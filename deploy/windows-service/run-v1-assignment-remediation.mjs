import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { applyV1AssignmentRemediation, planV1AssignmentRemediation, v1AssignmentManifestSchema } from '@hasarbotu/api'
import { closeDatabasePool, createDatabasePool, parseDatabaseUrl } from '@hasarbotu/database'

// Same operator boundary as run-v1-import: read-only preview, exact digest and human confirmation.
const args = { apply: false }
let pool
try {
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i]
    if (key === '--apply') { args.apply = true; continue }
    const fields = { '--manifest': 'manifest', '--organization-id': 'organizationId', '--actor-user-id': 'actorUserId', '--expected-plan-hash': 'expectedPlanHash' }
    if (!fields[key] || !process.argv[i + 1] || args[fields[key]]) throw new Error('ASSIGNMENT_ARGUMENT_INVALID')
    args[fields[key]] = process.argv[++i]
  }
  if (!args.manifest || !args.organizationId) throw new Error('ASSIGNMENT_MANIFEST_AND_ORGANIZATION_REQUIRED')
  if (args.apply && (!process.stdin.isTTY || !args.actorUserId || !/^[0-9a-f]{64}$/u.test(args.expectedPlanHash ?? ''))) throw new Error('ASSIGNMENT_INTERACTIVE_ACTOR_AND_PLAN_REQUIRED')
  const manifest = v1AssignmentManifestSchema.parse(JSON.parse(await readFile(args.manifest, 'utf8')))
  pool = createDatabasePool({ config: parseDatabaseUrl(process.env.DATABASE_URL) })
  const client = await pool.connect()
  let plan
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
    plan = await planV1AssignmentRemediation(client, args.organizationId, manifest)
    await client.query('ROLLBACK')
  } finally { client.release() }
  process.stdout.write(`${JSON.stringify({ mode: args.apply ? 'apply' : 'preview', planHash: plan.planHash,
    closedCases: plan.entries.length, unassignedResponsible: plan.entries.filter(row => row.responsibleUserId === null).length,
    expertUserId: manifest.expertUserId }, null, 2)}\n`)
  if (args.apply) {
    if (args.expectedPlanHash !== plan.planHash) throw new Error('ASSIGNMENT_EXPECTED_PLAN_MISMATCH')
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    let confirmation
    try { confirmation = await rl.question(`UYGULA ${plan.planHash} yazin: `) }
    finally { rl.close() }
    if (confirmation.trim() !== `UYGULA ${plan.planHash}`) throw new Error('ASSIGNMENT_CONFIRMATION_MISMATCH')
    const result = await applyV1AssignmentRemediation(pool, { organizationId: args.organizationId, actorUserId: args.actorUserId,
      requestId: `v1-assignment-${Date.now()}` }, plan, args.expectedPlanHash)
    process.stdout.write(`${JSON.stringify(result)}\n`)
  }
} catch (error) {
  // Database and filesystem errors may contain private paths or configuration.
  const code = /^assignment_|^ASSIGNMENT_/u.test(error.message) ? error.message : 'ASSIGNMENT_RUNTIME_ERROR'
  process.stderr.write(`${JSON.stringify({ status: 'error', code })}\n`)
  process.exitCode = 1
} finally {
  if (pool) await closeDatabasePool(pool)
}
