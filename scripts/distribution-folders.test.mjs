import assert from 'node:assert/strict'
import test from 'node:test'
import {parseDistributionFolders} from './distribution-folders.mjs'

test('private office mappings preserve arbitrary registered keys and Unicode paths',()=>{
  const roots={'office-primary':'P:\\Örnek Ofis\\2026','archive-1':'\\\\server\\arşiv'}
  assert.deepEqual(parseDistributionFolders(roots),roots)
})
test('generic installations can select a folder instead of receiving an invented office path',()=>assert.deepEqual(parseDistributionFolders({}),{}))
test('malformed maps and relative, drive-relative or unsafe paths are rejected',()=>{
  for(const input of [null,[],{'office-primary':'C:relative'},{'office-primary':'relative/path'},{'office-primary':12},{'office-primary':'P:\\bad\0path'},JSON.parse('{"__proto__":"C:\\\\Office"}')])assert.throws(()=>parseDistributionFolders(input))
})
