import type { PolicyOcrPageChunk, PolicyOcrResultSummary } from '@hasarbotu/contracts'
import type { PolicyOcrLanguageMode } from '@hasarbotu/domain'

export interface PolicyOcrWorkerInput {
  readonly filePath: string
  readonly languageAssetDirectory: string
  readonly ocrRunId: string
  readonly ocrRunVersion: number
  readonly sourceHash: string
  readonly sourceSize: number
  readonly languageMode: PolicyOcrLanguageMode
  readonly languageDataHash: string
  readonly renderProfileVersion: 'policy-ocr-render-standard/1.0.0' | 'policy-ocr-render-high-quality/1.0.0'
  readonly qualityVersion: 'policy-ocr-quality/1.0.0'
  readonly locatorVersion: 'policy-ocr-locator/1.0.0'
  readonly eligiblePages: readonly {
    readonly textPageId: string
    readonly pageNumber: number
    readonly sourcePageStatus: 'image_only' | 'text'
  }[]
  readonly renderDpi: number
  readonly maxImagePixels: number
  readonly maxPageCharacters: number
  readonly maxTotalCharacters: number
  readonly maxElementsPerPage: number
}

export type PolicyOcrWorkerMessage =
  | { readonly kind: 'phase'; readonly phase: 'rendering' | 'preprocessing' | 'recognizing' | 'normalizing' | 'validating' }
  | { readonly kind: 'page'; readonly page: PolicyOcrPageChunk }
  | { readonly kind: 'complete'; readonly summary: PolicyOcrResultSummary }
  | { readonly kind: 'error'; readonly errorCode: string }
