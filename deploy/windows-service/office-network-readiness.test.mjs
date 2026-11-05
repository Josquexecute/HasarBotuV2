import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

test('read-only preflight uses distinct API and field health endpoints and fails closed for either outage', { skip: process.platform !== 'win32' }, () => {
  const literal = value => "'" + value.replaceAll("'", "''") + "'"
  for (const failure of ['none','api','field']) {
    const script = `function Get-CimInstance {param($ClassName,$Filter)}
function Invoke-RestMethod {param($Uri,$TimeoutSec,$Headers)
  if($Uri -eq 'http://127.0.0.1:3100/health'){if(${literal(failure)} -eq 'api'){return @{status='degraded';service='hasarbotu-api'}};return @{status='ok';service='hasarbotu-api'}}
  if($Uri -eq 'http://127.0.0.1:3200/field-health'){if(${literal(failure)} -eq 'field'){throw 'FIELD_UNAVAILABLE'};return @{status='ok'}}
  throw 'WRONG_HEALTH_ENDPOINT'
}
& ${literal(resolve('deploy/windows-service/test-office-network-readiness.ps1'))} -ApiOrigin https://office.example.test -Stage Before -NodeExe ${literal(process.execPath)}`
    let stdout
    try { stdout = execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')], { windowsHide:true, encoding:'utf8',timeout:20_000 }) }
    catch (error) { assert.notEqual(failure, 'none', String(error)); assert.equal(error.status, 1); stdout = error.stdout }
    const result = JSON.parse(stdout)
    assert.equal(result.status, failure === 'none' ? 'PASS' : 'BLOCKED')
    assert.equal(result.productionMutated, false)
    assert.equal(result.realGoogleConsent, 'PENDING')
    assert.equal(result.checks.filter(check => check.status === 'FAIL').length, failure === 'none' ? 0 : 1)
  }
})
