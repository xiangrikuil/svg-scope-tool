import type { SvgScopeResult } from '@/lib/svg-scope'

export type LevelRectId = 'level' | 'level1' | 'level2'

export interface SvgEntry {
  id: string
  fileName: string
  rawContent: string
  desiredId: string
  levelTransitionSeconds: Partial<Record<LevelRectId, number>>
  result: SvgScopeResult | null
  error: string | null
  isProcessing: boolean
}
