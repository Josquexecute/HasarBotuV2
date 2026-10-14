/** Type-specific rules cannot run until a user has classified an imported folder. */
export class CaseTypeRequiredError extends Error {
  readonly statusCode = 409
  constructor() {
    super('case_type_required')
    this.name = 'CaseTypeRequiredError'
  }
}

export function requireCaseType(value: 'traffic' | 'casco' | null): 'traffic' | 'casco' {
  if (value === null) throw new CaseTypeRequiredError()
  return value
}
