import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  assertTestDatabaseUrl,
  createDatabasePool,
  closeDatabasePool,
  runMigrations,
} from '@hasarbotu/database'
import { verifyPassword } from '@hasarbotu/api'
import {
  validateOrganizationCode,
  validateOrganizationName,
  validateEmail,
  validateDisplayName,
  validateAdminPassword,
  getBootstrapReadiness,
  bootstrapFirstAdmin,
  SafeError,
} from './bootstrap-first-admin.mjs'

const SCRIPT_PATH = fileURLToPath(new URL('./bootstrap-first-admin.mjs', import.meta.url))

function sampleInput(overrides = {}) {
  return {
    organizationCode: 'baran-global',
    organizationName: 'Baran Global Ekspertiz',
    adminEmail: 'admin@baranglobal.com',
    adminDisplayName: 'Sistem Yöneticisi',
    adminPassword: 'correct-horse-battery-staple',
    adminPasswordConfirm: 'correct-horse-battery-staple',
    ...overrides,
  }
}

// === Salt-okunur, DB gerektirmeyen dogrulama testleri (her zaman calisir) ===

test('validateOrganizationCode: gecerli kod kabul edilir, bosluk/buyuk harf/gecersiz karakter reddedilir', () => {
  assert.equal(validateOrganizationCode('baran-global'), 'baran-global')
  assert.throws(() => validateOrganizationCode('Baran Global'), (e) => e instanceof SafeError && e.safeCode === 'ORGANIZATION_CODE_INVALID')
  assert.throws(() => validateOrganizationCode('-leading-dash'), (e) => e.safeCode === 'ORGANIZATION_CODE_INVALID')
  assert.throws(() => validateOrganizationCode(''), (e) => e.safeCode === 'ORGANIZATION_CODE_INVALID')
})

test('validateOrganizationName: bos/yalniz-bosluk isim reddedilir', () => {
  assert.equal(validateOrganizationName('Baran Global Ekspertiz'), 'Baran Global Ekspertiz')
  assert.throws(() => validateOrganizationName('   '), (e) => e.safeCode === 'ORGANIZATION_NAME_INVALID')
})

test('validateEmail: gecersiz bicim reddedilir (loginRequestSchema ile AYNI emailSchema)', () => {
  assert.equal(validateEmail('admin@baranglobal.com'), 'admin@baranglobal.com')
  assert.throws(() => validateEmail('not-an-email'), (e) => e.safeCode === 'ADMIN_EMAIL_INVALID')
})

test('validateDisplayName: bos deger reddedilir', () => {
  assert.equal(validateDisplayName('Sistem Yöneticisi'), 'Sistem Yöneticisi')
  assert.throws(() => validateDisplayName(''), (e) => e.safeCode === 'ADMIN_DISPLAY_NAME_INVALID')
})

test('validateAdminPassword: kisa parola ve eslesmeyen onay reddedilir (passwordSchema ile AYNI min/max)', () => {
  assert.equal(validateAdminPassword('correct-horse-battery', 'correct-horse-battery'), 'correct-horse-battery')
  assert.throws(() => validateAdminPassword('short', 'short'), (e) => e.safeCode === 'ADMIN_PASSWORD_INVALID')
  assert.throws(() => validateAdminPassword('correct-horse-battery', 'different-value'), (e) => e.safeCode === 'ADMIN_PASSWORD_CONFIRMATION_MISMATCH')
})

test('CLI: DATABASE_URL verilmezse DATABASE_URL_REQUIRED ile exit 1 doner', () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH], {
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
// packages/database/test/integration.test.ts ile AYNI guvenlik kapisi:
// TEST_DATABASE_URL yoksa bu blok ACIKCA atlanir; verildiginde veritabani
// adi `_test` ile bitmek ZORUNDADIR (assertTestDatabaseUrl) -- uretim
// veritabanina karsi kosma girisimi durur. Her test KENDI icinde semayi
// sifirlayip migration'lari taze calistirir (tam izolasyon, sira
// bagimliligi yok) -- "organizations=0/users=0" onkosulu her testin
// KENDI, taze bir bos veritabaninda gecerli olmasi gerekir.

const TEST_URL = process.env.TEST_DATABASE_URL
const hasTestDb = typeof TEST_URL === 'string' && TEST_URL.length > 0

async function freshTestPool() {
  const config = assertTestDatabaseUrl(TEST_URL)
  const pool = createDatabasePool({ config })
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await runMigrations({ databaseUrl: config.url, quiet: true })
  return pool
}

describe('GERCEK PostgreSQL entegrasyonu (bootstrap-first-admin)', { skip: hasTestDb ? false : 'TEST_DATABASE_URL verilmedi' }, () => {
  test('getBootstrapReadiness: taze migration edilmis bos DBde ready=true, admin rolu seed edilmis', async () => {
    const pool = await freshTestPool()
    try {
      const readiness = await getBootstrapReadiness(pool)
      assert.equal(readiness.ready, true)
      assert.equal(readiness.organizationCount, 0)
      assert.equal(readiness.userCount, 0)
      assert.notEqual(readiness.adminRoleId, null)
      assert.deepEqual(readiness.blockers, [])
    } finally {
      await closeDatabasePool(pool)
    }
  })

  test('bootstrapFirstAdmin: basarili -- org+user+user_roles+2 audit_events TEK transactionda olusur, parola GERCEKTEN argon2 ile dogrulanabilir', async () => {
    const pool = await freshTestPool()
    try {
      const result = await bootstrapFirstAdmin(pool, sampleInput())
      assert.ok(result.organizationId)
      assert.ok(result.userId)
      assert.equal(result.auditEventIds.length, 2)

      const org = await pool.query('SELECT code, name FROM organizations WHERE id = $1', [result.organizationId])
      assert.equal(org.rows[0].code, 'baran-global')
      assert.equal(org.rows[0].name, 'Baran Global Ekspertiz')

      const user = await pool.query(
        'SELECT email, display_name, status, password_hash, organization_id FROM users WHERE id = $1',
        [result.userId],
      )
      assert.equal(user.rows[0].email, 'admin@baranglobal.com')
      assert.equal(user.rows[0].status, 'active')
      assert.equal(user.rows[0].organization_id, result.organizationId)
      const passwordVerified = await verifyPassword(user.rows[0].password_hash, 'correct-horse-battery-staple')
      assert.equal(passwordVerified, true)
      const wrongPasswordVerified = await verifyPassword(user.rows[0].password_hash, 'wrong-password-entirely')
      assert.equal(wrongPasswordVerified, false)

      const roles = await pool.query(
        `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1`,
        [result.userId],
      )
      assert.deepEqual(roles.rows.map((row) => row.code), ['admin'])

      const auditRows = await pool.query(
        'SELECT action, resource_type, resource_id, actor_user_id, details FROM audit_events WHERE id = ANY($1::uuid[]) ORDER BY action',
        [result.auditEventIds],
      )
      assert.equal(auditRows.rows.length, 2)
      const orgEvent = auditRows.rows.find((row) => row.action === 'organization.created')
      const userEvent = auditRows.rows.find((row) => row.action === 'user.created')
      assert.equal(orgEvent.actor_user_id, null)
      assert.equal(orgEvent.resource_id, result.organizationId)
      assert.equal(orgEvent.details.bootstrap, true)
      assert.equal(userEvent.actor_user_id, null)
      assert.equal(userEvent.resource_id, result.userId)
      assert.deepEqual(userEvent.details.roles, ['admin'])
    } finally {
      await closeDatabasePool(pool)
    }
  })

  test('bootstrapFirstAdmin: ILK basarili calistirmadan SONRA ikinci deneme fail-closed reddedilir (tek-kullanimlik)', async () => {
    const pool = await freshTestPool()
    try {
      await bootstrapFirstAdmin(pool, sampleInput())
      const readinessAfterFirst = await getBootstrapReadiness(pool)
      assert.equal(readinessAfterFirst.ready, false)
      assert.deepEqual(readinessAfterFirst.blockers, ['ORGANIZATIONS_NOT_EMPTY_1', 'USERS_NOT_EMPTY_1'])

      await assert.rejects(
        () => bootstrapFirstAdmin(pool, sampleInput({ organizationCode: 'second-org', adminEmail: 'second@example.com' })),
        (error) => error instanceof SafeError && error.safeCode.startsWith('READINESS_CHANGED_SINCE_CHECK'),
      )

      const orgCount = await pool.query('SELECT COUNT(*)::int AS count FROM organizations')
      const userCount = await pool.query('SELECT COUNT(*)::int AS count FROM users')
      assert.equal(orgCount.rows[0].count, 1)
      assert.equal(userCount.rows[0].count, 1)
    } finally {
      await closeDatabasePool(pool)
    }
  })

  test('bootstrapFirstAdmin: baska bir surecin ARADA organizasyon eklemesi TOCTOU korumasiyla yakalanir, YARIM admin kullanicisi KALMAZ', async () => {
    const pool = await freshTestPool()
    try {
      // "onceki bir onizleme sonrasi, apply calismadan HEMEN once baska bir
      // surecin/operatorun ayni DB'ye bagimsiz bir organizasyon eklemesi"
      // senaryosunu simule eder -- bootstrapFirstAdmin KENDI ic
      // transaction'inda TAZE yeniden kontrol eder, disaridaki bu INSERT'i
      // yakalar.
      await pool.query("INSERT INTO organizations (id, code, name) VALUES (gen_random_uuid(), 'race-condition-org', 'Race Condition Org')")

      await assert.rejects(
        () => bootstrapFirstAdmin(pool, sampleInput()),
        (error) => error instanceof SafeError && error.safeCode.startsWith('READINESS_CHANGED_SINCE_CHECK'),
      )

      const orgCount = await pool.query('SELECT COUNT(*)::int AS count FROM organizations')
      const userCount = await pool.query('SELECT COUNT(*)::int AS count FROM users')
      assert.equal(orgCount.rows[0].count, 1, 'yalniz race-condition-org var olmali, bootstrap ikinci bir org EKLEMEMIS olmali')
      assert.equal(userCount.rows[0].count, 0, 'YARIM/yetim bir admin kullanicisi KESINLIKLE olusmamis olmali')
    } finally {
      await closeDatabasePool(pool)
    }
  })

  test('bootstrapFirstAdmin: gecersiz girdi (kisa parola) DB yazmasindan ONCE reddedilir -- sifir satir olusur', async () => {
    const pool = await freshTestPool()
    try {
      await assert.rejects(
        () => bootstrapFirstAdmin(pool, sampleInput({ adminPassword: 'short', adminPasswordConfirm: 'short' })),
        (error) => error instanceof SafeError && error.safeCode === 'ADMIN_PASSWORD_INVALID',
      )
      const orgCount = await pool.query('SELECT COUNT(*)::int AS count FROM organizations')
      const userCount = await pool.query('SELECT COUNT(*)::int AS count FROM users')
      assert.equal(orgCount.rows[0].count, 0)
      assert.equal(userCount.rows[0].count, 0)
    } finally {
      await closeDatabasePool(pool)
    }
  })

  test('bootstrapFirstAdmin: gecersiz organizasyon kodu (DB CHECK ihlali) transaction ROLLBACK ile sifir satir birakir', async () => {
    const pool = await freshTestPool()
    try {
      // Uygulama-seviyesi validasyonu BILEREK atlayip DB CHECK kisitina
      // dogrudan carpar -- ROLLBACK'in gercekten calistigini (yalniz
      // uygulama validasyonuna guvenilmedigini) kanitlar. bootstrapFirstAdmin
      // KENDI validateOrganizationCode'unu her zaman cagirir; bu yuzden DB
      // kisitina carpmasi icin dogrudan SQL ile ayni sekilde dener.
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await assert.rejects(
          () => client.query("INSERT INTO organizations (id, code, name) VALUES (gen_random_uuid(), 'INVALID CODE', 'x')"),
          (error) => error.code === '23514', // check_violation
        )
        await client.query('ROLLBACK')
      } finally {
        client.release()
      }
      const orgCount = await pool.query('SELECT COUNT(*)::int AS count FROM organizations')
      assert.equal(orgCount.rows[0].count, 0)
    } finally {
      await closeDatabasePool(pool)
    }
  })

  test('CLI: gercek (TEST) veritabaninda preview -- bos DBde Status=ready, exit 0, HICBIR satir yazilmaz', async () => {
    const pool = await freshTestPool()
    try {
      const result = spawnSync(process.execPath, [SCRIPT_PATH], {
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: TEST_URL },
      })
      assert.equal(result.status, 0)
      const json = JSON.parse(result.stdout.trim())
      assert.equal(json.Mode, 'preview')
      assert.equal(json.Status, 'ready')
      assert.equal(json.OrganizationCount, 0)
      assert.equal(json.UserCount, 0)
      assert.equal(json.AdminRoleSeeded, true)

      const orgCount = await pool.query('SELECT COUNT(*)::int AS count FROM organizations')
      assert.equal(orgCount.rows[0].count, 0, 'preview HICBIR SEY yazmamis olmali')
    } finally {
      await closeDatabasePool(pool)
    }
  })

  test('CLI: -Apply ile ama interaktif olmayan (TTY olmayan) stdinde STDIN_NOT_INTERACTIVE ile fail-closed reddedilir, sifir satir yazilir', async () => {
    const pool = await freshTestPool()
    try {
      // spawnSync varsayilan olarak TTY OLMAYAN bir stdin verir -- gercek bir
      // otomasyon/betik baglaminda yanlislikla -Apply calistirilirsa asla
      // sessizce ilerlemeyecegini (veya sonsuza kadar asilı kalmayacagini)
      // kanitlar.
      const result = spawnSync(process.execPath, [SCRIPT_PATH, '--apply'], {
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: TEST_URL },
        input: '',
        timeout: 10_000,
      })
      assert.equal(result.status, 2)
      const json = JSON.parse(result.stdout.trim())
      assert.equal(json.Status, 'blocked')
      assert.deepEqual(json.Blockers, ['STDIN_NOT_INTERACTIVE'])

      const orgCount = await pool.query('SELECT COUNT(*)::int AS count FROM organizations')
      assert.equal(orgCount.rows[0].count, 0)
    } finally {
      await closeDatabasePool(pool)
    }
  })
})
