const fs=require('node:fs')
const path=require('node:path')
const {pathToFileURL}=require('node:url')
const {createRequire}=require('node:module')
const root='C:/ProgramData/HasarBotu/runtime-20261011'
const reportDirectory='C:/ProgramData/HasarBotu/office-management/source-refresh'
const stamp=new Date().toISOString().replaceAll(':','').replaceAll('.','')
const pendingOnly=process.env.HB_SOURCE_REFRESH_PENDING_ONLY==='1'
const latestPath=reportDirectory+(pendingOnly?'/pending-latest.json':'/latest.json')
;(async()=>{
 if(process.env.COMPUTERNAME!=='DESKTOP-EFN2G33')throw new Error('SOURCE_REFRESH_TARGET_MISMATCH')
 const config=JSON.parse(fs.readFileSync(reportDirectory+'/configuration.json','utf8'))
 const roots=JSON.parse(process.env.HASARBOTU_AGENT_ROOTS)
 const targetRoot=roots['baran-global-primary']
 if(!targetRoot||!/^P:[\\/]/i.test(config.sourceRoot))throw new Error('SOURCE_REFRESH_ROOT_CONFIGURATION_INVALID')
 if(!fs.statSync(config.sourceRoot).isDirectory())throw new Error('PCLOUD_SOURCE_NOT_AVAILABLE')
 function underRoot(base,relative){
  if(path.win32.isAbsolute(relative))throw new Error('ABSOLUTE_CASE_PATH_REJECTED')
  const resolved=path.resolve(base,relative)
  if(!resolved.toUpperCase().startsWith(path.resolve(base).toUpperCase()+path.sep))throw new Error('CASE_PATH_OUTSIDE_ROOT')
  return resolved
 }
 const pg=createRequire(root+'/services/api/package.json')('pg')
 const url=new URL(process.env.DATABASE_URL)
 if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/hasarbotu')throw new Error('SOURCE_REFRESH_DATABASE_MISMATCH')
 const db=new pg.Client({connectionString:url.href});await db.connect()
 let rows
 try{rows=(await db.query(`SELECT c.id case_id,l.relative_path FROM case_locations l JOIN cases c ON c.id=l.case_id
  WHERE c.organization_id='019fe084-1ec1-7797-835a-777eb0cc59c2' AND NOT c.is_archived
   AND l.verification_status='verified' AND l.storage_root_key='baran-global-primary'
   AND ($1::boolean=false OR EXISTS (
    SELECT 1 FROM case_file_operations operation JOIN jobs job ON job.id=operation.active_job_id
    WHERE operation.organization_id=c.organization_id AND operation.case_id=c.id
     AND operation.approved_by_user_id IS NOT NULL
     AND job.status='pending' AND job.last_error_code='case_not_fresh'
   )) ORDER BY c.id`,[pendingOnly])).rows}finally{await db.end()}
 const cases=rows.map(r=>({caseId:r.case_id,caseRelativePath:r.relative_path,targetCaseRoot:underRoot(targetRoot,r.relative_path),sourceCaseRoot:underRoot(config.sourceRoot,r.relative_path)}))
 const {findCasesNeedingAttestation,buildAttestationRecordsBatch,writeAttestationRecord}=await import(pathToFileURL(root+'/tools/pcloud-source-attestation.mjs'))
 const started=Date.now()
 fs.writeFileSync(latestPath,JSON.stringify({checkedAt:new Date().toISOString(),status:'RUNNING',stage:'SELECTING_CURRENT_REVISIONS',casesChecked:cases.length}))
 const directSourceRoot=path.resolve(targetRoot).toUpperCase()===path.resolve(config.sourceRoot).toUpperCase()?config.sourceRoot:undefined
 const selected=cases.length===0?{casesToRefresh:[],heldCases:[],checkedFiles:0}:await findCasesNeedingAttestation({cases,databasePath:process.env.HASARBOTU_AGENT_PCLOUD_DB_PATH,topLevelFolderName:process.env.HASARBOTU_AGENT_PCLOUD_TOP_LEVEL_FOLDER,attestationStoreDirectory:process.env.HASARBOTU_AGENT_ATTESTATION_STORE,directSourceRoot})
 const held=[...selected.heldCases]
 let refreshedCases=0,sourceFilesAttested=0
 const preview=process.env.HB_SOURCE_REFRESH_PLAN_ONLY==='1'
 function progress(){fs.writeFileSync(latestPath,JSON.stringify({checkedAt:new Date().toISOString(),status:'RUNNING',stage:'READING_SOURCE_BYTES',casesChecked:cases.length,casesRequiringNewSourceProof:selected.casesToRefresh.length,refreshedCases,sourceFilesAttested,heldCases:held.length,durationMs:Date.now()-started}))}
 if(!preview)progress()
 async function refresh(group){
  const records=await buildAttestationRecordsBatch({cases:group,databasePath:process.env.HASARBOTU_AGENT_PCLOUD_DB_PATH,topLevelFolderName:process.env.HASARBOTU_AGENT_PCLOUD_TOP_LEVEL_FOLDER,attestedBy:'office-independent-source-refresh'})
  for(const record of records)await writeAttestationRecord(process.env.HASARBOTU_AGENT_ATTESTATION_STORE,record)
  refreshedCases+=group.length;sourceFilesAttested+=records.length
 }
 if(!preview)for(let i=0;i<selected.casesToRefresh.length;i+=20){
  const group=selected.casesToRefresh.slice(i,i+20)
  try{await refresh(group)}catch(e){
   if(!e.safeCode&&!['ENOENT','EACCES','EPERM','EIO'].includes(e.code))throw e
   for(const item of group){try{await refresh([item])}catch(error){if(!error.safeCode&&!['ENOENT','EACCES','EPERM','EIO'].includes(error.code))throw error;held.push({caseId:item.caseId,caseRelativePath:item.caseRelativePath,code:error.safeCode||error.code,fileSystemCode:error.fileSystemCode,sourceRelativePath:error.sourceRelativePath})}}
  }
  progress()
 }
 const proof={checkedAt:new Date().toISOString(),status:preview?'PREVIEW':held.length?'PARTIAL':'PASS',pendingOnly,directSource:directSourceRoot!==undefined,casesChecked:cases.length,filesChecked:selected.checkedFiles,casesRequiringNewSourceProof:selected.casesToRefresh.length,refreshedCases,sourceFilesAttested,heldCases:held.length,held,durationMs:Date.now()-started,sourceReadOnly:true,targetReadOnly:true,gateBypassed:false}
 if(!pendingOnly||cases.length>0)fs.writeFileSync(reportDirectory+'/'+stamp+'.json',JSON.stringify(proof,null,2),{flag:'wx'})
 fs.writeFileSync(latestPath,JSON.stringify(proof,null,2))
 if(!pendingOnly)fs.writeFileSync('C:/Users/user/Desktop/HasarBotu - Kaynak Kontrol Durumu.txt','\uFEFF'+`Kaynak doğrulaması: ${proof.status}\r\nTarih: ${proof.checkedAt}\r\nKontrol edilen klasör: ${proof.casesChecked}\r\nYeni kaynak kanıtı gereken: ${proof.casesRequiringNewSourceProof}\r\nYenilenen: ${refreshedCases}\r\nBekleyen: ${held.length}\r\nEvraklara yazılmadı; dosya işlemlerinin güvenlik kontrolü devam ediyor.\r\n`)
})().catch(e=>{
 const failure={checkedAt:new Date().toISOString(),status:'FAIL',stage:'SOURCE_REFRESH',pendingOnly,code:e.safeCode||e.code||e.message}
 fs.writeFileSync(reportDirectory+'/failure-'+stamp+'.json',JSON.stringify(failure))
 fs.writeFileSync(latestPath,JSON.stringify(failure))
 process.exitCode=1
})
