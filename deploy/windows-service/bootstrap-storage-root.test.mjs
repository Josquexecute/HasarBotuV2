import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  assertTestDatabaseUrl,
  createDatabasePool,
  closeDatabasePool,
  runMigrations,
  uuidv7,
} from '@hasarbotu/database'
import {
  validateOrganizationCode,
  validateRootKey,
  validateLabel,
  parseArguments,
  getStorageRootReadiness,
  bootstrapStorageRoot,
  SafeError,
} from './bootstrap-storage-root.mjs'

const SCRIPT_PATH = fileURLToPath(new URL('./bootstrap-storage-root.mjs', import.meta.url))

// === Salt-okunur, DB gerektirmeyen dogrulama testleri (her zaman calisir) ===

test('validateOrganizationCode: bosluklu deger trim edilir, bos deger reddedilir', () => {
  assert.equal(validateOrganizationCode('  baran-global  '), 'baran-global')
  assert.throws(() => validateOrganizationCode(''), (e) => e instanceof SafeError && e.safeCode === 'ORGANIZATION_CODE_INVALID')
  assert.throws(() => validateOrganizationCode('   '), (e) => e.safeCode === 'ORGANIZATION_CODE_INVALID')
})

test('validateRootKey: gercek uretim degeri (baran-global-primary) kabul edilir; buyuk harf/bosluk/asiri uzunluk reddedilir (storage_roots_key_format ile AYNI kural)', () => {
  assert.equal(validateRootKey('baran-global-primary'), 'baran-global-primary')
  assert.throws(() => validateRootKey('Baran-Global'), (e) => e.safeCode === 'ROOT_KEY_INVALID')
  assert.throws(() => validateRootKey('baran global'), (e) => e.safeCode === 'ROOT_KEY_INVALID')
  assert.throws(() => validateRootKey('-leading-dash'), (e) => e.safeCode === 'ROOT_KEY_INVALID')
  assert.throws(() => validateRootKey('a'.repeat(65)), (e) => e.safeCode === 'ROOT_KEY_INVALID')
  assert.throws(() => validateRootKey(''), (e) => e.safeCode === 'ROOT_KEY_INVALID')
})

test('validateLabel: bos/asiri uzun deger reddedilir', () => {
  assert.equal(validateLabel('Baran Global Ana Depo'), 'Baran Global Ana Depo')
  assert.throws(() => validateLabel(''), (e) => e.safeCode === 'LABEL_INVALID')
  assert.throws(() => validateLabel('x'.repeat(201)), (e) => e.safeCode === 'LABEL_INVALID')
})

test('parseArguments: tam gecerli girdi (apply ile/olmadan) dogru nesneyi doner', () => {
  const withoutApply = parseArguments(['--organization-code', 'baran-global', '--root-key', 'baran-global-primary', '--label', 'Ana Depo'])
  assert.deepEqual(withoutApply, { apply: false, organizationCode: 'baran-global', rootKey: 'baran-global-primary', label: 'Ana Depo' })
  const withApply = parseArguments(['--organization-code', 'x', '--root-key', 'y', '--label', 'z', '--apply'])
  assert.equal(withApply.apply, true)
})

test('parseArguments: bilinmeyen bayrak, degersiz bayrak ve eksik zorunlu alan reddedilir', () => {
  assert.throws(() => parseArguments(['--unknown']), (e) => e.safeCode === 'ARGUMENT_UNKNOWN:--unknown')
  assert.throws(
    () => parseArguments(['--organization-code']),
    (e) => e.safeCode === 'ARGUMENT_MISSING_VALUE:--organization-code',
  )
  assert.throws(
    () => parseArguments(['--organization-code', 'x']),
    (e) => e.safeCode === 'ARGUMENT_MISSING:--root-key',
  )
})

test('CLI: DATABASE_URL verilmezse DATABASE_URL_REQUIRED ile exit 1 doner', () => {
  const result = spawnSync(process.execPath, [
    SCRIPT_PATH,
    '--organization-code', 'baran-global',
    '--root-key', 'baran-global-primary',
    '--label', 'Ana Depo',
  ], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: '' },
  })
  assert.equal(result.status, 1)
  const json = JSON.parse(result.stdout.trim())
  assert.equal(json.ErrorCode, 'DATABASE_URL_REQUIRED')
})

test('CLI: bilinmeyen argüman fail-closed reddedilir', () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, '--unknown-flag'], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: 'postgres://x:y@127.0.0.1:5432/does_not_matter' },
  })
  assert.equal(result.status, 1)
  const json = JSON.parse(result.stdout.trim())
  assert.match(json.ErrorCode, /^ARGUMENT_UNKNOWN:/)
})

// === GERCEK PostgreSQL entegrasyon testleri (yalniz TEST_DATABASE_URL ile) ===
//
// bootstrap-first-admin.test.mjs ile AYNI guvenlik kapisi: TEST_DATABASE_URL
// yoksa bu blok ACIKCA atlanir; verildiginde veritabani adi `_test` ile
// bitmek ZORUNDADIR (assertTestDatabaseUrl). Her test KENDI icinde semayi
// sifirlayip migration'lari taze calistirir (tam izolasyon).

const TEST_URL = process.env.TEST_DATABASE_URL
const hasTestDb = typeof TEST_URL === 'string' && TEST_URL.length > 0

async function freshTestPool() {
  const config = assertTestDatabaseUrl(TEST_URL)
  const pool = createDatabasePool({ config })
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await runMigrations({ databaseUrl: config.url, quiet: true })
  return pool
}

async function insertOrganization(pool, code = 'baran-global', name = 'Baran Global Ekspertiz') {
  const id = uuidv7()
  await pool.query('INSERT INTO organizations (id, code, name) VALUES ($1, $2, $3)', [id, code, name])
  return id
}

describe('GERCEK PostgreSQL entegrasyonu (bootstrap-storage-root)', { skip: hasTestDb ? false : 'TEST_DATABASE_URL verilmedi' }, () => {
  test('getStorageRootReadiness: organizasyon yoksa ORGANIZATION_NOT_FOUND', async () => {
    const pool = await freshTestPool()
    try {
      const readiness = await getStorageRootReadiness(pool, 'baran-global', 'baran-global-primary')
      assert.equal(readiness.organizationId, null)
      assert.deepEqual(readiness.blockers, ['ORGANIZATION_NOT_FOUND'])
    } finally {
      await closeDatabasePool(pool)
    }
  })

  test('getStorageRootReadiness: organizasyon var, kok henuz yoksa ready=true', async () => {
    const pool = await freshTestPool()
    try {
      const orgId = await insertOrganization(pool)
      const readiness = await getStorageRootReadiness(pool, 'baran-global', 'baran-global-primary')
      assert.equal(readiness.organizationId, orgId)
      assert.equal(readiness.ready, true)
      assert.equal(readiness.alreadyExists, false)
    } finally {
      await closeDatabasePool(pool)
    }
  })

  test('bootstrapStorageRoot: basarili -- satir + audit_events TEK transactionda olusur', async () => {
    const pool = await freshTestPool()
    try {
      const orgId = await insertOrganization(pool)
      const result = await bootstrapStorageRoot(pool, {
        organizationCode: 'baran-global',
        rootKey: 'baran-global-primary',
        label: 'Baran Global Ana Depo',
      })
      assert.equal(result.outcome, 'applied')
      assert.equal(result.organizationId, orgId)

      const row = await pool.query(
        'SELECT organization_id, root_key, label, is_active FROM storage_roots WHERE id = $1',
        [result.id],
      )
      assert.equal(row.rows[0].organization_id, orgId)
      assert.equal(row.rows[0].root_key, 'baran-global-primary')
      assert.equal(row.rows[0].label, 'Baran Global Ana Depo')
      assert.equal(row.rows[0].is_active, true)

      const audit = await pool.query(
        'SELECT organization_id, actor_user_id, action, resource_type, resource_id, details FROM audit_events WHERE id = $1',
        [result.auditEventId],
      )
      assert.equal(audit.rows[0].organization_id, orgId)
      assert.equal(audit.rows[0].actor_user_id, null)
      assert.equal(audit.rows[0].action, 'storage_root.created')
      assert.equal(audit.rows[0].resource_type, 'storage_root')
      assert.equal(audit.rows[0].resource_id, result.id)
      assert.equal(audit.rows[0].details.rootKey, 'baran-global-primary')
    } finally {
      await closeDatabasePool(pool)
    }
  })

  test('bootstrapStorageRoot: ayni (org,rootKey) icin ikinci cagri already_exists doner, YENI satir/audit OLUSMAZ', async () => {
    const pool = await freshTestPool()
    try {
      await insertOrganization(pool)
      const first = await bootstrapStorageRoot(pool, {
        organizationCode: 'baran-global',
        rootKey: 'baran-global-primary',
        label: 'Baran Global Ana Depo',
      })
      assert.equal(first.outcome, 'applied')

      const second = await bootstrapStorageRoot(pool, {
        organizationCode: 'baran-global',
        rootKey: 'baran-global-primary',
        label: 'Farkli bir etiket bile fark etmez',
      })
      assert.equal(second.outcome, 'already_exists')

      const rootCount = await pool.query('SELECT COUNT(*)::int AS count FROM storage_roots')
      assert.equal(rootCount.rows[0].count, 1)
      const auditCount = await pool.query("SELECT COUNT(*)::int AS count FROM audit_events WHERE action = 'storage_root.created'")
      assert.equal(auditCount.rows[0].count, 1)
    } finally {
      await closeDatabasePool(pool)
    }
  })

  test('bootstrapStorageRoot: organizasyon yoksa blocked doner, sifir satir yazilir', async () => {
    const pool = await freshTestPool()
    try {
      const result = await bootstrapStorageRoot(pool, {
        organizationCode: 'no-such-org',
        rootKey: 'baran-global-primary',
        label: 'Ana Depo',
      })
      assert.equal(result.outcome, 'blocked')
      assert.deepEqual(result.blockers, ['ORGANIZATION_NOT_FOUND'])
      const rootCount = await pool.query('SELECT COUNT(*)::int AS count FROM storage_roots')
      assert.equal(rootCount.rows[0].count, 0)
    } finally {
      await closeDatabasePool(pool)
    }
  })

  test('bootstrapStorageRoot: cagridan ONCE ayni kok baska bir yoldan eklenmisse (rakip yazma benzetimi) TAZE ic-transaction kontrolu already_exists yakalar, IKINCI satir OLUSMAZ', async () => {
    const pool = await freshTestPool()
    try {
      const orgId = await insertOrganization(pool)
      await pool.query(
        'INSERT INTO storage_roots (id, organization_id, root_key, label) VALUES ($1, $2, $3, $4)',
        [uuidv7(), orgId, 'baran-global-primary', 'Rakip yazimla eklenen kok'],
      )

      const result = await bootstrapStorageRoot(pool, {
        organizationCode: 'baran-global',
        rootKey: 'baran-global-primary',
        label: 'Bu asla yazilmamali',
      })
      assert.equal(result.outcome, 'already_exists')

      const rows = await pool.query('SELECT label FROM storage_roots WHERE organization_id = $1 AND root_key = $2', [orgId, 'baran-global-primary'])
      assert.equal(rows.rows.length, 1, 'ikinci bir satir olusmamis olmali')
      assert.equal(rows.rows[0].label, 'Rakip yazimla eklenen kok', 'ilk (rakip) etiket degismemis olmali')
    } finally {
      await closeDatabasePool(pool)
    }
  })

  test('bootstrapStorageRoot: gecersiz rootKey formati DB yazmasindan ONCE reddedilir', async () => {
    const pool = await freshTestPool()
    try {
      await insertOrganization(pool)
      await assert.rejects(
        () => bootstrapStorageRoot(pool, { organizationCode: 'baran-global', rootKey: 'Invalid Key', label: 'Ana Depo' }),
        (error) => error instanceof SafeError && error.safeCode === 'ROOT_KEY_INVALID',
      )
      const rootCount = await pool.query('SELECT COUNT(*)::int AS count FROM storage_roots')
      assert.equal(rootCount.rows[0].count, 0)
    } finally {
      await closeDatabasePool(pool)
    }
  })

  test('CLI: onizleme -- organizasyon varsa Status=ready, exit 0, HICBIR satir yazilmaz', async () => {
    const pool = await freshTestPool()
    try {
      await insertOrganization(pool)
      const result = spawnSync(process.execPath, [
        SCRIPT_PATH,
        '--organization-code', 'baran-global',
        '--root-key', 'baran-global-primary',
        '--label', 'Ana Depo',
      ], {
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: TEST_URL },
      })
      assert.equal(result.status, 0)
      const json = JSON.parse(result.stdout.trim())
      assert.equal(json.Mode, 'preview')
      assert.equal(json.Status, 'ready')
      assert.equal(json.OrganizationFound, true)

      const rootCount = await pool.query('SELECT COUNT(*)::int AS count FROM storage_roots')
      assert.equal(rootCount.rows[0].count, 0, 'onizleme HICBIR SEY yazmamis olmali')
    } finally {
      await closeDatabasePool(pool)
    }
  })

  test('CLI: onizleme -- organizasyon yoksa Status=blocked, exit 2', async () => {
    const pool = await freshTestPool()
    try {
      const result = spawnSync(process.execPath, [
        SCRIPT_PATH,
        '--organization-code', 'no-such-org',
        '--root-key', 'baran-global-primary',
        '--label', 'Ana Depo',
      ], {
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: TEST_URL },
      })
      assert.equal(result.status, 2)
      const json = JSON.parse(result.stdout.trim())
      assert.equal(json.Status, 'blocked')
      assert.deepEqual(json.Blockers, ['ORGANIZATION_NOT_FOUND'])
    } finally {
      await closeDatabasePool(pool)
    }
  })

  test('CLI: --apply gercek DBde satiri yazar; ayni komut IKINCI KEZ calistirilinca already_exists ile idempotent kalir', async () => {
    const pool = await freshTestPool()
    try {
      await insertOrganization(pool)
      const args = [
        SCRIPT_PATH,
        '--organization-code', 'baran-global',
        '--root-key', 'baran-global-primary',
        '--label', 'Ana Depo',
        '--apply',
      ]
      const first = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, DATABASE_URL: TEST_URL } })
      assert.equal(first.status, 0)
      const firstJson = JSON.parse(first.stdout.trim())
      assert.equal(firstJson.Status, 'applied')
      assert.ok(firstJson.StorageRootId)

      const second = spawnSync(process.execPath, args, { encoding: 'utf8', env: { ...process.env, DATABASE_URL: TEST_URL } })
      assert.equal(second.status, 0)
      const secondJson = JSON.parse(second.stdout.trim())
      assert.equal(secondJson.Status, 'already_exists')

      const rootCount = await pool.query('SELECT COUNT(*)::int AS count FROM storage_roots')
      assert.equal(rootCount.rows[0].count, 1, 'iki calistirmadan sonra hala tek satir olmali')
    } finally {
      await closeDatabasePool(pool)
    }
  })
})
