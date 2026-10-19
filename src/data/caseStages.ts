import type { CaseStage, CaseStageCode } from '../types/case'

export const CASE_STAGE_LABELS: Readonly<Record<CaseStageCode, CaseStage>> = {
  new_notification: 'Yeni İhbar',
  parts_and_labor: 'Parça Referans Kodları İstenildi',
  under_repair: 'Onarımda',
  under_investigation: 'Araştırmada',
  total_loss: 'Ağır Hasar/Pert',
  closed: 'Kapanış',
}
