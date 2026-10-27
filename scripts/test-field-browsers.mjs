import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium, firefox, webkit } from '@playwright/test'
import { startFieldBrowserFixture } from '../services/api/tools/field-browser-fixture.mjs'

const evidence=resolve(process.env.FIELD_BROWSER_EVIDENCE ?? '.local/field-browser-evidence')
const captureScreenshots=process.env.HB_CAPTURE_SCREENSHOTS==='1'
await mkdir(evidence,{recursive:true})
const fixture=await startFieldBrowserFixture(process.env.TEST_DATABASE_URL)
const checks=[]
const check=(name,pass)=>{assert.ok(pass,name);checks.push({name,pass:true})}
try {
  for(const [index,[engine,name]] of [[chromium,'chromium'],[firefox,'firefox'],[webkit,'webkit']].entries()){
    const browser=await engine.launch({headless:true})
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,...(name!=='firefox'?{isMobile:true}:{})})
    const page=await context.newPage(), errors=[]
    page.on('pageerror',error=>errors.push(error.message))
    try {
      await page.goto(fixture.origin+'/saha')
      await page.getByRole('heading',{name:'Hoş geldiniz'}).waitFor()
      for(const [width,height] of [[320,700],[375,812],[390,844],[412,915],[768,1024],[1024,768],[844,390],[1440,900]]){
        await page.setViewportSize({width,height})
        check(`${name}: login fits ${width}x${height}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
      }
      await page.setViewportSize({width:390,height:844})
      if(captureScreenshots)await page.screenshot({path:join(evidence,`${name}-login-mobile.png`),fullPage:true})
      check(`${name}: persistent-cookie consent starts unchecked`,!await page.getByRole('checkbox',{name:'Bu cihazda oturumumu hatırla'}).isChecked())
      await page.getByLabel('E-posta',{exact:true}).fill(fixture.email);await page.getByLabel('Parola',{exact:true}).fill(fixture.password)
      await page.getByRole('button',{name:'Giriş yap',exact:true}).click();await page.getByRole('textbox',{name:'Plaka ara'}).waitFor()
      check(`${name}: refusing persistence uses a session cookie`,(await context.cookies()).find(cookie=>cookie.name==='hb_session')?.expires===-1)
      await page.getByRole('textbox',{name:'Plaka ara'}).fill(fixture.cases[index].plate)
      await page.getByRole('button',{name:'Ara',exact:true}).click();await page.locator('.field-case').first().waitFor()
      await page.locator('.field-case').filter({hasText:fixture.cases[index].plate}).click()
      const photo=Buffer.concat([fixture.jpeg,Buffer.alloc(600000,7)])
      let interrupted=false, resumedOffset=0
      await page.route('**/api/v1/field/uploads/*/chunk?offset=*',async route=>{
        const offset=Number(new URL(route.request().url()).searchParams.get('offset'))
        if(offset>0&&!interrupted){interrupted=true;await route.abort('failed');return}
        if(interrupted&&offset>0)resumedOffset=offset
        await route.continue()
      })
      await page.getByLabel('Galeriden fotoğraf seç',{exact:true}).setInputFiles({name:'camera-original.jpg',mimeType:'image/jpeg',buffer:photo})
      await page.getByRole('button',{name:'1 fotoğrafı yükle',exact:true}).click()
      await page.getByText('Devam etmeyi bekliyor',{exact:true}).waitFor()
      check(`${name}: failed transport pauses visibly`,interrupted)
      await page.getByRole('button',{name:'1 fotoğrafı yükle',exact:true}).click()
      await page.getByText('HASAR 102.jpg',{exact:true}).waitFor({timeout:30000})
      check(`${name}: resume continues from committed bytes`,resumedOffset>=262144)
      const saved=await fixture.pool.query('SELECT * FROM field_photo_uploads WHERE case_id=$1',[fixture.cases[index].id])
      check(`${name}: retry has one upload record`,saved.rowCount===1)
      check(`${name}: original bytes remain exact`,(await readFile(join(fixture.originals,saved.rows[0].id+'.bin'))).equals(photo))
      check(`${name}: JPEG reaches the physical HASAR folder`,(await readFile(join(fixture.root,fixture.cases[index].path,'HASAR','HASAR 102.jpg'))).length>=102400)
      check(`${name}: earlier office photo is preserved`,(await readFile(join(fixture.root,fixture.cases[index].path,'HASAR','HASAR 101.jpg'),'utf8'))==='Existing office photo must be preserved')
      for(const [kind,fileName,label] of [['Şase','synthetic.heic','ŞASE.jpg'],['Kilometre','synthetic.avif','KM.jpg'],['VİTES','orientation-6.jpg','VİTES.jpg']]){
        await page.getByRole('button',{name:kind,exact:true}).click()
        await page.getByLabel('Galeriden fotoğraf seç',{exact:true}).setInputFiles(resolve('services/file-agent/test/fixtures/field-photo',fileName))
        await page.getByRole('button',{name:'1 fotoğrafı yükle',exact:true}).click()
        await page.getByText(label,{exact:true}).waitFor({timeout:30000})
        check(`${name}: ${kind} photo is converted and named correctly`,(await readFile(join(fixture.root,fixture.cases[index].path,'HASAR',label))).length>=102400)
      }
      check(`${name}: legacy root photo remains untouched`,(await readFile(join(fixture.root,fixture.cases[index].path,'VİTES.jpg'),'utf8'))==='Legacy root photo must be preserved')
      for(const [width,height] of [[320,700],[375,812],[390,844],[412,915],[768,1024],[844,390],[1440,900]]){
        await page.setViewportSize({width,height})
        check(`${name}: photo workflow fits ${width}x${height}`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
      }
      await page.setViewportSize({width:390,height:844});if(captureScreenshots)await page.screenshot({path:join(evidence,`${name}-uploads-mobile.png`),fullPage:true})
      await page.setViewportSize({width:1440,height:900});if(captureScreenshots)await page.screenshot({path:join(evidence,`${name}-uploads-desktop.png`),fullPage:true})
      check(`${name}: private management endpoints stay unavailable`,(await context.request.get(fixture.origin+'/api/v1/users')).status()===404)
      await page.getByRole('button',{name:'Oturumu kapat',exact:true}).click();await page.getByRole('heading',{name:'Hoş geldiniz'}).waitFor()
      check(`${name}: logout removes session cookie`,!(await context.cookies()).some(cookie=>cookie.name==='hb_session'))
      await page.getByRole('checkbox',{name:'Bu cihazda oturumumu hatırla'}).check()
      await page.getByLabel('E-posta',{exact:true}).fill(fixture.email);await page.getByLabel('Parola',{exact:true}).fill(fixture.password)
      await page.getByRole('button',{name:'Giriş yap',exact:true}).click();await page.getByRole('textbox',{name:'Plaka ara'}).waitFor()
      check(`${name}: persistence requires explicit consent`,(await context.cookies()).find(cookie=>cookie.name==='hb_session')?.expires>Date.now()/1000)
      check(`${name}: no browser runtime errors`,errors.length===0)
      console.log(`${name}: PASS`)
    } finally {await context.close();await browser.close()}
  }
  check('worker reports no unexpected failures',fixture.errors.length===0)
  const records=(await fixture.pool.query("SELECT case_id,status,output_file_name,output_bytes,output_hash FROM field_photo_uploads")).rows
  check('all twelve genuine browser uploads reach ready status',records.length===12&&records.every(row=>row.status==='ready'&&row.output_bytes>=102400&&row.output_bytes<=614400))
  check('JPEG hashes are recorded',records.every(row=>/^[a-f0-9]{64}$/u.test(row.output_hash)))
  for(const row of records){
    const target=fixture.cases.find(item=>item.id===row.case_id)
    const bytes=await readFile(join(fixture.root,target.path,'HASAR',row.output_file_name))
    check(`${row.output_file_name}: physical bytes match the recorded hash`,bytes.length===Number(row.output_bytes)&&createHash('sha256').update(bytes).digest('hex')===row.output_hash)
  }
  await writeFile(join(evidence,'acceptance.json'),JSON.stringify({status:'PASS',checkedAt:new Date().toISOString(),checks},null,2))
  console.log(`Field browsers: ${checks.length} checks PASS`)
}catch(error){await writeFile(join(evidence,'failure.json'),JSON.stringify({status:'FAIL',message:error.message,checks},null,2));throw error}
finally{await fixture.close()}
