import { Divider, HStack, VStack, Text, Image, RoundedRectangle, Spacer, ZStack, Device, modifiers, GeometryReader, useColorScheme } from "scripting"
import { Overview, WrtInfo, fmtBytes, fmtSpeed, fmtUptime } from "./api"
import { CpuUsage, OverviewHistory } from "./openwrt-metrics"
import { InlineCanvasPlot } from "./plot-view"
export const HOME_BG = "systemGroupedBackground"
const INK="label",PANEL="secondarySystemGroupedBackground",CARD_RADIUS=18
const CARD_STROKE={shapeStyle:{light:"rgba(60,60,67,0.08)",dark:"rgba(255,255,255,0.09)"},strokeStyle:{lineWidth:0.5}}
function hexTint(color:string,alpha:number):string {
  const m=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if(!m)return color
  const h=m[1].length===3?m[1].split('').map(c=>c+c).join(''):m[1]
  return `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${alpha})`
}
declare var Animation: any
function animationApi(): any {
  try { if (typeof Animation !== "undefined" && Animation) return Animation } catch {}
  try { return (globalThis as any).Animation } catch {}
  return undefined
}
function cardCrossfadeAnimation(step: number): any {
  try {
    const A = animationApi()
    if (typeof A?.smooth === "function") return { animation: A.smooth({ duration: 0.28 }), value: step }
    if (typeof A?.easeOut === "function") return { animation: A.easeOut(0.28), value: step }
    if (typeof A?.default === "function") return { animation: A.default(), value: step }
  } catch {}
  return undefined
}
export const CPU_CARD_HEIGHT = 232
const CPU_FACE_FRAME = { minWidth: 0, maxWidth: "infinity" as const, height: CPU_CARD_HEIGHT - 32, alignment: "topLeading" as const }
export function HomeBadge({icon,color}:{icon:string;color:string}) {
  return <Image systemName={icon} font={11.5} fontWeight="semibold" foregroundStyle={color as any} frame={{width:22,height:22}} background={<RoundedRectangle cornerRadius={7} fill={{light:hexTint(color,0.12),dark:hexTint(color,0.20)}}/>}/>
}
export function HomeCard({children,onOpen,fixedHeight}:{children?:any;onOpen?:()=>void;fixedHeight?:number}) {
  const sized=fixedHeight!==undefined
    ? modifiers().frame({minWidth:0,maxWidth:"infinity",alignment:"topLeading"}).frame({height:fixedHeight-32,alignment:"topLeading"})
    : modifiers().frame({minWidth:0,maxWidth:"infinity",alignment:"leading"})
  const shell=sized.padding(16).background(<RoundedRectangle cornerRadius={CARD_RADIUS} fill={PANEL} stroke={CARD_STROKE}/>)
  // Native hit plane ABOVE the native chart, sized after card padding/background.
  // A clear fill plus explicit contentShape includes chart, numbers and empty space.
  // Only tappable cards get this plane; a tap recognizer does not add a drag handler.
  return <VStack alignment="leading" spacing={fixedHeight!==undefined?0:12} foregroundStyle={INK} font={13}
    modifiers={onOpen?shell.overlay(<RoundedRectangle cornerRadius={CARD_RADIUS} fill="clear" contentShape="rect" onTapGesture={onOpen}/>):shell}>{children}</VStack>
}
export function MetricNumber({value,unit="",pointSize=16,tone="label",digits=0,running=true}:{running?:boolean;value?:number;unit?:string;pointSize?:number;tone?:any;digits?:number}) {
  const shown=value===undefined||!Number.isFinite(value)?"--":value.toFixed(digits)
  return <Text font={pointSize} fontWeight="semibold" foregroundStyle={tone} lineLimit={1} minimumScaleFactor={0.65}>{`${shown}${unit}`}</Text>
}
// Both pages use the same inline Canvas runtime; only samples cross the native bridge.
const SCREEN_W:number|undefined=(Device as any)?.screen?.width
const SIZED=typeof SCREEN_W==="number"&&SCREEN_W>112&&SCREEN_W<=600
export const PLOT_FULL_W:number|undefined=SIZED?SCREEN_W-64:undefined
export const PLOT_HALF_W:number|undefined=SIZED?(SCREEN_W-46)/2-32:undefined
export function GridPlot(props:{samples:number[];tone:string;plotHeight?:number;area?:boolean;running?:boolean;percent?:boolean;plotWidth?:number;elevated?:boolean}) {
  return <InlineCanvasPlot {...props}/>
}
export function tempBadgeStyle(temp?:number):{fg:any;bg:any} {
  if(temp===undefined||!Number.isFinite(temp))return {fg:"secondaryLabel",bg:"tertiarySystemFill"}
  if(temp>=75)return {fg:{light:"#d63638",dark:"#ff6961"},bg:{light:"rgba(214,54,56,0.12)",dark:"rgba(255,105,97,0.18)"}}
  if(temp>=60)return {fg:{light:"#c16b13",dark:"#ffaf40"},bg:{light:"rgba(193,107,19,0.12)",dark:"rgba(255,175,64,0.18)"}}
  return {fg:{light:"#14804a",dark:"#39d98a"},bg:{light:"rgba(23,150,91,0.12)",dark:"rgba(57,217,138,0.18)"}}
}
export function CpuBreakdown({cpu,running}:{cpu?:CpuUsage;running:boolean}) {
  return <HStack spacing={0} alignment="bottom"><HStack spacing={22}>{([['SYS',cpu?.system],['USER',cpu?.user],['STEAL',cpu?.steal]] as const).map(([title,value])=><VStack key={title} alignment="leading" spacing={3}><Text font={10} fontWeight="medium" foregroundStyle="secondaryLabel" lineLimit={1}>{title}</Text><MetricNumber value={value} digits={1} pointSize={14} running={running}/></VStack>)}</HStack><Spacer/><HStack alignment="lastTextBaseline" spacing={2}><MetricNumber running={running} value={cpu?.usage} digits={1} pointSize={24} tone="#3485eb"/><Text font={12} fontWeight="medium" foregroundStyle="#3485eb">%</Text></HStack></HStack>
}
export function CpuSystemCard({w,onFlip,bare=false}:{w?:WrtInfo;onFlip?:()=>void;bare?:boolean}) {
  const cores=w?.cpus?.filter(x=>x.id!=='cpu')??[]
  const info=[['Uptime',w?fmtUptime(w.uptime,true):'--'],['Arch',w?.arch||'--'],['Cpu',cores.length?String(cores.length):'--'],['Kernel',w?.kernel||'--'],['Board',w?.model||'--']] as const
  const rows:any[]=[]
  info.forEach(([title,value],i)=>{
    if(i>0){rows.push(<Spacer key={`s0-${title}`}/>);rows.push(<Divider key={`d-${title}`}/>);rows.push(<Spacer key={`s1-${title}`}/>)}
    rows.push(<HStack key={title}><Text font={12.5} foregroundStyle="label">{title}</Text><Spacer/><Text font={12.5} foregroundStyle="secondaryLabel" lineLimit={1} minimumScaleFactor={0.85} multilineTextAlignment="trailing">{value}</Text></HStack>)
  })
  const content=<VStack alignment="leading" spacing={0} frame={CPU_FACE_FRAME}><HStack spacing={8}><HomeBadge icon="info.circle" color="#3485eb"/><Text font={15} fontWeight="semibold" lineLimit={1} minimumScaleFactor={0.85}>{w?.release||'系统版本未提供'}</Text><Spacer/><Image systemName="arrowshape.turn.up.left" font={11.5} fontWeight="semibold" foregroundStyle="tertiaryLabel"/></HStack><Spacer/>{rows}</VStack>
  return bare ? content : <HomeCard onOpen={onFlip} fixedHeight={CPU_CARD_HEIGHT}>{content}</HomeCard>
}
export function CpuCard({w,history,running,flipped=false,onFlip}:{w?:WrtInfo;history:number[];running:boolean;flipped?:boolean;onFlip?:()=>void}) {
  const temp=tempBadgeStyle(w?.temperature)
  const step=flipped?1:0
  const anim=cardCrossfadeAnimation(step)
  const cpuModel=w?.cpuModel?.replace(/\s+/g," ").trim()
  return <HomeCard onOpen={onFlip} fixedHeight={CPU_CARD_HEIGHT}>
    <ZStack alignment="topLeading" frame={CPU_FACE_FRAME}>
      <VStack alignment="leading" spacing={0} frame={CPU_FACE_FRAME}
        opacity={flipped?0:1} scaleEffect={flipped?0.97:1}
        {...(anim?{animation:anim}:{})}>
        <VStack alignment="leading" spacing={4}><HStack spacing={8}><HomeBadge icon="cpu" color="#3485eb"/><Text font={16} fontWeight="semibold" lineLimit={1}>CPU</Text><Spacer/><HStack spacing={6}><HStack spacing={3} padding={{horizontal:8,vertical:3.5}} background={<RoundedRectangle cornerRadius={10} fill={temp.bg}/>}><Image systemName="thermometer.medium" font={10} foregroundStyle={temp.fg}/><Text font={11} fontWeight="bold" foregroundStyle={temp.fg}>{w?.temperature===undefined?"-- °C":`${w.temperature.toFixed(1)} °C`}</Text></HStack><Image systemName="arrowshape.turn.up.left" font={11.5} fontWeight="semibold" foregroundStyle="tertiaryLabel"/></HStack></HStack><Text font={12} foregroundStyle="secondaryLabel" lineLimit={1} minimumScaleFactor={0.82}>{cpuModel||(w?"CPU 型号未提供":"--")}</Text></VStack><Spacer/><GridPlot samples={history} tone="#3485eb" plotHeight={92} area percent running={running} plotWidth={PLOT_FULL_W}/><Spacer/><CpuBreakdown cpu={w?.cpus?.find(c=>c.id==='cpu')} running={running}/>
      </VStack>
      <VStack alignment="leading" spacing={0} frame={CPU_FACE_FRAME}
        opacity={flipped?1:0} scaleEffect={flipped?1:0.97}
        {...(anim?{animation:anim}:{})}>
        <CpuSystemCard w={w} bare/>
      </VStack>
    </ZStack>
  </HomeCard>
}
export function TrafficCard({heading,rate,total,history,tone,running}:{heading:string;rate?:number;total?:number;history:number[];tone:string;running:boolean}) {
  const parts=rate===undefined?undefined:fmtSpeed(rate).split(' '),value=parts?Number(parts[0]):undefined,unit=parts?" "+parts.slice(1).join(' '):""
  return <HomeCard><HStack spacing={6}><HomeBadge icon={heading==="上传"?"arrow.up":"arrow.down"} color={tone}/><Text font={15} fontWeight="semibold" lineLimit={1}>{heading}</Text><Spacer/><MetricNumber running={false} value={value} unit={unit} pointSize={14} tone={tone} digits={value!==undefined&&value<100?1:0}/></HStack><GridPlot samples={history} tone={tone} plotHeight={66} area running={running} plotWidth={PLOT_HALF_W}/><HStack spacing={4}><Text font={11.5} foregroundStyle="secondaryLabel">{`已用 ${total===undefined?'--':fmtBytes(total)}`}</Text><Spacer/></HStack></HomeCard>
}
// Deterministic bars: no GeometryReader. Equal flexible-width bars, one fixed 24pt row height.
const BAR_ROW={minWidth:0,maxWidth:"infinity" as const,minHeight:24,maxHeight:24}
const BAR_CELL={minWidth:0,maxWidth:"infinity" as const,minHeight:24,maxHeight:24}
export function CapacityBars({fraction,tone}:{fraction?:number;tone:string}) {
  const n=fraction===undefined?0:Math.round(Math.max(0,Math.min(1,fraction))*24)
  return <HStack spacing={2} frame={BAR_ROW}>{Array.from({length:24},(_,i)=><RoundedRectangle key={String(i)} cornerRadius={2} fill={{color:tone,opacity:i<n?0.85:0.12}} frame={BAR_CELL}/>)}</HStack>
}
export const LOAD_TONES={light:["#17965b","#c16b13","#287ed6"],dark:["#39d98a","#ffaf40","#56b5ff"]}
// GeometryReader (proven to render on device in 1.5.164) wrapped in ONE fixed 24pt-high container so
// the row height is deterministic and the footer sits below it (card spacing 12).
export function LoadBars({fraction,tone}:{fraction?:number;tone:string}) {
  const known=fraction!==undefined&&Number.isFinite(fraction)&&fraction>=0
  const height=known?24*Math.min(1,fraction):0
  return <ZStack alignment="top" frame={{height:24}}><GeometryReader>{(geometry:{size:{width:number;height:number}})=>{
    const W=Math.max(0,geometry.size.width),gap=W*2.5/144,bar=Math.max(0,(W-23*gap)/24)
    return <HStack spacing={gap} frame={{width:W,height:24}}>{Array.from({length:24},(_,i)=><ZStack key={String(i)} alignment="bottom" frame={{width:bar,height:24}}>
      <RoundedRectangle cornerRadius={Math.min(1.75,bar/2)} fill={{color:tone,opacity:0.12}} frame={{width:bar,height:24}}/>
      {height>0?<RoundedRectangle cornerRadius={Math.min(1.75,bar/2,height/2)} fill={tone} frame={{width:bar,height}}/>:null}
    </ZStack>)}</HStack>
  }}</GeometryReader></ZStack>
}
// Intrinsic content sets the row height; its background paints equal-height cards.
// Neither the card nor the row asks for an infinite height proposal.
export function CompactMetricCard({heading,icon,iconColor,trailing,bars,footer}:{heading:string;icon?:string;iconColor?:string;trailing?:any;bars:any;footer:any}) {
  return <VStack alignment="leading" spacing={12} foregroundStyle={INK} font={13}
    modifiers={modifiers().frame({minWidth:0,maxWidth:"infinity",alignment:"leading"}).padding(16)}><HStack spacing={6}>{icon&&iconColor?<HomeBadge icon={icon} color={iconColor}/>:null}<Text font={15} fontWeight="semibold" lineLimit={1}>{heading}</Text><Spacer/>{trailing}</HStack>{bars}{footer}</VStack>
}
export function MetricFooterValue({value,caption,valueEdge="center"}:{value:string;caption:string;valueEdge?:"leading"|"center"|"trailing"}) {
  return <VStack alignment={valueEdge} spacing={3} frame={{minWidth:0,maxWidth:"infinity",alignment:valueEdge}} fixedSize={{horizontal:false,vertical:true}}>
    <Text font={12} fontWeight="medium" multilineTextAlignment={valueEdge==='leading'?'leading':valueEdge==='trailing'?'trailing':'center'}>{value}</Text>
    <Text font={10} foregroundStyle="secondaryLabel">{caption}</Text>
  </VStack>
}
export function RamCard({w,running=true}:{w?:WrtInfo;running?:boolean}) {
  const total=w?.memTotal&&w.memTotal>0?w.memTotal:undefined,used=total===undefined||w?.memFree===undefined?undefined:Math.max(0,total-w.memFree),fraction=total&&used!==undefined?used/total:undefined
  return <CompactMetricCard heading="内存" icon="memorychip" iconColor="#9b6be3" trailing={<MetricNumber running={running} value={fraction===undefined?undefined:fraction*100} unit="%" pointSize={15} tone="#9b6be3"/>}
    bars={<CapacityBars fraction={fraction} tone="#9b6be3"/>}
    footer={<HStack spacing={8} alignment="top"><MetricFooterValue value={used===undefined?'--':fmtBytes(used)} caption="已用" valueEdge="leading"/><MetricFooterValue value={total===undefined?'--':fmtBytes(total)} caption="总计" valueEdge="trailing"/></HStack>}/>
}
export function LoadCard({w}:{w?:WrtInfo}) {
  const cores=w?.cpus?.filter(c=>c.id!=='cpu').length
  const values=[0,1,2].map(i=>w?.load[i]),tones=LOAD_TONES[useColorScheme()]
  return <CompactMetricCard heading="负载" icon="speedometer" iconColor="#d97706"
    trailing={cores?<Text font={11} foregroundStyle="tertiaryLabel">{`${cores}核`}</Text>:null}
    bars={<HStack spacing={8}>{values.map((value,i)=><LoadBars key={String(i)} fraction={cores&&value!==undefined?value/cores:undefined} tone={tones[i]}/>)}</HStack>}
    footer={<HStack spacing={8} alignment="top">{values.map((value,i)=><MetricFooterValue key={String(i)} value={value===undefined||!Number.isFinite(value)?'--':value.toFixed(2)} caption={`${[1,5,15][i]}分钟`}/>)}</HStack>}/>
}
export function DiskCapacityBar({used,size}:{used?:number;size?:number}) {
  const known=size!==undefined&&Number.isFinite(size)&&size>0&&used!==undefined&&Number.isFinite(used)&&used>=0
  const fraction=known?Math.min(1,used/size):undefined
  return <GeometryReader modifiers={modifiers().frame({height:10}).frame({minWidth:0,maxWidth:"infinity"})}>{(geometry:{size:{width:number;height:number}})=>{
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
  const pct=d&&d.size>0?Math.round(Math.min(1,d.used/d.size)*100):undefined
  return <HomeCard><HStack spacing={8}><HomeBadge icon="internaldrive" color="#00a8b5"/><Text font={15} fontWeight="semibold">磁盘</Text><Spacer/>{pct!==undefined?<Text font={13} fontWeight="semibold" foregroundStyle="#00a8b5">{`${pct}%`}</Text>:<Text font={12} foregroundStyle="secondaryLabel">容量未提供</Text>}</HStack>{d?<><HStack spacing={6}><Text font={13} fontWeight="medium" lineLimit={1}>{d.device||'文件系统'}</Text><Text font={10.5} foregroundStyle="secondaryLabel" padding={{horizontal:6,vertical:2}} background={<RoundedRectangle cornerRadius={6} fill="tertiarySystemFill"/>}>{d.mount||'--'}</Text><Spacer/><Text font={11.5} foregroundStyle="secondaryLabel">{fmtBytes(d.size)}</Text></HStack><DiskCapacityBar used={d.used} size={d.size}/><HStack><Text font={12} fontWeight="medium">{`已用 ${fmtBytes(d.used)}`}</Text><Spacer/><Text font={12} foregroundStyle="secondaryLabel">{`可用 ${fmtBytes(d.avail)}`}</Text></HStack></>:<Text font={12} foregroundStyle="secondaryLabel">LuCI未提供挂载点容量，或当前账号无只读权限。</Text>}</HomeCard>
}
export function HomeConnectionsCard({count}:{count?:number}) {
  return <HomeCard>
    <HStack spacing={8}>
      <HomeBadge icon="link" color="#9b6be3"/>
      <Text font={15} fontWeight="semibold" lineLimit={1}>活动连接</Text>
      <Spacer/>
      <MetricNumber value={count} pointSize={20} tone="#9b6be3"/>
    </HStack>
  </HomeCard>
}
export function HomeDashboard({overview,histories,running,cpuFlipped=false,onToggleCpu}:{overview:Overview|null;histories:OverviewHistory;running:boolean;cpuFlipped?:boolean;onToggleCpu?:()=>void}) {
  const w=overview?.wrt
  return <VStack spacing={14}><CpuCard w={w} history={histories.cpu.cpu??[]} running={running} flipped={cpuFlipped} onFlip={onToggleCpu}/><HStack spacing={14} alignment="top"><TrafficCard heading="上传" rate={overview?.traffic.up} total={overview?.upTotal} history={histories.up} tone="#2dbf82" running={running}/><TrafficCard heading="下载" rate={overview?.traffic.down} total={overview?.downTotal} history={histories.down} tone="#27b1cf" running={running}/></HStack><HStack spacing={14} alignment="top" background={<HStack spacing={14}><RoundedRectangle cornerRadius={CARD_RADIUS} fill={PANEL} stroke={CARD_STROKE} frame={{minWidth:0,maxWidth:"infinity"}}/><RoundedRectangle cornerRadius={CARD_RADIUS} fill={PANEL} stroke={CARD_STROKE} frame={{minWidth:0,maxWidth:"infinity"}}/></HStack>}><RamCard w={w} running={running}/><LoadCard w={w}/></HStack><DiskCard w={w}/></VStack>
}
