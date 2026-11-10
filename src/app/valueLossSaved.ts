export const VALUE_LOSS_SAVED_EVENT = 'hasarbotu:value-loss-saved'
export const VALUE_LOSS_SAVED_STORAGE_KEY = 'hasarbotu:value-loss-saved'

export function notifyValueLossSaved(caseId: string) {
  window.dispatchEvent(new CustomEvent(VALUE_LOSS_SAVED_EVENT, { detail: { caseId } }))
  // Other Electron windows share this origin; only the case ID and time cross windows.
  try { window.localStorage.setItem(VALUE_LOSS_SAVED_STORAGE_KEY, JSON.stringify({ caseId, at: Date.now() })) }
  catch { /* Focus refresh still retrieves the authoritative server record. */ }
}
