const button = document.querySelector('#assistant')
const assistant = window.hasarbotuAssistant

if (assistant) {
  button.disabled = false
  let pointerId
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || pointerId !== undefined) return
    pointerId = event.pointerId
    button.setPointerCapture(pointerId)
    assistant.press()
  })
  button.addEventListener('pointermove', (event) => {
    if (event.pointerId === pointerId) assistant.drag()
  })
  button.addEventListener('pointerup', (event) => {
    if (event.pointerId !== pointerId) return
    pointerId = undefined
    assistant.release()
  })
  const cancel = () => { pointerId = undefined; assistant.cancel() }
  button.addEventListener('pointercancel', cancel)
  button.addEventListener('lostpointercapture', cancel)
  window.addEventListener('blur', cancel)
  // Mouse/touch activation is handled above, after distinguishing a drag.
  button.addEventListener('click', (event) => { if (event.detail === 0) assistant.menu() })
  button.addEventListener('contextmenu', (event) => { event.preventDefault(); assistant.menu() })
  button.addEventListener('keydown', (event) => {
    const direction = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[event.key]
    if (direction) { event.preventDefault(); assistant.move(direction) }
    if (event.key === 'Escape') { cancel(); button.blur() }
  })
}
