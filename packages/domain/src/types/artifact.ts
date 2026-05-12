export type ClauseStatus = 'agreed' | 'open' | 'contested'
export type Criticality = 'low' | 'medium' | 'high'

export interface ClauseRegion {
  span: { start: number; end: number }
  clause_type: string
  status: ClauseStatus
  criticality_default: Criticality
  last_changed_at_version: number
}

export interface Artifact {
  markdown: string
  version: number
  overlay: ClauseRegion[]
  open_issues: string[]
  changelog: string
}

export function emptyArtifact(): Artifact {
  return {
    markdown: '',
    version: 0,
    overlay: [],
    open_issues: [],
    changelog: '',
  }
}
