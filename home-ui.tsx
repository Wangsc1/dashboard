import { HStack, VStack, Text, Image, RoundedRectangle, Spacer, ScrollView, LazyVStack, SVG, ZStack, NavigationStack, modifiers, useState, useEffect, useMemo, GeometryReader, useColorScheme } from "scripting"
import { Overview, WrtInfo, fmtBytes, fmtSpeed, fmtUptime } from "./api"
import { CpuUsage, OverviewHistory } from "./openwrt-metrics"
import { CHART_HISTORY, scrollPoints, smoothPath } from "./chart"
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
// Non-Charts plot, same SVG approach that displayed on the device through 1.5.161. One string,
// rebuilt only when a new sample arrives (no timers, no per-frame setState). The newest sample is
// always at the right of a fixed 60-point window; short history grows from the right, no fake zeros.
// Smoothness limit: updates step once per sample (1 s) instead of sliding every frame.
export function GridPlot({samples,tone,plotHeight=96,area=false,percent=false}:{samples:number[];tone:string;plotHeight?:number;area?:boolean;running?:boolean;percent?:boolean}) {
  const W=336,H=plotHeight,values=samples.slice(-CHART_HISTORY).filter(Number.isFinite),scale=percent?100:Math.max(1024,...values)
  const points=scrollPoints(values,values,0,W),line=values.length<2?"":smoothPath(points,H,scale,2),first=points[0],last=points[points.length-1]
  const grid=[...Array.from({length:8},(_,i)=>`<path d="M ${i*W/7},0 V ${H}"/>`),...Array.from({length:5},(_,i)=>`<path d="M 0,${i*H/4} H ${W}"/>`)].join("")
  const fill=area&&line&&first&&last?`<path d="${line} L ${last.x},${H} L ${first.x},${H} Z" fill="${tone}" fill-opacity="0.10"/>`:""
  const code=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><g stroke="#9295a3" stroke-opacity="0.22" stroke-width="0.6" stroke-dasharray="3 3" fill="none">${grid}</g>${fill}${line?`<path d="${line}" fill="none" stroke="${tone}" stroke-width="1.5" stroke-linecap="round"/>`:""}</svg>`
  return <SVG code={code} resizable frame={{maxWidth:"infinity",height:plotHeight}}/>
}
export function CpuBreakdown({cpu,running}:{cpu?:CpuUsage;running:boolean}) {
  return <HStack spacing={0} alignment="bottom"><HStack spacing={22}>{([['SYS',cpu?.system],['USER',cpu?.user],['STEAL',cpu?.steal]] as const).map(([title,value])=><VStack key={title} alignment="leading" spacing={3}><Text font={10} fontWeight="semibold" foregroundStyle="secondaryLabel" lineLimit={1}>{title}</Text><MetricNumber value={value} digits={1} pointSize={14} running={running}/></VStack>)}</HStack><Spacer/><HStack alignment="lastTextBaseline" spacing={2}><MetricNumber running={running} value={cpu?.usage} digits={1} pointSize={22} tone="#3485eb"/><Text font={11} foregroundStyle="#3485eb">%</Text></HStack></HStack>
}
export function CpuCard({w,history,running,onOpen,detail=false}:{w?:WrtInfo;history:number[];running:boolean;onOpen?:()=>void;detail?:boolean}) {
  return <HomeCard onOpen={onOpen}><HStack><Text font={detail?15:16} fontWeight="semibold">{detail?w?.cpuModel||"CPU 型号未提供":"CPU"}</Text><Spacer/>{!detail?<Text font={11} foregroundStyle="#3485eb" padding={{horizontal:8,vertical:4}} background={<RoundedRectangle cornerRadius={8} fill={{light:"#edf5ff",dark:"#24374d"}}/>}>{w?.temperature===undefined?"-- °C":`${w.temperature.toFixed(1)} °C`}</Text>:null}</HStack><GridPlot samples={history} tone="#3485eb" percent running={running}/><CpuBreakdown cpu={w?.cpus?.find(c=>c.id==='cpu')} running={running&&!detail}/></HomeCard>
}
export function TrafficCard({heading,rate,total,history,tone,running}:{heading:string;rate?:number;total?:number;history:number[];tone:string;running:boolean}) {
  const parts=rate===undefined?undefined:fmtSpeed(rate).split(' '),value=parts?Number(parts[0]):undefined,unit=parts?" "+parts.slice(1).join(' '):""
  return <HomeCard><HStack spacing={3}><Text font={16} fontWeight="semibold">{heading}</Text><Spacer/><MetricNumber running={running} value={value} unit={unit} pointSize={14} tone={tone} digits={value!==undefined&&value<100?1:0}/></HStack><GridPlot samples={history} tone={tone} plotHeight={66} area running={running}/><Text font={12} foregroundStyle="secondaryLabel">{`已用 ${total===undefined?'--':fmtBytes(total)}`}</Text></HomeCard>
}
// Deterministic bars: no GeometryReader. Equal flexible-width bars, one fixed 24pt row height.
const BAR_ROW={minWidth:0,maxWidth:"infinity" as const,minHeight:24,maxHeight:24}
const BAR_CELL={minWidth:0,maxWidth:"infinity" as const,minHeight:24,maxHeight:24}
export function CapacityBars({fraction,tone}:{fraction?:number;tone:string}) {
  const n=fraction===undefined?0:Math.round(Math.max(0,Math.min(1,fraction))*24)
  return <HStack spacing={2} frame={BAR_ROW}>{Array.from({length:24},(_,i)=><RoundedRectangle key={String(i)} cornerRadius={1.75} fill={{color:tone,opacity:i<n?0.85:0.12}} frame={BAR_CELL}/>)}</HStack>
}
export const LOAD_TONES={light:["#17965b","#c16b13","#287ed6"],dark:["#39d98a","#ffaf40","#56b5ff"]}
// Same structure as the working RAM bars: plain rounded rectangles in one HStack. Each cell is a
// VStack of at most two fixed-height rectangles (empty track above, filled part below).
export function LoadBars({fraction,tone}:{fraction?:number;tone:string}) {
  const known=fraction!==undefined&&Number.isFinite(fraction)&&fraction>=0
  const fill=known?Math.min(24,24*Math.min(1,fraction)):0,rest=24-fill
  const rect=(opacity:number,size:number,key:string)=><RoundedRectangle key={key} cornerRadius={1.75} fill={{color:tone,opacity}} frame={{minWidth:0,maxWidth:"infinity",minHeight:size,maxHeight:size}}/>
  return <HStack spacing={2} frame={BAR_ROW}>{Array.from({length:24},(_,i)=><VStack key={String(i)} spacing={0} frame={BAR_CELL}>{rest>0?rect(0.12,rest,"t"):null}{fill>0?rect(0.85,fill,"f"):null}</VStack>)}</HStack>
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
  const w=overview?.wrt,cores=w?.cpus?.filter(x=>x.id!=='cpu')??[],rows=Array.from({length:Math.ceil(cores.length/2)},(_,i)=>cores.slice(i*2,i*2+2))
  const info=[['Uptime',w?fmtUptime(w.uptime,true):'--'],['Arch',w?.arch||'--'],['Cpu',cores.length?String(cores.length):'--'],['Kernel',w?.kernel||'--'],['Board',w?.model||'--']]
  return <NavigationStack presentationDetents={['large']} presentationDragIndicator="visible" presentationContentInteraction="scrolls"><ScrollView navigationTitle="CPU" navigationBarTitleDisplayMode="inline" background={HOME_BG}><LazyVStack spacing={16} padding={{horizontal:16,top:12,bottom:24}}><HomeCard><Text font={15} fontWeight="semibold">{w?.release||'系统版本未提供'}</Text><VStack spacing={5}>{info.map(([title,value])=><HStack key={title}><Text font={12} foregroundStyle="label">{title}</Text><Spacer/><Text font={12} foregroundStyle="label" multilineTextAlignment="trailing">{value}</Text></HStack>)}</VStack></HomeCard><DetailCpuSummary w={w} history={histories.cpu.cpu??[]} running={running}/>{rows.map((row,i)=><HStack key={String(i)} spacing={16} alignment="top">{row.map(c=><CoreCard key={c.id} cpu={c} w={w} history={histories.cpu[c.id]??[]} running={running}/>)}{row.length===1?<Spacer frame={{minWidth:0,maxWidth:'infinity'}}/>:null}</HStack>)}{!cores.length?<Text font={12} foregroundStyle="secondaryLabel">/proc/stat未提供逻辑核数据或当前账号无读取权限。</Text>:null}</LazyVStack></ScrollView></NavigationStack>
}
// Per-core plots use the same SVG GridPlot (no timers).
export function SampledCpuPlot({samples}:{samples:number[]}) {
  return <GridPlot samples={samples} tone="#2dbf82" percent plotHeight={76} running={false}/>
}
export function DetailCpuSummary({w,history,running}:{w?:WrtInfo;history:number[];running:boolean}) {
  const [visible,setVisible]=useState(false)
  return <VStack onAppear={()=>setVisible(true)} onDisappear={()=>setVisible(false)}><CpuCard w={w} history={history} running={running&&visible} detail/></VStack>
}
export function CoreCard({cpu,w,history,running}:{cpu:CpuUsage;w?:WrtInfo;history:number[];running:boolean}) {
  const meta=w?.cpuMeta?.[cpu.id]
  return <HomeCard><HStack><Text font={12} foregroundStyle="secondaryLabel">{cpu.id.toUpperCase()}</Text><Spacer/><Text font={17} fontWeight="semibold" foregroundStyle="#2dbf82" lineLimit={1} minimumScaleFactor={0.65}>{cpu.usage===undefined?"--%":`${cpu.usage.toFixed(1)}%`}</Text></HStack><SampledCpuPlot samples={history}/><HStack spacing={5}><VStack alignment="leading" spacing={3}><Text font={9} fontWeight="semibold" foregroundStyle="secondaryLabel">频率</Text><Text font={11} fontWeight="semibold">{meta?.mhz===undefined?'-- MHz':`${meta.mhz.toFixed(0)} MHz`}</Text></VStack><Spacer/><VStack alignment="trailing" spacing={3}><Text font={9} fontWeight="semibold" foregroundStyle="secondaryLabel">缓存大小</Text><Text font={11} fontWeight="semibold">{meta?.cacheKB===undefined?'-- KB':`${meta.cacheKB} KB`}</Text></VStack></HStack></HomeCard>
}
