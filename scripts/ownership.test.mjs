import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'
import {APPLICATION_OWNER,APPLICATION_COPYRIGHT} from '../src/app/branding.ts'

test('all original workspaces and Windows metadata identify the same project owner',async()=>{
  for(const path of ['','apps/desktop/','services/api/','services/file-agent/','packages/domain/','packages/contracts/','packages/database/','packages/desktop-bridge/','packages/config/']){
    const pkg=JSON.parse(await readFile(path+'package.json','utf8'))
    assert.equal(pkg.author,APPLICATION_OWNER)
    assert.equal(pkg.license,'UNLICENSED')
    if(pkg.build)assert.equal(pkg.build.copyright,`Copyright (c) 2026 ${APPLICATION_OWNER}. All rights reserved.`)
  }
  assert.ok((await readFile('LICENSE','utf8')).startsWith(`Copyright (c) 2026 ${APPLICATION_OWNER}.`))
  assert.ok((await readFile('README.md','utf8')).includes(`**© 2026 ${APPLICATION_OWNER}**`))
  assert.equal(APPLICATION_COPYRIGHT,`© 2026 ${APPLICATION_OWNER}. Tüm hakları saklıdır.`)
})
test('retained third-party character licenses remain separate from the project license',async()=>{
  assert.ok((await readFile('public/vendor/coucou/LICENSE','utf8')).includes('MIT License'))
  assert.ok((await readFile('LICENSE','utf8')).includes('Third-party components remain subject to their respective licenses'))
})
