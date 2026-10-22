import { VStack, Text, WebView, useState, useEffect, useColorScheme } from 'scripting'
import { plotCanvasHTML } from './plot-canvas'
interface PlotDiagnostic {ms:number;width:number;height:number;viewportWidth:number;viewportHeight:number;bitmapWidth:number;bitmapHeight:number;context:boolean;hidden:boolean;attempts:number;grids:number;frames:number;updates:number;samples:number;seq:number;active:boolean;error:string}
export const PLOT_DIAGNOSTIC_HEIGHT=56
export interface CanvasPlotProps {samples:number[];tone:string;plotHeight?:number;area?:boolean;running?:boolean;percent?:boolean;plotWidth?:number}
// Mount the drawing host in the first render, including during sheet presentation.
// The parent owns creation; running and component cleanup own pause/disposal.
// Native onAppear can arrive only after scrolling, so it must not gate chart creation.
export function InlineCanvasPlot(props:CanvasPlotProps) {
  const height=(props.plotHeight??96)+PLOT_DIAGNOSTIC_HEIGHT
  return <VStack spacing={0} frame={props.plotWidth?{width:props.plotWidth,height}:{height}}>
    <MountedCanvasPlot {...props}/>
  </VStack>
}
export function MountedCanvasPlot({samples,tone,plotHeight=96,area=false,running=true,percent=false}:CanvasPlotProps) {
  const [error,setError]=useState('')
  const [trace,setTrace]=useState({stage:'mount',nativeAppear:0,web:null as PlotDiagnostic|null})
  const theme=useColorScheme()
  const [host]=useState(()=>({controller:new WebViewController({ephemeral:true}),alive:true,ready:false,busy:false,registered:false,loaded:false,seq:0,pending:null as null|{seq:number;samples:number[];tone:string;area:boolean;running:boolean;percent:boolean;background:string},flush:()=>{}}))
  useEffect(()=>{
    host.alive=true
    let timeout:ReturnType<typeof setTimeout>|undefined
    const fail=()=>{if(host.alive){setError('曲线绘制层加载失败');host.ready=false;setTrace(s=>({...s,stage:'error'}))}}
    const flush=()=>{
      if(!host.alive||!host.ready||host.busy||!host.pending)return
      const payload=host.pending;host.pending=null;host.busy=true
      void host.controller.evaluateJavaScript(`return window.plotCanvas.update(${JSON.stringify(payload)})`).then(ok=>{if(ok!==true)fail()},fail).finally(()=>{host.busy=false;if(host.alive)flush()})
    }
    host.flush=flush
    // The WebView is already part of the first render. Register then load once;
    // do not wait for native visibility callbacks to begin document creation.
    const start=()=>{
      if(!host.alive||!host.registered||host.loaded)return
      host.loaded=true
      const initial=host.pending;host.pending=null
      timeout=setTimeout(fail,8000)
      setTrace(s=>({...s,stage:'loading'}))
      void host.controller.loadHTML(plotCanvasHTML(initial??undefined,true)).then(ok=>{if(!host.alive)return;if(ok===false)fail();else setTrace(s=>({...s,stage:host.ready?'ready':'loaded'}))},fail)
    }
    void Promise.all([
      host.controller.addScriptMessageHandler<PlotDiagnostic>('plotDiagnostic',value=>{
        if(host.alive&&value&&Number.isFinite(value.ms))setTrace(s=>({...s,web:value}))
        return true
      }),
      host.controller.addScriptMessageHandler('plotReady',()=>{
      if(!host.alive)return false
      if(timeout!==undefined)clearTimeout(timeout)
      host.ready=true;setTrace(s=>({...s,stage:'ready'}));flush();return true
    })]).then(()=>{host.registered=true;start()},fail)
    start()
    return()=>{host.alive=false;host.ready=false;host.pending=null;if(timeout!==undefined)clearTimeout(timeout);host.controller.dispose()}
  },[host])
  useEffect(()=>{
    host.pending={seq:++host.seq,samples:samples.filter(Number.isFinite).slice(-60),tone,area,running,percent,background:theme==='dark'?'#1c1c1e':'#f2f2f7'}
    host.flush()
  },[samples,tone,area,running,percent,theme,host])
  const d=trace.web
  // Diagnostics are a separate, explicitly sized footer. Never cover the WebView:
  // an opaque overlapping native view can itself interfere with visibility testing.
  return <VStack alignment="leading" spacing={0} frame={{height:plotHeight+PLOT_DIAGNOSTIC_HEIGHT}}>
    {error?<Text font={11} foregroundStyle="secondaryLabel" frame={{height:plotHeight}}>{error}</Text>:<WebView controller={host.controller} onAppear={()=>{if(host.alive)setTrace(s=>({...s,nativeAppear:s.nativeAppear+1}))}} disabled frame={{minHeight:plotHeight,maxHeight:plotHeight,minWidth:0,maxWidth:'infinity'}}/>}
    <VStack alignment="leading" spacing={0} frame={{height:PLOT_DIAGNOSTIC_HEIGHT}} foregroundStyle="label" font={8} fontDesign="monospaced">
      <Text>{`D183 ${trace.stage} A:${trace.nativeAppear} ${d?Math.round(d.ms/1000)+'s':'JS:--'}`}</Text>
      <Text>{d?`C:${d.width}x${d.height} V:${d.viewportWidth}x${d.viewportHeight} H:${+d.hidden}`:'C:-- V:-- H:--'}</Text>
      <Text>{d?`P:${d.attempts} G:${d.grids} F:${d.frames} N:${d.samples} U:${d.updates}`:'P:-- G:-- F:-- N:-- U:--'}</Text>
      <Text>{d?`B:${d.bitmapWidth}x${d.bitmapHeight} ctx:${+d.context} run:${+d.active}`:'B:-- ctx:-- run:--'}</Text>
      {d?.error?<Text>{`ERR:${d.error}`}</Text>:null}
    </VStack>
  </VStack>
}
