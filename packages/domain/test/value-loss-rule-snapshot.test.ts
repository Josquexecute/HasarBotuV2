import { describe, expect, it } from 'vitest'
import manifestJson from '../../../reference-data/value-loss/real-market-analysis/2026-07-01/1.0.0/manifest.json' with { type: 'json' }
import schemaJson from '../../../reference-data/value-loss/real-market-analysis/2026-07-01/1.0.0/schema.json' with { type: 'json' }
import snapshotJson from '../../../reference-data/value-loss/real-market-analysis/2026-07-01/1.0.0/snapshot.json' with { type: 'json' }
import {
  VALUE_LOSS_GROUP_CODE_SEQUENCE,
  VALUE_LOSS_REQUIRED_ANOMALIES,
  VALUE_LOSS_RULE_SNAPSHOT_JSON_SCHEMA,
  buildValueLossPartStableId,
  canonicalValueLossJson,
  hashValueLossRuleSnapshot,
  normalizeValueLossLabel,
  validateValueLossRuleSnapshot,
  type ValueLossPartRule,
  type ValueLossRuleManifest,
  type ValueLossRuleSnapshot,
} from '../src/index.js'

const snapshot = snapshotJson as unknown as ValueLossRuleSnapshot
const manifest = manifestJson as unknown as ValueLossRuleManifest
const schema = schemaJson as unknown as typeof VALUE_LOSS_RULE_SNAPSHOT_JSON_SCHEMA

describe('Paket 66 normalized değer kaybı snapshot', () => {
  it('schema, identity ve kaynak hash sınırlarını doğrular', () => {
    expect(validateValueLossRuleSnapshot(snapshot)).toEqual({ ok: true, errors: [] })
    expect(schema).toEqual(VALUE_LOSS_RULE_SNAPSHOT_JSON_SCHEMA)
    expect(snapshot.identity).toBe('real-market-analysis/2026-07-01/1.0.0')
    expect(snapshot.source.workbookSha256)
      .toBe('81d3ae870cd5569b13371ec8b4de081a9a4e3e15098f7454f5d0cdcd3708c424')
  })

  it('sheet adlarını, hidden state ve relationship çözümünü snapshotta korur', () => {
    expect(snapshot.sheets.map(({ name, state }) => ({ name, state }))).toEqual([
      { name: 'Hesaplama', state: 'visible' },
      { name: 'Sheet1', state: 'hidden' },
      { name: 'Uygulama Esasları', state: 'visible' },
      { name: 'Tablolar', state: 'visible' },
    ])
    expect(snapshot.sheets.every((item) => item.partName.startsWith('xl/worksheets/'))).toBe(true)
    expect(snapshot.sheets.find((item) => item.name === 'Tablolar')?.hiddenColumns)
      .toEqual([{ min: 21, max: 21 }, { min: 22, max: 22 }, { min: 23, max: 23 }])
  })

  it('grup kodu sırasını ve bölünmüş provenance mapping sayılarını korur', () => {
    expect(snapshot.vehicleGroupCodeSequence.map((item) => item.code))
      .toEqual(VALUE_LOSS_GROUP_CODE_SEQUENCE)
    expect(snapshot.vehicleMappings.filter((item) => item.provenance === 'source_workbook'))
      .toMatchObject([
        { vehicleType: 'TAKSİ', vehicleGroupCode: 'A' },
        { vehicleType: 'MİNİBÜS', vehicleGroupCode: 'B' },
        { vehicleType: 'OTOBÜS', vehicleGroupCode: 'B' },
      ])
    expect(snapshot.vehicleMappings.filter((item) => item.provenance === 'product_decision'))
      .toHaveLength(11)
    expect(snapshot.vehicleMappings.filter((item) => item.provenance === 'source_workbook'))
      .toHaveLength(3)
  })

  it('source_vehicle_name_column_incomplete ve tüm forensic anomalileri korur', () => {
    expect(snapshot.anomalies.map((item) => item.code)).toEqual(VALUE_LOSS_REQUIRED_ANOMALIES)
    expect(snapshot.dataValidations).toEqual([
      { sourceCell: 'Hesaplama!F12', type: 'list', formula: '"-10,-5,0,5,10"' },
      { sourceCell: 'Tablolar!Z2', type: 'list', formula: '"-10,-5,0,5,10"' },
    ])
    expect(snapshot.cachedFormulaErrors.map((item) => item.cachedError))
      .toEqual(['#NAME?', '#DIV/0!'])
  })

  it('ters kaynak yaş tablosunu artan banda normalize eder ve source rowu korur', () => {
    expect(snapshot.ageCoefficients.map((item) => [item.minAge, item.maxAge, item.coefficient, item.sourceRow]))
      .toEqual([
        [0, 2, '1', 26],
        [3, 4, '0.95', 25],
        [5, 7, '0.9', 24],
        [8, 10, '0.85', 23],
        [11, 13, '0.8', 22],
        [14, 16, '0.75', 21],
        [17, 19, '0.7', 20],
        [20, null, '0.65', 19],
      ])
  })

  it('altı aktif part tablosunu programatik satır sayılarıyla korur', () => {
    expect(snapshot.partTables.map((table) => [table.tableId, table.sourceRowCount, table.emittedRuleCount]))
      .toEqual([
        ['group-a', 32, 32],
        ['group-b', 46, 46],
        ['group-c-cedilla', 28, 56],
        ['group-d', 13, 13],
        ['group-e', 7, 7],
        ['group-f', 4, 4],
      ])
    expect(new Set(snapshot.partRules.map((rule) => rule.stableId)).size)
      .toBe(snapshot.partRules.length)
  })

  it('placeholder, sigortacı ve row 27/79 artık değerini aktif kurallara sızdırmaz', () => {
    expect(snapshot.partRules.some((rule) => rule.sourceLabel === '0')).toBe(false)
    expect(snapshot.partRules.some((rule) => rule.sourceLabel.includes('SİGORTA'))).toBe(false)
    expect(snapshot.partRules.some((rule) => rule.sourceRow === 27 || rule.sourceRow >= 299)).toBe(false)
  })

  it('dormant ve excluded bölümleri açık sınıflandırır', () => {
    expect(snapshot.sections.filter((section) => section.classification === 'dormant')
      .map((section) => section.sectionId))
      .toEqual(['unused-market-value-coefficients', 'later-additions', 'hidden-sheet1'])
    expect(snapshot.sections.filter((section) => section.classification === 'excluded')
      .map((section) => section.sectionId))
      .toEqual(['insurer-list', 'placeholder-part-rows', 'row-27-residual'])
  })

  it('Unicode NFC, Türkçe case ve whitespace normalizasyonu deterministiktir', () => {
    expect(normalizeValueLossLabel('  I\u0307S\u0327  MAKİNESİ  '))
      .toBe(normalizeValueLossLabel('İŞ MAKİNESİ'))
    const stableId = buildValueLossPartStableId({
      vehicleGroupCode: 'Ç',
      sourceTable: 'group-c-cedilla',
      sourceRow: 127,
      normalizedLabel: normalizeValueLossLabel('SAĞ YAN PANEL'),
      operationCapabilities: ['replacement', 'repair', 'paint'],
    })
    expect(stableId).toContain('vehicle-group=%C3%87')
    expect(stableId).toContain('source-row=127')
    expect(stableId).toContain('operations=paint%2Brepair%2Breplacement')
  })

  it('canonical JSON ve snapshot hash anahtar sırasından bağımsız deterministiktir', () => {
    const reordered = Object.fromEntries(Object.entries(snapshot).reverse())
    expect(canonicalValueLossJson(reordered)).toBe(canonicalValueLossJson(snapshot))
    expect(hashValueLossRuleSnapshot(snapshot)).toBe(manifest.normalizedSnapshotSha256)
    const cloned = JSON.parse(canonicalValueLossJson(snapshot)) as ValueLossRuleSnapshot
    expect(hashValueLossRuleSnapshot(cloned))
      .toBe(manifest.normalizedSnapshotSha256)
  })
})

describe('Paket 66 mutation testleri', () => {
  it('1. dormant tablo aktif sayılırsa doğrulama kırılır', () => {
    const mutated = {
      ...snapshot,
      partTables: [
        ...snapshot.partTables,
        {
          tableId: 'later-additions',
          sourceRange: 'Tablolar!B264:L295',
          vehicleGroupCodes: ['A'],
          sourceRowCount: 2,
          emittedRuleCount: 2,
        },
      ],
    } as unknown as ValueLossRuleSnapshot
    expect(validateValueLossRuleSnapshot(mutated).ok).toBe(false)
  })

  it('2. stable IDden source row veya vehicle group çıkarılırsa doğrulama kırılır', () => {
    const first = snapshot.partRules[0] as ValueLossPartRule
    for (const stableId of [
      first.stableId.replace(`|source-row=${first.sourceRow}`, ''),
      first.stableId.replace(`|vehicle-group=${encodeURIComponent(first.vehicleGroupCode)}`, ''),
    ]) {
      const mutated = {
        ...snapshot,
        partRules: [{ ...first, stableId }, ...snapshot.partRules.slice(1)],
      }
      expect(validateValueLossRuleSnapshot(mutated).ok).toBe(false)
    }
  })

  it('3. placeholder veya sigortacı filtresi kaldırılırsa doğrulama kırılır', () => {
    const first = snapshot.partRules[0] as ValueLossPartRule
    for (const injected of [
      { ...first, stableId: `${first.stableId}-placeholder`, sourceRow: 66, sourceLabel: '0' },
      { ...first, stableId: `${first.stableId}-insurer`, sourceRow: 300, sourceLabel: 'AK SİGORTA' },
    ]) {
      const mutated = { ...snapshot, partRules: [...snapshot.partRules, injected] }
      expect(validateValueLossRuleSnapshot(mutated).ok).toBe(false)
    }
  })

  it('4. product decision source_workbook yapılırsa doğrulama kırılır', () => {
    const index = snapshot.vehicleMappings.findIndex((mapping) => mapping.provenance === 'product_decision')
    const mapping = snapshot.vehicleMappings[index]
    expect(mapping).toBeDefined()
    const mutatedMappings = [...snapshot.vehicleMappings]
    mutatedMappings[index] = { ...(mapping as NonNullable<typeof mapping>), provenance: 'source_workbook' }
    const mutated = { ...snapshot, vehicleMappings: mutatedMappings }
    expect(validateValueLossRuleSnapshot(mutated).ok).toBe(false)
  })

  it('5. source_vehicle_name_column_incomplete kaldırılırsa doğrulama kırılır', () => {
    const mutated = {
      ...snapshot,
      anomalies: snapshot.anomalies.filter(
        (anomaly) => anomaly.code !== 'source_vehicle_name_column_incomplete',
      ),
    }
    expect(validateValueLossRuleSnapshot(mutated).ok).toBe(false)
  })
})
