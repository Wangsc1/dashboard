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
// Native chart lifecycle: closed vocabulary and small integers only. Legacy event names remain type-compatible for old test oracles.
type PlotEvent='native-draw'|'host-appear'|'host-disappear'|'web-appear'|'web-disappear'|'mount'|'dispose'|'load'|'kick-selected'|'kick-appear'|'kick-shown'|'kick-skipped'|'ready'|'ready-by-probe'|'painted'|'shown'|'reveal-check'|'reload-scene-unready'|'reload-probe-failed'|'reload-probe-timeout'|'reload-load-timeout'|'reload-bridge-failures'|'fail-load-timeout'|'fail-bridge'|'ignored-load-result'|'ignored-bridge-error'|'ignored-stale-update'|'scene-active'|'scene-inactive'|'scene-background'
export type PlotRole='home'|'detail'
export interface PlotTrace {id:number;role:PlotRole;sheet?:number}
let nextPlotId=0,nextSheetId=0
export function createPlotTrace(role:PlotRole,sheet?:number):PlotTrace{return {id:++nextPlotId,role,sheet}}
export function createSheetTrace(){return ++nextSheetId}
type SheetEvent='content-create'|'state-open'|'state-closed'|'content-mount'|'content-dispose'|'appear'|'disappear'|'running'|'paused'
const sheetEvents:Array<{event:SheetEvent;id:number;at:number;n:number}>=[]
// First timestamps/counts survive timeline eviction and later presentations of retained content.
const sheetFirst=new Map<number,{times:Partial<Record<SheetEvent,number>>;appearances:number}>()
export function sheetLifecycle(event:SheetEvent,id=0){
  let first=sheetFirst.get(id)
  if(!first){first={times:{},appearances:0};sheetFirst.set(id,first);if(sheetFirst.size>16)sheetFirst.delete(sheetFirst.keys().next().value!)}
  if(first.times[event]===undefined)first.times[event]=Date.now()
  if(event==='appear')first.appearances++
  const last=sheetEvents[sheetEvents.length-1];if(last?.event===event&&last.id===id){last.n++;last.at=Date.now();return}
  sheetEvents.push({event,id,at:Date.now(),n:1});if(sheetEvents.length>24)sheetEvents.shift()
}
const plotEvents:Array<{event:PlotEvent;at:number;gen:number;n:number;w?:number;h?:number;owner?:PlotTrace}>=[]
// Retain per-host milestones even if many cores push startup events out of the 40-entry timeline.
const plotHosts=new Map<number,{owner:PlotTrace;gen:number;times:Partial<Record<PlotEvent,number>>;firstAppear:Partial<Record<'host'|'web',number>>;appearanceCount:{host:number;web:number};w?:number;h?:number}>()
let plotMounts=0,plotLive=0
export function plotLifecycle(event:PlotEvent,gen=0,size?:{w:number;h:number},owner?:PlotTrace){
  if(owner){
    let h=plotHosts.get(owner.id)
    if(!h){h={owner,gen,times:{},firstAppear:{},appearanceCount:{host:0,web:0}};plotHosts.set(owner.id,h);if(plotHosts.size>64)plotHosts.delete(plotHosts.keys().next().value!)}
    if(event==='host-appear'||event==='web-appear'){
      const layer=event==='host-appear'?'host':'web'
      if(h.firstAppear[layer]===undefined)h.firstAppear[layer]=Date.now()
      h.appearanceCount[layer]++
    }
    if(h.gen!==gen&&event==='load'){delete h.times.ready;delete h.times.painted;delete h.times.shown;delete h.w;delete h.h}
    h.gen=gen
    if(['mount','dispose','native-draw','load','ready','painted','shown','host-appear','host-disappear','web-appear','web-disappear'].includes(event))h.times[event]=Date.now()
    if(size){h.w=size.w;h.h=size.h}
  }
  if(event==='mount'){plotMounts++;plotLive++}else if(event==='dispose')plotLive=Math.max(0,plotLive-1)
  const last=plotEvents[plotEvents.length-1]
  if(last&&last.event===event&&last.gen===gen&&last.owner?.id===owner?.id&&!size){last.n++;last.at=Date.now();return}
  plotEvents.push({event,at:Date.now(),gen,n:1,w:size?.w,h:size?.h,owner});if(plotEvents.length>40)plotEvents.shift()
}
export function plotLifecycleSummary(){
  const now=Date.now()
  return ['原生图表生命周期（仅本次运行，最多40项；gen=0为原生宿主，w/h=draw实际尺寸；无来源/样本/错误文本）',
    `累计挂载=${plotMounts} 当前存活=${plotLive}`,
    'host appear/disappear为原生视图回调；native-draw表示已发出原生绘制命令，不代表屏幕像素合成。原生宿主无Web文档、加载或消息就绪阶段。',
    ...plotEvents.map(e=>`-${Math.max(0,now-e.at)}ms ${e.event} gen=${e.gen} ×${e.n}${e.owner?` id=${e.owner.id} role=${e.owner.role}${e.owner.sheet!==undefined?` sheet=${e.owner.sheet}`:''}`:''}${e.w!==undefined?` ${e.w}x${e.h}`:''}`),
    '宿主最近里程碑（最多64个；firstAppear不覆盖，appearanceCount为回调次数；其余同事件保留最近一次）',
    ...[...plotHosts.values()].map(h=>`id=${h.owner.id} role=${h.owner.role}${h.owner.sheet!==undefined?` sheet=${h.owner.sheet}`:''} gen=${h.gen} ${(['host'] as const).map(k=>`${k}.firstAppear=${h.firstAppear[k]===undefined?'none':`-${Math.max(0,now-h.firstAppear[k]!)}ms`} ${k}.appearanceCount=${h.appearanceCount[k]}`).join(' ')}${h.w!==undefined?` ${h.w}x${h.h}`:''} ${Object.entries(h.times).map(([k,at])=>`${k}=-${Math.max(0,now-at!)}ms`).join(' ')}`),
    'sheet首次信号（最多16个；content-create=首次JS构建，content-mount/state=effect执行；appear不等于像素已合成）',
    ...[...sheetFirst.entries()].map(([id,s])=>`sheet=${id} appearanceCount=${s.appearances} ${Object.entries(s.times).map(([k,at])=>`first.${k}=-${Math.max(0,now-at!)}ms`).join(' ')}`),
    'CPU sheet生命周期（最多24项；state为JS effect，content-mount为订阅effect；appear/disappear为原生回调）',
    ...sheetEvents.map(e=>`-${Math.max(0,now-e.at)}ms sheet=${e.id} ${e.event} ×${e.n}`)].join('\n')
}
// Continuous animated draws only. Date.now is documented/available; no assumption of
// a performance global. All rings are allocated once, never in the draw hot path.
function drawMetric(){return {n:0,total:0,max:0,buckets:[0,0,0,0],ring:new Array<number>(128).fill(0),cursor:0}}
function drawTotals(){return {frames:0,restarts:0,backsteps:0,maxProgressStep:0,maxGeometryStep:0,stationary:0,native:drawMetric(),js:drawMetric(),cost:drawMetric()}}
const drawRoles={home:drawTotals(),detail:drawTotals()}
// v2 records entry and exclusion conditions BEFORE v1 filtering. No sample values.
const stateKeys=['updates','newRefs','runningTrue','runningFalse','animStarts','updateNotAnimating','updateStopped','raw','rawAnimating','timeMissing','timeInvalid','notAnimating','notRunning','notTicking','notForeground','notVisible','zeroSize','wake','park','setPausedTrue','setPausedFalse','restoreScene','restoreDisappear','restoreReturnAppear','restoreKick','restoreRunningFalse','startsWithoutDraw'] as const
type StateKey=typeof stateKeys[number]
function stateCounts(){const out={} as Record<StateKey,number>;for(const k of stateKeys)out[k]=0;return out}
const stateRoles={home:stateCounts(),detail:stateCounts()}
const rawJsRoles={home:drawMetric(),detail:drawMetric()}
interface PlotStateTrack {id:number;role:PlotRole;live:boolean;counts:ReturnType<typeof stateCounts>;updateAt:number;drawAt:number;flags:number;history:number;expectedPause:boolean;renderedPause:boolean;pendingStart:boolean;rawContinuous:boolean;rawAt:number;events:string[];times:number[];cursor:number;eventCount:number}
const stateHosts=new Map<number,PlotStateTrack>()
function makePlotState(owner:PlotTrace):PlotStateTrack{
  const s:PlotStateTrack={id:owner.id,role:owner.role,live:true,counts:stateCounts(),updateAt:0,drawAt:0,flags:0,history:0,expectedPause:false,renderedPause:false,pendingStart:false,rawContinuous:false,rawAt:0,events:new Array<string>(8).fill(''),times:new Array<number>(8).fill(0),cursor:0,eventCount:0}
  stateHosts.set(owner.id,s);if(stateHosts.size>64)stateHosts.delete(stateHosts.keys().next().value!)
  return s
}
function countState(s:PlotStateTrack,key:StateKey){s.counts[key]++;stateRoles[s.role][key]++}
function stateBoundary(s:PlotStateTrack,event:string){s.events[s.cursor]=event;s.times[s.cursor]=Date.now();s.cursor=(s.cursor+1)%8;s.eventCount=Math.min(8,s.eventCount+1)}
export function nativePlotStateEvent(t:NativeDrawTrack,event:'wake'|'park'|'setPausedTrue'|'setPausedFalse'|'restoreScene'|'restoreDisappear'|'restoreReturnAppear'|'restoreKick'|'restoreRunningFalse'){
  const s=t.state;countState(s,event)
  if(event==='setPausedTrue'||event==='setPausedFalse')s.expectedPause=event==='setPausedTrue'
  if(event==='park'||event.startsWith('restore'))stateBoundary(s,event)
}
export function nativePlotRenderedPause(t:NativeDrawTrack,paused:boolean){t.state.renderedPause=paused}
export function nativePlotUpdate(t:NativeDrawTrack,newRef:boolean,running:boolean,wasAnimating:boolean,oldStart:number,animating:boolean,start:number,length:number){
  const s=t.state;countState(s,'updates');if(newRef)countState(s,'newRefs');countState(s,running?'runningTrue':'runningFalse');s.updateAt=Date.now();s.history=length
  if(!animating)countState(s,'updateNotAnimating')
  if(wasAnimating&&!animating)countState(s,'updateStopped')
  if(animating&&(!wasAnimating||oldStart!==start)){
    if(s.pendingStart)countState(s,'startsWithoutDraw')
    countState(s,'animStarts');s.pendingStart=true;stateBoundary(s,'sample-start')
  }
}
// flags: model.animating=1 running=2 ticking=4 foreground=8 visible=16 positive-size=32.
export function nativePlotRawDraw(t:NativeDrawTrack,time:number,at:number,flags:number){
  const s=t.state;countState(s,'raw');s.drawAt=at;s.flags=flags
  if(time===undefined||time===null)countState(s,'timeMissing')
  else if(!Number.isFinite(time))countState(s,'timeInvalid')
  if(flags&1){countState(s,'rawAnimating');s.pendingStart=false}else countState(s,'notAnimating')
  if(!(flags&2))countState(s,'notRunning');if(!(flags&4))countState(s,'notTicking');if(!(flags&8))countState(s,'notForeground');if(!(flags&16))countState(s,'notVisible');if(!(flags&32))countState(s,'zeroSize')
  // JS-only continuous animation gap survives missing native time, not lifecycle/static gaps.
  if(flags===63){if(s.rawContinuous&&at>=s.rawAt)addDrawMetric(rawJsRoles[s.role],at-s.rawAt);s.rawContinuous=true;s.rawAt=at}else s.rawContinuous=false
}
export function nativePlotStateSummary(){
  const now=Date.now(),format=(c:ReturnType<typeof stateCounts>)=>stateKeys.map(k=>`${k}=${c[k]}`).join(' ')
  const lines=['原生绘制状态 v2（进程累计；raw为alive draw入口，无time/动画过滤；拒绝条件非互斥）',
    'A: newRefs不增长→宿主未收到新samples引用；B: newRefs增长但animStarts不增长→未启动，updateStopped/restore*辅助定位；C: animStarts增长但raw/rawAnimating不增长→动画已启但缺draw；D: raw存在，对照not*/zeroSize/timeMissing/timeInvalid与v1。不同阶段可并存，不凭累计值自动定根因。',
    'updates=宿主数据/style effect次数；newRefs=其中samples引用变化次数（含首帧）；runningTrue/False为effect传入值；updateNotAnimating/Stopped为更新后未动画/从动画变停止；wake/park为调用次数，setPaused*才是setter次数。',
    'flags位: animating=1 running=2 ticking=4 foreground=8 visible=16 positive-size=32；63才通过v1门控，还需有效time。expectedPause=最近setter期望，renderedPause=最近JS props，不代表原生已应用。',
    'restoreRunningFalse为running=false更新触发的归位路径标记，非额外restore调用；animStarts按更新前后animating/start比较。startsWithoutDraw为前次启动未见animating draw又启动的次数，pendingStart表示最近启动尚未见animating draw。']
  for(const role of ['home','detail'] as const){lines.push(`${role}.state: ${format(stateRoles[role])}`);const m=rawJsRoles[role];lines.push(`${role}.raw-js-active-gap: n=${m.n} total=${m.total.toFixed(1)}ms max=${m.max.toFixed(1)}ms buckets=${m.buckets.join('/')}（不依赖time，仍只计连续动画门控通过帧）`)}
  lines.push('逐宿主最近状态/8个边界（最多64宿主，含已卸载；无样本值）：')
  for(const s of stateHosts.values()){
    lines.push(`id=${s.id} role=${s.role} live=${+s.live} ${format(s.counts)} updateAge=${s.updateAt?Math.max(0,now-s.updateAt):'none'} drawAge=${s.drawAt?Math.max(0,now-s.drawAt):'none'} historyLength=${s.history} flags=${s.flags} expectedPause=${+s.expectedPause} renderedPause=${+s.renderedPause} pendingStart=${+s.pendingStart}`)
    const events=[];for(let j=0;j<s.eventCount;j++){const i=(s.cursor-s.eventCount+j+8)%8;events.push(`-${Math.max(0,now-s.times[i])}ms:${s.events[i]}`)}lines.push(events.join(' '))
  }
  return lines.join('\n')
}
export interface NativeDrawTrack {state:PlotStateTrack;role:PlotRole;continuous:boolean;native:number;js:number;start:number;progress:number;points:number[];length:number}
const drawTracks=new Map<number,NativeDrawTrack>()
const slowDraws=new Array<number>(12*6).fill(0)
let slowDrawCount=0,slowDrawCursor=0
export function createNativeDrawTrack(owner:PlotTrace):NativeDrawTrack{
  const t:NativeDrawTrack={state:makePlotState(owner),role:owner.role,continuous:false,native:0,js:0,start:0,progress:0,points:new Array<number>(122).fill(0),length:0}
  drawTracks.set(owner.id,t);if(drawTracks.size>64)drawTracks.delete(drawTracks.keys().next().value!)
  return t
}
export function resetNativeDrawTrack(t:NativeDrawTrack){t.continuous=false;t.state.rawContinuous=false}
export function disposeNativeDrawTrack(owner:PlotTrace,t:NativeDrawTrack){resetNativeDrawTrack(t);t.state.live=false;drawTracks.delete(owner.id)}
function addDrawMetric(s:ReturnType<typeof drawMetric>,v:number){
  s.n++;s.total+=v;s.max=Math.max(s.max,v);s.buckets[v<=40?0:v<=80?1:v<=150?2:3]++
  s.ring[s.cursor]=v;s.cursor=(s.cursor+1)%128
}
export function recordNativeDraw(t:NativeDrawTrack,nativeSeconds:number,entered:number,ended:number,animated:boolean,start:number,progress:number,shown?:ReadonlyArray<{x:number;y:number}>,scale=1){
  if(!animated||!Number.isFinite(nativeSeconds)||!Number.isFinite(entered)||ended<entered){t.continuous=false;return}
  const s=drawRoles[t.role],cost=ended-entered
  s.frames++;addDrawMetric(s.cost,cost)
  let nd=0,jd=0
  if(t.continuous){
    nd=(nativeSeconds-t.native)*1000;jd=entered-t.js
    // A reset native clock or wall-clock correction starts a fresh segment.
    if(nd>=0&&jd>=0){
      addDrawMetric(s.native,nd);addDrawMetric(s.js,jd)
      if(start!==t.start)s.restarts++
      else {const step=progress-t.progress;if(step<0)s.backsteps++;s.maxProgressStep=Math.max(s.maxProgressStep,Math.abs(step))}
    }else{nd=0;jd=0;t.continuous=false}
  }
  if(nd>80||jd>80||cost>40){
    const i=slowDrawCursor*6
    slowDraws[i]=entered;slowDraws[i+1]=t.role==='home'?0:1;slowDraws[i+2]=nd;slowDraws[i+3]=jd;slowDraws[i+4]=cost;slowDraws[i+5]=progress
    slowDrawCursor=(slowDrawCursor+1)%12;slowDrawCount=Math.min(12,slowDrawCount+1)
  }
  if(shown){
    let step=0
    const length=Math.min(61,shown.length),comparable=t.continuous&&length===t.length&&nd>=0&&jd>=0
    for(let i=0;i<length;i++){
      const x=shown[i].x,y=shown[i].y/scale,j=i*2
      if(comparable)step=Math.max(step,Math.abs(x-t.points[j]),Math.abs(y-t.points[j+1]))
      t.points[j]=x;t.points[j+1]=y
    }
    if(comparable){s.maxGeometryStep=Math.max(s.maxGeometryStep,step);if(step===0)s.stationary++}
    t.length=length
  }
  t.continuous=true;t.native=nativeSeconds;t.js=entered;t.start=start;t.progress=progress
}
export function nativeDrawSummary(){
  const lines=['原生连续绘制 v1（本次进程累计；home/detail分开；仅实际动画draw，跨暂停/后台/离屏不计gap）',
    'native-gap=官方time秒转毫秒；js-gap/cost=Date.now，毫秒精度、非单调时钟；cost仅JS draw函数体，不含未暴露的原生序列化/合成。不是屏幕FPS或像素成功证明。',
    'n/total按各宿主连续段汇总，非墙钟帧率；p50/p95仅最近128次；bucket=<=40/<=80/<=150/>150ms；restart=连续段内模型start变化，progress-backstep仅同一start。',
    `跟踪宿主=${drawTracks.size}/64 慢记录=${slowDrawCount}/12`]
  for(const role of ['home','detail'] as const){
    const s=drawRoles[role];lines.push(`${role}: animated-draw=${s.frames} restart=${s.restarts} progress-backstep=${s.backsteps} max-progress-step=${s.maxProgressStep.toFixed(3)} max-normalized-geometry-step=${s.maxGeometryStep.toFixed(5)} stationary-geometry-pairs=${s.stationary}`)
    for(const key of ['native','js','cost'] as const){const m=s[key],values=m.ring.slice(0,Math.min(m.n,128)).sort((a,b)=>a-b),q=(p:number)=>values.length?values[Math.ceil(values.length*p)-1].toFixed(1):'none';lines.push(`${role}.${key}: n=${m.n} total=${m.total.toFixed(1)}ms max=${m.max.toFixed(1)}ms p50=${q(.5)} p95=${q(.95)} buckets=${m.buckets.join('/')}`)}
  }
  const now=Date.now()
  for(let j=0;j<slowDrawCount;j++){const i=((slowDrawCursor-slowDrawCount+j+12)%12)*6;lines.push(`-${Math.max(0,now-slowDraws[i])}ms ${slowDraws[i+1]===0?'home':'detail'} native-gap=${slowDraws[i+2].toFixed(1)} js-gap=${slowDraws[i+3].toFixed(1)} cost=${slowDraws[i+4].toFixed(1)} progress=${slowDraws[i+5].toFixed(3)}`)}
  lines.push('geometry-step为相邻同点数帧最大坐标差（x归一化、y除scale），不含样本值；progress正常不证明全部曲线几何或屏幕显示连续；采样restart本身不等于错误。无样本值、地址或认证信息。')
  return lines.join('\n')
}
export function cadenceSummary(){
  const lines=['采样/绘图计时摘要 v1（仅本次运行；无地址、认证、配置或响应正文）',`会话=${session} 前台采样=${active?'是':'否'} 异常阈值=1500ms 记录上限=32`,
    '读法：read/headers/body慢且js-gap不高→请求/服务端尾延迟线索；js-gap高→JS调度/宿主暂停线索；仅bridge高→绘图桥接线索；canvas-gap为旧Web参考指标，原生TimelineCanvas不产生rAF/bridge计时。它们是耗时观察，不是单凭摘要确认根因。',
    'slowInfo=1表示该轮含60秒系统资料；zones是温度区数量；cpu-info为异步CPU元信息。后台及切源在途计时丢弃。']
  for(const [stage,s]of totals)lines.push(`${stage}: 次数=${s.n} 最大=${s.max}ms 慢=${s.slow}`)
  for(const p of pending.values())if(p.token.epoch===epoch&&Date.now()-p.at>=1500)lines.push(`${p.stage}: 尚未完成 已等待=${Date.now()-p.at}ms`)
  lines.push('最近异常（相对查看时间，毫秒）：')
  const now=Date.now();for(const e of recent)lines.push(`-${Math.max(0,now-e.at)}ms 会话${e.session} ${e.stage}=${e.ms}ms${e.slowInfo!==undefined?` slowInfo=${e.slowInfo} zones=${e.zones}`:''}`)
  if(!recent.length)lines.push('未捕获异常；不代表已排除真机绘制停顿。')
  return lines.join('\n')+'\n'+connectionLifecycleSummary()+'\n'+plotLifecycleSummary()+'\n'+nativeDrawSummary()+'\n'+nativePlotStateSummary()
}
