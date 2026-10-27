import { Worker } from 'node:worker_threads'
import { writeFile, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { PDF_TEXT_PARSER_VERSION } from '@hasarbotu/domain'
import { extractPdfText } from '../services/file-agent/dist/pdf-text-extractor.js'

import { summarizeMemory } from './soak-metrics.mjs'
const [mode, countText, output, ...extra] = process.argv.slice(2)
const count = Number(countText)
if (Number(process.versions.node.split('.')[0]) !== 24 || typeof global.gc !== 'function') throw new Error('Node 24.x and --expose-gc required')
if (!['plain', 'native', 'pdf'].includes(mode) || !Number.isSafeInteger(count) || count < 60 || count > 100000 || !output || extra.length) throw new Error('Usage: node --expose-gc scripts/worker-memory-probe.mjs <plain|native|pdf> <60..100000 jobs> <new-output.json>')
await writeFile(output, '', {flag:'wx'})
const started=Date.now(),samples=[],root=await mkdtemp(join(tmpdir(),'hb-worker-memory-'))
const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [4 0 R] /Count 1 >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>']
const text='BT /F1 14 Tf 50 750 Td (SYNTHETIC POLICY) Tj ET'
objects.push(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`)
let body='%PDF-1.4\n',offsets=[0]
for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(body));body+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`}
const xref=Buffer.byteLength(body)
body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
const pdf=Buffer.from(body)
await writeFile(join(root,'policy.pdf'),pdf)
const payload={kind:'pdf_text_extraction',extractionId:'01900000-0000-7000-8000-000000000001',extractionVersion:1,storageRootKey:'test',relativePath:'policy.pdf',declaredHash:createHash('sha256').update(pdf).digest('hex'),declaredSize:pdf.length,parserVersion:PDF_TEXT_PARSER_VERSION,normalizationVersion:'pdf-text-normalization/1.0.0',maxSourceBytes:1000000,maxPages:20,maxPageCharacters:200000,maxTotalCharacters:5000000,timeoutMs:30000,workerMemoryMb:192}
async function sample(n){global.gc();await new Promise(r=>setImmediate(r));samples.push({n,elapsedMs:Date.now()-started,...process.memoryUsage(),resources:process.getActiveResourcesInfo()})}
try {
  await sample(0)
  for(let n=1;n<=count;n++){
    if(mode==='pdf'){
      const result=await extractPdfText(root,payload,{onChunk:async()=>undefined})
      if(result.outcome!=='verified')throw new Error(JSON.stringify(result))
    }else await new Promise((resolve,reject)=>{const worker=new Worker(mode==='native'?"require('@napi-rs/canvas')":'0',{eval:true});worker.once('error',reject);worker.once('exit',code=>code===0?resolve():reject(new Error(String(code))))})
    if(n%30===0)await sample(n)
  }
  await new Promise(r=>setTimeout(r,500));await sample(count+1)
  const result={status:'MEASURED',node:process.version,mode,count,durationMs:Date.now()-started,samples,memoryAnalysis:summarizeMemory(samples.filter(s=>s.n>=count/2)),interpretation:'Post-warm slope is diagnostic; RSS alone cannot identify a leak. Compare plain/native/pdf in separate fresh processes.'}
  await writeFile(output,JSON.stringify(result,null,2))
  console.log(JSON.stringify({mode,durationMs:result.durationMs,samples:samples.map(s=>({n:s.n,rssMiB:s.rss/1048576,heapMiB:s.heapUsed/1048576}))}))
}finally{await rm(root,{recursive:true,force:true})}
