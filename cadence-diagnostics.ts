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
export function cadenceSummary(){
  const lines=['采样/绘图计时摘要 v1（仅本次运行；无地址、认证、配置或响应正文）',`会话=${session} 前台采样=${active?'是':'否'} 异常阈值=1500ms 记录上限=32`,
    '读法：read/headers/body慢且js-gap不高→请求/服务端尾延迟线索；js-gap高→JS调度/宿主暂停线索；仅bridge高→绘图桥接线索；canvas-gap高→画布rAF长间隔。它们是耗时观察，不是单凭摘要确认根因。',
    'slowInfo=1表示该轮含60秒系统资料；zones是温度区数量；cpu-info为异步CPU元信息。后台及切源在途计时丢弃。']
  for(const [stage,s]of totals)lines.push(`${stage}: 次数=${s.n} 最大=${s.max}ms 慢=${s.slow}`)
  for(const p of pending.values())if(p.token.epoch===epoch&&Date.now()-p.at>=1500)lines.push(`${p.stage}: 尚未完成 已等待=${Date.now()-p.at}ms`)
  lines.push('最近异常（相对查看时间，毫秒）：')
  const now=Date.now();for(const e of recent)lines.push(`-${Math.max(0,now-e.at)}ms 会话${e.session} ${e.stage}=${e.ms}ms${e.slowInfo!==undefined?` slowInfo=${e.slowInfo} zones=${e.zones}`:''}`)
  if(!recent.length)lines.push('未捕获异常；不代表已排除真机绘制停顿。')
  return lines.join('\n')
}
