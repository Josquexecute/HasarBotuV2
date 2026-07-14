import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import { AUTH_LOGIN_ROUTE, IDEMPOTENCY_KEY_HEADER, policyAnalysisResponseSchema, policyScenarioEvaluationResponseSchema } from '@hasarbotu/contracts'
import { assertTestDatabaseUrl, closeDatabasePool, createDatabasePool, runMigrations, uuidv7, type DatabaseConfig } from '@hasarbotu/database'
import { buildApp, hashPassword } from '../src/index.js'

const TEST_URL=process.env.TEST_DATABASE_URL
const describeDb=TEST_URL===undefined||TEST_URL.length===0?describe.skip:describe
const PASSWORD='p23-sentetik-guclu-parola-42'

describeDb('Kasko police analiz API (gercek PostgreSQL)',()=>{
  let config:DatabaseConfig;let pool:pg.Pool;let app:FastifyInstance
  let organizationId:string;let otherOrganizationId:string;let cascoCaseId:string;let trafficCaseId:string
  let policyDocumentId:string;let policyVersionId:string;let pendingDocumentId:string;let pendingVersionId:string
  let tcpDocumentId:string;let tcpVersionId:string
  let insurerId:string;let serviceId:string
  let adminCookie:string;let managerCookie:string;let secretaryCookie:string;let analysisId:string

  async function user(orgId:string,email:string,role:'admin'|'case_manager'|'secretary'){
    const id=uuidv7();await pool.query('INSERT INTO users (id,organization_id,email,display_name,password_hash) VALUES ($1,$2,$3,$4,$5)',[id,orgId,email,email,await hashPassword(PASSWORD)])
    await pool.query('INSERT INTO user_roles (user_id,role_id) VALUES ($1,(SELECT id FROM roles WHERE code=$2))',[id,role]);return id
  }
  async function login(email:string){const response=await app.inject({method:'POST',url:AUTH_LOGIN_ROUTE,payload:{email,password:PASSWORD}});expect(response.statusCode).toBe(200);return String(response.headers['set-cookie']).split(';')[0] as string}
  async function seedDocument(caseId:string,status:'ready'|'pending',orgId=organizationId){
    const documentId=uuidv7(),versionId=uuidv7(),ready=status==='ready'
    await pool.query("INSERT INTO documents (id,organization_id,case_id,document_type,status) VALUES ($1,$2,$3,'casco_policy',$4)",[documentId,orgId,caseId,status])
    await pool.query(`INSERT INTO document_versions
      (id,organization_id,document_id,case_id,version_number,original_file_name,display_name,mime_type,byte_size,content_hash,storage_root_key,relative_path,source_type,status,hash_verified,size_verified,verified_at)
      VALUES ($1,$2,$3,$4,1,'sentetik-police.pdf','Sentetik Poliçe','application/pdf',100,$5,'test-root',$6,'manual',$7,$8,$8,$9)`,
      [versionId,orgId,documentId,caseId,'a'.repeat(64),`sentetik/${versionId}.pdf`,status,ready,ready?new Date('2026-07-14T10:00:00.000Z'):null])
    await pool.query('UPDATE documents SET current_version_id=$1,current_version_number=1 WHERE id=$2',[versionId,documentId]);return{documentId,versionId}
  }
  function payload(overrides:Record<string,unknown>={},source={documentId:policyDocumentId,versionId:policyVersionId}){return{
    sourceDocumentId:source.documentId,sourceDocumentVersionId:source.versionId,insurerId,
    policyNumber:'SENTETIK-23',endorsementNumber:null,productName:'Sentetik Kasko',productType:'genisletilmis',insurerFormat:'sentetik-v1',
    policyStartDate:'2026-01-01',policyEndDate:'2026-12-31',issueDate:'2026-01-01',insuredVehicleReference:'sentetik-arac',sourceCompleteness:'complete',initialStatus:'awaiting_approval',
    sourceReferences:[
      {sourceKey:'S1',documentId:source.documentId,documentVersionId:source.versionId,pageNumber:2,sectionHeading:'Teminatlar',clauseIdentifier:'T-1',rawExcerpt:'Çarpışma hasarı sentetik koşullarla teminata dahildir.',locator:'p2:c10-62',sourceType:'policy',confidence:1},
      {sourceKey:'S2',documentId:source.documentId,documentVersionId:source.versionId,pageNumber:4,sectionHeading:'Özel Şartlar',clauseIdentifier:'M-2',rawExcerpt:'Anlaşmasız serviste yüzde yirmi muafiyet uygulanır.',locator:'p4:c20-72',sourceType:'special_conditions',confidence:.98},
    ],
    coverages:[{code:'COLLISION',canonicalType:'collision',originalHeading:'Çarpışma',originalWording:'Sentetik çarpışma teminat metni.',inclusion:'included',limit:null,conditions:[],exceptions:[],requiredDocuments:['EXPERT_REPORT'],sourceKeys:['S1'],confidence:1}],
    deductibles:[
      {code:'UNCONTRACTED_20',type:'uncontracted_service',trigger:'Anlaşmasız servis',conditions:[],calculationType:'percentage',fixedAmount:null,percentage:20,minimumAmount:null,maximumAmount:null,insurerShare:80,insuredShare:20,affectedCoverage:'collision',affectedRepairMethod:null,affectedServiceType:'private',affectedPartRule:null,exception:null,sourceKeys:['S2'],confidence:.98,approvalStatus:'approved'},
      {code:'PART_DIFF',type:'part_difference',trigger:'Orijinal parça farkı',conditions:[],calculationType:'conditional',fixedAmount:null,percentage:null,minimumAmount:null,maximumAmount:null,insurerShare:null,insuredShare:null,affectedCoverage:'collision',affectedRepairMethod:null,affectedServiceType:null,affectedPartRule:'original',exception:null,sourceKeys:['S2'],confidence:.9,approvalStatus:'approved'},
    ],
    serviceRules:[{code:'SERVICE',authorizedServiceRequirement:false,insurerContractedServiceRequirement:true,serviceFreedom:'conditional',glassNetwork:'Cam ağı ayrıdır.',mobileRepairRestriction:'Onay gerekir.',miniRepairRestriction:'Limit dahilinde.',towingDestination:'Uygun servis.',laborRestriction:null,condition:'Sigortacı anlaşması aranır.',sourceKeys:['S2'],confidence:.98}],
    partRules:[{code:'PARTS',allowedPartTypes:['original','equivalent'],procurementRule:'Poliçe şartına göre.',repairVsReplacementCondition:'Onarılabilir parça onarılır.',bettermentCondition:'Değer artışı ayrıca değerlendirilir.',condition:null,sourceKeys:['S2'],confidence:.9}],
    replacementVehicleRules:[{code:'REPLACEMENT',available:'conditional',vehicleClass:'C',duration:'Onarım süresi',maximumDays:7,eventLimit:2,waitingPeriodDays:1,serviceCondition:'Anlaşmalı servis',exclusions:[],sourceKeys:['S2'],confidence:.9}],
    exclusions:[{code:'RACING',originalWording:'Yarış kullanımı kapsam dışıdır.',trigger:'Yarış kullanımı',affectedCoverage:'collision',exceptionToExclusion:null,requiredDocuments:[],sourceKeys:['S1'],confidence:1}],
    requiredDocuments:[{code:'EXPERT_REPORT',description:'Ekspertiz raporu',trigger:'Çarpışma',sourceKeys:['S1']}],
    scenarioRules:[
      {ruleId:'COVERAGE_COLLISION',ruleVersion:'2026.07.14.1',scenarioType:'coverage',trigger:'Çarpışma',conditions:[{field:'damageCategory',operator:'equals',value:'collision'}],coverageOutcome:'covered',coverageCode:'COLLISION',deductibleCodes:[],limit:null,exception:null,requiredDocuments:['EXPERT_REPORT'],serviceCondition:null,partCondition:null,action:'Çarpışma teminatını uygula.',sourceKeys:['S1'],confidence:1,humanApprovalRequired:false,precedence:100,effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31'},
      {ruleId:'UNCONTRACTED',ruleVersion:'2026.07.14.1',scenarioType:'uncontracted_service',trigger:'Anlaşmasız servis',conditions:[{field:'insurerAgreementStatus',operator:'equals',value:'control_required'}],coverageOutcome:'conditional',coverageCode:'COLLISION',deductibleCodes:['UNCONTRACTED_20','PART_DIFF'],limit:null,exception:null,requiredDocuments:[],serviceCondition:'Anlaşmalı servis seçilmelidir.',partCondition:'Parça şartı kontrol edilir.',action:'Tedarik ve mobil onarımı kontrol için duraklat.',sourceKeys:['S2'],confidence:.9,humanApprovalRequired:true,precedence:100,effectiveFrom:'2026-01-01',effectiveTo:'2026-12-31'},
    ],
    conflicts:[{conflictType:'wording',affectedTopic:'collision',sourceAKey:'S1',sourceBKey:'S2',explanation:'Sentetik kaynaklar uzman çözümü gerektiriyor.',severity:'high'}],...overrides}}

  beforeAll(async()=>{
    config=assertTestDatabaseUrl(TEST_URL as string);pool=createDatabasePool({config});await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');await runMigrations({databaseUrl:config.url,quiet:true})
    organizationId=uuidv7();otherOrganizationId=uuidv7();await pool.query('INSERT INTO organizations (id,code,name) VALUES ($1,$2,$3),($4,$5,$6)',[organizationId,'p23-main','P23 Main',otherOrganizationId,'p23-other','P23 Other'])
    await user(organizationId,'p23-admin@test.local','admin');await user(organizationId,'p23-manager@test.local','case_manager');await user(organizationId,'p23-secretary@test.local','secretary');await user(otherOrganizationId,'p23-other@test.local','admin')
    insurerId=uuidv7();serviceId=uuidv7();await pool.query("INSERT INTO insurers (id,organization_id,name) VALUES ($1,$2,'Sentetik Sigorta')",[insurerId,organizationId]);await pool.query("INSERT INTO service_centers (id,organization_id,name,center_type,service_type) VALUES ($1,$2,'Sentetik Özel Servis','ozel','private')",[serviceId,organizationId])
    cascoCaseId=uuidv7();trafficCaseId=uuidv7();await pool.query(`INSERT INTO cases
      (id,organization_id,office_year,office_sequence,office_number,case_type,workflow_stage,plate,plate_normalized,loss_date,notification_date,insurer_id,service_center_id)
      VALUES ($1,$3,2026,2301,'2026/2301','casco','new_notification','34 P 2301','34P2301','2026-07-10','2026-07-11',$4,$5),($2,$3,2026,2302,'2026/2302','traffic','new_notification','34 P 2302','34P2302','2026-07-10','2026-07-11',$4,$5)`,[cascoCaseId,trafficCaseId,organizationId,insurerId,serviceId])
    ;({documentId:policyDocumentId,versionId:policyVersionId}=await seedDocument(cascoCaseId,'ready'));({documentId:pendingDocumentId,versionId:pendingVersionId}=await seedDocument(cascoCaseId,'pending'));({documentId:tcpDocumentId,versionId:tcpVersionId}=await seedDocument(cascoCaseId,'ready'))
    app=buildApp({loggerEnabled:false,auth:{pool,cookieSecure:false,loginRateLimit:{limit:100,windowMs:60_000}}});adminCookie=await login('p23-admin@test.local');managerCookie=await login('p23-manager@test.local');secretaryCookie=await login('p23-secretary@test.local')
  },60_000)
  afterAll(async()=>{if(app!==undefined)await app.close();if(pool!==undefined)await closeDatabasePool(pool)})

  it('401, rol, Traffic ve ready/verified kaynak kapilarini uygular',async()=>{
    const noSession=await app.inject({method:'GET',url:`/api/v1/cases/${cascoCaseId}/policy-analyses`});expect(noSession.statusCode).toBe(401)
    const forbidden=await app.inject({method:'POST',url:`/api/v1/cases/${cascoCaseId}/policy-analyses`,headers:{cookie:secretaryCookie,[IDEMPOTENCY_KEY_HEADER]:uuidv7()},payload:payload()});expect(forbidden.statusCode).toBe(403)
    const traffic=await app.inject({method:'POST',url:`/api/v1/cases/${trafficCaseId}/policy-analyses`,headers:{cookie:adminCookie,[IDEMPOTENCY_KEY_HEADER]:uuidv7()},payload:payload()});expect(traffic.statusCode).toBe(400)
    const invalid=await app.inject({method:'POST',url:`/api/v1/cases/${cascoCaseId}/policy-analyses`,headers:{cookie:adminCookie,[IDEMPOTENCY_KEY_HEADER]:uuidv7()},payload:payload({sourceDocumentId:pendingDocumentId,sourceDocumentVersionId:pendingVersionId})});expect(invalid.statusCode).toBe(400)
  })

  it('draft/conflict analizini atomik ve idempotent olusturur; excerpt audit e sizmaz',async()=>{
    const key=uuidv7();const first=await app.inject({method:'POST',url:`/api/v1/cases/${cascoCaseId}/policy-analyses`,headers:{cookie:managerCookie,[IDEMPOTENCY_KEY_HEADER]:key},payload:payload()});expect(first.statusCode,first.payload).toBe(201);expect(policyAnalysisResponseSchema.safeParse(first.json()).success).toBe(true)
    const body=first.json() as {analysis:{id:string;currentStatus:string;currentVersion:{sourceReferences:Array<{excerptHash:string}>;deductibles:unknown[]}}};analysisId=body.analysis.id;expect(body.analysis.currentStatus).toBe('conflict_detected');expect(body.analysis.currentVersion.deductibles).toHaveLength(2);expect(body.analysis.currentVersion.sourceReferences[0]?.excerptHash).toMatch(/^[a-f0-9]{64}$/)
    const replay=await app.inject({method:'POST',url:`/api/v1/cases/${cascoCaseId}/policy-analyses`,headers:{cookie:managerCookie,[IDEMPOTENCY_KEY_HEADER]:key},payload:payload()});expect(replay.statusCode).toBe(201);expect(replay.json()).toEqual(first.json())
    const count=await pool.query('SELECT count(*)::int AS n FROM policy_analyses WHERE id=$1',[analysisId]);expect(count.rows).toEqual([{n:1}])
    const audit=await pool.query("SELECT details::text AS details FROM audit_events WHERE resource_id=$1",[analysisId]);expect(audit.rows.map((row:{details:string})=>row.details).join(' ')).not.toContain('Sentetik koşullu muafiyet');expect(JSON.stringify(first.json())).not.toMatch(/[A-Z]:\\|\\\\|password|secret/i)
  })

  it('acik conflict kesin sonucu engeller; cozum, stale ve onay akisi calisir',async()=>{
    const before=await app.inject({method:'POST',url:`/api/v1/cases/${cascoCaseId}/policy-scenarios/evaluate`,headers:{cookie:managerCookie,[IDEMPOTENCY_KEY_HEADER]:uuidv7()},payload:{analysisId,policyAnalysisVersion:1,scenarioType:'coverage',damageCategory:'collision',repairMethod:null,requestedOperation:'repair',documentState:'verified'}});expect(before.statusCode).toBe(200);expect((before.json() as {evaluation:{result:string}}).evaluation.result).toBe('control_required')
    const list=await app.inject({method:'GET',url:`/api/v1/cases/${cascoCaseId}/policy-conflicts`,headers:{cookie:adminCookie}});const conflict=(list.json() as {items:Array<{id:string;version:number}>}).items[0]!
    const resolved=await app.inject({method:'POST',url:`/api/v1/cases/${cascoCaseId}/policy-conflicts/${conflict.id}/resolve`,headers:{cookie:adminCookie,[IDEMPOTENCY_KEY_HEADER]:uuidv7()},payload:{expectedVersion:conflict.version,resolutionStatus:'resolved_manual',resolutionReason:'Sentetik uzman değerlendirmesi.'}});expect(resolved.statusCode).toBe(200);const resolvedBody=resolved.json() as {analysis:{version:number;currentStatus:string}};expect(resolvedBody.analysis.currentStatus).toBe('awaiting_approval')
    const stale=await app.inject({method:'POST',url:`/api/v1/cases/${cascoCaseId}/policy-analyses/${analysisId}/approve`,headers:{cookie:adminCookie,[IDEMPOTENCY_KEY_HEADER]:uuidv7()},payload:{expectedVersion:1,reason:'stale'}});expect(stale.statusCode).toBe(409)
    const approved=await app.inject({method:'POST',url:`/api/v1/cases/${cascoCaseId}/policy-analyses/${analysisId}/approve`,headers:{cookie:adminCookie,[IDEMPOTENCY_KEY_HEADER]:uuidv7()},payload:{expectedVersion:resolvedBody.analysis.version,reason:'Sentetik kanıtlar doğrulandı.'}});expect(approved.statusCode).toBe(200);expect((approved.json() as {analysis:{currentStatus:string;currentVersion:{isActive:boolean}}}).analysis).toMatchObject({currentStatus:'approved',currentVersion:{isActive:true}})
  })

  it('onayli analiz kaynakli covered ve coklu muafiyetli fail-closed senaryolari uretir',async()=>{
    const covered=await app.inject({method:'POST',url:`/api/v1/cases/${cascoCaseId}/policy-scenarios/evaluate`,headers:{cookie:managerCookie,[IDEMPOTENCY_KEY_HEADER]:uuidv7()},payload:{analysisId,policyAnalysisVersion:1,scenarioType:'coverage',damageCategory:'collision',repairMethod:'repair',requestedOperation:'repair',documentState:'missing'}});expect(covered.statusCode).toBe(200);const coveredBody=policyScenarioEvaluationResponseSchema.parse(covered.json());expect(coveredBody.evaluation.result).toBe('covered');expect(coveredBody.evaluation.sourceReferences[0]).toMatchObject({pageNumber:2,clauseIdentifier:'T-1'})
    const conditional=await app.inject({method:'POST',url:`/api/v1/cases/${cascoCaseId}/policy-scenarios/evaluate`,headers:{cookie:managerCookie,[IDEMPOTENCY_KEY_HEADER]:uuidv7()},payload:{analysisId,policyAnalysisVersion:1,scenarioType:'uncontracted_service',damageCategory:'collision',repairMethod:'repair',requestedOperation:'mobile_repair',documentState:'verified'}});expect(conditional.statusCode).toBe(200);const body=policyScenarioEvaluationResponseSchema.parse(conditional.json());expect(body.evaluation.result).toBe('conditional');expect(body.evaluation.deductibles.map((item)=>item.code)).toEqual(['PART_DIFF','UNCONTRACTED_20']);expect(body.evaluation.operationalRecommendation).toMatchObject({procurementStatus:'pause',mobileRepairStatus:'pause',approvalRequired:true})
  })

  it('yeni source version yeni analiz surumu uretir ve onayliyi immutable/superseded korur',async()=>{
    const detail=await app.inject({method:'GET',url:`/api/v1/cases/${cascoCaseId}/policy-analyses/${analysisId}`,headers:{cookie:adminCookie}});const current=policyAnalysisResponseSchema.parse(detail.json()).analysis
    const created=await app.inject({method:'POST',url:`/api/v1/cases/${cascoCaseId}/policy-analyses/${analysisId}/versions`,headers:{cookie:adminCookie,[IDEMPOTENCY_KEY_HEADER]:uuidv7()},payload:{...payload({conflicts:[],initialStatus:'awaiting_approval'}),expectedVersion:current.version}});expect(created.statusCode).toBe(201);expect((created.json() as {analysis:{currentAnalysisVersion:number;currentStatus:string}}).analysis).toMatchObject({currentAnalysisVersion:2,currentStatus:'awaiting_approval'})
    const createdAnalysis=policyAnalysisResponseSchema.parse(created.json()).analysis
    const approved=await app.inject({method:'POST',url:`/api/v1/cases/${cascoCaseId}/policy-analyses/${analysisId}/approve`,headers:{cookie:adminCookie,[IDEMPOTENCY_KEY_HEADER]:uuidv7()},payload:{expectedVersion:createdAnalysis.version,reason:'Yeni sentetik kaynak sürümü doğrulandı.'}});expect(approved.statusCode).toBe(200)
    const versions=await app.inject({method:'GET',url:`/api/v1/cases/${cascoCaseId}/policy-analyses/${analysisId}/versions`,headers:{cookie:adminCookie}});const items=(versions.json() as {versions:Array<{analysisVersion:number;analysisStatus:string}>}).versions;expect(items).toEqual(expect.arrayContaining([expect.objectContaining({analysisVersion:2,analysisStatus:'approved'}),expect.objectContaining({analysisVersion:1,analysisStatus:'superseded'})]))
    await expect(pool.query("UPDATE policy_analysis_versions SET product_name='yasak' WHERE analysis_id=$1 AND analysis_version=1",[analysisId])).rejects.toMatchObject({code:'23001'})
  })

  it('tenant disi analiz 404 ve audit/snapshot guvenli kalir',async()=>{
    const foreign=await app.inject({method:'GET',url:`/api/v1/cases/${cascoCaseId}/policy-analyses/${analysisId}`,headers:{cookie:await login('p23-other@test.local')}});expect(foreign.statusCode).toBe(404)
    const rows=await pool.query("SELECT result_snapshot::text AS snapshot FROM policy_scenario_evaluations WHERE analysis_id=$1",[analysisId]);const snapshots=rows.rows.map((row:{snapshot:string})=>row.snapshot).join(' ');expect(snapshots).not.toContain('Sentetik koşullu muafiyet');expect(snapshots).not.toMatch(/[A-Z]:\\|\\\\|password|secret/i)
  })

  it('canli TCP API login/import/replay/approve/scenario ve guvenlik kapilarini dogrular',async()=>{
    await app.listen({host:'127.0.0.1',port:0});const address=app.addresses()[0];expect(address).toBeDefined();const base=`http://127.0.0.1:${address!.port}`
    async function tcpLogin(email:string){const response=await fetch(`${base}${AUTH_LOGIN_ROUTE}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:PASSWORD})});expect(response.status).toBe(200);return response.headers.getSetCookie()[0]!.split(';')[0]!}
    async function post(path:string,cookie:string,body:unknown,key=uuidv7()){return fetch(`${base}${path}`,{method:'POST',headers:{cookie,'content-type':'application/json',[IDEMPOTENCY_KEY_HEADER]:key},body:JSON.stringify(body)})}
    const liveAdmin=await tcpLogin('p23-admin@test.local'),liveManager=await tcpLogin('p23-manager@test.local'),liveSecretary=await tcpLogin('p23-secretary@test.local'),liveOther=await tcpLogin('p23-other@test.local')
    const unauthenticated=await fetch(`${base}/api/v1/cases/${cascoCaseId}/policy-analyses`);expect(unauthenticated.status).toBe(401)
    const forbidden=await post(`/api/v1/cases/${cascoCaseId}/policy-analyses`,liveSecretary,payload({}, {documentId:tcpDocumentId,versionId:tcpVersionId}));expect(forbidden.status).toBe(403)
    const key=uuidv7(),body=payload({conflicts:[],initialStatus:'awaiting_approval'},{documentId:tcpDocumentId,versionId:tcpVersionId})
    const created=await post(`/api/v1/cases/${cascoCaseId}/policy-analyses`,liveManager,body,key);expect(created.status).toBe(201);const createdJson=policyAnalysisResponseSchema.parse(await created.json())
    const replay=await post(`/api/v1/cases/${cascoCaseId}/policy-analyses`,liveManager,body,key);expect(replay.status).toBe(201);expect(await replay.json()).toEqual(createdJson)
    const stale=await post(`/api/v1/cases/${cascoCaseId}/policy-analyses/${createdJson.analysis.id}/approve`,liveAdmin,{expectedVersion:createdJson.analysis.version+1,reason:'stale'});expect(stale.status).toBe(409)
    const approved=await post(`/api/v1/cases/${cascoCaseId}/policy-analyses/${createdJson.analysis.id}/approve`,liveAdmin,{expectedVersion:createdJson.analysis.version,reason:'Canlı sentetik kaynak doğrulaması.'});expect(approved.status).toBe(200)
    const scenario=await post(`/api/v1/cases/${cascoCaseId}/policy-scenarios/evaluate`,liveManager,{analysisId:createdJson.analysis.id,policyAnalysisVersion:1,scenarioType:'uncontracted_service',damageCategory:'collision',repairMethod:'repair',requestedOperation:'mobile_repair',documentState:'verified'});expect(scenario.status).toBe(200);const scenarioJson=policyScenarioEvaluationResponseSchema.parse(await scenario.json());expect(scenarioJson.evaluation).toMatchObject({result:'conditional',operationalRecommendation:{procurementStatus:'pause',mobileRepairStatus:'pause'}})
    const foreign=await fetch(`${base}/api/v1/cases/${cascoCaseId}/policy-analyses/${createdJson.analysis.id}`,{headers:{cookie:liveOther}});expect(foreign.status).toBe(404)
    const audit=await pool.query("SELECT details::text AS details FROM audit_events WHERE resource_id=$1",[createdJson.analysis.id]);const serialized=JSON.stringify({analysis:createdJson,scenario:scenarioJson,audit:audit.rows});expect(serialized).not.toMatch(/[A-Z]:\\|\\\\|password|secret|Sentetik koşullu muafiyet/i)
  })
})
