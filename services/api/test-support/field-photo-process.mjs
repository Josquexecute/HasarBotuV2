import { runFieldPhotoOnce } from '../../file-agent/dist/field-photo-worker.js'

process.once('message', async config => {
  try {
    const worked = await runFieldPhotoOnce(config)
    process.send({ worked })
    process.disconnect()
  } catch {
    process.send({ failed: true })
    process.exitCode = 1
    process.disconnect()
  }
})
