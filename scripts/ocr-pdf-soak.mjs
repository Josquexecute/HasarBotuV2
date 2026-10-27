import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createCanvas, loadImage, PDFDocument } from '@napi-rs/canvas'
import { PDF_TEXT_PARSER_VERSION, policyOcrLanguageDataHash } from '@hasarbotu/domain'
import { extractPdfText } from '../services/file-agent/dist/pdf-text-extractor.js'
import { extractPolicyOcr } from '../services/file-agent/dist/policy-ocr-extractor.js'
import { getActiveExtractionMemory, getExtractionProcessPeakRss } from '../services/file-agent/dist/extraction-process.js'

import { summarizeMemory } from './soak-metrics.mjs'
import { assertMemoryGrowth } from './soak-memory-budget.mjs'

if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Node.js 24.x is required')
if (typeof global.gc !== 'function') throw new Error('Run with --expose-gc')
process.env.HASARBOTU_EXTRACTION_MEMORY_METRICS = '1'
const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--(duration-ms|concurrency|output|max-rss-mib|max-growth-mib|cycle-rounds|idle-ms)=(.+)$/.exec(arg)
  if (!match) throw new Error('Unknown option: ' + arg)
  return [match[1], match[2]]
}))
function integer(name, fallback, min, max) {
  const value = Number(options[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid ' + name)
  return value
}
const durationMs = integer('duration-ms', 600000, 1000, 7 * 86400000)
const concurrency = integer('concurrency', 2, 1, 8)
const cycleRounds = integer('cycle-rounds', 0, 0, 10000)
const idleMs = integer('idle-ms', 10000, 0, 60000)
const memoryPolicy = 'process-tree-matched-loaded-idle/2'
const maxRss = integer('max-rss-mib', 4096, 64, 65536) * 1048576
const maxGrowth = integer('max-growth-mib', 128, 1, 65536) * 1048576
if (!options.output) throw new Error('--output=<new-result.json> is required')
const output = resolve(options.output)
// Refuse to overwrite earlier evidence, including accidental duplicate invocations.
await writeFile(output, '', { flag: 'wx' })
const scratch = await mkdtemp(join(tmpdir(), 'hb-soak-'))
const temporaryRoot = join(scratch, 'temp')
await mkdir(temporaryRoot)
const previousTemp = process.env.TEMP
const previousTmp = process.env.TMP
process.env.TEMP = temporaryRoot
process.env.TMP = temporaryRoot
const started = Date.now()
const counts = { pdfJobs: 0, pdfPages: 0, ocrJobs: 0, ocrPages: 0, expectedFailures: 0, integrityAssertions: 0 }
const samples = []
const peaks = { rss: 0, parentRss: 0, childProcessesRss: 0, heapUsed: 0, external: 0 }
let budgetExceeded = false
let interrupted = false
const stop = () => { interrupted = true }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
const originalHashes = new Map()
const failureResults = []
const uuid = (n) => `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`
const digest = (buffer) => createHash('sha256').update(buffer).digest('hex')
function memoryPeak() {
  const m = process.memoryUsage()
  const currentChildren = getActiveExtractionMemory().reduce((sum, child) => sum + child.rss, 0)
  // Conservative: simultaneous child high-water marks also capture sub-250ms jobs.
  const childrenRss = Math.max(currentChildren, getExtractionProcessPeakRss())
  peaks.parentRss = Math.max(peaks.parentRss, m.rss)
  peaks.childProcessesRss = Math.max(peaks.childProcessesRss, childrenRss)
  peaks.rss = Math.max(peaks.rss, m.rss + childrenRss)
  for (const name of ['heapUsed', 'external']) peaks[name] = Math.max(peaks[name], m[name])
  if (m.rss + childrenRss > maxRss) budgetExceeded = true
}
const interval = setInterval(memoryPeak, 250)
interval.unref()

function textPdf(pages) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${Array.from({length:pages}, (_,i)=>`${4+i*2} 0 R`).join(' ')}] /Count ${pages} >>`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  for (let i = 0; i < pages; i++) {
    const pageId = 4+i*2
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId+1} 0 R >>`)
    const text = `BT /F1 14 Tf 50 750 Td (SYNTHETIC POLICY PAGE ${i+1} CLAIM LOAD INTEGRITY) Tj ET`
    objects.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`)
  }
  let body='%PDF-1.4\n', offsets=[0]
  for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(body));body+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`}
  const xref=Buffer.byteLength(body)
  body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body)
}
async function imagePdf(pages) {
  const pdf = new PDFDocument({ rasterDPI: 144 })
  for(let i=0;i<pages;i++) {
    const canvas=createCanvas(900,1200), ctx=canvas.getContext('2d')
    ctx.fillStyle='white';ctx.fillRect(0,0,900,1200)
    ctx.fillStyle='black';ctx.font='bold 42px Arial';ctx.fillText('KASKO POLICY CAM COVERAGE',40,100)
    ctx.font='32px Arial';ctx.fillText(`SYNTHETIC PAGE ${i+1}`,40,180)
    ctx.fillText('Muafiyet kontrol gerektirir',40,250)
    const image=await loadImage(canvas.toBuffer('image/png'))
    const page=pdf.beginPage(450,600)
    page.drawImage(image,0,0,450,600)
    pdf.endPage()
    canvas.width=1;canvas.height=1
  }
  return pdf.close()
}
let pdfPayload, ocrPayload
async function assertTempClean() {
  assert.deepEqual(await readdir(temporaryRoot),[])
  counts.integrityAssertions++
}
async function runSuccess(kind) {
  const payload=kind==='pdf'?pdfPayload:ocrPayload
  const chunks=[]
  const extract=kind==='pdf'?extractPdfText:extractPolicyOcr
  const result=await extract(scratch,payload,{onChunk:async chunk=>{chunks.push(chunk)}})
  assert.equal(result.outcome,'verified',JSON.stringify(result))
  const pages=chunks.flatMap(c=>c.pages),expected=kind==='pdf'?20:3
  assert.deepEqual(chunks.map(c=>c.sequence),Array.from({length:expected},(_,i)=>i))
  assert.deepEqual(pages.map(p=>p.pageNumber),Array.from({length:expected},(_,i)=>i+1))
  for(const page of pages)assert.match(page.normalizedText,/POLICY/)
  const summary=kind==='pdf'?result.pdfExtraction:result.policyOcr
  const hash=summary.outputHash
  if(originalHashes.has(kind))assert.equal(hash,originalHashes.get(kind))
  else originalHashes.set(kind,hash)
  assert.equal(summary.sourceHash,payload.declaredHash)
  counts[`${kind}Jobs`]++;counts[`${kind}Pages`]+=expected;counts.integrityAssertions+=5
}

async function runBatch() {
  const batch = await Promise.allSettled(Array.from({length:concurrency}, async () => {
    for(let i=0;i<3;i++) await runSuccess('pdf')
    await runSuccess('ocr')
  }))
  const failure = batch.find(r => r.status === 'rejected')
  if (failure) throw failure.reason
}

async function runFailure(kind, scenario) {
  const extract=kind==='pdf'?extractPdfText:extractPolicyOcr
  const payload={...(kind==='pdf'?pdfPayload:ocrPayload)}
  const hooks={onChunk:async()=>undefined}
  let expected
  if(scenario==='timeout') {payload.timeoutMs=50;hooks.workerUrl=pathToFileURL(resolve('services/file-agent/test/fixtures/hanging-worker.mjs'));expected=kind==='pdf'?'parser_timeout':'ocr_timeout'}
  else if(scenario==='chunk') {hooks.onChunk=async()=>{throw new Error('synthetic_offline')};expected='chunk_upload_failed'}
  else if(scenario==='heartbeat') {hooks.onHeartbeat=async(phase)=>{if(phase==='recognizing')throw new Error('synthetic_offline')};expected='heartbeat_failed'}
  else if(scenario==='limit') {if(kind==='pdf')payload.maxPageCharacters=1;else payload.maxImagePixels=100;expected=kind==='pdf'?'output_limit_exceeded':'image_pixel_limit_exceeded'}
  else if(scenario==='malformed') {const buffer=Buffer.from('%PDF-broken');payload.relativePath='broken.pdf';payload.declaredHash=digest(buffer);payload.declaredSize=buffer.length;expected='malformed_pdf'}
  const result=await extract(scratch,payload,hooks)
  assert.deepEqual(result,{outcome:'failed',errorCode:expected})
  counts.expectedFailures++;failureResults.push({kind,scenario,errorCode:expected})
  await assertTempClean()
}
async function sample(stage, memoryPhase = 'prewarm') {
  global.gc?.()
  await new Promise(resolve=>setImmediate(resolve))
  const native=process.platform === 'win32' ? JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',`$p=Get-Process -Id ${process.pid}; @{handles=$p.HandleCount;threads=$p.Threads.Count;privateBytes=$p.PrivateMemorySize64}|ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true})) : {}
  const resourceCounts={}
  for(const key of process.getActiveResourcesInfo())resourceCounts[key]=(resourceCounts[key]??0)+1
  assert.equal(resourceCounts.MessagePort??0,0)
  assert.equal(getActiveExtractionMemory().length,0, 'Extraction child still owned after job completion')
  memoryPeak()
  await assertTempClean()
  samples.push({stage,memoryPhase,pid:process.pid,rssScope:'parent-process-at-drained-job-boundary',elapsedMs:Date.now()-started,...process.memoryUsage(),...native,resourceCounts,counts:{...counts}})
  const baseline = samples.find(s => s.stage === (memoryPhase === 'idle' ? 'idle-warm' : 'concurrency-warm'))
  if (memoryPhase !== 'prewarm') assertMemoryGrowth(samples.at(-1), baseline, maxGrowth)
  assert.equal(budgetExceeded, false, 'Peak RSS budget exceeded')
  await writeFile(output,JSON.stringify({status:'RUNNING',configuration:{durationMs,concurrency,maxRss,maxGrowth,cycleRounds,idleMs,memoryPolicy},node:process.version,startedAt:new Date(started).toISOString(),durationMs:Date.now()-started,counts,peaks,samples,failureResults},null,2))
  console.log(JSON.stringify({stage,elapsedSeconds:Math.round((Date.now()-started)/1000),counts,rssMB:Math.round(process.memoryUsage().rss/1048576),native}))
}
let result
try {
  const pdfBuffer=textPdf(20), ocrBuffer=await imagePdf(3)
  await writeFile(join(scratch,'text.pdf'),pdfBuffer)
  await writeFile(join(scratch,'ocr.pdf'),ocrBuffer)
  await writeFile(join(scratch,'broken.pdf'),Buffer.from('%PDF-broken'))
  pdfPayload={kind:'pdf_text_extraction',extractionId:uuid(1),extractionVersion:1,storageRootKey:'anonymous-soak',relativePath:'text.pdf',declaredHash:digest(pdfBuffer),declaredSize:pdfBuffer.length,parserVersion:PDF_TEXT_PARSER_VERSION,normalizationVersion:'pdf-text-normalization/1.0.0',maxSourceBytes:64000000,maxPages:500,maxPageCharacters:200000,maxTotalCharacters:5000000,timeoutMs:30000,workerMemoryMb:192}
  ocrPayload={kind:'policy_ocr',ocrRunId:uuid(2),ocrRunVersion:1,textExtractionId:uuid(1),storageRootKey:'anonymous-soak',relativePath:'ocr.pdf',declaredHash:digest(ocrBuffer),declaredSize:ocrBuffer.length,languageMode:'tur+eng',languageDataVersion:'tessdata-4.0.0-full/1.0.0',languageDataHash:policyOcrLanguageDataHash('tur+eng'),engineVersion:'7.0.0',renderProfile:'standard',renderProfileVersion:'policy-ocr-render-standard/1.0.0',preprocessingVersion:'policy-ocr-preprocessing/1.0.0',qualityVersion:'policy-ocr-quality/1.0.0',normalizationVersion:'policy-ocr-normalization/1.0.0',locatorVersion:'policy-ocr-locator/1.0.0',renderDpi:300,eligiblePages:[1,2,3].map(n=>({textPageId:uuid(n+10),pageNumber:n,sourcePageStatus:'image_only'})),maxSourceBytes:64000000,maxImagePixels:30000000,maxPageCharacters:200000,maxTotalCharacters:5000000,maxElementsPerPage:20000,timeoutMs:120000,workerMemoryMb:512}
  await sample('baseline')
  await runSuccess('pdf');await runSuccess('ocr');await sample('warm')
  for(const kind of ['pdf','ocr']) for(const scenario of ['timeout','chunk','limit','malformed']) await runFailure(kind,scenario)
  await runFailure('ocr','heartbeat')
  await sample('failures')
  // One predeclared batch with the exact production test concurrency and job mix.
  // The old single serial job was not a matching reference for two live OCR lanes.
  await runBatch(); await sample('concurrency-warm', 'loaded')
  await new Promise(done => setTimeout(done, idleMs))
  await sample('idle-warm', 'idle')
  let round=0
  while(Date.now()-started<durationMs && !interrupted) {
    await runBatch()
    round++
    assert.equal(budgetExceeded, false, 'Peak RSS budget exceeded')
    if (cycleRounds > 0 && round % cycleRounds === 0) {
      await sample(`loaded-cycle-${round / cycleRounds}`, 'loaded')
      await new Promise(done => setTimeout(done, idleMs))
      await sample(`idle-cycle-${round / cycleRounds}`, 'idle')
    }
    if (Date.now() - started - samples.at(-1).elapsedMs >= 30000) {
      await sample(`round-${round}`, 'loaded')
    }
  }
  assert.equal(interrupted, false, 'Run interrupted before acceptance completed')
  await runFailure('pdf','timeout');await runFailure('ocr','timeout')
  await runBatch();await sample('recovery', 'loaded')
  await new Promise(done=>setTimeout(done,idleMs));await sample('recovery-idle', 'idle')
  const warm=samples.filter(s=>s.stage.startsWith('round-'))
  const last=warm.slice(-Math.min(5,warm.length))
  const rssRange=last.length?Math.max(...last.map(s=>s.rss))-Math.min(...last.map(s=>s.rss)):null
  const handleRange=last.length?Math.max(...last.map(s=>s.handles))-Math.min(...last.map(s=>s.handles)):null
  result={status:'PASS_BOUNDED_SOAK',configuration:{durationMs,concurrency,maxRss,maxGrowth,cycleRounds,idleMs,memoryPolicy},memoryAnalysis:{loaded:summarizeMemory(samples.filter(s=>s.memoryPhase==='loaded')),idle:summarizeMemory(samples.filter(s=>s.memoryPhase==='idle'))},startedAt:new Date(started).toISOString(),node:process.version,durationMs:Date.now()-started,counts,peaks,samples,failureResults,lastFiveSamples:{rssRange,handleRange},sourceHashes:{pdf:pdfPayload.declaredHash,ocr:ocrPayload.declaredHash},productionMutations:0,limitations:['Local synthetic extractor workload only; no API queue/WAN/customer acceptance or proof of absence of leaks','An already-started hook cannot be canceled by extractor API; queued hooks are suppressed after failure']}
}catch(error) {
  result={status:interrupted?'INTERRUPTED':'FAIL',configuration:{durationMs,concurrency,maxRss,maxGrowth,cycleRounds,idleMs,memoryPolicy},durationMs:Date.now()-started,error:String(error),stack:error.stack,counts,peaks,samples,failureResults}
  process.exitCode=interrupted?130:1
}finally {
  clearInterval(interval)
  process.off('SIGINT', stop)
  process.off('SIGTERM', stop)
  if(previousTemp===undefined)delete process.env.TEMP;else process.env.TEMP=previousTemp
  if(previousTmp===undefined)delete process.env.TMP;else process.env.TMP=previousTmp
  await rm(scratch,{recursive:true,force:true})
  await writeFile(output,JSON.stringify(result,null,2))
}
console.log(JSON.stringify({status:result.status,durationMs:result.durationMs,counts,resultFile:output}))
