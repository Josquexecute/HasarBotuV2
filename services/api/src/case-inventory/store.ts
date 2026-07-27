import type pg from 'pg'
import {
  CASE_INVENTORY_MAX_ROWS,
  type CaseInventoryQuery,
} from '@hasarbotu/contracts'
import { buildInventoryCells, type CaseInventoryRow } from '@hasarbotu/domain'

/**
 * Dosya Envanteri — liste/export sorgu katmanı.
 *
 * Salt okunur; audit YAZMAZ (bkz. HB-2026-101: yalnız `export` çağrısı, gerçek
 * dosya üretimi, audit'e düşer — burada sayım/satır sorgusu değil).
 * `ownerNames`/`ownerPhones` ve `servicePhone` PII kabul edilir; export
 * çağıran `includePhones=false` ise domain katmanı bu hücreleri HİÇ üretmez.
 */
interface InventoryDbRow {
  case_id: string
  office_number: string
  plate: string
  insurer_name: string | null
  responsible_name: string | null
  case_type: 'traffic' | 'casco'
  case_status: string
  loss_date: string | null
  notification_date: string | null
  expert_report_status: string | null
  expert_report_date: Date | string | null
  service_name: string | null
  service_phone: string | null
  owners: { name: string; phone: string | null }[] | null
}

function localDate(value: Date | string | null): string | null {
  if (value === null) return null
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10)
}

const WHERE_AND_PARAMS = (query: CaseInventoryQuery): { where: string; params: unknown[] } => {
  const where: string[] = ['c.organization_id = $1']
  const params: unknown[] = []
  if (query.caseType !== undefined) {
    params.push(query.caseType)
    where.push(`c.case_type = $${params.length + 1}`)
  }
  if (query.status !== undefined) {
    params.push(query.status)
    where.push(`c.lifecycle_status = $${params.length + 1}`)
  }
  return { where: where.join(' AND '), params }
}

const FROM_JOINS = `
  FROM cases c
  LEFT JOIN insurers i ON i.organization_id = c.organization_id AND i.id = c.insurer_id
  LEFT JOIN users r ON r.organization_id = c.organization_id AND r.id = c.responsible_user_id
  LEFT JOIN service_centers sc ON sc.organization_id = c.organization_id AND sc.id = c.service_center_id
  LEFT JOIN case_vehicle_owner_sets s ON s.organization_id = c.organization_id AND s.case_id = c.id
  LEFT JOIN LATERAL (
    SELECT dv.status AS report_status, COALESCE(dv.verified_at, dv.created_at) AS report_date
    FROM documents d
    JOIN document_versions dv ON dv.document_id = d.id AND dv.version_number = d.current_version_number
    WHERE d.organization_id = c.organization_id AND d.case_id = c.id AND d.document_type = 'expert_report'
    ORDER BY dv.created_at DESC
    LIMIT 1
  ) er ON true
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object('name', o.name, 'phone', o.phone) ORDER BY o.ordinal) AS owners
    FROM case_vehicle_owners o
    WHERE o.organization_id = c.organization_id AND o.case_id = c.id
      AND o.set_version = COALESCE(s.current_set_version, 0)
  ) oa ON true
`

export function createCaseInventoryStore(pool: pg.Pool) {
  return {
    async count(organizationId: string, query: CaseInventoryQuery): Promise<number> {
      const { where, params } = WHERE_AND_PARAMS(query)
      const result = await pool.query(
        `SELECT count(*)::int AS n ${FROM_JOINS} WHERE ${where}`,
        [organizationId, ...params],
      )
      return (result.rows[0] as { n: number }).n
    },

    /** Yalnız export yolunda çağrılır. `includePhones=false` ise telefon sütunları asla üretilmez. */
    async rows(
      organizationId: string,
      query: CaseInventoryQuery,
      includePhones: boolean,
    ): Promise<readonly Readonly<Record<string, { readonly value: string; readonly cellType: string }>>[]> {
      const { where, params } = WHERE_AND_PARAMS(query)
      const result = await pool.query(
        `SELECT
           c.id AS case_id, c.office_number, c.plate, i.name AS insurer_name,
           r.display_name AS responsible_name, c.case_type,
           CASE WHEN c.lifecycle_status = 'closed' THEN 'Kapalı'
                WHEN c.follow_up_date IS NOT NULL AND c.follow_up_date < CURRENT_DATE THEN 'Gecikmiş'
                ELSE 'Açık' END AS case_status,
           c.loss_date, c.notification_date,
           er.report_status AS expert_report_status, er.report_date AS expert_report_date,
           sc.name AS service_name, sc.phone AS service_phone,
           oa.owners
         ${FROM_JOINS}
         WHERE ${where}
         ORDER BY c.office_year, c.office_sequence
         LIMIT $${params.length + 2}`,
        [organizationId, ...params, CASE_INVENTORY_MAX_ROWS],
      )
      return (result.rows as InventoryDbRow[]).map((row) => {
        const inventoryRow: CaseInventoryRow = {
          caseId: row.case_id,
          officeNumber: row.office_number,
          plate: row.plate,
          insurerName: row.insurer_name,
          responsibleName: row.responsible_name,
          caseType: row.case_type,
          caseStatus: row.case_status,
          accidentDate: localDate(row.loss_date),
          notificationDate: localDate(row.notification_date),
          expertReportStatus: row.expert_report_status,
          expertReportDate: localDate(row.expert_report_date),
          // Ayrı bir "eksper rapor numarası" alanı hiçbir tabloda yok; tahmin
          // edilmez, dürüstlükle "Eksik" kalır (bkz. HB-2026-101).
          expertReportNumber: null,
          serviceName: row.service_name,
          // Servis ili hiçbir tabloda yok; aynı gerekçeyle "Eksik" kalır.
          serviceCity: null,
          servicePhone: row.service_phone,
          owners: row.owners ?? [],
        }
        return buildInventoryCells(inventoryRow, { includePhones, missingAsMarker: true })
      })
    },
  }
}

export type CaseInventoryStore = ReturnType<typeof createCaseInventoryStore>
