import { appendFileSync, realpathSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { join, resolve, sep } from 'node:path'
import * as threads from 'node:worker_threads'

// Opt-in diagnostics only. RSS belongs to the whole process, never one Worker.
const requestedDirectory = process.env.HB_MEMORY_PROFILE_DIR
if (requestedDirectory) {
  const directory = realpathSync(resolve(requestedDirectory))
  const localRoot = realpathSync(resolve('.local'))
  if (!directory.startsWith(localRoot + sep) || !statSync(directory).isDirectory()) throw new Error('Memory profiling requires an existing project-local .local directory')
  // Windows may reuse a PID between extraction hosts; never append a new lifetime
  // to an old isolate file or infer identity from PID/threadId alone.
  const isolateId = `${process.pid}-${threads.threadId}-${Date.now()}-${randomUUID()}`
  const file = join(directory, `${isolateId}.jsonl`)
  const memories = new Set(), seenMemories = new WeakSet()
  const OriginalMemory = WebAssembly.Memory
  const started = Date.now()
  const role = threads.isMainThread ? typeof process.send === 'function' ? 'extraction-host' : 'main'
    : threads.workerData?.ocrRunId ? 'policy-ocr' : threads.workerData?.extractionId ? 'pdf-parser' : 'auxiliary'
  let peakWasmCapacityBytes = 0
  const emit = value => appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), elapsedMs: Date.now() - started,
    isolateId, pid: process.pid, ppid: process.ppid, threadId: threads.threadId, role, ...value }) + '\n')
  const observe = memory => {
    if (memory instanceof OriginalMemory && !seenMemories.has(memory)) {
      seenMemories.add(memory)
      memories.add(new WeakRef(memory))
    }
  }
  const values = object => object && (typeof object === 'object' || typeof object === 'function')
    ? Object.values(Object.getOwnPropertyDescriptors(object)).filter(d => 'value' in d).map(d => d.value) : []
  const observeImports = imports => { for (const namespace of values(imports)) for (const item of values(namespace)) observe(item) }
  const observeExports = result => { for (const item of values(result?.instance?.exports ?? result?.exports)) observe(item) }
  const sample = stage => {
    let wasmCapacityBytes = 0, wasmMemoryCount = 0
    for (const ref of memories) {
      const memory = ref.deref()
      if (!memory) { memories.delete(ref); continue }
      wasmMemoryCount++
      wasmCapacityBytes += memory.buffer.byteLength
    }
    peakWasmCapacityBytes = Math.max(peakWasmCapacityBytes, wasmCapacityBytes)
    emit({ event: 'memory', stage, ...process.memoryUsage(), rssScope: 'shared-process', rssPid: process.pid, heapScope: 'current-isolate',
      wasmCapacityBytes, wasmMemoryCount, peakWasmCapacityBytes, wasmScope: 'current-isolate-capacity-not-live-allocation',
      externalMayIncludeWasm: true, nativeBytes: null, nativeScope: 'not-measured-no-residual-subtraction' })
  }
  WebAssembly.Memory = new Proxy(OriginalMemory, {
    construct(target, args, newTarget) {
      const memory = Reflect.construct(target, args, newTarget)
      observe(memory); sample('wasm-created')
      return memory
    },
  })
  const originalGrow = OriginalMemory.prototype.grow
  OriginalMemory.prototype.grow = function (...args) {
    const result = Reflect.apply(originalGrow, this, args)
    observe(this); sample('wasm-grown')
    return result
  }
  const OriginalInstance = WebAssembly.Instance
  WebAssembly.Instance = new Proxy(OriginalInstance, {
    construct(target, args, newTarget) {
      observeImports(args[1])
      const instance = Reflect.construct(target, args, newTarget)
      observeExports(instance); sample('wasm-instantiated-sync')
      return instance
    },
  })
  for (const name of ['instantiate', 'instantiateStreaming']) {
    const original = WebAssembly[name]
    if (typeof original !== 'function') continue
    WebAssembly[name] = function (...args) {
      observeImports(args[1])
      return Reflect.apply(original, this, args).then(result => {
        observeExports(result); sample('wasm-' + name)
        return result
      })
    }
  }
  const builtin = createRequire(import.meta.url)('node:worker_threads')
  const OriginalWorker = builtin.Worker
  builtin.Worker = class MemoryProfiledWorker extends OriginalWorker {
    constructor(filename, options) {
      super(filename, options)
      const childThreadId = this.threadId
      const path = String(filename).replaceAll('\\', '/')
      const source = path.includes('tesseract.js') ? 'tesseract' : path.includes('policy-ocr-worker') ? 'policy-ocr'
        : path.includes('pdf-parser-worker') ? 'pdf-parser' : options?.eval ? 'eval' : 'other'
      emit({ event: 'worker-created', childThreadId, childSource: source, childName: options?.name ?? null })
      this.once('exit', code => emit({ event: 'worker-exit', childThreadId, code }))
    }
  }
  syncBuiltinESMExports()
  sample('preload')
  setInterval(() => sample('interval'), 250).unref()
  process.once('exit', () => sample('exit'))
}
