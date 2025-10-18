import type { SvgScopeResult } from '@/lib/svg-scope'

export interface SvgEntry {
  id: string
  fileName: string
  rawContent: string
  desiredId: string
  result: SvgScopeResult | null
  error: string | null
  isProcessing: boolean
}
