import pg from 'pg'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createCanvas } from '@napi-rs/canvas'
import { assertTestDatabaseUrl, runMigrations, uuidv7 } from '@hasarbotu/database'
import { buildApp, hashPassword } from '../dist/index.js'
import { hashAgentSecret } from '../dist/agent/auth.js'
import { runFieldPhotoOnce } from '../../file-agent/dist/field-photo-worker.js'
import { createFieldPortal } from '../../../scripts/field-portal-server.mjs'

export async function startFieldBrowserFixture(databaseUrl) {
  const config = assertTestDatabaseUrl(databaseUrl), pool = new pg.Pool({ connectionString: config.url })
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await runMigrations({ databaseUrl: config.url, quiet: true })
  const work = await mkdtemp(join(tmpdir(),'hb-field-browser-')), root = join(work,'office'), originals = join(work,'originals'), gate = join(work,'gate.mjs')
  await mkdir(root); await writeFile(gate,"console.log(JSON.stringify({CaseStatus:'ready'}))\n")
  const org = uuidv7(), userId = uuidv7(), agentId = uuidv7(), email = 'field-browser@example.test', password = 'Synthetic-Browser-Field-42!', agentSecret = 'Synthetic-Browser-Agent-Only'
  await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,'field-browser','Synthetic browser office')",[org])
  await pool.query('INSERT INTO users(id,organization_id,email,display_name,password_hash) VALUES($1,$2,$3,$4,$5)',[userId,org,email,'Saha Eksperi',await hashPassword(password)])
  await pool.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code='expert'",[userId])
  await pool.query("INSERT INTO agents(id,organization_id,name,secret_hash) VALUES($1,$2,'Browser fixture agent',$3)",[agentId,org,hashAgentSecret(agentSecret)])
  await pool.query("INSERT INTO storage_roots(id,organization_id,root_key,label) VALUES($1,$2,'office','Synthetic')",[uuidv7(),org])
  const cases = []
  for (const [index,plate] of ['34ABC123','06DEF456','35GHI789'].entries()) {
    const id=uuidv7(),path=`2026 OFİS/Ekim 2026/${plate}`
    await mkdir(join(root,path,'HASAR'),{recursive:true});await writeFile(join(root,path,'HASAR','HASAR 101.jpg'),'Existing office photo must be preserved')
    await writeFile(join(root,path,'VİTES.jpg'),'Legacy root photo must be preserved')
    await pool.query("INSERT INTO cases(id,organization_id,office_year,office_sequence,office_number,plate,plate_normalized,workflow_stage) VALUES($1,$2,2026,$3,$4,$5,$5,'reporting')",[id,org,index+1,`2026/${index+1}`,plate])
    await pool.query("INSERT INTO case_locations(id,organization_id,case_id,storage_root_key,relative_path,verification_status) VALUES($1,$2,$3,'office',$4,'verified')",[uuidv7(),org,id,path])
    cases.push({id,plate,path,officeNumber:`2026/${index+1}`})
  }
  const app=buildApp({loggerEnabled:false,fieldPhotoDirectory:originals,auth:{pool,cookieSecure:false,loginRateLimit:{limit:100,windowMs:60000}}})
  const upstream=await app.listen({host:'127.0.0.1',port:0})
  const gateway=createFieldPortal({directory:resolve('dist'),upstream,publicOrigin:'http://127.0.0.1:0'})
  await new Promise(done=>gateway.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${gateway.address().port}`
  let stopping=false
  const errors=[]
  const agentConfig={apiBaseUrl:upstream,agentId,agentSecret,roots:{office:root},leaseSeconds:120,pollIntervalMs:200,freshnessGate:{toolPath:gate,pcloudLocalDatabasePath:join(work,'fixture.db'),topLevelFolderName:'Synthetic',attestationStoreDirectory:work}}
  const loop=async()=>{while(!stopping){try{await runFieldPhotoOnce(agentConfig)}catch{errors.push('worker_failed')}if(!stopping)await new Promise(done=>setTimeout(done,200))}}
  const worker=loop()
  const canvas=createCanvas(640,480),ctx=canvas.getContext('2d');ctx.fillStyle='#5782d4';ctx.fillRect(0,0,640,480);ctx.fillStyle='white';ctx.font='28px sans-serif';ctx.fillText('SYNTHETIC KM 123456',100,200)
  const jpeg=await canvas.encode('jpeg',95)
  return {origin,email,password,cases,pool,root,originals,jpeg,errors,async close(){stopping=true;await worker;await new Promise(done=>gateway.close(done));await app.close();await pool.end();await rm(work,{recursive:true,force:true})}}
}
