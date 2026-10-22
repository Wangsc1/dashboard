import { VStack, ZStack, Canvas, Text, WebView, useState, useEffect, useColorScheme } from 'scripting'
import { nextHomeTraceId, traceHome } from './home-trace'
import { plotCanvasHTML } from './plot-canvas'
export interface CanvasPlotProps {samples:number[];tone:string;plotHeight?:number;area?:boolean;running?:boolean;percent?:boolean;plotWidth?:number;diagnostic?:boolean}
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
export function MountedCanvasPlot({samples,tone,plotHeight=96,area=false,running=true,percent=false,diagnostic=false}:CanvasPlotProps) {
  const [error,setError]=useState('')
  // Temporary diagnostic labels do not change samples, animation or host lifetime.
  // A WebView is white until its document exists; stay transparent so the card colour shows through until the canvas has drawn.
  const [shown,setShown]=useState(false)
  const theme=useColorScheme()
  const [drawTrace,setDrawTrace]=useState({samples:0,sized:false,line:false})
  const [host]=useState(()=>({id:nextHomeTraceId(),input:0,revealed:false,trace:{samples:0,sized:false,line:false},traceKey:'',traceAt:0,controller:new WebViewController({ephemeral:true}),alive:true,ready:false,busy:false,registered:false,loaded:false,seq:0,pending:null as null|{seq:number;samples:number[];tone:string;area:boolean;running:boolean;percent:boolean;background:string},flush:()=>{}}))
  useEffect(()=>{
    host.alive=true
    let timeout:ReturnType<typeof setTimeout>|undefined,reveal:ReturnType<typeof setTimeout>|undefined
    const report=()=>{
      if(!diagnostic)return
      const key=`${host.ready}:${host.revealed}:${host.trace.sized}:${host.trace.line}`,now=Date.now()
      if(key===host.traceKey&&now-host.traceAt<30000)return
      host.traceKey=key;host.traceAt=now
      traceHome({stage:'plot-state',host:host.id,input:host.input,drawn:host.trace.samples,ready:host.ready,revealed:host.revealed,line:host.trace.line,sized:host.trace.sized})
    }
    const revealPlot=()=>{host.revealed=true;setShown(true);report()}
    report()
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
      void host.controller.loadHTML(plotCanvasHTML(initial??undefined,false,diagnostic)).then(ok=>{if(host.alive&&ok===false)fail()},fail)
    }
    void host.controller.addScriptMessageHandler('plotReady',()=>{
      if(!host.alive)return false
      if(timeout!==undefined)clearTimeout(timeout)
      host.ready=true;report();flush()
      // Normally the page reports plotPainted; the timer only guards against a lost message.
      reveal=setTimeout(()=>{if(host.alive)revealPlot()},700);return true
    }).then(()=>host.controller.addScriptMessageHandler('plotPainted',()=>{
      if(!host.alive)return false
      if(reveal!==undefined)clearTimeout(reveal)
      revealPlot();return true
    })).then(()=>diagnostic?host.controller.addScriptMessageHandler('plotTrace',(value?:{seq:number;samples:number;sized:boolean;line:boolean})=>{
      if(!host.alive||!value||!Number.isInteger(value.seq)||value.seq<0||value.seq>host.seq||!Number.isInteger(value.samples)||value.samples<0||value.samples>60||typeof value.sized!=='boolean'||typeof value.line!=='boolean')return false
      host.trace={samples:value.samples,sized:value.sized,line:value.line}
      setDrawTrace(host.trace);report();return true
    }):undefined).then(()=>{host.registered=true;start()},fail)
    start()
    return()=>{host.alive=false;host.ready=false;host.pending=null;if(timeout!==undefined)clearTimeout(timeout);if(reveal!==undefined)clearTimeout(reveal);host.controller.dispose()}
  },[host])
  useEffect(()=>{
    host.input=samples.filter(Number.isFinite).slice(-60).length
    host.pending={seq:++host.seq,samples:samples.filter(Number.isFinite).slice(-60),tone,area,running,percent,background:theme==='dark'?'#1c1c1e':'#f2f2f7'}
    host.flush()
  },[samples,tone,area,running,percent,theme,host])
  const diagnosticText=`图诊断 H${host.id} 入${samples.filter(Number.isFinite).slice(-60).length} 画${drawTrace.samples} 尺${drawTrace.sized?1:0} 线${drawTrace.line?1:0} 就绪${host.ready?1:0} 显${shown?1:0}`
  return error?<Text font={11} foregroundStyle="secondaryLabel" frame={{height:plotHeight}}>{diagnostic?`${error} · ${diagnosticText}`:error}</Text>:<ZStack alignment={diagnostic?'topLeading':undefined} frame={{minHeight:plotHeight,maxHeight:plotHeight,minWidth:0,maxWidth:'infinity'}}>{shown?null:<Canvas opaque={false} draw={drawPlotGrid} frame={{minHeight:plotHeight,maxHeight:plotHeight,minWidth:0,maxWidth:'infinity'}}/>}<WebView controller={host.controller} disabled opacity={shown?1:0} frame={{minHeight:plotHeight,maxHeight:plotHeight,minWidth:0,maxWidth:'infinity'}}/>{diagnostic?<Text font={8} foregroundStyle="secondaryLabel" background="secondarySystemBackground">{diagnosticText}</Text>:null}</ZStack>
}
