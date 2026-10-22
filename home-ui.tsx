import { HStack, VStack, Text, Image, RoundedRectangle, Spacer, ScrollView, LazyVStack, SVG, ZStack, Device, NavigationStack, modifiers, useState, useEffect, useMemo, GeometryReader, useColorScheme } from "scripting"
import { Overview, WrtInfo, fmtBytes, fmtSpeed, fmtUptime } from "./api"
import { CpuUsage, OverviewHistory } from "./openwrt-metrics"
import { CHART_HISTORY, PlotPoint, animateChart, scrollPoints, smoothPath } from "./chart"
export const HOME_BG = "systemBackground"
const INK="label",PANEL="secondarySystemBackground"
export function HomeCard({children,onOpen}:{children?:any;onOpen?:()=>void}) {
  return <VStack alignment="leading" spacing={12} foregroundStyle={INK} font={13} onTapGesture={onOpen}
    modifiers={modifiers().frame({minWidth:0,maxWidth:"infinity",alignment:"leading"}).padding(16).background(<RoundedRectangle cornerRadius={14} fill={PANEL}/>)}>{children}</VStack>
}
export function MetricNumber({value,unit="",pointSize=16,tone="label",digits=0,running=true}:{running?:boolean;value?:number;unit?:string;pointSize?:number;tone?:any;digits?:number}) {
  const target=value===undefined||!Number.isFinite(value)?"--":value.toFixed(digits)
  const [shown,setShown]=useState(target),[track]=useState({value:target,unit,at:Date.now()})
  useEffect(()=>{const end=Number(target),start=Number(track.value),now=Date.now();if(!running||target==='--'||!Number.isFinite(start)||track.unit!==unit){track.value=target;track.unit=unit;track.at=now;setShown(target);return}if(track.value===target)return
    const span=Math.max(300,Math.min(2500,now-track.at));track.at=now
    const t=setInterval(()=>{const p=Math.min(1,(Date.now()-now)/span),v=(start+(end-start)*(p*p*(3-2*p))).toFixed(digits);track.value=v;setShown(v);if(p===1)clearInterval(t)},16);return()=>clearInterval(t)
  },[target,unit,running])
  return <Text font={pointSize} fontWeight="semibold" foregroundStyle={tone} lineLimit={1} minimumScaleFactor={0.65}>{`${shown}${unit}`}</Text>
}
// One SVG, same rendering boundary as 1.5.166. The existing shared 50ms scheduler supplies
// elapsed time to LOCAL curve state only. Offscreen/paused/unmounted curves unsubscribe.
const SCREEN_W:number|undefined=(Device as any)?.screen?.width
const SIZED=typeof SCREEN_W==="number"&&SCREEN_W>112&&SCREEN_W<=600
export const PLOT_FULL_W:number|undefined=SIZED?SCREEN_W-64:undefined
export const PLOT_HALF_W:number|undefined=SIZED?(SCREEN_W-48)/2-32:undefined
export const PLOT_STROKE=1.5
export function GridPlot({samples,tone,plotHeight=96,area=false,running=true,percent=false,plotWidth,stableSamples=false}:{samples:number[];tone:string;plotHeight?:number;area?:boolean;running?:boolean;percent?:boolean;plotWidth?:number;stableSamples?:boolean}) {
  const [visible,setVisible]=useState(false)
  // Detail-only: a fresh array with identical values is not a new visual frame.
  // Keep homepage reference-based behavior unchanged. At most 60 numbers are compared.
  const sampleKey=useMemo(()=>stableSamples?samples.slice(-CHART_HISTORY).join(","):samples,[samples,stableSamples])
  const values=useMemo(()=>samples.slice(-CHART_HISTORY).filter(Number.isFinite),[sampleKey])
  const enabled=running&&visible
  const W=plotWidth!==undefined&&Number.isFinite(plotWidth)&&plotWidth>0?plotWidth:336,H=plotHeight
  const [track]=useState({previous:values,current:values,enabled,at:Date.now(),duration:1000,animating:false,
    shown:null as null|{points:PlotPoint[];scale:number;done:boolean;svg:string;tone:string;area:boolean;W:number;H:number},
    motion:null as null|{origin:PlotPoint[];from:PlotPoint[];to:PlotPoint[];scaleFrom:number;scaleTo:number}})
  const [tick,setTick]=useState(Date.now())
  // Prepare endpoints BEFORE rendering the new sample, so its first frame is progress=0,
  // never an intermediate target-frame jump before an effect runs. No state setter here.
  if(track.current!==values||track.enabled!==enabled){
    const now=Date.now(),changed=track.current!==values
    const reset=!enabled||!track.enabled||!values.length||values.length<track.current.length||(stableSamples&&!track.current.length)
    track.motion=null
    if(stableSamples&&changed&&!reset&&values.length>=2&&track.shown){
      // Retarget from the last SVG actually produced, NOT the unfinished old target.
      // At a completed window remove only the off-window outgoing knot; the visible
      // geometry is the canonical current history. During interruption keep every knot.
      const origin=track.shown.done?scrollPoints(track.current,track.current,0,W):track.shown.points
      const target=scrollPoints(values,values,0,W)
      const to=track.current.length===CHART_HISTORY&&values.length===CHART_HISTORY?[{x:-W/(CHART_HISTORY-1),value:track.current[0]},...target]:target
      const count=Math.max(origin.length,to.length)
      // At most 61 geometry knots. Repeating the right endpoint is a zero-length
      // segment, not an invented sample; this preserves shape while history grows.
      const pad=(ps:PlotPoint[])=>Array.from({length:count},(_,i)=>ps[Math.min(i,ps.length-1)])
      track.motion={origin,from:pad(origin),to:pad(to),scaleFrom:track.shown.scale,scaleTo:percent?100:Math.max(1024,...values)}
    }
    track.previous=reset?values:track.current
    track.current=values;track.enabled=enabled
    // Detail samples arrive on the existing 1s poll. Content dedupe can skip many
    // visual updates: that idle interval is NOT the duration of the next transition.
    track.duration=stableSamples?1000:Math.max(500,Math.min(1500,now-track.at||1000))
    track.at=now;track.animating=changed&&!reset&&values.length>=2
  }
  useEffect(()=>{
    // Detail p0 already renders synchronously; a same-time tick only caused an
    // extra setter/render with identical geometry. Homepage timing is unchanged.
    if(!stableSamples)setTick(Date.now())
    if(!track.animating)return
    return animateChart(at=>{setTick(at);return at<track.at+track.duration})
  },[values,enabled])
  const staticSvg=useMemo(()=>{
    const grid=[...Array.from({length:8},(_,i)=>`<path d="M ${i*W/7},0 V ${H}"/>`),...Array.from({length:5},(_,i)=>`<path d="M 0,${i*H/4} H ${W}"/>`)].join("")
    return {head:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><g stroke="#9295a3" stroke-opacity="0.22" stroke-width="0.6" stroke-dasharray="3 3" fill="none">${grid}</g>`,tail:"</svg>"}
  },[W,H])
  const scales=useMemo(()=>({from:percent?100:Math.max(1024,...track.previous),to:percent?100:Math.max(1024,...values)}),[values,track.previous,enabled,percent])
  const p=!enabled||track.current!==values?1:Math.max(0,Math.min(1,(tick-track.at)/track.duration))
  // previous retains the outgoing sample even when source history has already trimmed to 60.
  const code=useMemo(()=>{
    const current=track.current===values?track.current:values,previous=track.current===values?track.previous:values
    const motion=stableSamples?track.motion:null
    // An interrupted retarget p0 is exactly the already-produced frame. Reuse
    // its SVG, rather than rebuilding the exact same path string again.
    if(motion&&p===0&&track.shown?.points===motion.origin&&track.shown.tone===tone&&track.shown.area===area&&track.shown.W===W&&track.shown.H===H)return track.shown.svg
    const points=motion?(p===0?motion.origin:motion.from.map((a,i)=>({x:a.x+(motion.to[i].x-a.x)*p,value:a.value+(motion.to[i].value-a.value)*p}))):scrollPoints(previous,current,p,W)
    const scale=motion?motion.scaleFrom+(motion.scaleTo-motion.scaleFrom)*p:scales.from+(scales.to-scales.from)*p
    const line=values.length<2?"":smoothPath(points,H,scale,2),first=points[0],last=points[points.length-1]
    const fill=area&&line&&first&&last?`<path d="${line} L ${last.x},${H} L ${first.x},${H} Z" fill="${tone}" fill-opacity="0.10"/>`:""
    const stroke=line?`<path d="${line}" fill="none" stroke="${tone}" stroke-width="${PLOT_STROKE}" stroke-linecap="round"/>`:""
    const svg=staticSvg.head+fill+stroke+staticSvg.tail
    if(stableSamples)track.shown={points,scale,done:p===1||!track.animating,svg,tone,area,W,H}
    return svg
  },[values,track.previous,track.current,p,staticSvg,tone,area,scales])
  return <SVG code={code} resizable frame={plotWidth!==undefined?{width:W,height:H}:{height:H}} onAppear={()=>setVisible(true)} onDisappear={()=>setVisible(false)}/>
}
export function CpuBreakdown({cpu,running}:{cpu?:CpuUsage;running:boolean}) {
  return <HStack spacing={0} alignment="bottom"><HStack spacing={22}>{([['SYS',cpu?.system],['USER',cpu?.user],['STEAL',cpu?.steal]] as const).map(([title,value])=><VStack key={title} alignment="leading" spacing={3}><Text font={10} fontWeight="semibold" foregroundStyle="secondaryLabel" lineLimit={1}>{title}</Text><MetricNumber value={value} digits={1} pointSize={14} running={running}/></VStack>)}</HStack><Spacer/><HStack alignment="lastTextBaseline" spacing={2}><MetricNumber running={running} value={cpu?.usage} digits={1} pointSize={22} tone="#3485eb"/><Text font={11} foregroundStyle="#3485eb">%</Text></HStack></HStack>
}
export function CpuCard({w,history,running,onOpen,detail=false}:{w?:WrtInfo;history:number[];running:boolean;onOpen?:()=>void;detail?:boolean}) {
  return <HomeCard onOpen={onOpen}><HStack><Text font={detail?15:16} fontWeight="semibold">{detail?w?.cpuModel||"CPU 型号未提供":"CPU"}</Text><Spacer/>{!detail?<Text font={11} foregroundStyle="#3485eb" padding={{horizontal:8,vertical:4}} background={<RoundedRectangle cornerRadius={8} fill={{light:"#edf5ff",dark:"#24374d"}}/>}>{w?.temperature===undefined?"-- °C":`${w.temperature.toFixed(1)} °C`}</Text>:null}</HStack><GridPlot samples={history} tone="#3485eb" percent running={running} plotWidth={PLOT_FULL_W} stableSamples={detail}/><CpuBreakdown cpu={w?.cpus?.find(c=>c.id==='cpu')} running={running&&!detail}/></HomeCard>
}
export function TrafficCard({heading,rate,total,history,tone,running}:{heading:string;rate?:number;total?:number;history:number[];tone:string;running:boolean}) {
  const parts=rate===undefined?undefined:fmtSpeed(rate).split(' '),value=parts?Number(parts[0]):undefined,unit=parts?" "+parts.slice(1).join(' '):""
  return <HomeCard><HStack spacing={3}><Text font={16} fontWeight="semibold">{heading}</Text><Spacer/><MetricNumber running={false} value={value} unit={unit} pointSize={14} tone={tone} digits={value!==undefined&&value<100?1:0}/></HStack><GridPlot samples={history} tone={tone} plotHeight={66} area running={running} plotWidth={PLOT_HALF_W}/><Text font={12} foregroundStyle="secondaryLabel">{`已用 ${total===undefined?'--':fmtBytes(total)}`}</Text></HomeCard>
}
// Deterministic bars: no GeometryReader. Equal flexible-width bars, one fixed 24pt row height.
const BAR_ROW={minWidth:0,maxWidth:"infinity" as const,minHeight:24,maxHeight:24}
const BAR_CELL={minWidth:0,maxWidth:"infinity" as const,minHeight:24,maxHeight:24}
export function CapacityBars({fraction,tone}:{fraction?:number;tone:string}) {
  const n=fraction===undefined?0:Math.round(Math.max(0,Math.min(1,fraction))*24)
  return <HStack spacing={2} frame={BAR_ROW}>{Array.from({length:24},(_,i)=><RoundedRectangle key={String(i)} cornerRadius={1.75} fill={{color:tone,opacity:i<n?0.85:0.12}} frame={BAR_CELL}/>)}</HStack>
}
export const LOAD_TONES={light:["#17965b","#c16b13","#287ed6"],dark:["#39d98a","#ffaf40","#56b5ff"]}
// GeometryReader (proven to render on device in 1.5.164) wrapped in ONE fixed 24pt-high container so
// the row height is deterministic and the footer sits below it (card spacing 12).
export function LoadBars({fraction,tone}:{fraction?:number;tone:string}) {
  const known=fraction!==undefined&&Number.isFinite(fraction)&&fraction>=0
  const height=known?24*Math.min(1,fraction):0
  return <ZStack alignment="top" frame={{height:24}}><GeometryReader>{geometry=>{
    const W=Math.max(0,geometry.size.width),gap=W*2.5/144,bar=Math.max(0,(W-23*gap)/24)
    return <HStack spacing={gap} frame={{width:W,height:24}}>{Array.from({length:24},(_,i)=><ZStack key={String(i)} alignment="bottom" frame={{width:bar,height:24}}>
      <RoundedRectangle cornerRadius={Math.min(1.75,bar/2)} fill={{color:tone,opacity:0.12}} frame={{width:bar,height:24}}/>
      {height>0?<RoundedRectangle cornerRadius={Math.min(1.75,bar/2,height/2)} fill={tone} frame={{width:bar,height}}/>:null}
    </ZStack>)}</HStack>
  }}</GeometryReader></ZStack>
}
// Intrinsic content sets the row height; its background paints equal-height cards.
// Neither the card nor the row asks for an infinite height proposal.
export function CompactMetricCard({heading,trailing,bars,footer}:{heading:string;trailing?:any;bars:any;footer:any}) {
  return <VStack alignment="leading" spacing={12} foregroundStyle={INK} font={13}
    modifiers={modifiers().frame({minWidth:0,maxWidth:"infinity",alignment:"leading"}).padding(16)}><HStack spacing={4}><Text font={16} fontWeight="semibold">{heading}</Text><Spacer/>{trailing}</HStack>{bars}{footer}</VStack>
}
export function MetricFooterValue({value,caption,valueEdge="center"}:{value:string;caption:string;valueEdge?:"leading"|"center"|"trailing"}) {
  return <VStack alignment={valueEdge} spacing={3} frame={{minWidth:0,maxWidth:"infinity",alignment:valueEdge}} fixedSize={{horizontal:false,vertical:true}}>
    <Text font={12} multilineTextAlignment={valueEdge==='leading'?'leading':valueEdge==='trailing'?'trailing':'center'}>{value}</Text>
    <Text font={10} foregroundStyle="secondaryLabel">{caption}</Text>
  </VStack>
}
export function RamCard({w,running=true}:{w?:WrtInfo;running?:boolean}) {
  const total=w?.memTotal&&w.memTotal>0?w.memTotal:undefined,used=total===undefined||w?.memFree===undefined?undefined:Math.max(0,total-w.memFree),fraction=total&&used!==undefined?used/total:undefined
  return <CompactMetricCard heading="Ram" trailing={<MetricNumber running={running} value={fraction===undefined?undefined:fraction*100} unit="%" tone="#a179d1"/>}
    bars={<CapacityBars fraction={fraction} tone="#a179d1"/>}
    footer={<HStack spacing={8} alignment="top"><MetricFooterValue value={used===undefined?'--':fmtBytes(used)} caption="已用" valueEdge="leading"/><MetricFooterValue value={total===undefined?'--':fmtBytes(total)} caption="总计" valueEdge="trailing"/></HStack>}/>
}
export function LoadCard({w}:{w?:WrtInfo}) {
  const cores=w?.cpus?.filter(c=>c.id!=='cpu').length
  const values=[0,1,2].map(i=>w?.load[i]),tones=LOAD_TONES[useColorScheme()]
  return <CompactMetricCard heading="负载"
    bars={<HStack spacing={8}>{values.map((value,i)=><LoadBars key={String(i)} fraction={cores&&value!==undefined?value/cores:undefined} tone={tones[i]}/>)}</HStack>}
    footer={<HStack spacing={8} alignment="top">{values.map((value,i)=><MetricFooterValue key={String(i)} value={value===undefined||!Number.isFinite(value)?'--':value.toFixed(2)} caption={`${[1,5,15][i]}分钟`}/>)}</HStack>}/>
}
export function DiskCapacityBar({used,size}:{used?:number;size?:number}) {
  const known=size!==undefined&&Number.isFinite(size)&&size>0&&used!==undefined&&Number.isFinite(used)&&used>=0
  const fraction=known?Math.min(1,used/size):undefined
  return <GeometryReader modifiers={modifiers().frame({height:8}).frame({minWidth:0,maxWidth:"infinity"})}>{geometry=>{
    const W=Math.max(1,geometry.size.width),fill=fraction===undefined?undefined:W*fraction
    return <ZStack alignment="leading" frame={{width:W,height:8}}>
      <RoundedRectangle cornerRadius={4} fill={{color:"#859de0",opacity:0.12}} frame={{width:W,height:8}}/>
      {fill===undefined?null:<RoundedRectangle cornerRadius={Math.min(4,fill/2)} fill="#859de0" frame={{width:fill,height:8}}/>}
    </ZStack>
  }}</GeometryReader>
}
export function DiskCard({w}:{w?:WrtInfo}) {
  const d=w?.disk
  return <HomeCard><HStack><Text font={16} fontWeight="semibold">磁盘</Text><Spacer/><Text font={12} foregroundStyle="secondaryLabel">{d?fmtBytes(d.size):'容量未提供'}</Text></HStack>{d?<><HStack spacing={8}><Image systemName="internaldrive" foregroundStyle="#8593ad"/><VStack alignment="leading" spacing={3}><Text font={13}>{d.device||'文件系统'}</Text><Text font={11} foregroundStyle="secondaryLabel">{`挂载点 ${d.mount||'--'}`}</Text></VStack><Spacer/></HStack><DiskCapacityBar used={d.used} size={d.size}/><HStack><Text font={12}>{`已用 ${fmtBytes(d.used)}`}</Text><Spacer/><Text font={12} foregroundStyle="secondaryLabel">{`可用 ${fmtBytes(d.avail)}`}</Text></HStack></>:<Text font={12} foregroundStyle="secondaryLabel">LuCI未提供挂载点容量，或当前账号无只读权限。</Text>}</HomeCard>
}
export function HomeDashboard({overview,histories,running,onCpu}:{overview:Overview|null;histories:OverviewHistory;running:boolean;onCpu:()=>void}) {
  const w=overview?.wrt
  return <VStack spacing={16}><CpuCard w={w} history={histories.cpu.cpu??[]} running={running} onOpen={onCpu}/><HStack spacing={16} alignment="top"><TrafficCard heading="上传" rate={overview?.traffic.up} total={overview?.upTotal} history={histories.up} tone="#2dbf82" running={running}/><TrafficCard heading="下载" rate={overview?.traffic.down} total={overview?.downTotal} history={histories.down} tone="#27b1cf" running={running}/></HStack><HStack spacing={16} alignment="top" background={<HStack spacing={16}><RoundedRectangle cornerRadius={14} fill={PANEL} frame={{minWidth:0,maxWidth:"infinity"}}/><RoundedRectangle cornerRadius={14} fill={PANEL} frame={{minWidth:0,maxWidth:"infinity"}}/></HStack>}><RamCard w={w} running={running}/><LoadCard w={w}/></HStack><DiskCard w={w}/></VStack>
}
export function CpuDetails({overview,histories,running}:{overview:Overview|null;histories:OverviewHistory;running:boolean}) {
  // onAppear includes lazy prefetch. Only the native viewport id set gates interpolation.
  // null retains the old appearance fallback on hosts without this iOS18+/Scripting3.1 API.
  const [visibleIds,setVisibleIds]=useState<string[]|null>(null)
  const visibility=useMemo(()=>({idType:"string" as const,threshold:0.1,onChanged:(ids:string[]|number[])=>{
    const next=(ids as string[]).slice().sort()
    setVisibleIds(old=>old!==null&&old.length===next.length&&old.every((id,i)=>id===next[i])?old:next)
  }}),[])
  const live=(id:string)=>running&&(visibleIds===null||visibleIds.includes(id))
  const w=overview?.wrt,cores=w?.cpus?.filter(x=>x.id!=='cpu')??[],rows=Array.from({length:Math.ceil(cores.length/2)},(_,i)=>cores.slice(i*2,i*2+2))
  const info=[['Uptime',w?fmtUptime(w.uptime,true):'--'],['Arch',w?.arch||'--'],['Cpu',cores.length?String(cores.length):'--'],['Kernel',w?.kernel||'--'],['Board',w?.model||'--']]
  return <NavigationStack presentationDetents={['large']} presentationDragIndicator="visible" presentationContentInteraction="scrolls"><ScrollView navigationTitle="CPU" navigationBarTitleDisplayMode="inline" background={HOME_BG} onScrollTargetVisibilityChange={visibility}><LazyVStack scrollTargetLayout spacing={16} padding={{horizontal:16,top:12,bottom:24}}><HomeCard><Text font={15} fontWeight="semibold">{w?.release||'系统版本未提供'}</Text><VStack spacing={5}>{info.map(([title,value])=><HStack key={title}><Text font={12} foregroundStyle="label">{title}</Text><Spacer/><Text font={12} foregroundStyle="label" multilineTextAlignment="trailing">{value}</Text></HStack>)}</VStack></HomeCard><DetailCpuSummary key="summary" w={w} history={histories.cpu.cpu??[]} running={live("summary")}/>{rows.map(row=><CoreRow key={`core-${row[0].id}`} cpus={row} w={w} histories={histories} running={live(`core-${row[0].id}`)}/>)}{!cores.length?<Text font={12} foregroundStyle="secondaryLabel">/proc/stat未提供逻辑核数据或当前账号无读取权限。</Text>:null}</LazyVStack></ScrollView></NavigationStack>
}
// No whole-card/element snapshots: metadata and numeric values always use latest inputs.
// Each GridPlot independently controls its animation subscription through SVG visibility.
export function CoreRow({cpus,w,histories,running}:{cpus:CpuUsage[];w?:WrtInfo;histories:OverviewHistory;running:boolean}) {
  return <HStack key={`core-${cpus[0]?.id}`} spacing={16} alignment="top">{cpus.map(c=><CoreCard key={c.id} cpu={c} w={w} history={histories.cpu[c.id]??[]} running={running}/>)}{cpus.length===1?<Spacer frame={{minWidth:0,maxWidth:'infinity'}}/>:null}</HStack>
}
// Per-core plots share GridPlot and the single scheduler; no per-core timer.
export function SampledCpuPlot({samples,running=false}:{samples:number[];running?:boolean}) {
  return <GridPlot samples={samples} tone="#2dbf82" percent plotHeight={76} running={running} plotWidth={PLOT_HALF_W} stableSamples/>
}
export function DetailCpuSummary({w,history,running}:{w?:WrtInfo;history:number[];running:boolean}) {
  const [visible,setVisible]=useState(false)
  return <VStack key="summary" onAppear={()=>setVisible(true)} onDisappear={()=>setVisible(false)}><CpuCard w={w} history={history} running={running&&visible} detail/></VStack>
}
export function CoreCard({cpu,w,history,running}:{cpu:CpuUsage;w?:WrtInfo;history:number[];running:boolean}) {
  const meta=w?.cpuMeta?.[cpu.id]
  return <HomeCard><HStack><Text font={12} foregroundStyle="secondaryLabel">{cpu.id.toUpperCase()}</Text><Spacer/><Text font={17} fontWeight="semibold" foregroundStyle="#2dbf82" lineLimit={1} minimumScaleFactor={0.65}>{cpu.usage===undefined?"--%":`${cpu.usage.toFixed(1)}%`}</Text></HStack><SampledCpuPlot samples={history} running={running}/><HStack spacing={5}><VStack alignment="leading" spacing={3}><Text font={9} fontWeight="semibold" foregroundStyle="secondaryLabel">频率</Text><Text font={11} fontWeight="semibold">{meta?.mhz===undefined?'-- MHz':`${meta.mhz.toFixed(0)} MHz`}</Text></VStack><Spacer/><VStack alignment="trailing" spacing={3}><Text font={9} fontWeight="semibold" foregroundStyle="secondaryLabel">缓存大小</Text><Text font={11} fontWeight="semibold">{meta?.cacheKB===undefined?'-- KB':`${meta.cacheKB} KB`}</Text></VStack></HStack></HomeCard>
}
