import { PlotRole, sheetLifecycle } from "./cadence-diagnostics"
import { Button, Navigation, HStack, VStack, Text, Image, RoundedRectangle, Spacer, ScrollView, ZStack, Device, NavigationStack, modifiers, useState, useEffect, useMemo, GeometryReader, useColorScheme } from "scripting"
import { Overview, WrtInfo, fmtBytes, fmtSpeed, fmtUptime } from "./api"
import { CpuUsage, OverviewHistory } from "./openwrt-metrics"
import { InlineCanvasPlot } from "./plot-view"
export const HOME_BG = "systemBackground"
const INK="label",PANEL="secondarySystemBackground"
export function HomeCard({children,onOpen}:{children?:any;onOpen?:()=>void}) {
  const shell=modifiers().frame({minWidth:0,maxWidth:"infinity",alignment:"leading"}).padding(16).background(<RoundedRectangle cornerRadius={14} fill={PANEL}/>)
  // Native hit plane ABOVE the WebView, sized after card padding/background.
  // A clear fill plus explicit contentShape includes chart, numbers and empty space.
  // Only tappable cards get this plane; a tap recognizer does not add a drag handler.
  return <VStack alignment="leading" spacing={12} foregroundStyle={INK} font={13}
    modifiers={onOpen?shell.overlay(<RoundedRectangle cornerRadius={14} fill="clear" contentShape="rect" onTapGesture={onOpen}/>):shell}>{children}</VStack>
}
export function MetricNumber({value,unit="",pointSize=16,tone="label",digits=0,running=true}:{running?:boolean;value?:number;unit?:string;pointSize?:number;tone?:any;digits?:number}) {
  const shown=value===undefined||!Number.isFinite(value)?"--":value.toFixed(digits)
  return <Text font={pointSize} fontWeight="semibold" foregroundStyle={tone} lineLimit={1} minimumScaleFactor={0.65}>{`${shown}${unit}`}</Text>
}
// Both pages use the same inline Canvas runtime; only samples cross the native bridge.
const SCREEN_W:number|undefined=(Device as any)?.screen?.width
const SIZED=typeof SCREEN_W==="number"&&SCREEN_W>112&&SCREEN_W<=600
export const PLOT_FULL_W:number|undefined=SIZED?SCREEN_W-64:undefined
export const PLOT_HALF_W:number|undefined=SIZED?(SCREEN_W-48)/2-32:undefined
export const PLOT_STROKE=1.5
export function GridPlot(props:{samples:number[];tone:string;plotHeight?:number;area?:boolean;running?:boolean;percent?:boolean;plotWidth?:number;elevated?:boolean;role?:PlotRole;sheetTrace?:number}) {
  return <InlineCanvasPlot {...props}/>
}
export function CpuBreakdown({cpu,running}:{cpu?:CpuUsage;running:boolean}) {
  return <HStack spacing={0} alignment="bottom"><HStack spacing={22}>{([['SYS',cpu?.system],['USER',cpu?.user],['STEAL',cpu?.steal]] as const).map(([title,value])=><VStack key={title} alignment="leading" spacing={3}><Text font={10} fontWeight="semibold" foregroundStyle="secondaryLabel" lineLimit={1}>{title}</Text><MetricNumber value={value} digits={1} pointSize={14} running={running}/></VStack>)}</HStack><Spacer/><HStack alignment="lastTextBaseline" spacing={2}><MetricNumber running={running} value={cpu?.usage} digits={1} pointSize={22} tone="#3485eb"/><Text font={11} foregroundStyle="#3485eb">%</Text></HStack></HStack>
}
export function CpuCard({w,history,running,onOpen,detail=false,sheetTrace}:{w?:WrtInfo;history:number[];running:boolean;onOpen?:()=>void;detail?:boolean;sheetTrace?:number}) {
  return <HomeCard onOpen={onOpen}><HStack><Text font={detail?15:16} fontWeight="semibold">{detail?w?.cpuModel||"CPU 型号未提供":"CPU"}</Text><Spacer/>{!detail?<Text font={11} fontWeight="bold" foregroundStyle="#3485eb" padding={{horizontal:8,vertical:4}} background={<RoundedRectangle cornerRadius={8} fill={{light:"#d6e8ff",dark:"#24374d"}}/>}>{w?.temperature===undefined?"-- °C":`${w.temperature.toFixed(1)} °C`}</Text>:null}</HStack><GridPlot samples={history} tone="#3485eb" percent running={running} plotWidth={PLOT_FULL_W} elevated={detail} role={detail?"detail":"home"} sheetTrace={sheetTrace}/><CpuBreakdown cpu={w?.cpus?.find(c=>c.id==='cpu')} running={running&&!detail}/></HomeCard>
}
export function TrafficCard({heading,rate,total,history,tone,running}:{heading:string;rate?:number;total?:number;history:number[];tone:string;running:boolean}) {
  const parts=rate===undefined?undefined:fmtSpeed(rate).split(' '),value=parts?Number(parts[0]):undefined,unit=parts?" "+parts.slice(1).join(' '):""
  return <HomeCard><HStack spacing={3}><Text font={16} fontWeight="semibold">{heading}</Text><Spacer/><MetricNumber running={false} value={value} unit={unit} pointSize={14} tone={tone} digits={value!==undefined&&value<100?1:0}/></HStack><GridPlot samples={history} tone={tone} plotHeight={66} area running={running} plotWidth={PLOT_HALF_W} role="home"/><Text font={12} foregroundStyle="secondaryLabel">{`已用 ${total===undefined?'--':fmtBytes(total)}`}</Text></HomeCard>
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
  return <GeometryReader modifiers={modifiers().frame({height:10}).frame({minWidth:0,maxWidth:"infinity"})}>{geometry=>{
    const W=Math.max(1,geometry.size.width),count=50,gap=Math.min(2,W/(count*2)),cell=(W-gap*(count-1))/count,tone="#00bdc8"
    return <HStack spacing={gap} frame={{width:W,height:10}}>{Array.from({length:count},(_,i)=>{
      // A fractional final segment preserves the actual ratio instead of rounding up.
      const fill=fraction===undefined?0:cell*Math.max(0,Math.min(1,fraction*count-i))
      return <ZStack key={String(i)} alignment="leading" frame={{width:cell,height:10}}>
        <RoundedRectangle cornerRadius={Math.min(2,cell/2)} fill={{color:tone,opacity:0.12}} frame={{width:cell,height:10}}/>
        {fill>0?<RoundedRectangle cornerRadius={Math.min(2,fill/2)} fill={tone} frame={{width:fill,height:10}}/>:null}
      </ZStack>
    })}</HStack>
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
// A stable sheet owner receives samples through a local subscription. The presentation
// content itself never changes identity on each poll; only this mounted body updates.
export interface CpuDetailFrame { overview:Overview|null; histories:OverviewHistory; running:boolean }
export interface CpuDetailFeed { value:CpuDetailFrame; subscribe(fn:(value:CpuDetailFrame,old:CpuDetailFrame)=>void):void; unsubscribe(fn:(value:CpuDetailFrame,old:CpuDetailFrame)=>void):void }
// Plain per-owner feed: only the explicit LiveCpuDetails subscription updates UI.
// Reference equality and synchronous listener snapshots match the existing feed contract.
export function createCpuDetailFeed(initial:CpuDetailFrame):CpuDetailFeed & {setValue(value:CpuDetailFrame):void} {
  const listeners=new Set<(value:CpuDetailFrame,old:CpuDetailFrame)=>void>()
  return {
    value:initial,
    setValue(value){const old=this.value;this.value=value;if(value!==old)for(const fn of [...listeners])fn(value,old)},
    subscribe(fn){listeners.add(fn)},
    unsubscribe(fn){listeners.delete(fn)},
  }
}
export function LiveCpuDetails({feed,trace}:{feed:CpuDetailFeed;trace?:number}) {
  const [frame,setFrame]=useState(()=>{sheetLifecycle("content-create",trace);return feed.value})
  useEffect(()=>{
    sheetLifecycle("content-mount",trace)
    const changed=(value:CpuDetailFrame)=>setFrame(value)
    feed.subscribe(changed);setFrame(feed.value)
    return()=>{sheetLifecycle("content-dispose",trace);feed.unsubscribe(changed)}
  },[feed,trace])
  useEffect(()=>{sheetLifecycle(frame.running?"running":"paused",trace)},[frame.running,trace])
  return <CpuDetails trace={trace} overview={frame.overview} histories={frame.histories} running={frame.running}/>
}
export function CpuDetails({overview,histories,running,trace}:{overview:Overview|null;histories:OverviewHistory;running:boolean;trace?:number}) {
  const dismiss=Navigation.useDismiss()
  const w=overview?.wrt,cores=w?.cpus?.filter(x=>x.id!=='cpu')??[],rows=Array.from({length:Math.ceil(cores.length/2)},(_,i)=>cores.slice(i*2,i*2+2))
  const info=[['Uptime',w?fmtUptime(w.uptime,true):'--'],['Arch',w?.arch||'--'],['Cpu',cores.length?String(cores.length):'--'],['Kernel',w?.kernel||'--'],['Board',w?.model||'--']]
  return <NavigationStack onAppear={()=>sheetLifecycle("appear",trace)} onDisappear={()=>sheetLifecycle("disappear",trace)} presentationDetents={['large']} presentationDragIndicator="visible" presentationContentInteraction="scrolls"><ScrollView navigationTitle="CPU" navigationBarTitleDisplayMode="inline" background={HOME_BG} toolbar={{topBarLeading:<Button title="" systemImage="xmark" accessibilityLabel="关闭CPU详情" action={dismiss}/>}}><VStack spacing={16} padding={{horizontal:16,top:12,bottom:24}}><HomeCard><Text font={15} fontWeight="semibold">{w?.release||'系统版本未提供'}</Text><VStack spacing={5}>{info.map(([title,value])=><HStack key={title}><Text font={12} foregroundStyle="label">{title}</Text><Spacer/><Text font={12} foregroundStyle="label" multilineTextAlignment="trailing">{value}</Text></HStack>)}</VStack></HomeCard><DetailCpuSummary key="summary" sheetTrace={trace} w={w} history={histories.cpu.cpu??[]} running={running}/>{rows.map(row=><CoreRow key={`core-${row[0].id}`} sheetTrace={trace} cpus={row} w={w} histories={histories} running={running}/>)}{!cores.length?<Text font={12} foregroundStyle="secondaryLabel">/proc/stat未提供逻辑核数据或当前账号无读取权限。</Text>:null}</VStack></ScrollView></NavigationStack>
}
// No whole-card/element snapshots: metadata and numeric values always use latest inputs.
// Each shared plot creates its browser layer on component mount, without native visibility gates.
export function CoreRow({cpus,w,histories,running,sheetTrace}:{cpus:CpuUsage[];w?:WrtInfo;histories:OverviewHistory;running:boolean;sheetTrace?:number}) {
  return <HStack key={`core-${cpus[0]?.id}`} spacing={16} alignment="top">{cpus.map(c=><CoreCard key={c.id} sheetTrace={sheetTrace} cpu={c} w={w} history={histories.cpu[c.id]??[]} running={running}/>)}{cpus.length===1?<Spacer frame={{minWidth:0,maxWidth:'infinity'}}/>:null}</HStack>
}
// Per-core plots share GridPlot and the single scheduler; no per-core timer.
export function SampledCpuPlot({samples,running=false,sheetTrace}:{samples:number[];running?:boolean;sheetTrace?:number}) {
  return <GridPlot samples={samples} tone="#2dbf82" percent plotHeight={76} running={running} plotWidth={PLOT_HALF_W} elevated role="detail" sheetTrace={sheetTrace}/>
}
export function DetailCpuSummary({w,history,running,sheetTrace}:{w?:WrtInfo;history:number[];running:boolean;sheetTrace?:number}) {
  return <VStack key="summary"><CpuCard w={w} history={history} running={running} detail sheetTrace={sheetTrace}/></VStack>
}
export function CoreCard({cpu,w,history,running,sheetTrace}:{cpu:CpuUsage;w?:WrtInfo;history:number[];running:boolean;sheetTrace?:number}) {
  const meta=w?.cpuMeta?.[cpu.id]
  return <HomeCard><HStack><Text font={12} foregroundStyle="secondaryLabel">{cpu.id.toUpperCase()}</Text><Spacer/><Text font={17} fontWeight="semibold" foregroundStyle="#2dbf82" lineLimit={1} minimumScaleFactor={0.65}>{cpu.usage===undefined?"--%":`${cpu.usage.toFixed(1)}%`}</Text></HStack><SampledCpuPlot samples={history} running={running} sheetTrace={sheetTrace}/><HStack spacing={5}><VStack alignment="leading" spacing={3}><Text font={9} fontWeight="semibold" foregroundStyle="secondaryLabel">频率</Text><Text font={11} fontWeight="semibold">{meta?.mhz===undefined?'-- MHz':`${meta.mhz.toFixed(0)} MHz`}</Text></VStack><Spacer/><VStack alignment="trailing" spacing={3}><Text font={9} fontWeight="semibold" foregroundStyle="secondaryLabel">缓存大小</Text><Text font={11} fontWeight="semibold">{meta?.cacheKB===undefined?'-- KB':`${meta.cacheKB} KB`}</Text></VStack></HStack></HomeCard>
}
