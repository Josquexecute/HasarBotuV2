import assert from 'node:assert/strict'

/** Isolated fixture only: no screenshot, polling, live account or production data. */
export async function measureValueLossElectronTyping({ page, electron, storageKey, caseUrl, mode, inputMethod = 'playwright_keyboard' }) {
  await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive())
  const environment = await electron.evaluate(({ BrowserWindow, screen }) => ({
    electron: process.versions.electron, chromium: process.versions.chrome,
    window: BrowserWindow.getAllWindows()[0].getContentBounds(),
    displayFrequency: screen.getPrimaryDisplay().displayFrequency,
    scaleFactor: screen.getPrimaryDisplay().scaleFactor,
  }))
  const stored = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), storageKey)
  assert.ok(stored?.draft?.parts?.length, 'A completed synthetic calculation is required')
  let calculationRequests = 0
  const countRequest = request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/traffic-value-loss/calculate')) calculationRequests++
  }
  page.on('request', countRequest)
  await page.addInitScript(() => {
    window.__valueLossTiming = { input: [], frameEpoch: [], frames: [], longTasks: [] }
    new PerformanceObserver(list => window.__valueLossTiming.longTasks.push(...list.getEntries().map(item => item.duration))).observe({ type: 'longtask' })
    document.addEventListener('input', event => {
      if (!event.target.closest('.value-loss-calculator')) return
      const started = performance.now()
      requestAnimationFrame(() => {
        window.__valueLossTiming.input.push(performance.now() - started)
        window.__valueLossTiming.frameEpoch.push(performance.timeOrigin + performance.now())
      })
    }, true)
    let last = 0
    function frame(time) {
      if (last) window.__valueLossTiming.frames.push(time - last)
      last = time
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  const results = []
  const flushFrames = () => page.evaluate(() => new Promise((done, reject) => {
    const timeout = setTimeout(() => reject(new Error('Visible Electron renderer did not produce animation frames')), 5000)
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timeout); done() }))
  }))
  try {
    for (const count of [10, 100]) {
      await page.evaluate(({ key, stored, count, mode }) => {
        const draft = { ...stored.draft, vehicleCondition: 'normal', marketValue: '1000000', parts: Array.from({ length: count }, (_, index) => ({ ...stored.draft.parts[0], id: `perf-${index}`, stableRuleId: '', label: `SENTETİK PERFORMANS PARÇASI ${index}`, priorPartState: 'none', operation: 'replacement', material: 'unspecified' })) }
        sessionStorage.setItem(key, JSON.stringify({ ...stored, verificationVersion: mode === 'baseline' ? 4 : 5, draft, result: null }))
      }, { key: storageKey, stored, count, mode })
      await page.goto(caseUrl)
      await page.getByRole('button', { name: 'Değer Kaybı', exact: true }).click()
      await page.waitForFunction(expected => document.querySelectorAll('.value-loss-calculator__part').length === expected, count)
      const input = page.getByLabel('Rayiç bedeli (TL)', { exact: true })
      await input.press('End')
      await input.pressSequentially('12345')
      await flushFrames()
      const cdp = await page.context().newCDPSession(page)
      await cdp.send('Performance.enable')
      await cdp.send('HeapProfiler.collectGarbage')
      const readMetrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]))
      const before = await readMetrics()
      await electron.evaluate(({ app }) => app.getAppMetrics())
      await page.evaluate(() => { window.__valueLossTiming = { input: [], frameEpoch: [], frames: [], longTasks: [] } })
      const started = performance.now()
      const dispatchEpoch = []
      if (inputMethod === 'paced_cdp_text') {
        const pending = []
        for (let index = 0; index < 240; index++) {
          const remaining = started + index * 16 - performance.now()
          if (remaining > 0) await new Promise(done => setTimeout(done, remaining))
          dispatchEpoch.push(performance.timeOrigin + performance.now())
          pending.push(cdp.send('Input.insertText', { text: String(index % 10) }))
        }
        await Promise.all(pending)
      } else {
        assert.equal(inputMethod, 'playwright_keyboard')
        await input.pressSequentially('1234567890'.repeat(24), { delay: 16 })
      }
      await flushFrames()
      const elapsedMs = performance.now() - started
      const after = await readMetrics()
      const timing = await page.evaluate(() => window.__valueLossTiming)
      const processes = await electron.evaluate(({ app }) => app.getAppMetrics().map(item => ({ type: item.type, cpuPercent: item.cpu.percentCPUUsage, workingSetMiB: item.memory.workingSetSize / 1024 })))
      await cdp.send('HeapProfiler.collectGarbage')
      const retained = await readMetrics()
      await cdp.detach()
      const idleFrames = await page.evaluate(() => new Promise((done, reject) => {
        const values = []
        const timeout = setTimeout(() => reject(new Error('Idle Electron renderer did not produce animation frames')), 5000)
        let previous = 0
        function frame(time) {
          if (previous) values.push(time - previous)
          previous = time
          if (values.length < 40) requestAnimationFrame(frame)
          else { clearTimeout(timeout); done(values) }
        }
        requestAnimationFrame(frame)
      }))
      const percentile = (values, fraction) => [...values].sort((left, right) => left - right)[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)] ?? 0
      assert.equal(timing.input.length, 240)
      const dispatchToFrame = dispatchEpoch.map((sent, index) => timing.frameEpoch[index] - sent)
      results.push({ mode, parts: count, inputs: timing.input.length, ...(dispatchEpoch.length ? { dispatchToFrameP95Ms: percentile(dispatchToFrame, .95), dispatchToFrameP99Ms: percentile(dispatchToFrame, .99) } : {}), inputToFrameP95Ms: percentile(timing.input, .95), inputToFrameP99Ms: percentile(timing.input, .99), frameGapP95Ms: percentile(timing.frames, .95), observedFps: 1000 * timing.frames.length / timing.frames.reduce((sum, value) => sum + value, 0), idleFps: 1000 * idleFrames.length / idleFrames.reduce((sum, value) => sum + value, 0), longTasks: timing.longTasks.length, rendererTaskCpuMs: (after.TaskDuration - before.TaskDuration) * 1000, elapsedMs, jsHeapBeforeMiB: before.JSHeapUsedSize / 1024 / 1024, jsHeapAfterMiB: after.JSHeapUsedSize / 1024 / 1024, retainedJsHeapMiBAfterGc: retained.JSHeapUsedSize / 1024 / 1024, processes })
    }
    assert.equal(calculationRequests, 0, 'Typing must not invoke the calculation API')
    return { measurement: 'Real isolated Electron renderer, production assets; 240 trusted browser inputs; synthetic maximum-row form; retained heap after explicit GC', inputMethod, delayMs: 16, environment, calculationRequests, results }
  } finally { page.off('request', countRequest) }
}
