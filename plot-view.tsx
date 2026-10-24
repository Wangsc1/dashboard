import { TimingToken, timingToken, timing, timingSpan } from "./cadence-diagnostics"
import { AppEvents, VStack, ZStack, Canvas, Text, WebView, useState, useEffect, useColorScheme } from 'scripting'
import { plotCanvasHTML } from './plot-canvas'
type PlotMessage={seq:number;samples:number[];tone:string;area:boolean;running:boolean;percent:boolean;background:string;sampleAt:number;timingEpoch?:number;resume?:boolean}
export interface CanvasPlotProps {samples:number[];tone:string;plotHeight?:number;area?:boolean;running?:boolean;percent?:boolean;plotWidth?:number;elevated?:boolean}
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
// Card fill = secondarySystemBackground. In a presented sheet iOS uses the elevated
// palette (dark #2c2c2e, light unchanged), so detail plots must match that fill.
export function plotBackground(theme:string|undefined,elevated=false){return theme==='dark'?(elevated?'#2c2c2e':'#1c1c1e'):'#f2f2f7'}
export function MountedCanvasPlot({samples,tone,plotHeight=96,area=false,running=true,percent=false,elevated=false}:CanvasPlotProps) {
  const [error,setError]=useState('')
  // A WebView is white until its document exists; stay transparent so the card colour shows through until the canvas has drawn.
  const [shown,setShown]=useState(false)
  const theme=useColorScheme()
  const [host]=useState(()=>({controller:new WebViewController({ephemeral:true}),alive:true,ready:false,busy:false,registered:false,loaded:false,foreground:true,generation:0,bridgeEpoch:0,seq:0,sampleAt:0,lastSamples:null as number[]|null,token:undefined as TimingToken|undefined,latest:null as PlotMessage|null,pending:null as PlotMessage|null,flush:()=>{}}))
  useEffect(()=>{
    host.alive=true
    let timeout:ReturnType<typeof setTimeout>|undefined,reveal:ReturnType<typeof setTimeout>|undefined,probe:ReturnType<typeof setTimeout>|undefined
    const fail=()=>{if(host.alive){setError('曲线绘制层加载失败');host.ready=false}}
    const flush=()=>{
      if(!host.alive||!host.foreground||!host.ready||host.busy||!host.pending)return
      const payload=host.pending;host.pending=null;host.busy=true
      const epoch=host.bridgeEpoch,current=timingToken(),token=current?.epoch===payload.timingEpoch?current:undefined,finished=timingSpan(token,"bridge");host.token=token
      const valid=()=>host.alive&&epoch===host.bridgeEpoch
      const rejected=()=>{if(valid()){if(payload.resume)reload();else fail()}}
      // A resume probe must not itself wait forever on a suspended document.
      if(payload.resume)probe=setTimeout(()=>{if(valid())reload()},8000)
      void host.controller.evaluateJavaScript(`return window.plotCanvas?.update(${JSON.stringify(payload)}) ?? false`).then(ok=>{if(ok!==true)rejected();else if(valid()&&payload.resume)setError('')},rejected).finally(()=>{finished();if(valid()){if(probe!==undefined)clearTimeout(probe);probe=undefined;host.busy=false;flush()}})
    }
    host.flush=flush
    // The WebView is already part of the first render. Register then load once;
    // do not wait for native visibility callbacks to begin document creation.
    const start=()=>{
      if(!host.alive||!host.registered||host.loaded)return
      host.loaded=true
      const initial=host.pending??host.latest;host.pending=null
      const generation=++host.generation,valid=()=>host.alive&&host.generation===generation
      timeout=setTimeout(()=>{if(valid())fail()},8000)
      void host.controller.loadHTML(plotCanvasHTML(initial??undefined,false,generation)).then(ok=>{if(valid()&&ok===false)fail()},()=>{if(valid())fail()})
    }
    // Reload only this chart document if a resume probe finds no working runtime.
    // Healthy restores repaint in place; neither page identity nor history changes.
    const reload=()=>{
      host.bridgeEpoch++;host.busy=false;host.ready=false;host.loaded=false
      if(probe!==undefined)clearTimeout(probe);probe=undefined
      if(timeout!==undefined)clearTimeout(timeout);if(reveal!==undefined)clearTimeout(reveal)
      setShown(false);setError('');host.pending=host.latest;start()
    }
    const changed=(phase:'active'|'inactive'|'background')=>{
      if(phase==='active'&&host.foreground)return
      host.foreground=phase==='active'
      // Invalidate completion callbacks before releasing the single bridge slot.
      // A suspended pre-background evaluate must not block the resume probe.
      host.bridgeEpoch++;host.busy=false
      if(probe!==undefined)clearTimeout(probe);probe=undefined
      if(!host.foreground||!host.latest)return
      host.latest={...host.latest,seq:++host.seq,resume:true};host.pending=host.latest
      if(host.loaded&&!host.ready)reload();else flush()
    }
    AppEvents.scenePhase.addListener(changed)
    const accepts=(value:any)=>host.alive&&(value?.generation===host.generation||(value==null&&host.generation===1))
    void host.controller.addScriptMessageHandler('plotReady',(value:any)=>{
      if(!accepts(value))return false
      if(host.ready)return true
      if(timeout!==undefined)clearTimeout(timeout)
      host.ready=true;flush()
      // Normally the page reports plotPainted; the timer only guards against a lost message.
      const generation=host.generation
      reveal=setTimeout(()=>{if(host.alive&&host.generation===generation)setShown(true)},700);return true
    }).then(()=>host.controller.addScriptMessageHandler('plotPainted',(value:any)=>{
      if(!accepts(value))return false
      if(reveal!==undefined)clearTimeout(reveal)
      setShown(true);return true
    })).then(()=>host.controller.addScriptMessageHandler('plotLag',(value:any)=>{if(host.alive&&value?.epoch===host.token?.epoch&&typeof value?.ms==='number')timing(host.token,'canvas-gap',value.ms);return true})).then(()=>{host.registered=true;start()},fail)
    start()
    return()=>{AppEvents.scenePhase.removeListener(changed);host.alive=false;host.bridgeEpoch++;host.ready=false;host.pending=null;if(probe!==undefined)clearTimeout(probe);if(timeout!==undefined)clearTimeout(timeout);if(reveal!==undefined)clearTimeout(reveal);host.controller.dispose()}
  },[host])
  useEffect(()=>{
    if(host.lastSamples!==samples){host.lastSamples=samples;host.sampleAt=Date.now()}
    host.token=timingToken()
    host.latest=host.pending={timingEpoch:host.token?.epoch,sampleAt:host.sampleAt,seq:++host.seq,samples:samples.filter(Number.isFinite).slice(-60),tone,area,running,percent,background:plotBackground(theme,elevated)}
    host.flush()
  },[samples,tone,area,running,percent,theme,elevated,host])
  return error?<Text font={11} foregroundStyle="secondaryLabel" frame={{height:plotHeight}}>{error}</Text>:<ZStack frame={{minHeight:plotHeight,maxHeight:plotHeight,minWidth:0,maxWidth:'infinity'}}>{shown?null:<Canvas opaque={false} draw={drawPlotGrid} frame={{minHeight:plotHeight,maxHeight:plotHeight,minWidth:0,maxWidth:'infinity'}}/>}<WebView controller={host.controller} disabled opacity={shown?1:0} frame={{minHeight:plotHeight,maxHeight:plotHeight,minWidth:0,maxWidth:'infinity'}}/></ZStack>
}
