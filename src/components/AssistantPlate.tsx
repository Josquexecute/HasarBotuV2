import type { CaseType } from '../types/case'
import './assistant-plate.css'

export function AssistantPlate({ plate, type }: { plate: string; type?: CaseType }) {
  return <span className="assistant-plate"><strong>{plate}</strong>{(type === 'Trafik' || type === 'Kasko') && <small className="assistant-plate__type">{type === 'Trafik' ? 'TRAFİK' : 'KASKO'}</small>}</span>
}
