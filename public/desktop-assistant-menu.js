const menu = window.hasarbotuAssistantMenu
if (menu) {
  document.addEventListener('click',(event) => {
    const button = event.target.closest?.('button[data-action]')
    if (button) menu.choose(button.dataset.action)
  })
  document.addEventListener('keydown',(event) => {
    if (event.key === 'Escape') { event.preventDefault();menu.choose('close') }
  })
  window.addEventListener('focus',() => document.querySelector('button[data-action="open"]')?.focus())
} else {
  for (const button of document.querySelectorAll('button')) button.disabled = true
}
