import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const directory = resolve(process.env.FAULT_EVIDENCE ?? '.local/fault-0192')
const before = JSON.parse(await readFile(join(directory, 'baseline-electron.json'), 'utf8'))
const after = JSON.parse(await readFile(join(directory, 'candidate-electron.json'), 'utf8'))
assert.equal(before.status, 'PASS'); assert.equal(after.status, 'PASS')
assert.deepEqual(before.runtime, after.runtime)
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const summarize = (report, scenario) => {
  const trials = report.measurements.filter(item => item.scenario === scenario)
  assert.equal(trials.length, 3)
  return {
    touchFps: median(trials.map(item => item.touchFps)),
    frameP95Ms: median(trials.map(item => item.frameP95Ms)),
    inputP95Ms: scenario === 'idle' ? null : median(trials.map(item => item.inputP95Ms)),
    cpuPercent: median(trials.map(item => item.processes.reduce((sum, process) => sum + process.cpuPercent, 0))),
    privateMiB: median(trials.map(item => item.processes.reduce((sum, process) => sum + process.privateMiB, 0))),
    mainScriptMs: median(trials.map(item => item.mainScriptMs)),
    panelScriptMs: median(trials.map(item => item.panelScriptMs)),
    requests: median(trials.map(item => item.requests.length)),
  }
}
const checks = []
const check = (name, pass) => checks.push({ name, status: pass ? 'PASS' : 'FAIL' })
const scenarios = {}
for (const scenario of ['idle', 'input-and-tabs']) {
  const baseline = summarize(before, scenario), candidate = summarize(after, scenario)
  scenarios[scenario] = { baseline, candidate }
  check(`${scenario}: FPS within 5%`, candidate.touchFps >= baseline.touchFps * .95)
  check(`${scenario}: frame p95 within 10% + 3ms`, candidate.frameP95Ms <= baseline.frameP95Ms * 1.1 + 3)
  check(`${scenario}: CPU increase <= 1 percentage point`, candidate.cpuPercent <= baseline.cpuPercent + 1)
  check(`${scenario}: private memory increase <= 25 MiB`, candidate.privateMiB <= baseline.privateMiB + 25)
  if (scenario === 'idle') {
    check('no idle API polling in either build', candidate.requests === 0 && baseline.requests === 0)
    check('idle renderer scripting increase <= 10ms per 8s', candidate.mainScriptMs + candidate.panelScriptMs <= baseline.mainScriptMs + baseline.panelScriptMs + 10)
  } else check('input p95 within 25% or +15ms', candidate.inputP95Ms <= Math.max(baseline.inputP95Ms * 1.25, baseline.inputP95Ms + 15))
}
for (const name of ['detail', 'list']) check(`${name}: HTTP p95 within 25% or +3ms`, after.api[name].p95Ms <= Math.max(before.api[name].p95Ms * 1.25, before.api[name].p95Ms + 3))
for (const name of ['main', 'panel']) {
  check(`${name}: retained heap increase <= 8 MiB`, after.retained[name].heapMiB <= before.retained[name].heapMiB + 8)
  check(`${name}: no retained listener growth after repeated navigation`, after.retained[name].listeners <= after.retainedBefore[name].listeners)
}
const report = { status: checks.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL', runtime: after.runtime, fixtureCases: after.fixtureCases,
  method: 'Same machine, production bundles, real Electron windows + canvas, isolated PostgreSQL 17, three 8-second trials per scenario; medians. Input includes automation roundtrip. HTTP uses loopback + authenticated body download, 100 warm samples per endpoint. GC only outside timed trials.',
  scope: 'Local short-run regression measurement; no production/LAN or multi-hour soak claim.', scenarios, api: { baseline: before.api, candidate: after.api },
  retained: { baseline: before.retained, candidate: after.retained }, checks, touchAssetsVerified: after.touchAssetsVerified,
  productionChanged: false, feedChanged: false }
await writeFile(join(directory, 'performance-comparison.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
if (report.status !== 'PASS') process.exitCode = 1
