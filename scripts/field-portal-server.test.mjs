import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import http from 'node:http'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createFieldPortal, allowedFieldApi } from './field-portal-server.mjs'

let gateway, upstream, root, address, calls = 0
const publicOrigin = 'https://photos.example.test:8443'
before(async () => {
  root = await mkdtemp(join(tmpdir(),'hb-field-gateway-'))
  await mkdir(join(root,'assets')); await writeFile(join(root,'field.html'), '<h1>Synthetic field portal</h1>'); await writeFile(join(root,'assets','test.js'),'export const value=1')
  upstream = http.createServer((request,response) => { calls++; response.setHeader('content-type','application/json'); response.setHeader('vary',request.url.endsWith('/notice-sheet') ? 'x-hasarbotu-notice-sheet-fields' : 'x-hasarbotu-dashboard-stages'); response.setHeader('set-cookie','hb_session=synthetic; Path=/; HttpOnly; SameSite=Strict'); response.end(JSON.stringify({ ok:true, url:request.url, agentHeader:request.headers['x-agent-secret'] ?? null, idempotencyKey:request.headers['idempotency-key'] ?? null, identityHeader:request.headers['tailscale-user-login'] ?? null, dashboardStages:request.headers['x-hasarbotu-dashboard-stages'] ?? null,noticeSheetFields:request.headers['x-hasarbotu-notice-sheet-fields'] ?? null })) })
  await new Promise(done=>upstream.listen(0,'127.0.0.1',done))
  gateway=createFieldPortal({directory:root,upstream:`http://127.0.0.1:${upstream.address().port}`,publicOrigin})
  await new Promise(done=>gateway.listen(0,'127.0.0.1',done)); address=`http://127.0.0.1:${gateway.address().port}`
})
after(async () => { await Promise.all([new Promise(done=>gateway.close(done)),new Promise(done=>upstream.close(done))]); await rm(root,{recursive:true,force:true}) })
const request=(path,init={},at=address)=>new Promise((resolve,reject)=>{
  const body=init.body ?? ''
  const outgoing=http.request(at+path,{method:init.method ?? 'GET',headers:{host:'photos.example.test:8443',...(body?{'content-length':Buffer.byteLength(body)}:{}),...init.headers}},incoming=>{
    const chunks=[];incoming.on('data',chunk=>chunks.push(chunk));incoming.on('error',reject)
    incoming.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:incoming.statusCode,headers:Object.fromEntries(Object.entries(incoming.headers).map(([key,value])=>[key,Array.isArray(value)?value.join(','):value]))})))
  })
  outgoing.on('error',reject);outgoing.end(body)
})
test('public route allowlist excludes management, private APIs, agents and installers',()=>{
  for(const path of ['/api/v1/users','/api/v1/agents','/api/v1/cases','/api/v1/desktop-updates/latest','/api/v1/field-agent/uploads/claim'])assert.equal(allowedFieldApi('GET',path),false)
  assert.equal(allowedFieldApi('POST','/api/v1/field-agent/uploads/claim'),false)
})

test('Google callback redirects pass only to fixed clean result paths without following them', async () => {
  const resultPath = '/api/v1/google/result/field/login/success'
  let location = resultPath
  const oauthUpstream = http.createServer((_request, response) => {
    response.writeHead(303, { location, 'referrer-policy': 'no-referrer' }); response.end()
  })
  await new Promise(done => oauthUpstream.listen(0, '127.0.0.1', done))
  const portal = createFieldPortal({ directory: root, upstream: `http://127.0.0.1:${oauthUpstream.address().port}`, publicOrigin })
  await new Promise(done => portal.listen(0, '127.0.0.1', done))
  const at = `http://127.0.0.1:${portal.address().port}`
  try {
    const response = await request('/api/v1/google/callback?code=synthetic&state=synthetic', {}, at)
    assert.equal(response.status, 303)
    assert.equal(response.headers.get('location'), resultPath)
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
    assert.equal(allowedFieldApi('GET', resultPath), true)
    assert.equal(allowedFieldApi('POST', resultPath), false)
    for (const unsafe of ['https://evil.test' + resultPath, '//evil.test' + resultPath, resultPath + '?code=private', resultPath + '#state', '/api/v1/users']) {
      location = unsafe
      const rejected = await request('/api/v1/google/callback', {}, at)
      assert.equal(rejected.status, 502)
      assert.equal(rejected.headers.get('location'), null)
    }
  } finally {
    await new Promise(done => portal.close(done))
    await new Promise(done => oauthUpstream.close(done))
  }
})
test('serves only the mobile entry and safe assets with restrictive browser headers',async()=>{
  const response=await request('/saha');assert.equal(response.status,200);assert.match(await response.text(),/Synthetic field portal/);assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/)
  assert.equal((await request('/assets/test.js')).status,200)
  for(const path of ['/index.html','/.env','/package.json','/assets/%2e%2e%2fpackage.json'])assert.equal((await request(path)).status,404)
})
test('requires the exact host and an explicit matching origin for writes',async()=>{
  assert.equal((await request('/saha',{headers:{host:'evil.test'}})).status,421)
  for(const origin of [undefined,'https://evil.test'])assert.equal((await request('/api/v1/auth/login',{method:'POST',headers:origin?{origin}:{}})).status,403)
})
test('preserves session-cookie consent, enforces Secure and strips agent headers',async()=>{
  const response=await request('/api/v1/auth/login',{method:'POST',headers:{origin:publicOrigin,'content-type':'application/json','x-agent-secret':'must-not-forward'},body:'{}'})
  assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/; Secure/);assert.doesNotMatch(response.headers.get('set-cookie'),/Max-Age/)
  assert.equal((await response.json()).agentHeader,null)
})
test('denies unlisted endpoints and oversized bodies before they reach the API',async()=>{
  const previous=calls
  assert.equal((await request('/api/v1/field-agent/uploads/claim',{method:'POST',headers:{origin:publicOrigin}})).status,404)
  assert.equal((await request('/api/v1/auth/login',{method:'POST',headers:{origin:publicOrigin},body:'x'.repeat(65537)})).status,413)
  assert.equal(calls,previous)
})
test('tailnet compatibility requires explicit loopback proxy configuration and preserves legacy cookies',async()=>{
  assert.equal((await request('/api/v1/users',{headers:{'tailscale-user-login':'spoof@example.test'}})).status,404)
  const privateGateway=createFieldPortal({directory:root,upstream:`http://127.0.0.1:${upstream.address().port}`,publicOrigin,allowTailnetApi:true})
  await new Promise(done=>privateGateway.listen(0,'127.0.0.1',done))
  const at=`http://127.0.0.1:${privateGateway.address().port}`
  try{
    assert.equal((await request('/api/v1/users',{},at)).status,404)
    const authenticatedTransport=await request('/api/v1/users',{headers:{'tailscale-user-login':'synthetic-tailnet@example.test'}},at)
    assert.equal(authenticatedTransport.status,200)
    assert.doesNotMatch(authenticatedTransport.headers.get('set-cookie'),/; Secure/)
    assert.equal((await request('/api/v1/google/status',{},at)).status,200)
  }finally{await new Promise(done=>privateGateway.close(done))}
})

test('private office proxy preserves packaged Electron version negotiation without forwarding privileged headers',async()=>{
  const privateGateway=createFieldPortal({directory:root,upstream:`http://127.0.0.1:${upstream.address().port}`,publicOrigin,allowTailnetApi:true})
  await new Promise(done=>privateGateway.listen(0,'127.0.0.1',done))
  const at=`http://127.0.0.1:${privateGateway.address().port}`
  const userAgent='Mozilla/5.0 HasarBotu/0.1.72 Chrome/152.0.7977.167 Electron/44.9.1 Safari/537.36'
  let forwarded
  const capture=request=>{forwarded=request.headers}
  upstream.once('request',capture)
  try{
    const response=await request('/api/v1/cases',{headers:{'tailscale-user-login':'synthetic-tailnet@example.test','user-agent':userAgent,'x-agent-secret':'must-not-forward'}},at)
    assert.equal(response.status,200)
    assert.equal(forwarded['user-agent'],userAgent)
    assert.equal(forwarded['x-agent-secret'],undefined)
    assert.equal(forwarded['tailscale-user-login'],undefined)
  }finally{upstream.removeListener('request',capture);await new Promise(done=>privateGateway.close(done))}
})

test('private close previews retain the command key while privileged transport headers stay stripped',async()=>{
  const privateGateway=createFieldPortal({directory:root,upstream:`http://127.0.0.1:${upstream.address().port}`,publicOrigin,allowTailnetApi:true})
  await new Promise(done=>privateGateway.listen(0,'127.0.0.1',done))
  const at=`http://127.0.0.1:${privateGateway.address().port}`
  const path='/api/v1/cases/00000000-0000-4000-8000-000000000000/lifecycle/close/plan'
  const key='00000000-0000-4000-8000-000000000001'
  try{
    const response=await request(path,{method:'POST',headers:{'tailscale-user-login':'synthetic-tailnet@example.test','idempotency-key':key,'x-agent-secret':'must-not-forward','content-type':'application/json'},body:JSON.stringify({expectedCaseVersion:1,expectedLocationVersion:1,closeMode:'with_missing_requirements',reason:'Eksik belgeler takip edilecek.'})},at)
    assert.equal(response.status,200)
    const body=await response.json()
    assert.equal(body.idempotencyKey,key)
    assert.equal(body.agentHeader,null)
    assert.equal(body.identityHeader,null)
    assert.equal((await request(path,{method:'POST',headers:{origin:publicOrigin,'idempotency-key':key}},at)).status,404)
  }finally{await new Promise(done=>privateGateway.close(done))}
})

test('private dashboards preserve stage negotiation and Vary for current and older clients',async()=>{
  const privateGateway=createFieldPortal({directory:root,upstream:`http://127.0.0.1:${upstream.address().port}`,publicOrigin,allowTailnetApi:true})
  await new Promise(done=>privateGateway.listen(0,'127.0.0.1',done))
  const at=`http://127.0.0.1:${privateGateway.address().port}`
  try{
    for(const stages of ['7',undefined]){
      const response=await request('/api/v1/dashboard',{headers:{'tailscale-user-login':'synthetic-tailnet@example.test','x-agent-secret':'must-not-forward',...(stages?{'x-hasarbotu-dashboard-stages':stages}:{})}},at)
      assert.equal(response.status,200)
      assert.equal(response.headers.get('vary'),'x-hasarbotu-dashboard-stages')
      const body=await response.json()
      assert.equal(body.dashboardStages,stages ?? null)
      assert.equal(body.agentHeader,null)
      assert.equal(body.identityHeader,null)
    }
  }finally{await new Promise(done=>privateGateway.close(done))}
})
test('private notice sheets preserve read/write capability headers without exposing privileged transport headers',async()=>{
  const privateGateway=createFieldPortal({directory:root,upstream:`http://127.0.0.1:${upstream.address().port}`,publicOrigin,allowTailnetApi:true})
  await new Promise(done=>privateGateway.listen(0,'127.0.0.1',done))
  const at=`http://127.0.0.1:${privateGateway.address().port}`
  const path='/api/v1/cases/00000000-0000-4000-8000-000000000000/notice-sheet'
  try{
    for(const method of ['GET','PUT'])for(const fields of ['2',undefined]){
      const response=await request(path,{method,headers:{'tailscale-user-login':'synthetic-tailnet@example.test','x-agent-secret':'must-not-forward',...(fields?{'x-hasarbotu-notice-sheet-fields':fields}:{})}},at)
      assert.equal(response.status,200)
      assert.equal(response.headers.get('vary'),'x-hasarbotu-notice-sheet-fields')
      const body=await response.json()
      assert.equal(body.noticeSheetFields,fields ?? null)
      assert.equal(body.agentHeader,null)
      assert.equal(body.identityHeader,null)
    }
    assert.equal((await request(path,{headers:{'x-hasarbotu-notice-sheet-fields':'2'}},at)).status,404)
  }finally{await new Promise(done=>privateGateway.close(done))}
})
