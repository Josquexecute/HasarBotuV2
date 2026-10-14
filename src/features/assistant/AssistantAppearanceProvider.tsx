import type { ReactNode } from 'react'
import type { AssistantAppearancePort } from '../../data/assistantAppearancePort'
import { AssistantAppearanceContext } from './assistantAppearanceContext'
import { useAssistantAppearanceModel } from './useAssistantAppearance'

export function AssistantAppearanceProvider({ children, port }: { children: ReactNode; port?: AssistantAppearancePort }) {
  const model = useAssistantAppearanceModel(port)
  return <AssistantAppearanceContext.Provider value={model}>{children}</AssistantAppearanceContext.Provider>
}
