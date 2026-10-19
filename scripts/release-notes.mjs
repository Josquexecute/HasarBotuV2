import { execFileSync } from 'node:child_process'
import { assertReadableText } from './text-encoding.mjs'

export function parseReleaseVersion(tag) {
  if (typeof tag !== 'string' || tag.replace(/^v/, '').length > 32 || !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) throw new Error('Release version must be major.minor.patch.')
  return tag.replace(/^v/, '')
}

export function compareReleaseVersions(left, right) {
  const a = parseReleaseVersion(left).split('.').map(BigInt), b = parseReleaseVersion(right).split('.').map(BigInt)
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1
  return 0
}

export function readReleaseCommits(previousSha, currentSha, cwd = process.cwd()) {
  if (![currentSha, ...(previousSha ? [previousSha] : [])].every(sha => /^[a-f0-9]{40}$/.test(sha))) throw new Error('Release commits must be resolved SHA-1 references.')
  if (previousSha) execFileSync('git', ['merge-base', '--is-ancestor', previousSha, currentSha], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
  const result = execFileSync('git', ['log', '--no-merges', '--reverse', '--format=%H%x00%s%x00', previousSha ? `${previousSha}..${currentSha}` : currentSha], { cwd, encoding: 'utf8', maxBuffer: 2_000_000 })
  const parts = result.split('\0'), commits = []
  for (let index = 0; index + 1 < parts.length; index += 2) commits.push({ sha: parts[index].trim(), subject: parts[index + 1].trim() })
  return commits
}

export function renderReleaseNotes(commits, { version, sourceSha, runUrl, testSummary, summary = '' }) {
  parseReleaseVersion(version)
  if (!/^[a-f0-9]{40}$/.test(sourceSha) || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/.test(runUrl)) throw new Error('Invalid validated release provenance.')
  if (!testSummary || testSummary.status !== 'PASS' || !Number.isInteger(testSummary.passed) || testSummary.passed < 1
    || !Number.isInteger(testSummary.skipped) || testSummary.skipped < 0) throw new Error('Actual test results are required for release notes.')
  const groups = new Map([['Yeni özellikler', []], ['Düzeltmeler', []], ['Diğer değişiklikler', []]])
  for (const commit of commits) {
    if (!/^[a-f0-9]{40}$/.test(commit.sha) || typeof commit.subject !== 'string') throw new Error('Invalid commit entry.')
    const match = /^(\w+)(?:\([^)]+\))?!?:\s*(.+)$/u.exec(commit.subject)
    const title = (match?.[2] ?? commit.subject).replace(/[\r\n]/g, ' ').trim()
    if (!title) continue
    const group = match?.[1] === 'feat' ? 'Yeni özellikler' : match?.[1] === 'fix' ? 'Düzeltmeler' : 'Diğer değişiklikler'
    groups.get(group).push('- ' + title)
  }
  const lines = [`## HasarBotu ${version}`, '']
  if (summary.trim()) lines.push(summary.trim(), '')
  for (const [title, entries] of groups) if (entries.length) lines.push(`### ${title}`, '', ...entries, '')
  if (![...groups.values()].some(entries => entries.length)) lines.push('Bu sürüm için önceki sürümden sonra yeni kaynak değişikliği yok.', '')
  lines.push('### Doğrulama', '',
    'Windows x64 kurulum paketi; TypeScript, testler, build ve paket bütünlüğü kontrolleri geçti.',
    `${testSummary.passed} test geçti; ${testSummary.skipped} test atlandı. Atlanan kontroller başarılı sayılmadı.`,
    'Canlı Google hesabı veya ofis sunucusunun yeni sürüm kabulü bu CI kontrolüyle doğrulanmış sayılmaz.',
    '', `[Kontrol çalışması](${runUrl})`, '',
    `<!-- hasarbotu-source:${sourceSha} -->`)
  const body = lines.join('\n')
  if (body.length > 3500) throw new Error('Release notes exceed the desktop update limit; shorten the version summary or commit subjects.')
  return assertReadableText(body, 'Generated release notes')
}

const start = '<!-- hasarbotu-generated:start -->', end = '<!-- hasarbotu-generated:end -->'
export function mergeReleaseNotes(existing, generated) {
  assertReadableText(existing ?? '', 'Existing release notes')
  assertReadableText(generated, 'Generated release notes')
  const block = `${start}\n${generated}\n${end}`
  if (!existing?.trim()) return block
  const first = existing.indexOf(start), last = existing.indexOf(end)
  if (first < 0 && last < 0) return existing.trimEnd() + '\n\n' + block
  if (first < 0 || last < first || existing.indexOf(start, first + start.length) >= 0 || existing.indexOf(end, last + end.length) >= 0) throw new Error('Release note markers are damaged.')
  return existing.slice(0, first) + block + existing.slice(last + end.length)
}
