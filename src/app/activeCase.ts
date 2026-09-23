import { createContext, useContext, useEffect, type Dispatch, type SetStateAction } from 'react'
import type { CaseRecord } from '../types/case'
import type { DataSourceKind } from '../data/ports'

export interface ActiveCase {
  caseId: string
  plate: string
  officeNumber: string
  source: DataSourceKind
}

export const ActiveCaseContext = createContext<Dispatch<SetStateAction<ActiveCase | null>> | null>(null)
export const QUICK_NOTE_EVENT = 'hasarbotu:quick-note'
export const NOTE_SAVED_EVENT = 'hasarbotu:note-saved'

/** Only the mounted case screen supplies a target; navigation clears stale selection. */
export function useActiveCase(item: CaseRecord | null | undefined, source: DataSourceKind) {
  const publish = useContext(ActiveCaseContext)
  const caseId = item?.caseId
  const plate = item?.plate
  const officeNumber = item?.officeNumber
  useEffect(() => {
    if (!publish || !caseId || !plate || !officeNumber) return
    publish({ caseId, plate, officeNumber, source })
    return () => publish(null)
  }, [publish, caseId, plate, officeNumber, source])
}
