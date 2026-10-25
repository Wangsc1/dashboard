// Temporary bounded, process-local timing only. No Storage/network/identity export.
type Stage='read'|'headers'|'body'|'parse'|'publish'|'bridge'|'js-gap'|'cpu-info'|'cpu-parse'|'canvas-gap'
export type TimingToken={epoch:number}
let epoch=0,source='',active=false,session=0
let heartbeat:ReturnType<typeof setInterval>|undefined
let spanID=0
const pending=new Map<number,{token:TimingToken;stage:Stage;at:number}>()
export function timingSpan(token:TimingToken|undefined,stage:Stage){
  if(!token)return ()=>{}
  const id=++spanID,at=Date.now();pending.set(id,{token,stage,at})
  if(pending.size>64)pending.delete(pending.keys().next().value!)
  return ()=>{pending.delete(id);timing(token,stage,Date.now()-at)}
}
const totals=new Map<Stage,{n:number;max:number;slow:number}>()
const recent:Array<{session:number;stage:Stage;ms:number;at:number;slowInfo?:number;zones?:number}>=[]
let context:{slowInfo?:number;zones?:number}={}
export function timingToken(key?:string):TimingToken|undefined{return active&&(!key||key===source)?{epoch}:undefined}
export function timing(token:TimingToken|undefined,stage:Stage,ms:number,flags?:{slowInfo:number;zones:number}){
  if(!token||token.epoch!==epoch||!active||!Number.isFinite(ms)||ms<0)return
  const value=Math.round(ms),old=totals.get(stage)??{n:0,max:0,slow:0}
  old.n++;old.max=Math.max(old.max,value)
  if(value>=1500){old.slow++;recent.push({session,stage,ms:value,at:Date.now(),...(flags??(['read','headers','body','parse','publish'].includes(stage)?context:{}))});if(recent.length>32)recent.shift()}
  totals.set(stage,old)
}
export function timingReadContext(token:TimingToken|undefined,slowInfo:boolean,zones:number){if(token?.epoch===epoch&&active)context={slowInfo:slowInfo?1:0,zones}}
export function beginCadenceDiagnostics(key:string){
  // A source/pause boundary invalidates every unfinished timer span.
  if(heartbeat!==undefined)clearInterval(heartbeat);heartbeat=undefined
  source=key;session++;epoch++;active=false;pending.clear();const owned=session
  const stop=()=>{if(owned!==session)return;active=false;epoch++;context={};pending.clear();if(heartbeat!==undefined)clearInterval(heartbeat);heartbeat=undefined}
  return {resume(){
    if(active||source!==key||owned!==session)return
    active=true;epoch++;let expected=Date.now()+250
    heartbeat=setInterval(()=>{const now=Date.now(),late=now-expected;expected=now+250;if(late>=1000)timing(timingToken(key),'js-gap',late)},250)
  },pause:stop,close(){stop();if(owned===session)source=''}}
}
// Closed vocabulary only: no source key, address, metadata, credentials or errors.
type ConnectionEvent='active'|'inactive'|'background'|'appear'|'disappear'|'poll-start'|'poll-stop'|'sample'|'expired'|'request-error'|'render'|'root-home'|'root-proxies'|'root-rules'|'root-connections'|'root-more'
const connectionEvents:Array<{event:ConnectionEvent;at:number;n:number}>=[]
export function connectionLifecycle(event:ConnectionEvent){
  const last=connectionEvents[connectionEvents.length-1]
  if(last?.event===event){last.n++;last.at=Date.now();return}
  connectionEvents.push({event,at:Date.now(),n:1});if(connectionEvents.length>40)connectionEvents.shift()
}
export function connectionLifecycleSummary(){
  const now=Date.now()
  return ['连接生命周期（仅本次运行，最多40项，无来源/连接内容）',
    'root-*为JS读取的标签；render为连接正文已构建，appear/disappear为视图回调；不代表原生像素已绘制。',
    ...connectionEvents.map(e=>`-${Math.max(0,now-e.at)}ms ${e.event} ×${e.n}`)].join('\n')
}
// Chart document lifecycle: closed vocabulary plus small integers only (no source, samples, URLs or errors).
type PlotEvent='mount'|'dispose'|'load'|'ready'|'painted'|'shown'|'reveal-check'|'reload-scene-unready'|'reload-probe-failed'|'reload-probe-timeout'|'reload-load-timeout'|'reload-bridge-failures'|'fail-load-timeout'|'fail-bridge'|'ignored-load-result'|'ignored-bridge-error'|'ignored-stale-update'|'scene-active'|'scene-inactive'|'scene-background'
const plotEvents:Array<{event:PlotEvent;at:number;gen:number;n:number;w?:number;h?:number}>=[]
let plotMounts=0,plotLive=0
export function plotLifecycle(event:PlotEvent,gen=0,size?:{w:number;h:number}){
  if(event==='mount'){plotMounts++;plotLive++}else if(event==='dispose')plotLive=Math.max(0,plotLive-1)
  const last=plotEvents[plotEvents.length-1]
  if(last&&last.event===event&&last.gen===gen&&!size){last.n++;last.at=Date.now();return}
  plotEvents.push({event,at:Date.now(),gen,n:1,w:size?.w,h:size?.h});if(plotEvents.length>40)plotEvents.shift()
}
export function plotLifecycleSummary(){
  const now=Date.now()
  return ['图表文档生命周期（仅本次运行，最多40项；gen=文档代次，w/h=页面报告的绘制尺寸；无来源/样本/错误文本）',
    `累计挂载=${plotMounts} 当前存活=${plotLive}`,
    ...plotEvents.map(e=>`-${Math.max(0,now-e.at)}ms ${e.event} gen=${e.gen} ×${e.n}${e.w!==undefined?` ${e.w}x${e.h}`:''}`)].join('\n')
}
export function cadenceSummary(){
  const lines=['采样/绘图计时摘要 v1（仅本次运行；无地址、认证、配置或响应正文）',`会话=${session} 前台采样=${active?'是':'否'} 异常阈值=1500ms 记录上限=32`,
    '读法：read/headers/body慢且js-gap不高→请求/服务端尾延迟线索；js-gap高→JS调度/宿主暂停线索；仅bridge高→绘图桥接线索；canvas-gap高→画布rAF长间隔。它们是耗时观察，不是单凭摘要确认根因。',
    'slowInfo=1表示该轮含60秒系统资料；zones是温度区数量；cpu-info为异步CPU元信息。后台及切源在途计时丢弃。']
  for(const [stage,s]of totals)lines.push(`${stage}: 次数=${s.n} 最大=${s.max}ms 慢=${s.slow}`)
  for(const p of pending.values())if(p.token.epoch===epoch&&Date.now()-p.at>=1500)lines.push(`${p.stage}: 尚未完成 已等待=${Date.now()-p.at}ms`)
  lines.push('最近异常（相对查看时间，毫秒）：')
  const now=Date.now();for(const e of recent)lines.push(`-${Math.max(0,now-e.at)}ms 会话${e.session} ${e.stage}=${e.ms}ms${e.slowInfo!==undefined?` slowInfo=${e.slowInfo} zones=${e.zones}`:''}`)
  if(!recent.length)lines.push('未捕获异常；不代表已排除真机绘制停顿。')
  return lines.join('\n')+'\n'+connectionLifecycleSummary()+'\n'+plotLifecycleSummary()
}
