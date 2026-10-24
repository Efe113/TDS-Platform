export type ReportLevel = 'error' | 'warning' | 'info'

export interface ReportIssue {
  level: ReportLevel
  code: string
  message: string
  path?: string
  sample?: string
}

export interface ImportStats {
  blocks: number
  sections: number
  images: number
  imageBytes: number
  steps: number
  unresolvedClauses: number
  inventory: number
  mediaSaved: number
}

export class ValidationReporter {
  readonly issues: ReportIssue[] = []

  add(level: ReportLevel, code: string, message: string, extra?: { path?: string; sample?: string }): void {
    const duplicated = this.issues.some(
      (issue) => issue.level === level && issue.code === code && issue.message === message && issue.path === extra?.path
    )
    if (duplicated) return
    this.issues.push({ level, code, message, path: extra?.path, sample: extra?.sample?.slice(0, 160) })
  }

  error(code: string, message: string, extra?: { path?: string; sample?: string }): void {
    this.add('error', code, message, extra)
  }

  warn(code: string, message: string, extra?: { path?: string; sample?: string }): void {
    this.add('warning', code, message, extra)
  }

  info(code: string, message: string, extra?: { path?: string; sample?: string }): void {
    this.add('info', code, message, extra)
  }

  get errors(): ReportIssue[] {
    return this.issues.filter((issue) => issue.level === 'error')
  }

  get warnings(): ReportIssue[] {
    return this.issues.filter((issue) => issue.level === 'warning')
  }

  get ok(): boolean {
    return this.errors.length === 0
  }
}

export interface ValidationReport {
  issues: ReportIssue[]
  errors: ReportIssue[]
  warnings: ReportIssue[]
  stats: ImportStats
  ok: boolean
}

export const emptyStats = (): ImportStats => ({
  blocks: 0,
  sections: 0,
  images: 0,
  imageBytes: 0,
  steps: 0,
  unresolvedClauses: 0,
  inventory: 0,
  mediaSaved: 0
})
