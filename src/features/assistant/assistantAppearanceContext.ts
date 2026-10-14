import { createContext, useContext } from 'react'
import type { useAssistantAppearanceModel } from './useAssistantAppearance'

export const AssistantAppearanceContext = createContext<ReturnType<typeof useAssistantAppearanceModel> | null>(null)
export function useAssistantAppearance() {
  const value = useContext(AssistantAppearanceContext)
  if (!value) throw new Error('AssistantAppearanceProvider is required')
  return value
}
