import { parentPort, workerData } from 'node:worker_threads'
import { extractOfficePreview } from './case-folder-office-preview.js'

const { bytes, format } = workerData as { bytes: Uint8Array; format: 'docx' | 'xlsx' }
parentPort?.postMessage(extractOfficePreview(bytes, format))
