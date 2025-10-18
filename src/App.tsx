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
import type { SvgEntry } from '@/lib/types'

const generateEntryId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `entry-${Math.random().toString(36).slice(2, 10)}`

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const copyTimeoutRef = useRef<number | null>(null)

  const [entries, setEntries] = useState<SvgEntry[]>([])
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const [copiedEntryId, setCopiedEntryId] = useState<string | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current)
      }
    }
  }, [])

  const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files?.length) {
      return
    }

    const newEntries: SvgEntry[] = Array.from(files).map((file) => ({
      id: generateEntryId(),
      fileName: file.name,
      desiredId: '',
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

        const scoped = scopeSvgContent(content, {
          fileName: file.name,
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
