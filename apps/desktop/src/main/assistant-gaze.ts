import { ASSISTANT_SIZE, assistantGaze, type Point } from './assistant-policy.js'

export const ASSISTANT_NEAR_GAZE_MS = 80
export const ASSISTANT_FAR_GAZE_MS = 320
const INTERACTION_RADIUS = ASSISTANT_SIZE * 4

/** Keep nearby interactions responsive; sample distant pointer activity less often. */
export function createAssistantGazeTracker(options: {
  enabled: () => boolean
  cursor: () => Point
  position: () => Point
  send: (gaze: Point) => void
}) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let previous: Point | undefined
  const stop = () => { clearTimeout(timer); timer = undefined }
  const tick = () => {
    timer = undefined
    if (!options.enabled()) return
    const cursor = options.cursor()
    const position = options.position()
    const gaze = assistantGaze(cursor, position)
    if (gaze.x !== previous?.x || gaze.y !== previous.y) {
      previous = gaze
      options.send(gaze)
    }
    const distance = Math.hypot(cursor.x - position.x - ASSISTANT_SIZE / 2, cursor.y - position.y - ASSISTANT_SIZE / 2)
    timer = setTimeout(tick, distance <= INTERACTION_RADIUS ? ASSISTANT_NEAR_GAZE_MS : ASSISTANT_FAR_GAZE_MS)
  }
  return {
    start() { stop(); previous = undefined; tick() },
    stop,
  }
}
