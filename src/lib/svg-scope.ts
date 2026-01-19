import { generate, parse, walk } from 'css-tree'

interface PrefixResult {
  css: string
  changed: boolean
  selectorsChanged: boolean
  transitionsStripped: boolean
  allScoped: boolean
  warnings: string[]
}

const ID_SAFE_PATTERN = /[^\p{Letter}\p{Number}_-]+/gu
const VENDOR_PREFIX_PATTERN = /^-[a-z]+-/
const LEVEL_RECT_IDS = ['level', 'level1', 'level_1', 'level2'] as const

type LevelRectId = (typeof LEVEL_RECT_IDS)[number]
type LevelTransitionSeconds = Partial<Record<LevelRectId, number>>

function isTransitionProperty(property: string) {
  const normalized = property.trim().toLowerCase()
  const withoutVendor = normalized.replace(VENDOR_PREFIX_PATTERN, '')
  return (
    withoutVendor === 'transition' || withoutVendor.startsWith('transition-')
  )
}

function sanitizeId(value: string) {
  const normalized = value.normalize('NFKC')
  const replaced = normalized.replace(ID_SAFE_PATTERN, '-')
  const collapsed = replaced
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
  if (!collapsed) return ''
  if (/^[0-9]/.test(collapsed)) {
    return `svg-${collapsed}`
  }
  return collapsed
}

function generateSvgId() {
  return `svg-${Math.random().toString(36).slice(2, 10)}`
}

function prefixCssSelectors(
  css: string,
  id: string,
  aliases: string[]
): PrefixResult {
  try {
    const ast = parse(css, {
      parseAtrulePrelude: true,
      parseRulePrelude: true,
    }) as any
    let selectorsChanged = false
    let transitionsStripped = false
    let allScoped = true
    const warnings: string[] = []
    const aliasSet = new Set(
      aliases.filter((name) => name && name !== id)
    )

    ;(walk as any)(ast, {
      enter(node: any, item: any, list: any) {
        if (node.type === 'Declaration' && isTransitionProperty(node.property)) {
          if (list && item) {
            list.remove(item)
            transitionsStripped = true
          }
          return
        }

        if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList') {
          return
        }

        node.prelude.children.forEach((selector: any) => {
          let hadTargetBefore = false
          let hadAliasBefore = false
          let hasOtherId = false

          selector.children.forEach((child: any) => {
            if (child.type !== 'IdSelector') {
              return
            }
            if (child.name === id) {
              hadTargetBefore = true
              return
            }
            if (aliasSet.has(child.name)) {
              hadAliasBefore = true
              child.name = id
              return
            }
            hasOtherId = true
          })

          if (hadAliasBefore) {
            selectorsChanged = true
          }

          const wasScoped = hadTargetBefore || hadAliasBefore
          allScoped = allScoped && wasScoped

          if (wasScoped) {
            return
          }

          if (hasOtherId) {
            warnings.push(
              `选择器 "${generate(selector)}" 中已经存在其他 #id，将跳过自动作用域处理。`
            )
            return
          }

          if (selector.children.isEmpty) {
            return
          }

          selector.children.prependData({
            type: 'Combinator',
            name: ' ',
          })
          selector.children.prependData({
            type: 'IdSelector',
            name: id,
          })
          selectorsChanged = true
        })
      },
    })

    const changed = selectorsChanged || transitionsStripped
    return {
      css: generate(ast),
      changed,
      selectorsChanged,
      transitionsStripped,
      allScoped,
      warnings,
    }
  } catch (error) {
    return {
      css,
      changed: false,
      selectorsChanged: false,
      transitionsStripped: false,
      allScoped: false,
      warnings: [
        '无法解析样式文本，已跳过自动作用域处理。请手动检查这段 CSS。',
      ],
    }
  }
}

function stripTransitionFromInlineStyle(styleValue: string) {
  const trimmed = styleValue.trim()
  if (!trimmed) return { style: styleValue, changed: false }

  try {
    const ast = parse(trimmed, { context: 'declarationList' }) as any
    let changed = false

    ;(walk as any)(ast, {
      enter(node: any, item: any, list: any) {
        if (node.type !== 'Declaration') return
        if (!isTransitionProperty(node.property)) return
        if (list && item) {
          list.remove(item)
          changed = true
        }
      },
    })

    const next = generate(ast).trim()
    return { style: next, changed }
  } catch {
    const next = trimmed
      .replace(
        /(^|;)\s*(-[a-z]+-)?transition(-[a-z-]+)?\s*:[^;]*;?/gi,
        '$1'
      )
      .replace(/;{2,}/g, ';')
      .replace(/^\s*;\s*/g, '')
      .trim()

    return { style: next, changed: next !== trimmed }
  }
}

function parseSvgNumber(value: string | null) {
  if (!value) return null
  const num = Number.parseFloat(value)
  return Number.isFinite(num) ? num : null
}

function formatSvgNumber(value: number) {
  const rounded = Math.round(value * 1000) / 1000
  return `${rounded}`
}

function formatCssSeconds(value: number) {
  const rounded = Math.round(value * 1000) / 1000
  return `${rounded}s`
}

function appendInlineStyle(styleValue: string, declaration: string) {
  const trimmed = styleValue.trim()
  if (!trimmed) return declaration.trim()
  const joiner = trimmed.endsWith(';') ? ' ' : '; '
  return `${trimmed}${joiner}${declaration.trim()}`
}

function ensureLevelRectTransform(rect: SVGRectElement) {
  const x = parseSvgNumber(rect.getAttribute('x')) ?? 0
  const y = parseSvgNumber(rect.getAttribute('y')) ?? 0
  const width = parseSvgNumber(rect.getAttribute('width'))
  const height = parseSvgNumber(rect.getAttribute('height'))

  if (width === null || height === null) return false

  const cx = x + width / 2
  const cy = y + height / 2
  const rotate = `rotate(180 ${formatSvgNumber(cx)} ${formatSvgNumber(cy)})`
  const existing = rect.getAttribute('transform')?.trim() ?? ''
  if (existing.includes(rotate)) return false

  rect.setAttribute('transform', existing ? `${existing} ${rotate}` : rotate)
  return true
}

function ensureLevelRectTransitionInlineStyle(rect: SVGRectElement, seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return false

  const existingStyle = rect.getAttribute('style') ?? ''
  const declaration = `transition: height ${formatCssSeconds(seconds)};`
  const nextStyle = appendInlineStyle(existingStyle, declaration)
  if (nextStyle === existingStyle) return false
  rect.setAttribute('style', nextStyle)
  return true
}

function applyLevelEnhancements(
  svg: SVGSVGElement,
  levelTransitionSeconds?: LevelTransitionSeconds
) {
  const rectIds = LEVEL_RECT_IDS.filter((rectId) =>
    svg.querySelector(`rect#${rectId}`)
  ) as LevelRectId[]

  if (!rectIds.length) {
    return { changed: false, rectIds: [] as LevelRectId[] }
  }

  let changed = false
  rectIds.forEach((rectId) => {
    const rect = svg.querySelector(`rect#${rectId}`) as SVGRectElement | null
    if (!rect) return
    changed = ensureLevelRectTransform(rect) || changed
    const seconds = levelTransitionSeconds?.[rectId] ?? 5
    changed = ensureLevelRectTransitionInlineStyle(rect, seconds) || changed
  })

  return { changed, rectIds }
}

export interface SvgScopeResult {
  ok: boolean
  error?: string
  svgId: string
  generatedId: boolean
  scopedBefore: boolean
  scopedAfter: boolean
  changed: boolean
  processed: string
  classes: string[]
  warnings: string[]
  levelRects: LevelRectId[]
}

interface ScopeOptions {
  desiredId?: string
  fileName?: string
  forceNewId?: boolean
  levelTransitionSeconds?: LevelTransitionSeconds
}

function deriveIdFromFileName(fileName?: string) {
  if (!fileName) return ''
  const baseName = fileName.replace(/\.[^/.\\]+$/g, '')
  const sanitizedBase = sanitizeId(baseName)
  if (!sanitizedBase) {
    return ''
  }
  const suffix = Math.floor(Math.random() * 9000 + 1000).toString()
  return `${sanitizedBase}-${suffix}`
}

export function scopeSvgContent(
  svgContent: string,
  options: ScopeOptions = {}
): SvgScopeResult {
  const { desiredId, fileName, forceNewId = false } = options
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgContent, 'image/svg+xml')
  const parserError = doc.querySelector('parsererror')

  if (parserError) {
    return {
      ok: false,
      error: '无法解析 SVG 文件，请确认文件是否正确。',
      svgId: '',
      generatedId: false,
      scopedBefore: false,
      scopedAfter: false,
      changed: false,
      processed: svgContent,
      classes: [],
      warnings: [],
      levelRects: [],
    }
  }

  const root = doc.documentElement
  if (!root || root.tagName.toLowerCase() !== 'svg') {
    return {
      ok: false,
      error: '文件中没有找到 <svg> 根节点。',
      svgId: '',
      generatedId: false,
      scopedBefore: false,
      scopedAfter: false,
      changed: false,
      processed: svgContent,
      classes: [],
      warnings: [],
      levelRects: [],
    }
  }

  const svg = root as unknown as SVGSVGElement
  const currentId = svg.getAttribute('id')?.trim() ?? ''
  const sanitizedCurrentId = forceNewId ? '' : sanitizeId(currentId)
  const nextIdCandidate =
    !forceNewId && desiredId ? sanitizeId(desiredId) : ''
  const fileNameDerivedId = deriveIdFromFileName(fileName)
  const generatedId =
    forceNewId || (!sanitizedCurrentId && !nextIdCandidate)
  const targetId =
    nextIdCandidate ||
    sanitizedCurrentId ||
    fileNameDerivedId ||
    generateSvgId()

  if (!targetId) {
    return {
      ok: false,
      error: 'SVG id 为空且无法自动生成，请手动提供一个有效的 id。',
      svgId: '',
      generatedId: false,
      scopedBefore: false,
      scopedAfter: false,
      changed: false,
      processed: svgContent,
      classes: [],
      warnings: [],
      levelRects: [],
    }
  }

  if (currentId !== targetId) {
    svg.setAttribute('id', targetId)
  }

  const styleNodes = Array.from(svg.querySelectorAll('style'))
  const classes = new Set<string>()
  const warnings: string[] = []

  let scopedBefore = true
  let scopedAfter = true
  let changed = currentId !== targetId

  const aliasIds = Array.from(
    new Set(
      [
        currentId,
        sanitizedCurrentId,
        desiredId ?? '',
        desiredId ? sanitizeId(desiredId) : '',
      ]
        .filter(Boolean)
        .map((name) => name as string)
        .filter((name) => name !== targetId)
    )
  )

  styleNodes.forEach((style) => {
    const content = style.textContent ?? ''
    if (!content.trim()) {
      return
    }

    const classMatches = content.match(/\.[A-Za-z0-9_-]+/g) ?? []
    classMatches.forEach((match) => classes.add(match.replace('.', '')))

    const prefixResult = prefixCssSelectors(content, targetId, aliasIds)
    scopedBefore = scopedBefore && prefixResult.allScoped
    const blockScopedAfter =
      prefixResult.allScoped || prefixResult.selectorsChanged
    scopedAfter = scopedAfter && blockScopedAfter
    if (prefixResult.changed) {
      changed = true
      style.textContent = prefixResult.css
    }
    warnings.push(...prefixResult.warnings)
  })

  Array.from(svg.querySelectorAll('[style]')).forEach((node) => {
    const styleValue = node.getAttribute('style') ?? ''
    if (!styleValue.trim()) return

    const stripped = stripTransitionFromInlineStyle(styleValue)
    if (!stripped.changed) return

    changed = true
    if (!stripped.style) {
      node.removeAttribute('style')
      return
    }
    node.setAttribute('style', stripped.style)
  })

  const levelEnhancements = applyLevelEnhancements(
    svg,
    options.levelTransitionSeconds
  )
  if (levelEnhancements.changed) {
    changed = true
  }

  Array.from(svg.querySelectorAll('[class]')).forEach((node) => {
    const classValue = node.getAttribute('class')
    classValue
      ?.split(/\s+/)
      .filter(Boolean)
      .forEach((cls) => classes.add(cls))
  })

  const serializer = new XMLSerializer()
  const processed = serializer.serializeToString(svg)

  return {
    ok: true,
    svgId: targetId,
    generatedId,
    scopedBefore,
    scopedAfter,
    changed,
    processed,
    classes: Array.from(classes.values()).sort(),
    warnings,
    levelRects: levelEnhancements.rectIds,
  }
}
