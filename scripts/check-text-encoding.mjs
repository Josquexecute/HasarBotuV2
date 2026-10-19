import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { decodeUtf8Text } from './text-encoding.mjs'

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 4_000_000 })
  .split('\0').filter(file => /\.(?:[cm]?[jt]sx?|json|html|css|ps1|psm1|nsh|yml|yaml|md|mdx|txt|vbs|svg|xml|sql)$/i.test(file))
let checked = 0
for (const file of files) {
  let bytes
  try { bytes = await readFile(file) }
  catch (error) { if (error.code === 'ENOENT') continue; throw error }
  const text = decodeUtf8Text(bytes, file)
  if (/\.ps(?:1|m1)$/i.test(file) && /[^\x00-\x7f]/u.test(text) && !bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    throw new Error(`${file}: Windows PowerShell scripts containing Unicode require a UTF-8 BOM.`)
  }
  checked++
}
console.log(JSON.stringify({ status: 'PASS', checked }))
