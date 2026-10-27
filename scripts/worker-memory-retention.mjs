import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { writeFile, rename } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import { summarizeMemory } from './soak-metrics.mjs'

const [mode, countText, output] = process.argv.slice(2)
const count = Number(countText)
if (process.platform !== 'win32' || Number(process.versions.node.split('.')[0]) !== 24 || typeof global.gc !== 'function' || !['plain', 'native', 'reuse-native'].includes(mode) ||
  !Number.isSafeInteger(count) || count < 100 || count > 20000 || !output) throw new Error('Node 24 --expose-gc required: <plain|native|reuse-native> <100..20000 jobs per wave> <new-output.json>')
await writeFile(output, '', { flag: 'wx' })
const source = mode === 'plain' ? '0' : `const {parentPort}=require('node:worker_threads'); const canvas=require('@napi-rs/canvas');
  function work(){const c=canvas.createCanvas(256,256);const ctx=c.getContext('2d');ctx.fillText('SYNTHETIC POLICY',5,50);c.toBuffer('image/png');c.width=1;c.height=1;}
  ${mode === 'reuse-native' ? "parentPort.on('message',()=>{work();parentPort.postMessage('done')})" : 'work()'}`
const samples = [], started = Date.now()
const native = trim => {
  const code = trim ? `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class HBTrim{[DllImport("psapi.dll")]public static extern bool EmptyWorkingSet(IntPtr h);}';$p=Get-Process -Id ${process.pid};if(-not [HBTrim]::EmptyWorkingSet($p.Handle)){throw 'Targeted working set trim failed'};` : ''
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', code +
    `$p=Get-Process -Id ${process.pid};@{privateBytes=$p.PrivateMemorySize64;workingSet=$p.WorkingSet64;threads=$p.Threads.Count;handles=$p.HandleCount}|ConvertTo-Json -Compress`], { encoding: 'utf8', windowsHide: true }))
}
async function sample(stage, trim = false) {
  global.gc(); await new Promise(done => setImmediate(done))
  const counters = native(trim)
  const resources = process.getActiveResourcesInfo()
  const s = { stage, elapsedMs: Date.now() - started, ...process.memoryUsage(), ...counters, resources }
  samples.push(s)
  const data = { status: 'RUNNING', mode, count, node: process.version, pid: process.pid, samples }
  await writeFile(output + '.tmp', JSON.stringify(data, null, 2)); await rename(output + '.tmp', output)
}
let reused
try {
  await sample('baseline')
  if (mode === 'reuse-native') { reused = new Worker(source, { eval: true }); await once(reused, 'online') }
  for (let wave = 1; wave <= 5; wave++) {
    for (let n = 0; n < count; n++) {
      if (reused) { const done = once(reused, 'message'); reused.postMessage('work'); await done }
      else {
        const worker = new Worker(source, { eval: true })
        const [code] = await once(worker, 'exit'); assert.equal(code, 0)
      }
    }
    await sample('wave-' + wave)
  }
  if (reused) { await reused.terminate(); reused = undefined }
  await sample('workers-terminated')
  await sample('targeted-working-set-trim', true)
  // Idle is an explicit reclamation experiment, not a retry or a production fix.
  await new Promise(done => setTimeout(done, 10000))
  await sample('idle-10s')
  assert.equal(process.getActiveResourcesInfo().filter(r => r === 'MessagePort').length, 0)
  const result = { status: 'MEASURED', mode, count, totalJobs: count * 5, node: process.version,
    durationMs: Date.now() - started, samples, postWarm: summarizeMemory(samples.filter(s => /^wave-[2-5]$/.test(s.stage))),
    interpretation: 'Trim only evicts physical working pages; unchanged private commit is not deallocation. Plateau/reuse controls distinguish bounded retention from continued growth within this measured window; neither alone proves absence of all native leaks.', productionMutations: 0 }
  await writeFile(output + '.tmp', JSON.stringify(result, null, 2)); await rename(output + '.tmp', output)
  console.log(JSON.stringify({ mode, status: result.status, totalJobs: result.totalJobs, durationMs: result.durationMs }))
} finally { if (reused) await reused.terminate() }
