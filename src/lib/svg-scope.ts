import { generate, parse, walk } from 'css-tree'

interface PrefixResult {
  css: string
  changed: boolean
  allScoped: boolean
  warnings: string[]
}

const ID_SAFE_PATTERN = /[^\p{Letter}\p{Number}_-]+/gu

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
    const ast = parse(css, { parseAtrulePrelude: true, parseRulePrelude: true })
    let changed = false
    let allScoped = true
    const warnings: string[] = []
    const aliasSet = new Set(
      aliases.filter(
        (name) => name && name !== id
      )
    )

    walk(ast, {
      enter(node) {
        if (node.type !== 'Rule' || node.prelude.type !== 'SelectorList') {
          return
        }

        node.prelude.children.forEach((selector) => {
          let hadTargetBefore = false
          let hadAliasBefore = false
          let hasOtherId = false

          selector.children.forEach((child) => {
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
            changed = true
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
          changed = true
        })
      },
    })

    return {
      css: generate(ast),
      changed,
      allScoped,
      warnings,
    }
  } catch (error) {
    return {
      css,
      changed: false,
      allScoped: false,
      warnings: [
        '无法解析样式文本，已跳过自动作用域处理。请手动检查这段 CSS。',
      ],
    }
  }
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
}

interface ScopeOptions {
  desiredId?: string
  fileName?: string
  forceNewId?: boolean
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
    }
  }

  const svg = doc.documentElement
  if (!svg || svg.tagName.toLowerCase() !== 'svg') {
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
    }
  }

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
    const blockScopedAfter = prefixResult.allScoped || prefixResult.changed
    scopedAfter = scopedAfter && blockScopedAfter
    if (prefixResult.changed) {
      changed = true
      style.textContent = prefixResult.css
    }
    warnings.push(...prefixResult.warnings)
  })

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
  }
}
