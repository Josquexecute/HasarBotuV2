import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'
import { createCanvas } from '@napi-rs/canvas'
import { createWorker, OEM } from 'tesseract.js'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  POLICY_OCR_ENGINE_VERSION,
  POLICY_OCR_LANGUAGE_DATA_VERSION,
  POLICY_OCR_NORMALIZATION_VERSION,
  POLICY_OCR_PREPROCESSING_VERSION,
  buildPolicyOcrOutputHash,
  buildPolicyOcrReadingOrder,
  derivePolicyOcrRunStatus,
  evaluatePolicyOcrQuality,
  sha256Text,
  type PolicyOcrBlockInput,
  type PolicyOcrBoundingBox,
} from '@hasarbotu/domain'
import type { PolicyOcrPageChunk } from '@hasarbotu/contracts'
import type { PolicyOcrWorkerInput, PolicyOcrWorkerMessage } from './policy-ocr-protocol.js'

const input=workerData as PolicyOcrWorkerInput
function send(message:PolicyOcrWorkerMessage):void{parentPort?.postMessage(message)}

function canonicalError(error:unknown):string{const name=(error as{name?:unknown}).name;if(name==='PasswordException')return'encrypted_pdf';if(name==='InvalidPDFException'||name==='FormatError')return'malformed_pdf';if(name==='MissingPDFException')return'source_missing';const message=error instanceof Error?error.message:'';return/^[a-z0-9_]{1,64}$/.test(message)?message:'ocr_worker_failed'}

function otsuThreshold(histogram:Uint32Array,total:number):number{let sum=0;for(let i=0;i<256;i+=1)sum+=i*histogram[i]!;let backgroundWeight=0,backgroundSum=0,best=0,maximum=-1;for(let threshold=0;threshold<256;threshold+=1){backgroundWeight+=histogram[threshold]!;if(backgroundWeight===0)continue;const foregroundWeight=total-backgroundWeight;if(foregroundWeight===0)break;backgroundSum+=threshold*histogram[threshold]!;const backgroundMean=backgroundSum/backgroundWeight,foregroundMean=(sum-backgroundSum)/foregroundWeight;const between=backgroundWeight*foregroundWeight*(backgroundMean-foregroundMean)**2;if(between>maximum){maximum=between;best=threshold}}return best}

function preprocess(context:ReturnType<ReturnType<typeof createCanvas>['getContext']>,width:number,height:number):number{const image=context.getImageData(0,0,width,height),histogram=new Uint32Array(256);let minimum=255,maximum=0;for(let index=0;index<image.data.length;index+=4){const value=Math.round(0.299*image.data[index]!+0.587*image.data[index+1]!+0.114*image.data[index+2]!);minimum=Math.min(minimum,value);maximum=Math.max(maximum,value);histogram[value]!+=1}
  const range=Math.max(1,maximum-minimum);const normalizedHistogram=new Uint32Array(256);for(let value=0;value<256;value+=1){const mapped=Math.round((value-minimum)*255/range);normalizedHistogram[Math.max(0,Math.min(255,mapped))]!+=histogram[value]!}const threshold=otsuThreshold(normalizedHistogram,width*height)
  for(let index=0;index<image.data.length;index+=4){const gray=Math.round(0.299*image.data[index]!+0.587*image.data[index+1]!+0.114*image.data[index+2]!);const normalized=Math.max(0,Math.min(255,Math.round((gray-minimum)*255/range)));const value=normalized<=threshold?0:255;image.data[index]=value;image.data[index+1]=value;image.data[index+2]=value;image.data[index+3]=255}context.putImageData(image,0,0);return threshold}

function box(value:{readonly x0:number;readonly y0:number;readonly x1:number;readonly y1:number}):PolicyOcrBoundingBox{return{x:Math.max(0,Math.round(value.x0)),y:Math.max(0,Math.round(value.y0)),width:Math.max(0,Math.round(value.x1-value.x0)),height:Math.max(0,Math.round(value.y1-value.y0))}}
function rotation(value:number|null):{rotationDegrees:0|90|180|270;deskewDegrees:number}{const degrees=(value??0)*180/Math.PI,quarter=Math.round(degrees/90)*90,residual=degrees-quarter;const normalized=((quarter%360)+360)%360;const rotationDegrees=(normalized===90||normalized===180||normalized===270?normalized:0) as 0|90|180|270;return{rotationDegrees,deskewDegrees:Math.round(Math.max(-15,Math.min(15,residual))*1000)/1000}}

async function run():Promise<void>{
  let ocrWorker:Awaited<ReturnType<typeof createWorker>>|undefined
  let task:ReturnType<typeof getDocument>|undefined
  try{
    if(!isAbsolute(input.filePath)||!isAbsolute(input.languageAssetDirectory)||/:\/\//u.test(input.filePath)||/:\/\//u.test(input.languageAssetDirectory))throw new Error('network_access_blocked')
    const data=new Uint8Array(await readFile(input.filePath))
    task=getDocument({data,useSystemFonts:false,verbosity:0})
    const pdf=await task.promise
    if(input.eligiblePages.some(item=>item.pageNumber<1||item.pageNumber>pdf.numPages))throw new Error('page_limit_exceeded')
    const languages=input.languageMode==='tur+eng'?['tur','eng']:[input.languageMode]
    ocrWorker=await createWorker(languages,OEM.LSTM_ONLY,{langPath:input.languageAssetDirectory,cacheMethod:'none',gzip:true,logger:()=>undefined})
    const summaries:Array<{pageNumber:number;status:PolicyOcrPageChunk['status'];normalizedTextHash:string;qualityStatus:PolicyOcrPageChunk['qualityStatus'];blockCount:number;lineCount:number;wordCount:number}>=[]
    let totalCharacters=0,readyPageCount=0,lowQualityPageCount=0,emptyPageCount=0,failedPageCount=0,blockCount=0,lineCount=0,wordCount=0,confidenceTotal=0
    for(const eligible of input.eligiblePages){
      const startedAt=Date.now()
      let chunk:PolicyOcrPageChunk
      try{
        send({kind:'phase',phase:'rendering'})
        const pdfPage=await pdf.getPage(eligible.pageNumber)
        const viewport=pdfPage.getViewport({scale:input.renderDpi/72})
        const width=Math.ceil(viewport.width),height=Math.ceil(viewport.height)
        if(width*height>input.maxImagePixels)throw new Error('image_pixel_limit_exceeded')
        const canvas=createCanvas(width,height),context=canvas.getContext('2d')
        context.fillStyle='#ffffff';context.fillRect(0,0,width,height)
        const renderInput={canvas:null,canvasContext:context,viewport,background:'#ffffff'} as unknown as Parameters<typeof pdfPage.render>[0]
        await pdfPage.render(renderInput).promise
        send({kind:'phase',phase:'preprocessing'})
        const threshold=preprocess(context,width,height)
        send({kind:'phase',phase:'recognizing'})
        const recognized=await ocrWorker.recognize(canvas.toBuffer('image/png'),{rotateAuto:true},{text:true,blocks:true})
        const blocks:PolicyOcrBlockInput[]=(recognized.data.blocks??[]).map(block=>({text:block.text,confidence:block.confidence,bbox:box(block.bbox),lines:block.paragraphs.flatMap(paragraph=>paragraph.lines).map(line=>({text:line.text,confidence:line.confidence,bbox:box(line.bbox),words:line.words.map(word=>({text:word.text,confidence:word.confidence,bbox:box(word.bbox)}))}))}))
        send({kind:'phase',phase:'normalizing'})
        const ordered=buildPolicyOcrReadingOrder(blocks)
        totalCharacters+=Array.from(ordered.normalizedText).length
        if(Array.from(ordered.normalizedText).length>input.maxPageCharacters||totalCharacters>input.maxTotalCharacters||ordered.elements.length>input.maxElementsPerPage)throw new Error('output_limit_exceeded')
        const words=ordered.elements.filter(item=>item.type==='word')
        const lowConfidenceWordCount=words.filter(item=>item.confidence<70).length
        const unreadableRegionCount=blocks.length===0?1:0
        const minimum=words.length===0?0:Math.min(...words.map(item=>item.confidence))
        const quality=evaluatePolicyOcrQuality({normalizedText:ordered.normalizedText,meanConfidence:recognized.data.confidence,wordCount:words.length,lowConfidenceWordCount,unreadableRegionCount,readingOrderQuality:ordered.quality})
        const status:PolicyOcrPageChunk['status']=ordered.normalizedText.length===0?'unreadable':quality.status==='high'?'accepted_candidate':quality.status==='medium'?'partial':quality.status==='low'?'low_confidence':'control_required'
        const applied=rotation(recognized.data.rotateRadians)
        chunk={textPageId:eligible.textPageId,pageNumber:eligible.pageNumber,status,languageMode:input.languageMode,imageWidth:width,imageHeight:height,renderDpi:input.renderDpi,rotationDegrees:applied.rotationDegrees,deskewDegrees:applied.deskewDegrees,threshold,rawOcrText:ordered.rawText,rawTextHash:sha256Text(ordered.rawText),normalizedText:ordered.normalizedText,normalizedTextHash:sha256Text(ordered.normalizedText),meanConfidence:Math.max(0,Math.min(100,Math.round(recognized.data.confidence*100)/100)),minimumConfidence:minimum,qualityStatus:quality.status,readingOrderQuality:ordered.quality,compositeStatus:eligible.sourcePageStatus==='image_only'?'ocr_only':'control_required',qualityReasonCode:quality.reasonCode,requiresHumanReview:quality.requiresHumanReview,lowConfidenceWordCount,unreadableRegionCount,processingDurationMs:Math.min(600_000,Date.now()-startedAt),elements:ordered.elements.map(item=>({elementIndex:item.elementIndex,type:item.type,parentIndex:item.parentIndex,readingOrder:item.readingOrder,startOffset:item.startOffset,endOffset:item.endOffset,textHash:item.textHash,confidence:item.confidence,bbox:item.bbox}))}
      }catch(error){
        const code=canonicalError(error)
        if(['image_pixel_limit_exceeded','output_limit_exceeded'].includes(code))throw error
        chunk={textPageId:eligible.textPageId,pageNumber:eligible.pageNumber,status:'failed',languageMode:input.languageMode,imageWidth:1,imageHeight:1,renderDpi:input.renderDpi,rotationDegrees:0,deskewDegrees:0,threshold:0,rawOcrText:'',rawTextHash:sha256Text(''),normalizedText:'',normalizedTextHash:sha256Text(''),meanConfidence:0,minimumConfidence:0,qualityStatus:'control_required',readingOrderQuality:'control_required',compositeStatus:'control_required',qualityReasonCode:'ocr_failed',requiresHumanReview:true,lowConfidenceWordCount:0,unreadableRegionCount:1,processingDurationMs:Math.min(600_000,Date.now()-startedAt),elements:[]}
      }
      const count=(type:string)=>chunk.elements.filter(item=>item.type===type).length
      if(chunk.status==='accepted_candidate')readyPageCount+=1
      else if(['partial','low_confidence','control_required'].includes(chunk.status))lowQualityPageCount+=1
      else if(chunk.status==='unreadable')emptyPageCount+=1
      else failedPageCount+=1
      blockCount+=count('block');lineCount+=count('line');wordCount+=count('word');confidenceTotal+=chunk.meanConfidence
      summaries.push({pageNumber:chunk.pageNumber,status:chunk.status,normalizedTextHash:chunk.normalizedTextHash,qualityStatus:chunk.qualityStatus,blockCount:count('block'),lineCount:count('line'),wordCount:count('word')})
      send({kind:'page',page:chunk})
    }
    send({kind:'phase',phase:'validating'})
    const processed=input.eligiblePages.length,status=derivePolicyOcrRunStatus({eligiblePageCount:processed,readyPageCount,lowQualityPageCount,emptyPageCount,failedPageCount}),meanConfidence=processed===0?null:Math.round(confidenceTotal/processed*1000)/1000
    send({kind:'complete',summary:{ocrRunId:input.ocrRunId,ocrRunVersion:input.ocrRunVersion,status,engineVersion:POLICY_OCR_ENGINE_VERSION,languageDataVersion:POLICY_OCR_LANGUAGE_DATA_VERSION,languageDataHash:input.languageDataHash,renderProfileVersion:input.renderProfileVersion,preprocessingVersion:POLICY_OCR_PREPROCESSING_VERSION,qualityVersion:input.qualityVersion,normalizationVersion:POLICY_OCR_NORMALIZATION_VERSION,locatorVersion:input.locatorVersion,sourceHash:input.sourceHash,sourceSize:input.sourceSize,eligiblePageCount:processed,processedPageCount:processed,readyPageCount,lowQualityPageCount,emptyPageCount,failedPageCount,blockCount,lineCount,wordCount,normalizedCharacterCount:totalCharacters,meanConfidence,outputHash:buildPolicyOcrOutputHash(summaries)}})
  }catch(error){send({kind:'error',errorCode:canonicalError(error)})}
  finally{await ocrWorker?.terminate().catch(()=>undefined);await task?.destroy().catch(()=>undefined)}
}

void run()
