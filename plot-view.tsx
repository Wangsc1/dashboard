import { VStack, Text, WebView, useState, useEffect, useColorScheme } from 'scripting'
import { plotCanvasHTML } from './plot-canvas'
export interface CanvasPlotProps {samples:number[];tone:string;plotHeight?:number;area?:boolean;running?:boolean;percent?:boolean;plotWidth?:number}
// Mount the drawing host in the first render, including during sheet presentation.
// The parent owns creation; running and component cleanup own pause/disposal.
// Native onAppear can arrive only after scrolling, so it must not gate chart creation.
export function InlineCanvasPlot(props:CanvasPlotProps) {
  const height=props.plotHeight??96
  return <VStack spacing={0} frame={props.plotWidth?{width:props.plotWidth,height}:{height}}>
    <MountedCanvasPlot {...props}/>
  </VStack>
}
export function MountedCanvasPlot({samples,tone,plotHeight=96,area=false,running=true,percent=false}:CanvasPlotProps) {
  const [error,setError]=useState('')
  const theme=useColorScheme()
  const [host]=useState(()=>({controller:new WebViewController({ephemeral:true}),alive:true,ready:false,busy:false,registered:false,loaded:false,seq:0,pending:null as null|{seq:number;samples:number[];tone:string;area:boolean;running:boolean;percent:boolean;background:string},flush:()=>{}}))
  useEffect(()=>{
    host.alive=true
    let timeout:ReturnType<typeof setTimeout>|undefined
    const fail=()=>{if(host.alive){setError('曲线绘制层加载失败');host.ready=false}}
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
      void host.controller.loadHTML(plotCanvasHTML(initial??undefined)).then(ok=>{if(host.alive&&ok===false)fail()},fail)
    }
    void host.controller.addScriptMessageHandler('plotReady',()=>{
      if(!host.alive)return false
      if(timeout!==undefined)clearTimeout(timeout)
      host.ready=true;flush();return true
    }).then(()=>{host.registered=true;start()},fail)
    start()
    return()=>{host.alive=false;host.ready=false;host.pending=null;if(timeout!==undefined)clearTimeout(timeout);host.controller.dispose()}
  },[host])
  useEffect(()=>{
    host.pending={seq:++host.seq,samples:samples.filter(Number.isFinite).slice(-60),tone,area,running,percent,background:theme==='dark'?'#1c1c1e':'#f2f2f7'}
    host.flush()
  },[samples,tone,area,running,percent,theme,host])
  return error?<Text font={11} foregroundStyle="secondaryLabel" frame={{height:plotHeight}}>{error}</Text>:<WebView controller={host.controller} disabled frame={{minHeight:plotHeight,maxHeight:plotHeight,minWidth:0,maxWidth:'infinity'}}/>
}
