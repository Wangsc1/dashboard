import { AppEvents, TimelineCanvas, VStack, useRef, useState, useEffect, useColorScheme } from 'scripting'
import { plotLifecycle, createPlotTrace, PlotRole, createNativeDrawTrack, resetNativeDrawTrack, disposeNativeDrawTrack, recordNativeDraw, nativePlotStateEvent, nativePlotUpdate, nativePlotRawDraw, nativePlotRenderedPause } from './cadence-diagnostics'
import { createNativePlot, updateNativePlot, advanceNativePlot, restoreNativePlot, drawNativePlot } from './native-plot'
export interface CanvasPlotProps {samples:number[];tone:string;plotHeight?:number;area?:boolean;running?:boolean;percent?:boolean;plotWidth?:number;elevated?:boolean;role?:PlotRole;sheetTrace?:number}
export function InlineCanvasPlot(props:CanvasPlotProps) {
  const height=props.plotHeight??96
  return <VStack spacing={0} frame={props.plotWidth?{width:props.plotWidth,height}:{height}}><MountedCanvasPlot {...props}/></VStack>
}
export function plotBackground(theme:string|undefined,elevated=false){return theme==='dark'?(elevated?'#2c2c2e':'#1c1c1e'):'#f2f2f7'}
// One process-local completion queue, NOT a frame driver. Native TimelineView owns frames.
// Final draw queues a deferred boundary update; never call React setters inside draw.
const completions=new Map<object,()=>void>()
let completionTimer:ReturnType<typeof setTimeout>|undefined
function cancelCompletion(owner:object){completions.delete(owner);if(!completions.size&&completionTimer!==undefined){clearTimeout(completionTimer);completionTimer=undefined}}
function afterFinalDraw(owner:object,finish:()=>void){
  completions.set(owner,finish)
  if(completionTimer!==undefined)return
  completionTimer=setTimeout(()=>{completionTimer=undefined;const pending=[...completions.values()];completions.clear();for(const done of pending)done()},0)
}
// Explicitly approved cadence: reduce native bridge load without changing sample timing.
const PLOT_SCHEDULE={minimumInterval:1/30}
const kickListeners=new Set<(reason:'selected'|'appear')=>void>()
export function requestPlotKick(reason:'selected'|'appear'){for(const fn of [...kickListeners])fn(reason)}
export function MountedCanvasPlot({samples,tone,plotHeight=96,plotWidth,area=false,running=true,percent=false,elevated=false,role='home',sheetTrace}:CanvasPlotProps){
  const theme=useColorScheme()
  const ref=useRef<ReturnType<typeof makeHost>|null>(null)
  function makeHost(){const trace=createPlotTrace(role,sheetTrace);return {model:createNativePlot(),trace,drawTrack:createNativeDrawTrack(trace),alive:true,foreground:true,visible:true,running,lastSamples:null as number[]|null,sampleAt:0,revision:0,paintRevision:-1,ticking:true,background:plotBackground(theme,elevated)}}
  if(!ref.current)ref.current=makeHost()
  const host=ref.current
  const [paused,setPaused]=useState(false)
  const record=(event:Parameters<typeof plotLifecycle>[0],size?:{w:number;h:number})=>plotLifecycle(event,0,size,host.trace)
  const park=()=>{nativePlotStateEvent(host.drawTrack,'park');resetNativeDrawTrack(host.drawTrack);cancelCompletion(host);const ticking=host.ticking;host.ticking=false;if(host.alive&&ticking){nativePlotStateEvent(host.drawTrack,'setPausedTrue');setPaused(true)}}
  const wake=()=>{nativePlotStateEvent(host.drawTrack,'wake');cancelCompletion(host);host.revision++;if(host.alive&&host.foreground&&host.visible&&!host.ticking){host.ticking=true;nativePlotStateEvent(host.drawTrack,'setPausedFalse');setPaused(false)}}
  useEffect(()=>{
    host.alive=true;record('mount')
    const changed=(phase:'active'|'inactive'|'background')=>{
      if(!host.alive||(phase==='active'&&host.foreground))return
      record(phase==='active'?'scene-active':phase==='inactive'?'scene-inactive':'scene-background')
      nativePlotStateEvent(host.drawTrack,'restoreScene');resetNativeDrawTrack(host.drawTrack);host.foreground=phase==='active';restoreNativePlot(host.model);host.model.active=host.running&&host.foreground&&host.visible
      if(host.foreground&&host.running){wake()}else{park()}
    }
    const kick=(reason:'selected'|'appear')=>{if(!host.alive||!host.foreground||!host.visible||!host.running||host.ticking)return;record(reason==='selected'?'kick-selected':'kick-appear');wake()}
    AppEvents.scenePhase.addListener(changed);kickListeners.add(kick)
    return()=>{disposeNativeDrawTrack(host.trace,host.drawTrack);host.alive=false;host.ticking=false;cancelCompletion(host);AppEvents.scenePhase.removeListener(changed);kickListeners.delete(kick);record('dispose')}
  },[host])
  useEffect(()=>{
    const newRef=host.lastSamples!==samples,wasAnimating=host.model.animating,oldStart=host.model.start
    if(host.lastSamples!==samples){host.lastSamples=samples;host.sampleAt=Date.now()}
    if(!running){nativePlotStateEvent(host.drawTrack,'restoreRunningFalse');resetNativeDrawTrack(host.drawTrack)}
    host.running=running;host.background=plotBackground(theme,elevated)
    updateNativePlot(host.model,{samples,tone,area,percent,running:running&&host.foreground&&host.visible,sampleAt:host.sampleAt},Date.now())
    nativePlotUpdate(host.drawTrack,newRef,running,wasAnimating,oldStart,host.model.animating,host.model.start,host.model.history.length)
    // Includes paused data/style changes: one native draw, then park after its final commands.
    wake()
  },[samples,tone,area,percent,running,theme,elevated,host])
  // A layout change is not a sample: redraw retained geometry without a synthetic x-shift.
  useEffect(()=>{wake()},[plotHeight,plotWidth,host])
  nativePlotRenderedPause(host.drawTrack,paused)
  return <TimelineCanvas schedule={PLOT_SCHEDULE} paused={paused} opaque={false}
    frame={{minHeight:plotHeight,maxHeight:plotHeight,minWidth:0,maxWidth:'infinity'}}
    onAppear={()=>{if(!host.alive)return;const returning=!host.visible;host.visible=true;record('host-appear');if(returning){nativePlotStateEvent(host.drawTrack,'restoreReturnAppear');resetNativeDrawTrack(host.drawTrack);restoreNativePlot(host.model);host.model.active=host.running&&host.foreground;wake()}}
    onDisappear={()=>{if(!host.alive)return;host.visible=false;record('host-disappear');nativePlotStateEvent(host.drawTrack,'restoreDisappear');restoreNativePlot(host.model);host.model.active=false;park()}}
    draw={(ctx,size,time)=>{
      if(!host.alive)return
      const entered=Date.now()
      nativePlotRawDraw(host.drawTrack,time,entered,(host.model.animating?1:0)|(host.running?2:0)|(host.ticking?4:0)|(host.foreground?8:0)|(host.visible?16:0)|(size.width>0&&size.height>0?32:0))
      const animated=host.model.animating&&host.foreground&&host.visible&&host.running&&host.ticking&&size.width>0&&size.height>0
      advanceNativePlot(host.model,Date.now())
      drawNativePlot(ctx,size,host.model,host.background)
      if(size.width>0&&size.height>0&&host.paintRevision!==host.revision){host.paintRevision=host.revision;record('native-draw',{w:size.width,h:size.height})}
      if(!host.model.animating&&host.ticking&&((size.width>0&&size.height>0)||!host.model.history.length)){
        const revision=host.revision
        afterFinalDraw(host,()=>{if(host.alive&&host.revision===revision&&!host.model.animating){nativePlotStateEvent(host.drawTrack,'park');resetNativeDrawTrack(host.drawTrack);host.ticking=false;nativePlotStateEvent(host.drawTrack,'setPausedTrue');setPaused(true)}})
      }
      const model=host.model,progress=Math.max(0,Math.min(1,(entered-model.start)/model.duration))
      recordNativeDraw(host.drawTrack,time,entered,Date.now(),animated,model.start,progress,model.shown,model.scale)
    }}/>
}
