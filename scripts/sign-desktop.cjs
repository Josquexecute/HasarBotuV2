const { createServer } = require('node:http')
const { request } = require('node:https')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

// SignTool accepts an HTTP timestamp URL. Only the local hop uses HTTP; the
// timestamp request leaves this process through verified HTTPS without redirects.
module.exports = async function sign(configuration) {
  const timestamp = new URL(process.env.HASARBOTU_SIGNING_TIMESTAMP_URL)
  if (timestamp.protocol !== 'https:' || timestamp.username || timestamp.password || timestamp.search || timestamp.hash) throw new Error('HTTPS timestamp required')
  const tool = process.env.HASARBOTU_SIGNTOOL_PATH
  if (!tool) throw new Error('Preflight-selected Windows SDK SignTool required')
  let failure
  const server = createServer((incoming, outgoing) => {
    if (incoming.method !== 'POST' || incoming.url !== '/' || incoming.headers['content-type']?.split(';')[0] !== 'application/timestamp-query') {
      failure = 'TIMESTAMP_REQUEST_REJECTED method=' + incoming.method + ' type=' + incoming.headers['content-type']
      outgoing.writeHead(400).end(); incoming.resume(); return
    }
    let size = 0
    const chunks = []
    incoming.on('data', chunk => {
      size += chunk.length
      if (size > 65536) { outgoing.writeHead(413).end(); incoming.destroy() }
      else chunks.push(chunk)
    })
    incoming.on('error', () => outgoing.destroy())
    incoming.on('end', () => {
      if (size > 65536) return
      const bytes = Buffer.concat(chunks)
      const upstream = request(timestamp, { method: 'POST', rejectUnauthorized: true,
        headers: { 'content-type': 'application/timestamp-query', 'content-length': bytes.length },
        signal: AbortSignal.timeout(20000) }, response => {
        if (response.statusCode !== 200 || response.headers['content-type']?.split(';')[0] !== 'application/timestamp-reply') {
          failure = 'TIMESTAMP_HTTPS_RESPONSE_REJECTED status=' + response.statusCode + ' type=' + response.headers['content-type']
          response.resume(); outgoing.writeHead(502).end(); return
        }
        const replies = []; let replySize = 0
        response.on('data', chunk => {
          replySize += chunk.length
          if (replySize > 65536) { response.destroy(); outgoing.destroy() }
          else replies.push(chunk)
        })
        response.on('error', () => outgoing.destroy())
        response.on('end', () => {
          if (replySize <= 65536 && !outgoing.destroyed) outgoing.writeHead(200, { 'content-type': 'application/timestamp-reply' }).end(Buffer.concat(replies))
        })
      })
      upstream.on('error', error => { failure = 'TIMESTAMP_HTTPS_FAILED code=' + error.code; if (!outgoing.destroyed) outgoing.writeHead(502).end() })
      upstream.end(bytes)
    })
  })
  server.requestTimeout = 25000
  server.headersTimeout = 10000
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  try {
    const args = configuration.computeSignToolArgs(true)
    const index = args.indexOf('/tr')
    if (index < 0 || args[index + 1] !== timestamp.href && args[index + 1] !== process.env.HASARBOTU_SIGNING_TIMESTAMP_URL) throw new Error('Expected RFC3161 HTTPS timestamp argument')
    args[index + 1] = `http://127.0.0.1:${server.address().port}/`
    await promisify(execFile)(tool, args, { windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 })
    await promisify(execFile)(tool, ['verify', '/pa', '/all', '/tw', configuration.path], { windowsHide: true, timeout: 30000 })
  } catch (error) {
    if (failure) throw new Error(failure)
    throw error
  } finally {
    server.closeAllConnections()
    await new Promise(done => server.close(done))
  }
}
