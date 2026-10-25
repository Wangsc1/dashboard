import { TimingToken, timingToken, timing, timingSpan, plotLifecycle, createPlotTrace, PlotRole } from "./cadence-diagnostics"
import { AppEvents, VStack, ZStack, Canvas, Text, WebView, useState, useEffect, useColorScheme } from 'scripting'
import { plotCanvasHTML } from './plot-canvas'
type PlotMessage={seq:number;samples:number[];tone:string;area:boolean;running:boolean;percent:boolean;background:string;sampleAt:number;timingEpoch?:number;resume?:boolean}
export interface CanvasPlotProps {samples:number[];tone:string;plotHeight?:number;area?:boolean;running?:boolean;percent?:boolean;plotWidth?:number;elevated?:boolean;role?:PlotRole;sheetTrace?:number}
// Mount the drawing host in the first render, including during sheet presentation.
// The parent owns creation; running and component cleanup own pause/disposal.
// Native onAppear can arrive only after scrolling, so it must not gate chart creation.
export function InlineCanvasPlot(props:CanvasPlotProps) {
  const height=props.plotHeight??96
  return <VStack spacing={0} frame={props.plotWidth?{width:props.plotWidth,height}:{height}}>
    <MountedCanvasPlot {...props}/>
  </VStack>
}
// Native copy of the web canvas grid (8 columns, 5 rows, dashed) so the card never shows an empty plot while the WebView document loads.
export function drawPlotGrid(ctx:any,size:{width:number;height:number}){
  const w=size.width,h=size.height
  ctx.strokeStyle='rgba(146,149,163,0.22)';ctx.lineWidth=0.6;ctx.setLineDash([3,3]);ctx.beginPath()
  for(let i=0;i<8;i++){ctx.moveTo(i*w/7,0);ctx.lineTo(i*w/7,h)}
  for(let i=0;i<5;i++){ctx.moveTo(0,i*h/4);ctx.lineTo(w,i*h/4)}
  ctx.stroke()
}
// Opaque-colour cover (Canvas itself remains non-opaque): hides the initial white
// WebView backing and any web grid underneath without doubling the grid strokes.
export function drawPlotCover(ctx:any,size:{width:number;height:number},background:string){
  ctx.fillStyle=background;ctx.fillRect(0,0,size.width,size.height);drawPlotGrid(ctx,size)
  // TEMP display-source probe: N belongs only to this cover; remove with the HTML W after diagnosis.
  ctx.save();ctx.fillStyle='#b45309';ctx.fillRect(2,2,14,14)
  ctx.fillStyle='#ffffff';ctx.font=10;ctx.textAlign='center';ctx.textBaseline='top';ctx.fillText('N',9,4);ctx.restore()
}
// Card fill = secondarySystemBackground. In a presented sheet iOS uses the elevated
// palette (dark #2c2c2e, light unchanged), so detail plots must match that fill.
export function plotBackground(theme:string|undefined,elevated=false){return theme==='dark'?(elevated?'#2c2c2e':'#1c1c1e'):'#f2f2f7'}
// Script-message params and evaluateJavaScript results are consumed leniently so the chart does not depend
// on one runtime's wrapping (raw value, JSON string, or single-element array) or on one Promise timing.
function messageBody(v:any):any{
  if(typeof v==='string'){try{v=JSON.parse(v)}catch{return v}}
  if(Array.isArray(v))v=v[0]
  return v&&typeof v==='object'&&'body' in v&&!('generation' in v)?v.body:v
}
const truthy=(v:any)=>v===true||v===1||v==='true'||v==='1'||v==='2'||v===2
// Host-level recomposition requests (home tab selected / page appeared). Charts that are not yet shown ignore them;
// First reveal is owned only by plotPainted. No parent props, so card memoisation is unaffected.
const kickListeners=new Set<(reason:'selected'|'appear')=>void>()
export function requestPlotKick(reason:'selected'|'appear'){for(const fn of [...kickListeners])fn(reason)}
export function MountedCanvasPlot({samples,tone,plotHeight=96,area=false,running=true,percent=false,elevated=false,role="home",sheetTrace}:CanvasPlotProps) {
  const [error,setError]=useState('')
  // Keep WebView visible throughout loading; only the stable native cover is hidden after a confirmed paint.
  const [shown,setShown]=useState(false)
  const theme=useColorScheme()
  const [host]=useState(()=>({controller:new WebViewController({ephemeral:true}),trace:createPlotTrace(role,sheetTrace),alive:true,shown:false,ready:false,loadRetries:0,bridgeFailures:0,markReady:(()=>{}) as ()=>void,ackSeq:0,probeSeq:0,resumeUnverified:false,clearProbe:(()=>{}) as ()=>void,busy:false,registered:false,loaded:false,foreground:true,generation:0,bridgeEpoch:0,seq:0,sampleAt:0,lastSamples:null as number[]|null,token:undefined as TimingToken|undefined,latest:null as PlotMessage|null,pending:null as PlotMessage|null,flush:()=>{}}))
  const record=(event:Parameters<typeof plotLifecycle>[0],gen=host.generation,size?:{w:number;h:number})=>plotLifecycle(event,gen,size,host.trace)
  useEffect(()=>{
    host.alive=true;record('mount',host.generation)
    let timeout:ReturnType<typeof setTimeout>|undefined,reveal:ReturnType<typeof setTimeout>|undefined,probe:ReturnType<typeof setTimeout>|undefined,probeReady:ReturnType<typeof setTimeout>|undefined
    const fail=()=>{if(host.alive){setError('曲线绘制层加载失败');host.ready=false}}
    const flush=()=>{
      if(!host.alive||!host.foreground||!host.ready||host.busy||!host.pending)return
      const payload=host.pending;host.pending=null;host.busy=true
      const epoch=host.bridgeEpoch,current=timingToken(),token=current?.epoch===payload.timingEpoch?current:undefined,finished=timingSpan(token,"bridge");host.token=token
      const valid=()=>host.alive&&epoch===host.bridgeEpoch
      // A healthy, painted document is never torn down for one failed bridge call.
      // Resume probes still reload an unresponsive document; ordinary samples retry on the next sample.
      const rejected=()=>{if(!valid())return
        if(payload.resume){record('reload-probe-failed',host.generation);reload();return}
        if(host.shown){record('ignored-bridge-error',host.generation);if(++host.bridgeFailures>=3){record('reload-bridge-failures',host.generation);reload()}return}
        record('fail-bridge',host.generation);fail()}
      // A resume probe must not itself wait forever on a suspended document.
      host.clearProbe=()=>{if(probe!==undefined)clearTimeout(probe);probe=undefined}
      if(payload.resume){host.probeSeq=payload.seq;probe=setTimeout(()=>{if(valid()){record('reload-probe-timeout',host.generation);host.probeSeq=0;reload()}},8000)}
      let keepProbe=false
      // Result contract is read leniently. 'missing' = no chart runtime; false = stale update (document healthy);
      // true/1/'true' = applied; anything else is unverified: the page's plotAck message (or the probe timeout) decides.
      void host.controller.evaluateJavaScript(`return window.plotCanvas ? window.plotCanvas.update(${JSON.stringify(payload)}) : 'missing'`).then(r=>{
        if(!valid())return
        if(r==='missing')rejected()
        else if(r===false||r==='false'||r===0){record('ignored-stale-update',host.generation)}
        else if(truthy(r)){host.bridgeFailures=0;if(payload.resume)setError('')}
        else if(payload.resume){keepProbe=host.ackSeq<payload.seq}
        else record('ignored-bridge-error',host.generation)
      },rejected).finally(()=>{finished();if(valid()){if(!keepProbe){host.clearProbe();if(payload.resume)host.probeSeq=0};host.busy=false;flush()}})
    }
    host.flush=flush
    // The WebView is already part of the first render. Register then load once;
    // do not wait for native visibility callbacks to begin document creation.
    const start=()=>{
      if(!host.alive||!host.registered||host.loaded)return
      host.loaded=true
      const initial=host.pending??host.latest;host.pending=null
      const generation=++host.generation,valid=()=>host.alive&&host.generation===generation
      record('load',generation)
      // Load timeout: one automatic retry of this chart document, then a visible error.
      timeout=setTimeout(()=>{if(!valid()||host.ready)return
        if(host.loadRetries++<1){record('reload-load-timeout',generation);reload()}else{record('fail-load-timeout',generation);fail()}},8000)
      // loadHTML's result is only a request outcome. Readiness is the plotReady message;
      // once the document is ready (or merely not yet failed) a false/rejected result must not hide it.
      // Not-yet-ready failures are left to the bounded load timeout above (one retry, then error).
      const loadResult=(bad:boolean)=>{if(valid()&&bad)record('ignored-load-result',generation)}
      // If script messages are unavailable or delayed, the document itself can still prove it is running:
      // poll its own state (not a mask; no visibility change unless the page confirms a real paint).
      const aliveCheck=(left:number)=>{if(!valid()||host.ready)return;probeReady=setTimeout(()=>{
        if(!valid()||host.ready)return
        void host.controller.evaluateJavaScript('return window.plotCanvas ? window.plotCanvas.alive() : 0').then(r=>{
          if(!valid()||host.ready)return
          if(r===1||r===2||r==='1'||r==='2'){record('ready-by-probe',generation);host.markReady()}else if(left>0)aliveCheck(left-1)
        },()=>{if(left>0)aliveCheck(left-1)})
      },1000)}
      aliveCheck(6)
      void host.controller.loadHTML(plotCanvasHTML(initial??undefined,false,generation)).then(ok=>loadResult(ok===false),()=>loadResult(true))
    }
    // Reload only this chart document if a resume probe finds no working runtime.
    // Healthy restores repaint in place; neither page identity nor history changes.
    const reload=()=>{
      host.bridgeEpoch++;host.busy=false;host.ready=false;host.loaded=false
      if(probe!==undefined)clearTimeout(probe);probe=undefined
      if(timeout!==undefined)clearTimeout(timeout);if(probeReady!==undefined)clearTimeout(probeReady);if(reveal!==undefined)clearTimeout(reveal)
      if(kickTimer!==undefined)clearTimeout(kickTimer);kickTimer=undefined
      host.shown=false;setShown(false);setError('');host.pending=host.latest;start()
    }
    const changed=(phase:'active'|'inactive'|'background')=>{
      if(phase==='active'&&host.foreground)return
      record(phase==='active'?'scene-active':phase==='inactive'?'scene-inactive':'scene-background',host.generation)
      host.foreground=phase==='active'
      // Invalidate completion callbacks before releasing the single bridge slot.
      // A suspended pre-background evaluate must not block the resume probe.
      host.bridgeEpoch++;host.busy=false
      if(probe!==undefined)clearTimeout(probe);probe=undefined
      if(!host.foreground||!host.latest)return
      host.latest={...host.latest,seq:++host.seq,resume:true};host.pending=host.latest
      // A load still in flight is not stale: its own timeout owns the retry. Do not restart it.
      if(host.loaded&&!host.ready)return
      flush()
    }
    // Bounded recomposition: coalesced into one timer; re-applies the latest samples (resume repaint, no history change)
    // without changing native view opacity/identity. Only for an already-shown, healthy, foreground document.
    let kickTimer:ReturnType<typeof setTimeout>|undefined
    const scheduleKick=(event:'kick-selected'|'kick-appear',delay:number)=>{
      if(!host.alive||kickTimer!==undefined){if(host.alive)record('kick-skipped',host.generation);return}
      kickTimer=setTimeout(()=>{
        kickTimer=undefined
        if(!host.alive||!host.foreground||!host.ready||!host.shown||!host.latest){record('kick-skipped',host.generation);return}
        record(event,host.generation)
        host.latest={...host.latest,seq:++host.seq,resume:true};host.pending=host.latest
        flush()
      },delay)
    }
    const onKick=(reason:'selected'|'appear')=>scheduleKick(reason==='selected'?'kick-selected':'kick-appear',0)
    kickListeners.add(onKick)
    AppEvents.scenePhase.addListener(changed)
    const accepts=(raw:any)=>{const value=messageBody(raw);return host.alive&&(value?.generation===host.generation||(value==null&&host.generation===1))}
    const markReady=()=>{
      if(host.ready)return
      record('ready',host.generation)
      if(timeout!==undefined)clearTimeout(timeout);if(probeReady!==undefined)clearTimeout(probeReady);probeReady=undefined
      host.ready=true;flush()
      // Normally the page reports plotPainted. If that message is lost, reveal only after
      // the document confirms a real non-zero-size paint; a view that has not been laid out
      // yet (first tab entry) keeps the native grid and paints when its size arrives.
      const generation=host.generation
      const check=(left:number)=>{reveal=setTimeout(()=>{
        if(!host.alive||host.generation!==generation||host.shown)return
        void host.controller.evaluateJavaScript('return window.plotCanvas?.painted?.() === true').then(ok=>{
          if(!host.alive||host.generation!==generation||host.shown)return
          record('reveal-check',generation);if(truthy(ok)){record('shown',generation);host.shown=true;setShown(true)}else if(left>0)check(left-1)
        },()=>{if(host.alive&&host.generation===generation&&left>0)check(left-1)})
      },700)}
      check(6)
    }
    host.markReady=markReady
    void host.controller.addScriptMessageHandler('plotReady',(value:any)=>{
      if(!accepts(value))return false
      markReady();return true
    }).then(()=>host.controller.addScriptMessageHandler('plotPainted',(value:any)=>{
      if(!accepts(value))return false
      if(reveal!==undefined)clearTimeout(reveal)
      record('painted',host.generation,(()=>{const b=messageBody(value);return typeof b?.w==='number'&&typeof b?.h==='number'?{w:b.w,h:b.h}:undefined})())
      const first=!host.shown
      if(first)record('shown',host.generation)
      host.shown=true;setShown(true);return true
    })).then(()=>host.controller.addScriptMessageHandler('plotAck',(value:any)=>{
      const b=messageBody(value);if(!host.alive||b?.generation!==host.generation||typeof b?.seq!=='number')return false
      if(b.seq>=host.ackSeq)host.ackSeq=b.seq
      host.bridgeFailures=0
      if(host.probeSeq!==0&&b.seq>=host.probeSeq){host.probeSeq=0;host.clearProbe();if(host.resumeUnverified){host.resumeUnverified=false;setError('')}}
      return true
    }).catch(()=>{})).then(()=>host.controller.addScriptMessageHandler('plotLag',(value:any)=>{if(host.alive&&value?.epoch===host.token?.epoch&&typeof value?.ms==='number')timing(host.token,'canvas-gap',value.ms);return true})).then(()=>{host.registered=true;start()},fail)
    start()
    return()=>{record('dispose',host.generation);kickListeners.delete(onKick);if(kickTimer!==undefined)clearTimeout(kickTimer);AppEvents.scenePhase.removeListener(changed);host.alive=false;host.bridgeEpoch++;host.ready=false;host.pending=null;if(probe!==undefined)clearTimeout(probe);if(timeout!==undefined)clearTimeout(timeout);if(probeReady!==undefined)clearTimeout(probeReady);if(reveal!==undefined)clearTimeout(reveal);host.controller.dispose()}
  },[host])
  useEffect(()=>{
    if(host.lastSamples!==samples){host.lastSamples=samples;host.sampleAt=Date.now()}
    host.token=timingToken()
    host.latest=host.pending={timingEpoch:host.token?.epoch,sampleAt:host.sampleAt,seq:++host.seq,samples:samples.filter(Number.isFinite).slice(-60),tone,area,running,percent,background:plotBackground(theme,elevated)}
    host.flush()
  },[samples,tone,area,running,percent,theme,elevated,host])
  // Both keyed layers remain mounted at fixed positions. WebView never crosses
  // opacity 0 -> 1 (including reloads). Only its coloured grid cover becomes transparent;
  // native appearance callbacks remain diagnostics, not creation/reveal gates.
  return error?<Text font={11} foregroundStyle="secondaryLabel" frame={{height:plotHeight}}>{error}</Text>:<ZStack onAppear={()=>record("host-appear")} onDisappear={()=>record("host-disappear")} frame={{minHeight:plotHeight,maxHeight:plotHeight,minWidth:0,maxWidth:'infinity'}}><WebView key={`plot-web-${host.trace.id}`} onAppear={()=>record("web-appear")} onDisappear={()=>record("web-disappear")} controller={host.controller} disabled opacity={1} frame={{minHeight:plotHeight,maxHeight:plotHeight,minWidth:0,maxWidth:'infinity'}}/><Canvas key={`plot-grid-${host.trace.id}`} opaque={false} opacity={shown?0:1} draw={(ctx,size)=>drawPlotCover(ctx,size,plotBackground(theme,elevated))} frame={{minHeight:plotHeight,maxHeight:plotHeight,minWidth:0,maxWidth:'infinity'}}/></ZStack>
}
