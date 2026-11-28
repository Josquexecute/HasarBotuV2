interface CaseFolderBrowsePath {
  readonly caseId: string
  readonly path: readonly string[]
  readonly locationVersion?: number
}

export type CaseFolderBrowseRequest = CaseFolderBrowsePath & (
  | { readonly action: 'list' | 'reveal' }
  | { readonly action: 'preview'; readonly page?: number }
  | { readonly action: 'add'; readonly locationVersion: number }
  | { readonly action: 'paste'; readonly locationVersion: number; readonly source: readonly string[]; readonly names: readonly string[] }
)

export const CASE_FOLDER_COPY_LIMIT = 500

export type CaseFolderEntry =
  | { readonly name: string; readonly kind: 'directory' }
  | { readonly name: string; readonly kind: 'file'; readonly size: number | null; readonly modifiedAt: string | null }

export interface CaseFolderListing {
  readonly kind: 'listed'
  readonly rootName: string
  readonly locationVersion: number
  readonly entries: readonly CaseFolderEntry[]
}

export type CaseFolderPreview =
  | { readonly kind: 'image'; readonly src: string }
  | { readonly kind: 'pdf'; readonly src: string; readonly page: number; readonly pageCount: number }
  | { readonly kind: 'text'; readonly text: string; readonly truncated?: boolean }
  | { readonly kind: 'word'; readonly paragraphs: readonly string[]; readonly truncated: boolean }
  | { readonly kind: 'workbook'; readonly sheets: readonly { readonly name: string; readonly rows: readonly (readonly string[])[] }[]; readonly truncated: boolean }
  | { readonly kind: 'unsupported' }

export type CaseFolderBrowseResult = CaseFolderListing | CaseFolderPreview
  | { readonly kind: 'revealed' }
  | { readonly kind: 'copied'; readonly count: number; readonly skipped: number }
  | { readonly kind: 'error'; readonly message: string; readonly reset?: boolean }
