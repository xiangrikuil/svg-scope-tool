import {
  type ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Upload,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { scopeSvgContent } from '@/lib/svg-scope'
import type { LevelRectId, SvgEntry } from '@/lib/types'

const generateEntryId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `entry-${Math.random().toString(36).slice(2, 10)}`

const DEFAULT_LEVEL_TRANSITION_SECONDS = 5
const LEVEL_RECT_IDS: LevelRectId[] = ['level', 'level1', 'level2']

function splitTopLevelCommas(value: string) {
  const segments: string[] = []
  let buffer = ''
  let depth = 0

  for (const ch of value) {
    if (ch === '(') depth += 1
    if (ch === ')' && depth > 0) depth -= 1

    if (ch === ',' && depth === 0) {
      segments.push(buffer)
      buffer = ''
      continue
    }
    buffer += ch
  }

  if (buffer) segments.push(buffer)
  return segments.map((seg) => seg.trim()).filter(Boolean)
}

function parseCssTimeToSeconds(token: string) {
  const match = token.trim().match(/^([0-9]*\.?[0-9]+)\s*(ms|s)\s*$/i)
  if (!match) return null
  const value = Number.parseFloat(match[1])
  if (!Number.isFinite(value)) return null
  const unit = match[2].toLowerCase()
  return unit === 'ms' ? value / 1000 : value
}

function extractTransitionSecondsFromStyle(styleValue: string) {
  const text = styleValue.trim()
  if (!text) return null

  const durationMatch = text.match(
    /(^|;)\s*(-[a-z]+-)?transition-duration\s*:\s*([^;]+)\s*;?/i
  )
  if (durationMatch?.[3]) {
    const timeMatch = durationMatch[3].match(/([0-9]*\.?[0-9]+\s*(?:ms|s))/i)
    if (timeMatch?.[1]) {
      const seconds = parseCssTimeToSeconds(timeMatch[1])
      if (seconds !== null) return seconds
    }
  }

  const shorthandMatch = text.match(
    /(^|;)\s*(-[a-z]+-)?transition\s*:\s*([^;]+)\s*;?/i
  )
  if (!shorthandMatch?.[3]) return null

  const segments = splitTopLevelCommas(shorthandMatch[3])
  const heightSegment =
    segments.find((seg) => /\bheight\b/i.test(seg)) ?? segments[0]
  if (!heightSegment) return null

  const times = Array.from(
    heightSegment.matchAll(/([0-9]*\.?[0-9]+)\s*(ms|s)\b/gi)
  )
  if (!times.length) return null

  return parseCssTimeToSeconds(`${times[0][1]}${times[0][2]}`)
}

function extractLevelTransitionSeconds(svgContent: string) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgContent, 'image/svg+xml')
  const result: Partial<Record<LevelRectId, number>> = {}

  LEVEL_RECT_IDS.forEach((rectId) => {
    const rect = doc.querySelector(`rect#${rectId}`)
    if (!rect) return
    const styleValue = rect.getAttribute('style') ?? ''
    const seconds = extractTransitionSecondsFromStyle(styleValue)
    result[rectId] = seconds ?? DEFAULT_LEVEL_TRANSITION_SECONDS
  })

  return result
}

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const copyTimeoutRef = useRef<number | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  const [entries, setEntries] = useState<SvgEntry[]>([])
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const [copiedEntryId, setCopiedEntryId] = useState<string | null>(null)
  const [levelDemoMaxHeights, setLevelDemoMaxHeights] = useState<
    Partial<Record<LevelRectId, number>>
  >({})
  const levelDemoRafRef = useRef<Partial<Record<LevelRectId, number>>>({})

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current)
      }
    }
  }, [])

  const handleApplyLevelTransitions = (entryId: string) => {
    setEntries((prev) => {
      const entry = prev.find((item) => item.id === entryId)
      if (!entry || !entry.rawContent) {
        return prev
      }

      const desiredId = entry.result?.ok ? entry.result.svgId : undefined
      const scoped = scopeSvgContent(entry.rawContent, {
        desiredId,
        fileName: entry.fileName,
        levelTransitionSeconds: entry.levelTransitionSeconds,
      })

      return prev.map((item) => {
        if (item.id !== entryId) return item
        if (!scoped.ok) {
          return {
            ...item,
            result: null,
            error: scoped.error ?? '无法处理该 SVG 文件。',
          }
        }

        return {
          ...item,
          result: scoped,
          error: null,
        }
      })
    })
  }

  const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files?.length) {
      return
    }

    const newEntries: SvgEntry[] = Array.from(files).map((file) => ({
      id: generateEntryId(),
      fileName: file.name,
      desiredId: '',
      levelTransitionSeconds: {
        level: DEFAULT_LEVEL_TRANSITION_SECONDS,
        level1: DEFAULT_LEVEL_TRANSITION_SECONDS,
        level2: DEFAULT_LEVEL_TRANSITION_SECONDS,
      },
      rawContent: '',
      result: null,
      error: null,
      isProcessing: true,
    }))

    setEntries((prev) => [...prev, ...newEntries])
    setActiveEntryId((prev) => prev ?? newEntries[0]?.id ?? null)

    Array.from(files).forEach((file, index) => {
      const entryId = newEntries[index].id
      const reader = new FileReader()

      reader.onload = () => {
        const content =
          typeof reader.result === 'string'
            ? reader.result
            : new TextDecoder('utf-8').decode(reader.result as ArrayBuffer)

        const entryLevelTransitionSeconds = {
          ...newEntries[index]?.levelTransitionSeconds,
          ...extractLevelTransitionSeconds(content),
        }
        const scoped = scopeSvgContent(content, {
          fileName: file.name,
          levelTransitionSeconds: entryLevelTransitionSeconds,
        })

        setEntries((prev) =>
          prev.map((item) => {
            if (item.id !== entryId) {
              return item
            }

            if (!scoped.ok) {
              return {
                ...item,
                rawContent: content,
                isProcessing: false,
                desiredId: '',
                result: null,
                error: scoped.error ?? '无法处理该 SVG 文件。',
              }
            }

            return {
              ...item,
              rawContent: content,
              isProcessing: false,
              desiredId: scoped.svgId,
              levelTransitionSeconds: {
                ...item.levelTransitionSeconds,
                ...entryLevelTransitionSeconds,
              },
              result: scoped,
              error: null,
            }
          })
        )
      }

      reader.onerror = () => {
        setEntries((prev) =>
          prev.map((item) =>
            item.id === entryId
              ? {
                  ...item,
                  isProcessing: false,
                  error: '读取文件时发生错误，请重试。',
                }
              : item
          )
        )
      }

      reader.readAsText(file)
    })

    event.target.value = ''
  }

  const handleApplyId = (entryId: string, forceNew = false) => {
    setEntries((prev) => {
      const entry = prev.find((item) => item.id === entryId)
      if (!entry || !entry.rawContent) {
        return prev
      }

      const trimmedDesired = entry.desiredId.trim()
      const scoped = scopeSvgContent(entry.rawContent, {
        desiredId: forceNew ? undefined : trimmedDesired || undefined,
        fileName: entry.fileName,
        forceNewId: forceNew,
        levelTransitionSeconds: entry.levelTransitionSeconds,
      })

      return prev.map((item) => {
        if (item.id !== entryId) {
          return item
        }

        if (!scoped.ok) {
          return {
            ...item,
            desiredId: trimmedDesired,
            result: null,
            error: scoped.error ?? '无法处理该 SVG 文件。',
          }
        }

        return {
          ...item,
          desiredId: scoped.svgId,
          result: scoped,
          error: null,
        }
      })
    })

    setCopiedEntryId((prev) => (prev === entryId ? null : prev))
  }

  const handleDownload = (entry: SvgEntry) => {
    if (!entry.result?.ok) return

    const blob = new Blob([entry.result.processed], {
      type: 'image/svg+xml',
    })
    const url = URL.createObjectURL(blob)
    const downloadName =
      entry.fileName.replace(/\.svg$/i, '') ||
      entry.result.svgId ||
      'scoped-svg'
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${downloadName}-scoped.svg`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const handleCopy = async (entry: SvgEntry) => {
    if (!entry.result?.ok) return
    try {
      await navigator.clipboard.writeText(entry.result.processed)
      setCopiedEntryId(entry.id)
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current)
      }
      copyTimeoutRef.current = window.setTimeout(
        () => setCopiedEntryId(null),
        2000
      )
    } catch {
      setEntries((prev) =>
        prev.map((item) =>
          item.id === entry.id
            ? {
                ...item,
                error: '无法写入剪贴板，请确认浏览器权限后重试。',
              }
            : item
        )
      )
    }
  }

  const activeEntry = useMemo(
    () => entries.find((item) => item.id === activeEntryId) ?? null,
    [entries, activeEntryId]
  )

  useEffect(() => {
    return () => {
      Object.values(levelDemoRafRef.current).forEach((rafId) => {
        if (typeof rafId === 'number') {
          window.cancelAnimationFrame(rafId)
        }
      })
    }
  }, [])

  const getPreviewSvg = () => {
    const container = previewRef.current
    if (!container) return null
    return container.querySelector('svg') as SVGSVGElement | null
  }

  const getPreviewLevelRect = (rectId: LevelRectId) => {
    const svg = getPreviewSvg()
    if (!svg) return null
    return svg.querySelector(`rect#${rectId}`) as SVGRectElement | null
  }

  const setLevelRectHeight = (rect: SVGRectElement, height: number) => {
    const rounded = Math.round(height * 1000) / 1000
    const value = `${rounded}`
    rect.setAttribute('height', value)
  }

  const cancelLevelDemoAnimation = (rectId: LevelRectId) => {
    const rafId = levelDemoRafRef.current[rectId]
    if (typeof rafId === 'number') {
      window.cancelAnimationFrame(rafId)
    }
    delete levelDemoRafRef.current[rectId]
  }

  const animateLevelRectHeight = (
    rectId: LevelRectId,
    fromHeight: number,
    toHeight: number,
    durationSeconds: number
  ) => {
    cancelLevelDemoAnimation(rectId)

    const rect = getPreviewLevelRect(rectId)
    if (!rect) return

    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      setLevelRectHeight(rect, toHeight)
      return
    }

    const durationMs = durationSeconds * 1000
    const start = performance.now()
    const ease = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2

    const step = (now: number) => {
      const progress = Math.min((now - start) / durationMs, 1)
      const currentHeight =
        fromHeight + (toHeight - fromHeight) * ease(progress)

      const nextRect = getPreviewLevelRect(rectId)
      if (!nextRect) {
        cancelLevelDemoAnimation(rectId)
        return
      }

      setLevelRectHeight(nextRect, currentHeight)

      if (progress < 1) {
        levelDemoRafRef.current[rectId] = window.requestAnimationFrame(step)
        return
      }

      cancelLevelDemoAnimation(rectId)
    }

    levelDemoRafRef.current[rectId] = window.requestAnimationFrame(step)
  }

  const handleRandomLevelDemo = () => {
    const result = activeEntry?.result
    if (!activeEntry || !result?.ok) return
    if (!result.levelRects.length) return

    LEVEL_RECT_IDS.filter((id) => result.levelRects.includes(id)).forEach(
      (rectId) => {
        const rect = getPreviewLevelRect(rectId)
        if (!rect) return

        const heightValue = Number.parseFloat(rect.getAttribute('height') ?? '')
        const fromHeight = Number.isFinite(heightValue) ? heightValue : 0
        const maxHeight =
          levelDemoMaxHeights[rectId] ??
          (fromHeight > 0 ? fromHeight : 100)
        const toHeight = maxHeight > 0 ? Math.random() * maxHeight : 0
        const durationSeconds =
          activeEntry.levelTransitionSeconds[rectId] ??
          DEFAULT_LEVEL_TRANSITION_SECONDS

        animateLevelRectHeight(rectId, fromHeight, toHeight, durationSeconds)
      }
    )
  }

  useEffect(() => {
    Object.values(levelDemoRafRef.current).forEach((rafId) => {
      if (typeof rafId === 'number') {
        window.cancelAnimationFrame(rafId)
      }
    })
    levelDemoRafRef.current = {}

    if (!activeEntry?.result?.ok) {
      setLevelDemoMaxHeights({})
      return
    }

    const svg = getPreviewSvg()
    if (!svg) return

    const viewBox = svg.getAttribute('viewBox')?.trim() ?? ''
    const viewBoxParts = viewBox.split(/[,\s]+/).filter(Boolean)
    const viewBoxHeight =
      viewBoxParts.length === 4 ? Number.parseFloat(viewBoxParts[3]) : Number.NaN
    const svgHeightFallback = Number.parseFloat(svg.getAttribute('height') ?? '')
    const fallbackMaxHeight =
      Number.isFinite(viewBoxHeight) && viewBoxHeight > 0
        ? viewBoxHeight
        : Number.isFinite(svgHeightFallback) && svgHeightFallback > 0
          ? svgHeightFallback
          : 100

    const nextMaxHeights: Partial<Record<LevelRectId, number>> = {}

    activeEntry.result.levelRects.forEach((rectId) => {
      const rect = svg.querySelector(`rect#${rectId}`) as SVGRectElement | null
      if (!rect) return

      const height = Number.parseFloat(rect.getAttribute('height') ?? '')
      const currentHeight = Number.isFinite(height) ? height : 0
      const maxHeight =
        currentHeight > 0 ? currentHeight : Math.max(1, fallbackMaxHeight)

      nextMaxHeights[rectId] = maxHeight
    })

    setLevelDemoMaxHeights(nextMaxHeights)
  }, [activeEntryId, activeEntry?.result?.processed])

  const statusBadges = useMemo(() => {
    if (!activeEntry?.result) return null

    const analysis = activeEntry.result
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={analysis.scopedBefore ? 'success' : 'warning'}>
          {analysis.scopedBefore ? (
            <span className="flex items-center gap-1">
              <ShieldCheck size={14} />
              原始样式已作用域
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <ShieldAlert size={14} />
              原始样式存在冲突
            </span>
          )}
        </Badge>
        <Badge variant={analysis.scopedAfter ? 'success' : 'destructive'}>
          {analysis.scopedAfter ? (
            <span className="flex items-center gap-1">
              <Check size={14} />
              已完成作用域处理
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <AlertTriangle size={14} />
              仍有选择器未自动处理
            </span>
          )}
        </Badge>
        <Badge variant="secondary">
          {analysis.changed ? '已更新 id / 样式' : '无需修改'}
        </Badge>
      </div>
    )
  }, [activeEntry])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">SVG Scope Tool</h1>
            <p className="text-sm text-muted-foreground">
              上传多个 SVG，自动检测并修正样式作用域，适合在 Vercel 等平台部署。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              上传 SVG
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-8">
        <input
          ref={fileInputRef}
          id="svg-upload"
          type="file"
          accept=".svg,image/svg+xml"
          className="hidden"
          onChange={handleFileSelection}
          multiple
        />

        <Card>
          <CardHeader>
            <CardTitle>上传 SVG 文件</CardTitle>
            <CardDescription>
              支持从 UI 工具导出的多个 SVG。本工具会检测 `.cls-*` 等类名是否已作用域，
              并自动加上对应的 id 选择器。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Label htmlFor="svg-upload" className="block">
              <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-muted-foreground/40 bg-muted/40 p-8 text-center transition hover:border-primary hover:bg-primary/5">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">
                    点击或拖拽文件到这里上传
                  </p>
                  <p className="text-xs text-muted-foreground">
                    仅限 .svg 文件，可一次选择多个文件进行批量修复。
                  </p>
                </div>
                {entries.length > 0 && (
                  <Badge variant="secondary">已上传 {entries.length} 个文件</Badge>
                )}
              </div>
            </Label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              选择文件
            </Button>
            {entries.some((entry) => entry.isProcessing) && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在解析文件…
              </p>
            )}
          </CardContent>
        </Card>

        {entries.length > 0 ? (
          <Card>
            <CardHeader className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <CardTitle>检测结果</CardTitle>
                  <CardDescription>
                    当前共上传 {entries.length} 个 SVG。选择下方文件可查看并调整其 id
                    与作用域信息。
                  </CardDescription>
                </div>
                {statusBadges}
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  文件列表
                </h2>
                <div className="grid gap-2 sm:grid-cols-2">
                  {entries.map((entry) => {
                    const isActive = activeEntryId === entry.id
                    const baseClass =
                      'flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'
                    const className = isActive
                      ? `${baseClass} border-primary bg-primary/10 text-primary`
                      : `${baseClass} border-border hover:border-primary/40 hover:bg-muted/60`

                    return (
                      <button
                        key={entry.id}
                        type="button"
                        className={className}
                        onClick={() => setActiveEntryId(entry.id)}
                        aria-pressed={isActive}
                      >
                        <span className="mr-2 truncate">{entry.fileName}</span>
                        {entry.isProcessing && (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                        )}
                        {!entry.isProcessing && entry.error && (
                          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                        )}
                        {!entry.isProcessing && entry.result?.ok && (
                          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
                        )}
                      </button>
                    )
                  })}
                </div>
              </section>

              {activeEntry ? (
                activeEntry.isProcessing ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {activeEntry.fileName} 正在处理，请稍候…
                  </p>
                ) : activeEntry.result?.ok ? (
                  <>
                    <section className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        当前 SVG 使用的 id 为{' '}
                        <code className="rounded bg-muted px-1 py-0.5 text-xs">
                          {activeEntry.result.svgId}
                        </code>
                        。可以手动输入新的 id 或点击重新生成以确保全局唯一。
                      </p>
                    </section>

                    <section className="flex flex-col gap-3 sm:flex-row sm:items-end">
                      <div className="flex-1 space-y-2">
                        <Label htmlFor="svg-id">自定义 SVG id</Label>
                        <Input
                          id="svg-id"
                          value={activeEntry.desiredId}
                          onChange={(event) =>
                            setEntries((prev) =>
                              prev.map((item) =>
                                item.id === activeEntry.id
                                  ? { ...item, desiredId: event.target.value }
                                  : item
                              )
                            )
                          }
                          placeholder="例如：unique-icon-id"
                        />
                      </div>
                      <Button
                        onClick={() => {
                          const trimmed = activeEntry.desiredId.trim()
                          const currentId = activeEntry.result?.svgId ?? ''
                          const shouldForceNew =
                            !trimmed || trimmed === currentId
                          handleApplyId(activeEntry.id, shouldForceNew)
                        }}
                        variant="secondary"
                      >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        重新生成
                      </Button>
                    </section>

                    <section className="space-y-3">
                      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        样式类名
                      </h2>
                      {activeEntry.result.classes.length ? (
                        <div className="flex flex-wrap gap-2">
                          {activeEntry.result.classes.map((cls) => (
                            <Badge key={cls} variant="outline">
                              .{cls}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          未检测到 `.cls-*` 类名。
                        </p>
                      )}
                    </section>

                    {activeEntry.result.warnings.length > 0 && (
                      <section className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <AlertTriangle size={16} />
                          无法自动处理的样式
                        </div>
                        <ul className="list-disc space-y-1 pl-5 text-sm">
                          {activeEntry.result.warnings.map((info, index) => (
                            <li key={index}>{info}</li>
                          ))}
                        </ul>
                      </section>
                    )}

                    <section className="space-y-3">
                      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        预览
                      </h2>
                        <div className="flex flex-col gap-4 lg:flex-row">
                          <div className="flex-1 rounded-lg border bg-white p-4 shadow-sm">
                            <div
                              ref={previewRef}
                              className="flex justify-center"
                              dangerouslySetInnerHTML={{
                                __html: activeEntry.result.processed,
                              }}
                            />
                        </div>
                          <div className="flex-1 space-y-3">
                            <div className="flex items-center gap-2">
                              <Button onClick={() => handleDownload(activeEntry)}>
                                <Download className="mr-2 h-4 w-4" />
                                下载修正后的 SVG
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() => handleCopy(activeEntry)}
                              >
                                <Copy className="mr-2 h-4 w-4" />
                                {copiedEntryId === activeEntry.id
                                  ? '已复制'
                                  : '复制代码'}
                              </Button>
                            </div>
                            {activeEntry.result.levelRects.length > 0 && (
                              <details className="rounded-lg border bg-muted/20 p-4">
                                <summary className="cursor-pointer select-none text-sm font-semibold">
                                  高级设置：液位动画 / 演示（
                                  {activeEntry.result.levelRects
                                    .map((id) => `#${id}`)
                                    .join('、')}
                                  ）
                                </summary>
                                <div className="mt-4 space-y-4">
                                  <div className="space-y-1">
                                    <p className="text-sm text-muted-foreground">
                                      可分别设置每个液位 rect 的 <code>height</code> 过渡时间（单位：秒；填{' '}
                                      <code>0</code> 表示不做动画）。
                                    </p>
                                  </div>
                                  <div className="grid gap-3 sm:grid-cols-3">
                                    {LEVEL_RECT_IDS.filter((id) =>
                                      activeEntry.result?.levelRects.includes(id)
                                    ).map((rectId) => (
                                      <div key={rectId} className="space-y-2">
                                        <Label
                                          htmlFor={`level-transition-${rectId}`}
                                        >
                                          {`#${rectId}`} 过渡时间（s）
                                        </Label>
                                        <Input
                                          id={`level-transition-${rectId}`}
                                          type="number"
                                          min={0}
                                          step={0.1}
                                          value={
                                            activeEntry.levelTransitionSeconds[
                                              rectId
                                            ] ?? DEFAULT_LEVEL_TRANSITION_SECONDS
                                          }
                                          onChange={(event) => {
                                            const next =
                                              event.target.value === ''
                                                ? 0
                                                : Number.parseFloat(
                                                    event.target.value
                                                  )
                                            setEntries((prev) =>
                                              prev.map((item) =>
                                                item.id === activeEntry.id
                                                  ? {
                                                      ...item,
                                                      levelTransitionSeconds: {
                                                        ...item.levelTransitionSeconds,
                                                        [rectId]: Number.isFinite(next)
                                                          ? next
                                                          : 0,
                                                      },
                                                    }
                                                  : item
                                              )
                                            )
                                          }}
                                        />
                                      </div>
                                    ))}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="secondary"
                                      onClick={() =>
                                        handleApplyLevelTransitions(activeEntry.id)
                                      }
                                    >
                                      应用液位动画
                                    </Button>
                                    <p className="text-xs text-muted-foreground">
                                      更新导出 SVG 内液位 rect 的内联{' '}
                                      <code>transition</code> 与 <code>transform</code>。
                                    </p>
                                  </div>

                                  <div className="space-y-3 rounded-lg border bg-background/60 p-4">
                                    <div className="space-y-1">
                                      <h3 className="text-sm font-semibold">
                                        高度演示
                                      </h3>
                                      <p className="text-xs text-muted-foreground">
                                        点击“随机演示”会在预览中随机修改液位高度，并按上方设置的秒数播放动画（仅影响预览，不会写入导出代码）。
                                      </p>
                                    </div>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={handleRandomLevelDemo}
                                    >
                                      随机演示
                                    </Button>
                                  </div>
                                </div>
                              </details>
                            )}
                            <Textarea
                              value={activeEntry.result.processed}
                              readOnly
                              className="h-64 font-mono text-xs"
                            />
                        </div>
                      </div>
                    </section>
                  </>
                ) : (
                  <section className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
                    <div className="flex items-center gap-2 font-semibold">
                      <AlertTriangle size={16} />
                      {activeEntry.error ?? '无法处理该 SVG 文件。'}
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      请检查文件内容或换用其它 SVG 文件。
                    </p>
                  </section>
                )
              ) : (
                <p className="text-sm text-muted-foreground">
                  请选择一个文件以查看详细信息。
                </p>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>如何使用</CardTitle>
              <CardDescription>
                还没有上传文件，点击上方上传区域即可开始。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                1. 上传需要检测的 SVG 文件，本工具会分析
                <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
                  &lt;style&gt;
                </code>
                中的类名。
              </p>
              <p>
                2. 若发现样式未作用域，会自动为每个选择器添加
                <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
                  #id
                </code>
                前缀。
              </p>
              <p>
                3. 下载修正后的 SVG 或复制源码，把它部署到 Vercel
                等静态站点上即可避免样式冲突。
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}

export default App
