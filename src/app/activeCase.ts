import { createContext, useCallback, useContext, useEffect, type Dispatch, type SetStateAction } from 'react'
import type { CaseRecord } from '../types/case'
import type { DataSourceKind } from '../data/ports'
import { useSession } from './sessionContext'
import { rememberAssistantCase } from './assistantCaseSelection'

export interface ActiveCase {
  caseId: string
  plate: string
  officeNumber: string
  source: DataSourceKind
}

export const ActiveCaseContext = createContext<Dispatch<SetStateAction<ActiveCase | null>> | null>(null)
export const QUICK_NOTE_EVENT = 'hasarbotu:quick-note'
export const NOTE_SAVED_EVENT = 'hasarbotu:note-saved'

type CaseIdentity = Pick<CaseRecord, 'caseId' | 'plate' | 'officeNumber'>

/** Navigation clears the main quick-note target; Touch retains the last case. */
export function useActiveCase(item: CaseIdentity | null | undefined, source: DataSourceKind) {
  const publish = useContext(ActiveCaseContext)
  const session = useSession()
  const userId = session.status === 'authenticated' ? session.user?.id : undefined
  const activate = useCallback((target: ActiveCase) => {
    if (!publish) return
    publish(target)
    if (target.source === 'api' && userId && !rememberAssistantCase(userId, target.caseId)) {
      console.warn('Touch Assistant dosya seçimi bu cihazda saklanamadı.')
    }
  }, [publish, userId])
  const caseId = item?.caseId
  const plate = item?.plate
  const officeNumber = item?.officeNumber
  useEffect(() => {
    if (!publish || !caseId || !plate || !officeNumber) return
    activate({ caseId, plate, officeNumber, source })
    return () => publish(null)
  }, [activate, publish, caseId, plate, officeNumber, source])
  // Re-selecting the same row must also override a later manual Touch selection.
  return (target: CaseIdentity) => activate({ caseId: target.caseId, plate: target.plate, officeNumber: target.officeNumber, source })
}
