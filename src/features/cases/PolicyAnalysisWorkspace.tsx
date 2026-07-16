import { CheckCircle2, FileSearch, ListChecks, PlayCircle, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import type { DataSourceKind, PolicyAiPromotionRecord } from '../../data'
import { PolicyAiCandidatesModule, type PolicyAnalysisWorkflowPhase } from './PolicyAiCandidatesModule'
import { PolicyAnalysisApiModule } from './PolicyAnalysisApiModule'

const STEPS: readonly {
  readonly phase: PolicyAnalysisWorkflowPhase
  readonly title: string
  readonly description: string
  readonly icon: typeof PlayCircle
}[] = [
  { phase: 'source', title: 'Kaynağı seç ve planla', description: 'Doğrulanmış PDF/OCR parçaları', icon: FileSearch },
  { phase: 'planned', title: 'Analizi başlat', description: 'Açık gönderim onayı ve bütçe', icon: PlayCircle },
  { phase: 'review', title: 'Adayları incele', description: 'Kanıt, kabul, düzenleme veya red', icon: ListChecks },
  { phase: 'applied', title: 'Taslağa uygula', description: 'Paket 23 sürümü ve kaynak zinciri', icon: ShieldCheck },
]

const PHASE_INDEX: Record<PolicyAnalysisWorkflowPhase, number> = {
  source: 0,
  planned: 1,
  review: 2,
  applied: 3,
}

export function PolicyAnalysisWorkspace({
  caseId,
  source,
}: {
  caseId: string
  source: DataSourceKind
}) {
  const [phase, setPhase] = useState<PolicyAnalysisWorkflowPhase>('source')
  const [analysisRefreshToken, setAnalysisRefreshToken] = useState(0)
  const [latestPromotion, setLatestPromotion] = useState<PolicyAiPromotionRecord | null>(null)
  const currentIndex = PHASE_INDEX[phase]

  const handlePromotionApplied = (promotion: PolicyAiPromotionRecord) => {
    setLatestPromotion(promotion)
    setPhase('applied')
    setAnalysisRefreshToken((value) => value + 1)
  }

  return <section className="policy-analysis-workspace" aria-labelledby="policy-workflow-heading">
    <header className="policy-analysis-workspace__header">
      <div><span className="eyebrow">Paket 30 · kullanıcı kontrollü uçtan uca akış</span><h2 id="policy-workflow-heading">Kasko Poliçe Analiz Akışı</h2><p>Analiz başlatma, kanıt inceleme ve onaylanan adayları taslağa uygulama aynı dosya bağlamında yürütülür.</p></div>
      <strong>AI sonucu tek başına kesin karar değildir.</strong>
    </header>
    <ol className="policy-analysis-steps" aria-label="Poliçe analiz adımları">
      {STEPS.map((step, index) => {
        const Icon = step.icon
        const state = index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'pending'
        return <li className={`is-${state}`} aria-current={state === 'current' ? 'step' : undefined} key={step.phase}>
          <Icon aria-hidden="true" /><div><strong>{step.title}</strong><span>{step.description}</span></div>{state === 'complete' && <CheckCircle2 className="policy-analysis-steps__check" aria-hidden="true" />}
        </li>
      })}
    </ol>
    {latestPromotion !== null && <div className="policy-analysis-applied" role="status" aria-live="polite">
      <CheckCircle2 aria-hidden="true" />
      <div><strong>Onaylanan adaylar analiz taslağına uygulandı.</strong><span>Analiz {latestPromotion.analysisId} · sürüm {latestPromotion.analysisVersion} aşağıda güncellendi. Nihai analiz onayı ayrıca gerekir.</span></div>
    </div>}
    <PolicyAiCandidatesModule caseId={caseId} source={source} onPromotionApplied={handlePromotionApplied} onPhaseChange={setPhase} />
    <PolicyAnalysisApiModule caseId={caseId} source={source} refreshToken={analysisRefreshToken} />
  </section>
}
