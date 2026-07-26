import{useCallback,useEffect,useState}from'react'
import{useSession}from'../app/sessionContext'
import{createHttpPolicyAnalysisAdapter,HttpPolicyAnalysisError}from'./policyAnalysisHttpAdapter'
import type{DataSourceKind,PolicyAnalysisRecord,PolicyScenarioEvaluationRecord,PolicyScenarioType}from'./ports'
export type PolicyAnalysisLoadStatus='idle'|'loading'|'ok'|'empty'|'unauthorized'|'not_found'|'forbidden'|'conflict'|'unavailable'
export function usePolicyAnalysis(caseId:string,source:DataSourceKind,enabled:boolean,refreshToken=0){const{reportUnauthorized}=useSession();const[evaluating,setEvaluating]=useState(false);const[requestVersion,setRequestVersion]=useState(0);const retry=useCallback(()=>setRequestVersion(value=>value+1),[]);const active=source==='api'&&enabled
  // Yukleme durumu efektte senkron sifirlanmaz; istek anahtari degisince RENDER
  // sirasinda turetilir. Onceki analizin verisi ve senaryo degerlendirmesi hicbir
  // frame'de gorunmez; anahtari tutmayan gec yanit yok sayilir.
  const requestKey=`${caseId}#${requestVersion}#${refreshToken}`
  const[loaded,setLoaded]=useState<{key:string;data:PolicyAnalysisRecord|null;status:PolicyAnalysisLoadStatus}>(()=>({key:requestKey,data:null,status:'loading'}))
  const[evaluated,setEvaluated]=useState<{key:string;value:PolicyScenarioEvaluationRecord|null}>(()=>({key:requestKey,value:null}))
  const current=loaded.key===requestKey?loaded:{key:requestKey,data:null,status:'loading' as const}
  const evaluation=evaluated.key===requestKey?evaluated.value:null
  const data=active?current.data:null
  const status:PolicyAnalysisLoadStatus=active?current.status:'idle'
  useEffect(()=>{if(!active)return undefined;let cancelled=false;createHttpPolicyAnalysisAdapter().getCurrentAnalysis(caseId).then(value=>{if(cancelled)return;setLoaded({key:requestKey,data:value,status:value===null?'empty':'ok'})}).catch((error:unknown)=>{if(cancelled)return;const kind=error instanceof HttpPolicyAnalysisError?error.kind:'unavailable';setLoaded({key:requestKey,data:null,status:kind});if(kind==='unauthorized')reportUnauthorized()});return()=>{cancelled=true}},[active,caseId,reportUnauthorized,requestKey])
  const evaluate=useCallback(async(scenarioType:PolicyScenarioType)=>{if(data===null)return;setEvaluating(true);setEvaluated({key:requestKey,value:null});try{const result=await createHttpPolicyAnalysisAdapter().evaluateScenario(caseId,{analysisId:data.id,policyAnalysisVersion:data.currentAnalysisVersion,scenarioType,damageCategory:scenarioType==='coverage'?'collision':null,repairMethod:'repair',requestedOperation:scenarioType,documentState:'verified'});setEvaluated({key:requestKey,value:result})}catch(error){const kind=error instanceof HttpPolicyAnalysisError?error.kind:'unavailable';setLoaded(prev=>prev.key===requestKey?{...prev,status:kind}:prev);if(kind==='unauthorized')reportUnauthorized()}finally{setEvaluating(false)}},[caseId,data,reportUnauthorized,requestKey])
  return{data,status,evaluation,evaluating,evaluate,retry}
}
