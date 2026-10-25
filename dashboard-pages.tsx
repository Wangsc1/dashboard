import { NikkiManagement, NikkiSubscription, NikkiRule, NikkiFile, NikkiManagementError, NIKKI_RULE_TYPES, loadNikkiManagement, saveNikkiSubscription, deleteNikkiSubscription, updateNikkiSubscription, saveNikkiRule, deleteNikkiRule, setNikkiRulesEnabled, reorderNikkiRules, selectNikkiProfile, readNikkiFile, saveNikkiFile } from "./api"
import { rootToolbar } from "./root-toolbar"
import { AppEvents, Button, Divider, HStack, VStack, Text, Image, Circle, RoundedRectangle, Spacer, ScrollView, LazyVStack, NavigationLink, Menu, Picker, TextField, Toggle, Form, Section, ProgressView, Editor, ZStack, modifiers, Safari, useState, useEffect, useMemo } from "scripting"
import { Controller, Group, Conn, Rule, Provider, setRuleDisabled, closeRuleConnections, ruleToggleSupported, loadGroups, testGroup, selectProxy, loadProviders, updateProvider, loadRules, loadConnections, closeConnection, closeAllConnections, fmtBytes, fmtSpeed, fmtUptime, delayColor, loadRuntimeVersions, checkCoreUpdate, loadNikkiRuntime, NikkiRuntime, verifyCoreRestart, upgradeCoreAndVerify, lastControllerMode, loadConfig, setMode as setControllerMode, nikkiService, nikkiServiceStatus, coreAction, CoreAction, queryDNS, webpage } from "./api"
import { usePreferences, KernelConfigPage, updatePreference, Choice, ThresholdRange, Range, TestURLField } from "./settings-ui"
import { NODE_SORT_OPTIONS, savePreferences, getPreferences, cachedIcon, readCachedIcon, feedback } from "./preferences"
import { selectable, sortedNodes, historyFor, SceneVisibility, filterConnections, clientLabels, saveClientLabel, sourceKey, confirmed } from "./dashboard-model"

const FG = { light: "#41434B", dark: "#CFD0D7" }

export const safeError = () => "请求未完成：请检查连接、认证与当前内核/Nikki版本支持（404/权限不足可能不支持该操作）。详情不会写入日志。"
async function attempt(fn: () => Promise<any>) { try { await fn() } catch { await Dialog.alert({ title: "操作未完成", message: safeError() }) } }
function Card({children,compact=false,contextMenu,...rest}: {children?:any;animation?:any;transition?:any;compact?:boolean;opacity?:number;contextMenu?:any}) { const content=<VStack {...rest} alignment="leading" spacing={compact?6:10} font={compact?12:14} foregroundStyle={FG} modifiers={modifiers().frame({maxWidth:"infinity",alignment:"leading"}).padding({horizontal:compact?10:14,vertical:compact?10:14}).background(<RoundedRectangle cornerRadius={compact?16:22} fill="secondarySystemBackground"/>)}>{children}</VStack>;return contextMenu?<VStack spacing={0} frame={{maxWidth:"infinity"}} contextMenu={contextMenu}>{content}</VStack>:content }
function Shell({children,title,toolbar,onAppear,onDisappear,animation,background,overlay,refresh}:any) { return <ScrollView {...(refresh?{refreshable:refresh}:{})} overlay={overlay} background={background} navigationTitle={title} navigationBarTitleDisplayMode="inline" toolbar={toolbar} onAppear={onAppear} onDisappear={onDisappear}><LazyVStack animation={animation} spacing={12} padding={{horizontal:14,vertical:8}}>{children}</LazyVStack></ScrollView> }
function Hint({children}:any) { return <Text font={12} foregroundStyle="secondaryLabel">{children}</Text> }
function Chip({title,color="systemBlue",small=false}:{title:string;color?:string;small?:boolean}) { return <Text font={small?10:11} foregroundStyle={color as any} padding={{horizontal:6,vertical:3}} background={<RoundedRectangle cornerRadius={6} fill="tertiarySystemBackground"/>}>{title}</Text> }
function Pages({limit,total,more,hideCount=false}:{limit:number;total:number;more:()=>void;hideCount?:boolean}) { if(hideCount&&limit>=total)return null;return <HStack>{hideCount?null:<Hint>{`已展示 ${Math.min(limit,total)} / ${total}`}</Hint>}<Spacer/>{limit<total ? <Button title="加载更多" action={more}/> : null}</HStack> }
function Empty() { return <Hint>尚未添加控制器，请从主页右上角进入设置。</Hint> }
export function GroupIcon({g}:{g:Group}) {
  const p=usePreferences(), [,setIconRevision]=useState(0), symbol=p.groupIcons[g.name]
  // Read the current source on every render, never a previous URL's async state.
  const url=p.customIcons&&!symbol?g.icon:undefined, image=url?readCachedIcon(url):null
  useEffect(()=>{ let alive=true;if(url&&!readCachedIcon(url)) cachedIcon(url).then(()=>{if(alive)setIconRevision(n=>n+1)}).catch(()=>{});return()=>{alive=false} },[url])
  if (!p.customIcons) return null
  return image ? <Image image={image} resizable scaleToFit frame={{width:28,height:28}}/> : <Image systemName={symbol || "point.3.connected.trianglepath.dotted"} foregroundStyle="systemBlue" frame={{width:26,height:26}}/>
}
export function GroupNodesPage({c,g,onChanged}:{c:Controller;g:Group;onChanged:()=>void}) {
  const prefs=usePreferences(), [current,setCurrent]=useState(g.now),[delays,setDelays]=useState(g.delays),[q,setQ]=useState(""),[limit,setLimit]=useState(80),[busy,setBusy]=useState(false),[guard]=useState({alive:true})
  useEffect(()=>()=>{guard.alive=false},[])
  const sorted=useMemo(()=>sortedNodes(g,delays),[g.all,delays,prefs.nodeSort])
  const nodes=useMemo(()=>{const needle=q.toLowerCase();return sorted.filter(x=>x.toLowerCase().includes(needle))},[sorted,q])
  async function pick(n:string) { if(n===current||busy)return;setBusy(true);await attempt(async()=>{ await selectProxy(c,g.name,n);if(guard.alive){setCurrent(n);onChanged()} });if(guard.alive)setBusy(false) }
  async function test(){if(busy)return;setBusy(true);await attempt(async()=>{await confirmed(`${c.name} · ${g.name}`,"将通过组中节点访问偏好中设置的测速URL，产生外部网络请求。",async()=>{const ds=await testGroup(c,g,(k,v)=>{if(guard.alive)setDelays(d=>({...d,[k]:v}))});if(guard.alive)setDelays(d=>({...d,...ds}))})});if(guard.alive)setBusy(false)}
  return Shell({title:g.name,toolbar:{topBarTrailing:<Button title={busy?"处理中…":"测速"} disabled={busy} systemImage="bolt.fill" action={test}/ >},children:<>
    <Card><Hint>{`${g.type} · 完整节点列表 ${g.all.length} · 当前 ${current}`}</Hint><TextField title="搜索节点" value={q} onChanged={(v:string)=>{setQ(v);setLimit(80)}}/></Card>
    {nodes.slice(0,limit).map(n=><Button key={n} disabled={busy || !selectable(g)} action={()=>pick(n)}><Card><HStack><Text font={prefs.proxyStyle==="compact"?12:14} foregroundStyle={n===current?"systemBlue":FG}>{`${n===current?"✓ ":""}${n}`}</Text><Spacer/>{delays[n]!==undefined?<Text font={12} foregroundStyle={delayColor(delays[n]) as any}>{delays[n]>0?`${delays[n]} ms`:"超时"}</Text>:<Hint>未测速</Hint>}</HStack></Card></Button>)}
    {!selectable(g)?<Hint>此组类型不实现Mihomo SelectAble，不支持手动指定节点。</Hint>:null}<Pages limit={limit} total={nodes.length} more={()=>setLimit(limit+80)}/>
  </>})
}
async function updateAllProviders(c:Controller,kind:"proxies"|"rules",ps:Provider[],done:()=>void){
  const list=ps.filter(x=>["http","file"].includes(x.vehicleType.toLowerCase()))
  if(!list.length)return
  await attempt(async()=>{const rs=await Promise.allSettled(list.map(x=>updateProvider(c,kind,x.name)));done();if(rs.some(r=>r.status==="rejected"))throw new Error("partial")})
}
// Same visual label for provider and Nikki refresh actions; color stays caller-owned.
function providerRefreshLabel(busy:boolean,color:string="systemBlue") {return busy?<ProgressView progressViewStyle="circular" frame={{width:34,height:34}} background={<Circle fill="tertiarySystemFill"/>}/>:<Image systemName="arrow.triangle.2.circlepath" font={14} foregroundStyle={color} frame={{width:34,height:34}} background={<Circle fill="tertiarySystemFill"/>}/>}
export function ProviderCard({c,p,kind,onChanged}:{c:Controller;p:Provider;kind:"proxies"|"rules";onChanged:()=>void}) {
  const [busy,setBusy]=useState(false),[guard]=useState({alive:true});useEffect(()=>()=>{guard.alive=false},[])
  const refreshable=["http","file"].includes(p.vehicleType.toLowerCase()), label=p.vehicleType.toLowerCase()==="http"?"远程订阅":p.vehicleType
  const ago=(t:string)=>{const m=Math.max(0,Math.floor((Date.now()-Date.parse(t))/60000));return m<1?"刚刚":m<60?`${m}分钟前`:m<1440?`${Math.floor(m/60)}小时前`:`${Math.floor(m/1440)}天前`}
  return <Card><HStack alignment="top"><VStack alignment="leading" spacing={8}><Text font={16} fontWeight="semibold">{p.name}</Text><HStack spacing={12}><HStack spacing={4}><Image systemName="cloud.fill" font={12} foregroundStyle="secondaryLabel"/><Text font={12} foregroundStyle="secondaryLabel">{kind==="rules"&&p.behavior?`${label} · ${p.behavior}`:label}</Text></HStack><HStack spacing={4}><Image systemName="square.stack.3d.up" font={12} foregroundStyle="secondaryLabel"/><Text font={12} foregroundStyle="secondaryLabel">{p.count===null?"数量未提供":`${p.count} ${kind==="proxies"?"节点":"条规则"}`}</Text></HStack></HStack></VStack><Spacer/><VStack alignment="trailing" spacing={8}><Button disabled={busy || !refreshable} buttonStyle="plain" action={async()=>{if(busy)return;setBusy(true);await attempt(async()=>{await updateProvider(c,kind,p.name);if(guard.alive)onChanged()});if(guard.alive)setBusy(false)}}>{providerRefreshLabel(busy)}</Button><Text font={11} foregroundStyle="secondaryLabel">{p.updatedAt?`更新于 ${ago(p.updatedAt)}`:"更新时间未提供"}</Text></VStack></HStack>{!refreshable?<Hint>内联/兼容提供者不提供可下载订阅，更新不可用。</Hint>:null}</Card>
}
const testedDelays=new Map<string,Record<string,number>>(),testedNodes=new Map<string,number>(),probing=new Set<string>()
// Native SF Symbols content replacement: no JS timer, rotation modifier,
// Animation factory or state-update wrapper is required for this transition.
export function GroupChevron({expanded}:{expanded:boolean}) {
  return <Image systemName={expanded?"chevron.down":"chevron.right"} contentTransition="symbolEffect" font={12} foregroundStyle="tertiaryLabel" frame={{width:28,height:28}}/>
}
export function GroupSection({c,g,onChanged,expanded=false}:{c:Controller;g:Group;onChanged:()=>void;expanded?:boolean}) {
  const prefs=usePreferences(),[busy,setBusy]=useState(false),storeKey=`${sourceKey(c)}|${g.name}`,merged=()=>{const o:Record<string,number>={...g.delays};for(const n of g.all){const v=testedNodes.get(`${sourceKey(c)}|${n}`);if(v!==undefined&&o[n]===undefined)o[n]=v}return{...o,...(testedDelays.get(storeKey)??{})}},[delays,setDelays]=useState(merged),[open,setOpen]=useState(false),[nodeLimit,setNodeLimit]=useState(40),[now,setNow]=useState(g.now),[failed,setFailed]=useState<Set<string>>(new Set()),[guard]=useState({alive:true});useEffect(()=>()=>{guard.alive=false},[])
  useEffect(()=>setDelays(merged()),[g.delays,storeKey]);useEffect(()=>setNow(g.now),[g.now]);const d=delays[now]
  const isOpen=expanded||open
  useEffect(()=>{
    if(!isOpen)return
    const missing=g.all.filter(n=>delays[n]===undefined&&!failed.has(n)&&!probing.has(`${storeKey}|${n}`))
    if(!missing.length)return
    for(const n of missing)probing.add(`${storeKey}|${n}`)
    const keep=(d:Record<string,number>)=>{const ok:Record<string,number>={};for(const[k,v]of Object.entries(d))if(v>0){ok[k]=v;testedNodes.set(`${sourceKey(c)}|${k}`,v)}if(Object.keys(ok).length)testedDelays.set(storeKey,{...(testedDelays.get(storeKey)??{}),...ok});return ok}
    ;(async()=>{
      const ok=keep(await testGroup(c,{...g,all:missing},(k,v)=>{if(v>0){keep({[k]:v});if(guard.alive)setDelays(merged())}else if(guard.alive)setFailed(f=>new Set([...f,k]))}).catch(()=>({} as Record<string,number>)))
      const still=missing.filter(n=>ok[n]===undefined)
      if(guard.alive){setDelays(merged());if(still.length)setFailed(f=>new Set([...f,...still]))}
    })().finally(()=>{for(const n of missing)probing.delete(`${storeKey}|${n}`)})
  },[isOpen,storeKey,g.all.length])
  const sorted=useMemo(()=>isOpen?sortedNodes(g,delays):[],[isOpen,g.all,delays,prefs.nodeSort])
  const toggleOpen=()=>{setOpen(v=>!v);feedback()}
  return <Card><HStack onLongPressGesture={()=>{if(prefs.collapseGesture)toggleOpen()}}><Button buttonStyle="plain" frame={{maxWidth:"infinity",alignment:"leading"}} action={toggleOpen}><HStack spacing={12} frame={{maxWidth:"infinity",alignment:"leading"}} contentShape="rect">{prefs.customIcons ? <GroupIcon g={g}/> : null}<VStack alignment="leading" spacing={4}><Text font={16} fontWeight="semibold">{g.name}</Text><HStack spacing={10}><Text font={12} foregroundStyle="secondaryLabel">{now||"内核未提供当前节点"}</Text>{d!==undefined?<><Text font={12} foregroundStyle={delayColor(d) as any}>{d>0?`${d}ms`:"超时"}</Text></>:null}</HStack></VStack><Spacer/></HStack></Button><Button title="" systemImage="bolt.fill" tint="systemOrange" action={async()=>{if(busy)return;setBusy(true);await attempt(async()=>{const save=(k:string,v:number)=>{testedDelays.set(storeKey,{...(testedDelays.get(storeKey)??{}),[k]:v});testedNodes.set(`${sourceKey(c)}|${k}`,v)};const d=await testGroup(c,g,(k,v)=>{save(k,v);if(guard.alive)setDelays(merged())});for(const[k,v]of Object.entries(d))save(k,v);if(guard.alive){setDelays(merged());onChanged()}});if(guard.alive)setBusy(false)}}/><Button buttonStyle="plain" action={toggleOpen}><VStack frame={{width:44,height:44}} contentShape="rect"><GroupChevron expanded={isOpen}/></VStack></Button></HStack>
    {prefs.collapseGesture?<Button title={open?"收起预览":"展开预览"} action={()=>{setOpen(!open);feedback()}}/>:null}
    {expanded||open?<>{(()=>{const ns=sorted.slice(0,nodeLimit),rows:string[][]=[];for(let i=0;i<ns.length;i+=2)rows.push(ns.slice(i,i+2));return rows.map(r=><HStack key={r[0]} spacing={8}>{r.map(n=>{const on=now===n,dn=delays[n];return <Button key={n} buttonStyle="plain" disabled={!selectable(g)} frame={{maxWidth:"infinity"}} action={()=>{if(n===now)return;const prev=now;setNow(n);void attempt(async()=>{try{await selectProxy(c,g.name,n)}catch(e){if(guard.alive)setNow(prev);throw e}if(guard.alive)onChanged()})}}><VStack alignment="leading" spacing={10} frame={{maxWidth:"infinity",alignment:"leading"}} padding={{horizontal:10,vertical:14}} background={<RoundedRectangle cornerRadius={12} fill={on?"systemBlue":"tertiarySystemBackground"}/>}><HStack><Text font={prefs.proxyStyle==="compact"?12:13} fontWeight="semibold" lineLimit={1} foregroundStyle={on?"white":FG}>{n}</Text><Spacer/>{on?<Image systemName="checkmark.circle.fill" font={13} foregroundStyle="white"/>:null}</HStack><HStack spacing={4} frame={{maxWidth:"infinity"}}><Text font={11} foregroundStyle={dn!==undefined?delayColor(dn) as any:"secondaryLabel"}>{dn===undefined?(failed.has(n)?"超时":"未测速"):dn>0?`${dn}ms`:"超时"}</Text><Spacer/><Text font={11} lineLimit={1} foregroundStyle={on?"white":"secondaryLabel"}>{g.types?.[n]||"协议未知"}</Text></HStack></VStack></Button>})}{r.length<2?<Spacer frame={{maxWidth:"infinity"}}/>:null}</HStack>)})()}<Pages hideCount limit={nodeLimit} total={g.all.length} more={()=>setNodeLimit(nodeLimit+40)}/></>:null}
  </Card>
}
const PROXY_MODE_OPTIONS = [["rule","规则模式"],["direct","直连模式"],["global","全局模式"]] as const
const PROXY_MODE_NONE="__none__"
// Memory-only last confirmed core mode per source; never persisted or shared across sources.
const proxyModeCache=new Map<string,string>()
function cachedProxyMode(c:Controller){
 const key=sourceKey(c),known=proxyModeCache.get(key);if(known)return known
 try{const x=Storage.get<any>("dashboard_mode_snapshot_v1");if(x?.source===JSON.stringify(c)&&PROXY_MODE_OPTIONS.some(([v])=>v===x.mode)){proxyModeCache.set(key,x.mode);return x.mode}}catch{}
 return null
}
function rememberProxyMode(c:Controller,mode:string){proxyModeCache.set(sourceKey(c),mode);try{Storage.set("dashboard_mode_snapshot_v1",{source:JSON.stringify(c),mode})}catch{}}
function forgetProxyMode(c:Controller){proxyModeCache.delete(sourceKey(c));try{const x=Storage.get<any>("dashboard_mode_snapshot_v1");if(x?.source===JSON.stringify(c))Storage.set("dashboard_mode_snapshot_v1",null)}catch{}}
const modePrefetch=new Set<string>()
function prefetchProxyMode(c:Controller){const key=sourceKey(c);cachedProxyMode(c);if(modePrefetch.has(key))return;modePrefetch.add(key);void loadConfig(c).then(cfg=>{if(PROXY_MODE_OPTIONS.some(([v])=>v===cfg.mode))rememberProxyMode(c,cfg.mode!)}).catch(()=>{}).finally(()=>modePrefetch.delete(key))}

export const proxyModeCacheForTest=(c:Controller)=>proxyModeCache.get(sourceKey(c))
export function ProxyModeControl({c,enabled,version,resume=0,onMode}:{c:Controller;enabled:boolean;version:number;resume?:number;onMode?:(mode:string|null)=>void}) {
  type Session = {source:string;cacheKey:string;controller:Controller;alive:boolean;visible:boolean;mode:string|null;pending:string|null;loading:boolean;busy:boolean;error:string;read:number}
  const [holder]=useState<{current:Session|null}>({current:null}),[,redraw]=useState(0)
  const source=JSON.stringify(c)
  if(holder.current?.source!==source){const cacheKey=sourceKey(c),known=cachedProxyMode(c);holder.current={source,cacheKey,controller:{...c},alive:true,visible:enabled,mode:known,pending:null,loading:enabled&&!known,busy:false,error:"",read:0}}
  const session=holder.current!
  if(session.visible!==enabled){session.visible=enabled;session.read++;if(!session.busy){session.mode=proxyModeCache.get(session.cacheKey)??null;session.loading=enabled&&!session.mode}}
  const current=()=>session.alive&&session.visible&&holder.current===session
  const paint=()=>{if(current())redraw(n=>n+1)}
  // initial: unknown until read. silent: keep a known value and hide failures.
  // verify: keep the Picker mounted while confirming a write, but clear if it cannot be confirmed.
  async function readMode(message="",retainMessage=false,kind:"initial"|"silent"|"verify"="initial") {
    if(!current())return
    const read=++session.read,keepVisible=kind==="verify"||(kind==="silent"&&!!session.mode),quiet=kind==="silent"&&!!session.mode
    if(!keepVisible){session.mode=null;forgetProxyMode(session.controller);session.loading=true;session.error="";paint()}
    try {
      const cfg=await loadConfig(session.controller)
      if(!current()||read!==session.read)return
      if(PROXY_MODE_OPTIONS.some(([value])=>value===cfg.mode)){session.mode=cfg.mode!;rememberProxyMode(session.controller,cfg.mode!);session.error=retainMessage?message:""}
      else{session.mode=null;forgetProxyMode(session.controller);session.error=message?`${message}；内核未提供可识别的当前模式。`:"内核未提供可识别的代理模式，暂不能切换。"}
    } catch {
      if(current()&&read===session.read&&!quiet){session.mode=null;forgetProxyMode(session.controller);session.error=message?`${message}；当前模式读取失败，请重试读取。`:"代理模式读取失败，请检查连接与权限后重试。"}
    } finally {if(current()&&read===session.read){session.loading=false;paint()}}
  }
  // Report only read-back confirmed modes; unknown/loading/failed states report null.
  useEffect(()=>{if(current())onMode?.(session.mode)},[session,session.mode,enabled])
  useEffect(()=>()=>{session.alive=false;session.read++},[session])
  useEffect(()=>{if(enabled&&!session.busy)void readMode("",false,"silent")},[session,enabled,version,resume])
  async function change(value:string) {
    if(!current()||session.busy||session.loading||!session.mode||value===session.mode||!PROXY_MODE_OPTIONS.some(([mode])=>mode===value))return
    // Lock synchronously; stale callbacks cannot queue a second PATCH or use a new source.
    // Keep the confirmed value/cache and Picker mounted; only the displayed target is optimistic.
    session.busy=true;session.pending=value;session.error="";paint()
    try {
      try {await setControllerMode(session.controller,value)}
      catch {await readMode("代理模式切换失败，已尝试重新读取当前模式",true,"verify");return}
      await readMode("切换请求已发送",false,"verify")
      if(current()&&session.mode===value)session.error=""
      else if(current()&&session.mode)session.error="内核当前模式与请求不一致，已显示实际模式。"
    } finally {session.busy=false;session.pending=null;paint()}
  }
  return <VStack alignment="leading" spacing={10} frame={{maxWidth:"infinity"}}>
    <HStack><Text font={20} fontWeight="bold" padding={{top:6}}>代理模式</Text><Spacer/></HStack>
    {/* Always mounted so layout never jumps; unknown mode uses a tag that matches no segment (no highlight) and is disabled. */}
    <Picker title="代理模式" pickerStyle="segmented" value={session.pending??session.mode??PROXY_MODE_NONE} disabled={!enabled||(session.loading&&!session.mode)||!session.mode} onChanged={change}>{PROXY_MODE_OPTIONS.map(([value,title])=><Text key={value} tag={value}>{title}</Text>)}</Picker>
    {session.error?<Text font={12} foregroundStyle="systemRed">{session.error}</Text>:null}
    {!session.loading&&!session.busy&&!session.mode?<Button title="重试读取代理模式" disabled={!enabled} action={()=>readMode()}/>:null}
  </VStack>
}
export function ProxyTestSettings() {
  const p = usePreferences(["testTimeout"])
  return <>
    <HStack><Text font={20} fontWeight="bold" padding={{top:6}}>测速设置</Text><Spacer/></HStack>
    <Card><VStack alignment="leading" spacing={0} padding={{vertical:6}} frame={{maxWidth:"infinity",alignment:"leading"}}><TestURLField /></VStack><Divider /><Range title="超时时间" min={1000} max={10000} step={100} value={p.testTimeout} suffix=" ms" onChanged={n => updatePreference({ testTimeout: n })} /></Card>
    <HStack><Text font={20} fontWeight="bold" padding={{top:6}}>延迟阈值</Text><Spacer/></HStack>
    <Card><ThresholdRange /></Card>
  </>
}
const proxyCache=new Map<string,{groups:Group[];providers:Provider[]}>()
const PROXY_SNAPSHOT_KEY="dashboard_proxy_snapshot_v1"
let proxySnapshotText=""
// Keep the last proxy list on this device so the first frame after launch shows it while the live request refreshes it.
function setProxyCache(key:string,value:{groups:Group[];providers:Provider[]}){
  proxyCache.set(key,value)
  try{const snapshot={key,groups:value.groups,providers:value.providers},text=JSON.stringify(snapshot);if(text===proxySnapshotText||text.length>800000)return;proxySnapshotText=text;Storage.set(PROXY_SNAPSHOT_KEY,snapshot)}catch{}
}
function hydrateProxyCache(key:string){
  const known=proxyCache.get(key);if(known||!key)return known
  try{const raw=Storage.get<any>(PROXY_SNAPSHOT_KEY);if(raw?.key===key&&Array.isArray(raw.groups)){const value={groups:raw.groups as Group[],providers:Array.isArray(raw.providers)?raw.providers as Provider[]:[]};proxyCache.set(key,value);return value}}catch{}
  return undefined
}
const proxyPrefetch=new Set<string>(),proxyPrefetched=new Set<string>()
// Start loading as early as possible (before the first screen) and fill the cache; failures stay silent and the page loads normally.
export function prefetchProxies(active:Controller|null){
  if(!active)return;prefetchProxyMode(active);const key=sourceKey(active);hydrateProxyCache(key);if(proxyPrefetched.has(key)||proxyPrefetch.has(key))return;proxyPrefetch.add(key)
  void Promise.all([loadGroups(active,{includeGlobal:false}).catch(()=>null),loadProviders(active,"proxies").catch(()=>null)]).then(([groups,providers])=>{
    const old=proxyCache.get(key);if(groups||providers){proxyPrefetched.add(key);setProxyCache(key,{groups:groups??old?.groups??[],providers:providers??old?.providers??[]})}
  }).finally(()=>{proxyPrefetch.delete(key)})
}
// Read owners need a monotonic invalidation even when background/active events
// arrive before one render. Epoch checks also reject results before effect cleanup.
function usePageScene(){
  const [scene]=useState({active:true,epoch:0,vis:new SceneVisibility(),restore:undefined as undefined|(()=>void)}),[revision,setRevision]=useState(0)
  useEffect(()=>{const changed=(phase:"active"|"inactive"|"background")=>{const active=phase==="active";if(scene.vis.scene(active,Date.now()))scene.restore?.();if(scene.active===active)return;scene.active=active;scene.epoch++;setRevision(n=>n+1)};AppEvents.scenePhase.addListener(changed);return()=>AppEvents.scenePhase.removeListener(changed)},[])
  return {scene,revision}
}
export function ProxiesPage({active,version,onClose,selected=true}:{active:Controller|null;version:number;onClose?:()=>void;selected?:boolean}) {
  const p=usePreferences(),cacheKey=active?sourceKey(active):"",cached=hydrateProxyCache(cacheKey),[groups,setGroups]=useState<Group[]>(cached?.groups??[]),[providers,setProviders]=useState<Provider[]>(cached?.providers??[]),[loaded,setLoaded]=useState(!!cached),[err,setErr]=useState(""),[tick,setTick]=useState(0),[expanded,setExpanded]=useState(false),[showProviders,setShowProviders]=useState(true),[limit,setLimit]=useState(40),[visible,setVisible]=useState(selected),[confirmedMode,setConfirmedMode]=useState<{key:string;mode:string|null}>(()=>({key:cacheKey,mode:proxyModeCache.get(cacheKey)??null})),globalMode=confirmedMode.key===cacheKey&&confirmedMode.mode==="global"
  const {scene,revision}=usePageScene()
  scene.restore=()=>{if(selected)setVisible(true)}
  useEffect(()=>setVisible(selected),[selected])
  useEffect(()=>{const c=hydrateProxyCache(cacheKey);setGroups(c?.groups??[]);setProviders(c?.providers??[]);setLoaded(!!c)},[cacheKey])
  useEffect(()=>{if(!active||!selected||!visible||!scene.active)return;let alive=true;const epoch=scene.epoch,current=()=>alive&&scene.active&&scene.epoch===epoch;setErr("");loadGroups(active,{includeGlobal:globalMode}).then(x=>{if(current()){setGroups(x);setLoaded(true);setErr("");setProxyCache(cacheKey,{groups:x,providers:proxyCache.get(cacheKey)?.providers??[]})}}).catch(()=>{if(current())setErr(safeError())});return()=>{alive=false}},[active&&sourceKey(active),version,tick,p.showHidden,p.showGlobal,globalMode,p.nestedDelay,selected,visible,revision])
  useEffect(()=>{if(!active||!showProviders||!selected||!visible||!scene.active)return;let alive=true;const epoch=scene.epoch,current=()=>alive&&scene.active&&scene.epoch===epoch;loadProviders(active,"proxies").then(x=>{if(current()){setProviders(x);setProxyCache(cacheKey,{groups:proxyCache.get(cacheKey)?.groups??[],providers:x})}}).catch(()=>{if(current())setErr("代理来源读取不可用：当前内核不支持或权限不足；显示的0是已加载数量，不代表远端总数。")});return()=>{alive=false}},[active&&sourceKey(active),tick,showProviders,selected,visible,revision])
  const remote=providers.filter(x=>x.vehicleType.toLowerCase()==="http")
  const shownGroups=groups.filter(g=>g.name!=="GLOBAL"||p.showGlobal||globalMode)
  const menu=<Menu label={<Image systemName="ellipsis.circle"/>}><Picker title="节点排序" pickerStyle="menu" value={p.nodeSort} onChanged={(v:string)=>savePreferences({nodeSort:v as any})}>{NODE_SORT_OPTIONS.map(([key, label]) => <Text key={key} tag={key}>{label}</Text>)}</Picker><Toggle title="展示全部代理组" value={expanded} onChanged={setExpanded}/><Toggle title="显示代理来源" value={showProviders} onChanged={setShowProviders}/><Toggle title="显示隐藏组" value={p.showHidden} onChanged={(v:boolean)=>savePreferences({showHidden:v})}/><Toggle key="customIcons" title="显示图标" value={p.customIcons} onChanged={(v:boolean)=>updatePreference({customIcons:v})}/><Toggle key="disconnectOnSwitch" title="自动断开旧连接" value={p.disconnectOnSwitch} onChanged={(v:boolean)=>updatePreference({disconnectOnSwitch:v})}/></Menu>
  return Shell({title:active?.name??"代理",toolbar:rootToolbar("proxies",onClose,menu),onAppear:()=>{scene.vis.appear();setVisible(true)},onDisappear:()=>{if(scene.vis.disappear(Date.now()))setVisible(false)},children:<>{!active?<Empty/>:<><ProxyModeControl key={JSON.stringify(active)} c={active} enabled={selected&&visible&&scene.active} version={version} resume={revision} onMode={mode=>setConfirmedMode({key:cacheKey,mode})}/><HStack><Text font={20} fontWeight="bold" padding={{top:6}}>策略组</Text><Spacer/></HStack>{err?<Hint>{err}</Hint>:null}{!err&&loaded&&shownGroups.length===0?<Hint>未读取到策略组</Hint>:null}{shownGroups.slice(0,limit).map(g=><GroupSection key={g.name} c={active} g={g} expanded={expanded} onChanged={()=>setTick(t=>t+1)}/>)}<Pages hideCount limit={limit} total={shownGroups.length} more={()=>setLimit(limit+40)}/>{showProviders?<><HStack><Text font={20} fontWeight="bold" padding={{top:6}}>代理来源</Text><Spacer/></HStack>{remote.slice(0,limit).map(p=><ProviderCard key={p.name} c={active} p={p} kind="proxies" onChanged={()=>setTick(t=>t+1)}/>)}<Pages hideCount limit={limit} total={remote.length} more={()=>setLimit(limit+40)}/></>:null}</>}<ProxyTestSettings /></>})
}
function ruleColor(type:string) { return /AND|OR|NOT|MATCH/.test(type)?"systemRed":/PROCESS/i.test(type)?"systemPurple":/IP|GEOIP/i.test(type)?"systemGreen":"systemBlue" }
// Last-seen rules / connections are kept on this device and loaded at launch, so the first frame is not empty while the live request runs.
function snapshotStore(storageKey:string){
  let last=""
  return {
    save(key:string,value:Record<string,any>){try{const snap={key,at:Date.now(),...value},text=JSON.stringify({key,...value});if(text===last||text.length>800000)return;last=text;Storage.set(storageKey,snap)}catch{}},
    load(key:string,maxAge=Infinity):any{try{const raw=Storage.get<any>(storageKey);if(raw?.key===key&&Date.now()-(raw.at??0)<=maxAge)return raw}catch{}return undefined}
  }
}
const rulesSnap=snapshotStore("dashboard_rules_snapshot_v1"),rulesCache=new Map<string,{rules:Rule[];providers:Provider[]}>()
function hydrateRules(key:string){
  const known=rulesCache.get(key);if(known||!key)return known
  const raw=rulesSnap.load(key);if(raw&&Array.isArray(raw.rules)){const value={rules:raw.rules as Rule[],providers:Array.isArray(raw.providers)?raw.providers as Provider[]:[]};rulesCache.set(key,value);return value}
  return undefined
}
function setRulesCache(key:string,value:{rules:Rule[];providers:Provider[]}){rulesCache.set(key,value);rulesSnap.save(key,value)}
const rulesPrefetch=new Set<string>(),rulesPrefetched=new Set<string>()
export function prefetchRules(active:Controller|null){
  if(!active)return;const key=sourceKey(active);hydrateRules(key);if(rulesPrefetched.has(key)||rulesPrefetch.has(key))return;rulesPrefetch.add(key)
  void Promise.all([loadRules(active).catch(()=>null),loadProviders(active,"rules").catch(()=>null)]).then(([rules,providers])=>{
    const old=rulesCache.get(key);if(rules||providers){rulesPrefetched.add(key);setRulesCache(key,{rules:rules??old?.rules??[],providers:providers??old?.providers??[]})}
  }).finally(()=>{rulesPrefetch.delete(key)})
}
const CONN_SNAPSHOT_MAX_AGE=600000,connSnap=snapshotStore("dashboard_connections_snapshot_v1"),connCache=new Map<string,{at:number;conns:Conn[]}>()
let connPersistedAt=0
function frozenConns(xs:Conn[]){return xs.slice(0,300).map(x=>({...x,upSpeed:0,downSpeed:0}))}
// Connections are live data: a saved list is only shown briefly (and only if recent) until the first real sample replaces it.
function hydrateConns(key:string):Conn[]|undefined{
  if(!key)return undefined
  const known=connCache.get(key);if(known&&Date.now()-known.at<=CONN_SNAPSHOT_MAX_AGE)return known.conns
  const raw=connSnap.load(key,CONN_SNAPSHOT_MAX_AGE);if(raw&&Array.isArray(raw.conns)){connCache.set(key,{at:raw.at,conns:raw.conns as Conn[]});return raw.conns as Conn[]}
  return undefined
}
function setConnCache(key:string,xs:Conn[]){
  const conns=frozenConns(xs),now=Date.now();connCache.set(key,{at:now,conns})
  if(now-connPersistedAt>10000){connPersistedAt=now;connSnap.save(key,{conns})}
}
const connPrefetch=new Set<string>(),connPrefetched=new Set<string>()
export function prefetchConnections(active:Controller|null){
  if(!active)return;const key=sourceKey(active);hydrateConns(key);if(connPrefetched.has(key)||connPrefetch.has(key))return;connPrefetch.add(key)
  void loadConnections(active).then(xs=>{connPrefetched.add(key);setConnCache(key,xs)}).catch(()=>{}).finally(()=>{connPrefetch.delete(key)})
}
export function RulesPage({active,version,onClose,selected=true}:{active:Controller|null;version:number;onClose?:()=>void;selected?:boolean}) {
  const prefs=usePreferences()
  const rulesKey=active?sourceKey(active):"",rulesCached=hydrateRules(rulesKey),[rules,setRules]=useState<Rule[]>(rulesCached?.rules??[]),[providers,setProviders]=useState<Provider[]>(rulesCached?.providers??[]),[tab,setTab]=useState("rules"),[qRules,setQRules]=useState(""),[qProv,setQProv]=useState(""),[search,setSearch]=useState(false),[limit,setLimit]=useState(80),[pendingRules,setPendingRules]=useState<number[]>([]),[tick,setTick]=useState(0),[err,setErr]=useState(""),[visible,setVisible]=useState(selected)
  useEffect(()=>{const c=hydrateRules(rulesKey);setRules(c?.rules??[]);setProviders(c?.providers??[])},[rulesKey])
  // Pull-to-refresh and effect reads share one reader. Results are published only while their
  // owner (source/version/mount generation) is current; a stale read can never overwrite newer data.
  const [pullBox]=useState({gen:0,pull:undefined as undefined|Promise<void>,mounted:true,rev:0,busy:new Set<string>()})
  const reloadRules=(current:()=>boolean):Promise<void>=>{
    if(!active)return Promise.resolve()
    setErr("")
    const rev=pullBox.rev
    const a=loadRules(active).then(xs=>{if(current()&&rev===pullBox.rev){setRules(xs);setRulesCache(rulesKey,{rules:xs,providers:rulesCache.get(rulesKey)?.providers??[]})}}).catch(()=>{if(current())setErr(safeError())})
    const b=loadProviders(active,"rules").then(xs=>{if(current()){setProviders(xs);setRulesCache(rulesKey,{rules:rulesCache.get(rulesKey)?.rules??[],providers:xs})}}).catch(()=>{if(current())setErr("规则提供者数量未提供：内核未支持或权限不足；分段显示的是已加载数量。规则列表独立读取。")})
    return Promise.all([a,b]).then(()=>{})
  }
  useEffect(()=>{pullBox.mounted=true;return()=>{pullBox.mounted=false;pullBox.gen++;pullBox.pull=undefined}},[])
  useEffect(()=>{pullBox.gen++;pullBox.pull=undefined},[active&&sourceKey(active),version])
  useEffect(()=>{if(!active||!visible)return;let alive=true;void reloadRules(()=>alive);return()=>{alive=false}},[active&&sourceKey(active),version,tick,visible])
  // Pull = former "全部更新" (no confirmation, same updateAllProviders semantics and failure alert) followed by
  // the former "刷新规则" re-read. The promise ends only when both have really finished or failed.
  const pullRules=():Promise<void>=>{
    if(!active)return Promise.resolve()
    if(pullBox.pull)return pullBox.pull
    const gen=pullBox.gen,current=()=>pullBox.mounted&&pullBox.gen===gen
    const p:Promise<void>=updateAllProviders(active,"rules",providers,()=>{}).then(()=>current()?reloadRules(current):undefined).then(()=>{if(pullBox.pull===p)pullBox.pull=undefined})
    pullBox.pull=p;return p
  }
  // Optimistic toggle -> PATCH -> read back. Busy per (source,index) so repeats never run concurrently.
  const toggleRule=async(r:Rule,disabled:boolean)=>{
    if(!active||!ruleToggleSupported(r))return
    const idx=r.index as number,key=rulesKey+"#"+idx
    if(pullBox.busy.has(key))return
    pullBox.busy.add(key);setPendingRules(xs=>[...xs,idx])
    const gen=pullBox.gen,current=()=>pullBox.mounted&&pullBox.gen===gen,src=active
    const put=(value:boolean)=>{
      const map=(xs:Rule[])=>xs.map(x=>x.index===idx?{...x,disabled:value}:x)
      pullBox.rev++;setRulesCache(rulesKey,{rules:map(rulesCache.get(rulesKey)?.rules??rules),providers:rulesCache.get(rulesKey)?.providers??[]})
      if(current())setRules(map)
    }
    try{
      put(disabled);if(current())setErr("")
      try{await setRuleDisabled(src,idx,disabled)}catch{put(!disabled);if(current())setErr(safeError());return}
      let verified=false
      try{
        const xs=await loadRules(src),got=xs.find(x=>x.index===idx)
        pullBox.rev++;setRulesCache(rulesKey,{rules:xs,providers:rulesCache.get(rulesKey)?.providers??[]});if(current())setRules(xs)
        verified=got?.disabled===disabled
        if(!verified&&current())setErr("规则状态未生效，已按内核当前状态显示")
      }catch{verified=true;if(current())setErr("已发送开关请求，但回读规则失败；显示的是未经确认的状态")}
      if(disabled&&verified&&getPreferences().interruptOnRuleDisable){
        const res=await closeRuleConnections(src,r.type,r.payload)
        if(current()){
          if(res.readFailed)setErr("已禁用规则，但读取连接失败，未能打断相关连接")
          else if(res.failed>0)setErr(`已禁用规则，但有 ${res.failed} 条连接未能关闭`)
        }
      }
    }finally{pullBox.busy.delete(key);if(current())setPendingRules(xs=>xs.filter(x=>x!==idx))}
  }
  const shown=useMemo(()=>{
    const needle=qRules.toLowerCase(),matches:(Rule&{no:number})[]=[]
    // Keep original rule numbers, but allocate indexed copies only for matches.
    for(let i=0;i<rules.length;i++){const r=rules[i];if([r.type,r.payload,r.proxy].join(" ").toLowerCase().includes(needle))matches.push({...r,no:i+1})}
    return matches
  },[rules,qRules])
  const shownProviders=useMemo(()=>{const needle=qProv.toLowerCase();return needle?providers.filter(p=>[p.name,p.type,p.vehicleType].join(" ").toLowerCase().includes(needle)):providers},[providers,qProv])
  return Shell({title:active?.name??"规则",refresh:pullRules,onAppear:()=>setVisible(true),onDisappear:()=>setVisible(false),toolbar:rootToolbar("rules",onClose,<Menu label={<Image systemName="ellipsis.circle"/>}><Toggle title="禁用规则时打断连接" value={prefs.interruptOnRuleDisable} onChanged={(v:boolean)=>savePreferences({interruptOnRuleDisable:v})}/></Menu>),children:<>{!active?<Empty/>:<><VStack spacing={6} padding={6} background={<RoundedRectangle cornerRadius={16} fill="secondarySystemBackground"/>}>
      <HStack spacing={6}>
        {(["rules","providers"] as const).map(k=><Button key={k} buttonStyle="plain" action={()=>{setTab(k);setLimit(80)}}><HStack spacing={6} padding={{horizontal:8,vertical:6}} background={<RoundedRectangle cornerRadius={12} fill={tab===k?"systemBackground":"clear"}/>}><Text font={13} fontWeight={tab===k?"semibold":"regular"} foregroundStyle={tab===k?"label":"secondaryLabel"}>{k==="rules"?"规则":"提供者"}</Text><Text font={11} foregroundStyle={tab===k?"label":"secondaryLabel"} padding={{horizontal:6,vertical:1}} background={<RoundedRectangle cornerRadius={8} fill="tertiarySystemFill"/>}>{String(k==="rules"?rules.length:providers.length)}</Text></HStack></Button>)}
        <Spacer/>
        <Button buttonStyle="plain" accessibilityLabel="搜索规则与提供者" action={()=>setSearch(!search)}><Image systemName="magnifyingglass" font={14} foregroundStyle={search?"systemBlue":"secondaryLabel"} frame={{width:32,height:32}} background={<RoundedRectangle cornerRadius={12} fill={search?"tertiarySystemFill":"clear"}/>}/></Button>
      </HStack>
      {search?<HStack spacing={0} background={<RoundedRectangle cornerRadius={10} fill="systemBackground"/>}>
        <TextField title={tab==="providers"?"搜索提供者...":"搜索规则..."} prompt={tab==="providers"?"搜索提供者...":"搜索规则..."} labelsHidden textFieldStyle="plain" axis="horizontal" lineLimit={1} value={tab==="providers"?qProv:qRules} onChanged={(v:string)=>{if(tab==="providers")setQProv(v);else setQRules(v);setLimit(80)}} font={16} padding={{horizontal:8}} frame={{height:36,maxWidth:"infinity"}}/>
        {(tab==="providers"?qProv:qRules).length>0?<Button buttonStyle="plain" accessibilityLabel={tab==="providers"?"清除提供者搜索":"清除规则搜索"} action={()=>{if(tab==="providers")setQProv("");else setQRules("");setLimit(80)}} padding={{trailing:4}}><Image systemName="xmark.circle.fill" font={16} foregroundStyle="secondaryLabel" frame={{width:32,height:32}}/></Button>:null}
      </HStack>:null}
    </VStack>{err?<Hint>{err}</Hint>:null}{tab==="providers"?<>{shownProviders.slice(0,limit).map(p=><ProviderCard key={p.name} c={active} p={p} kind="rules" onChanged={()=>setTick(t=>t+1)}/>)}<Pages hideCount limit={limit} total={shownProviders.length} more={()=>setLimit(limit+80)}/></>:<>{shown.slice(0,limit).map(r=><Card key={String(r.no)}><HStack spacing={8}><Hint>{`#${r.no}`}</Hint><Chip title={r.type} color={ruleColor(r.type)}/><Text font={13} opacity={r.disabled?0.45:1}>{r.payload||"—"}</Text><Spacer/><Text font={12} foregroundStyle="secondaryLabel" opacity={r.disabled?0.45:1}>{r.proxy}</Text>{ruleToggleSupported(r)?<Toggle title="启用规则" labelsHidden value={!r.disabled} disabled={pendingRules.includes(r.index as number)} scaleEffect={0.75} frame={{width:46}} onChanged={(v:boolean)=>{void toggleRule(r,!v)}}/>:null}</HStack></Card>)}<Pages hideCount limit={limit} total={shown.length} more={()=>setLimit(limit+80)}/></>}</>}</>})
}
const pad2=(n:number)=>String(n).padStart(2,"0")
const fmtClock=(t:number)=>{const d=new Date(t);return `${pad2(d.getMonth()+1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3,"0")}`}
function DetailRow({title,value,color}:{title:string;value:string;color?:string}) { return <HStack><Text>{title}</Text><Spacer/><Text foregroundStyle={(color??"secondaryLabel") as any} lineLimit={2}>{value||"未提供"}</Text></HStack> }
export function ConnectionDetailPage({x,onDisconnect}:{x:Conn;onDisconnect:(x:Conn)=>void}) {
  const end=x.closedAt??Date.now(),dstPort=x.dst.lastIndexOf(":")>0?x.dst.slice(x.dst.lastIndexOf(":")+1):"",dstIP=x.dst.lastIndexOf(":")>0?x.dst.slice(0,x.dst.lastIndexOf(":")):x.dst
  return <Form navigationTitle={x.host} navigationBarTitleDisplayMode="inline" toolbar={x.closedAt?undefined:{topBarTrailing:<Button title="断开" action={()=>onDisconnect(x)}/>}}>
    <Section header={<Text>周期</Text>}><DetailRow title="请求时间" value={x.start?fmtClock(x.start):""}/><DetailRow title="状态" value={x.closedAt?"已关闭":"活跃中"} color={x.closedAt?"secondaryLabel":"systemGreen"}/><DetailRow title="持续时间" value={x.start?fmtUptime(Math.max(0,(end-x.start)/1000)):""}/></Section>
    <Section header={<Text>目标地址</Text>}><DetailRow title="地址" value={x.host}/><DetailRow title="端口" value={dstPort}/><DetailRow title="目标IP" value={dstIP}/></Section>
    <Section header={<Text>流量</Text>}><HStack><VStack alignment="leading" spacing={2}><Hint>上传</Hint><Text font={20} fontWeight="semibold">{fmtBytes(x.up)}</Text><Text font={13} foregroundStyle="systemBlue">{fmtSpeed(x.upSpeed??0)}</Text></VStack><Spacer/><VStack alignment="leading" spacing={2}><Hint>下载</Hint><Text font={20} fontWeight="semibold">{fmtBytes(x.down)}</Text><Text font={13} foregroundStyle="systemGreen">{fmtSpeed(x.downSpeed??0)}</Text></VStack><Spacer/></HStack></Section>
    <Section header={<Text>源信息</Text>}><DetailRow title="源地址" value={x.src}/><DetailRow title="网络" value={x.network}/><DetailRow title="类型" value={x.inboundType??""}/></Section>
    <Section header={<Text>规则</Text>}><DetailRow title="规则" value={x.rule}/><DetailRow title="链路" value={(x.chains??[]).join(" → ")}/></Section>
    <Section header={<Text>标识</Text>}><DetailRow title="ID" value={x.id}/></Section>
  </Form>
}
export function ConnectionsPage({active,version,onClose,selected=true}:{active:Controller|null;version:number;onClose?:()=>void;selected?:boolean}) {
  const prefs=usePreferences(),[conns,setConns]=useState<Conn[]>(()=>active?hydrateConns(sourceKey(active))??[]:[]),[closed,setClosed]=useState<Conn[]>([]),[visible,setVisible]=useState(selected),[tab,setTab]=useState("active"),[err,setErr]=useState(""),[q,setQ]=useState(""),[search,setSearch]=useState(false),[client,setClient]=useState(""),[labelsOpen,setLabelsOpen]=useState(false),[labels,setLabels]=useState<Record<string,string>>({}),[labelIP,setLabelIP]=useState(""),[label,setLabel]=useState(""),[limit,setLimit]=useState(60),[tick,setTick]=useState(0),[fresh,setFresh]=useState<Record<string,number>>({}),[sort,setSort]=useState("new"),[seenBox]=useState({seen:new Set<string>(),init:false}),[foreground,setForeground]=useState(true),[resume,setResume]=useState(0),[scene]=useState({active:true,epoch:0,stop:undefined as undefined|(()=>void),vis:new SceneVisibility(),selected:selected,pull:undefined as undefined|(()=>Promise<void>)})
  // A boolean alone misses background -> active batched into one render (or a
  // repeated active). Every resume needs a new owner after epoch invalidation.
  useEffect(()=>{const changed=(phase:"active"|"inactive"|"background")=>{if(scene.vis.scene(phase==="active",Date.now())&&scene.selected)setVisible(true);scene.active=phase==="active";scene.epoch++;scene.stop?.();setForeground(scene.active);if(scene.active){setResume(n=>n+1);setErr("");setFresh({})}};AppEvents.scenePhase.addListener(changed);return()=>{scene.stop?.();AppEvents.scenePhase.removeListener(changed)}},[])
  scene.selected=selected
  useEffect(()=>{setVisible(selected)},[selected])
  useEffect(()=>{if(!active)return;seenBox.seen.clear();seenBox.init=false;setFresh({});setLabels(clientLabels(active));setConns(hydrateConns(sourceKey(active))??[]);setClosed(historyFor(active).closed);setClient("")},[active&&sourceKey(active)])
  useEffect(()=>{if(active&&selected&&visible&&foreground)historyFor(active).resume()},[active&&sourceKey(active),selected,visible,foreground,resume])
  useEffect(()=>{
    // Delays belong to this poll owner, not to the retained page. A restart must
    // reveal rows whose previous owner's callbacks can no longer complete.
    setFresh({})
    if(!active||!selected||!visible||!foreground)return
    let alive=true,request: {abort:AbortController;at:number}|undefined
    const timers=new Set<ReturnType<typeof setTimeout>>()
    const epoch=scene.epoch,current=()=>alive&&scene.active&&epoch===scene.epoch
    // Native timeout/abort may settle only after JS resumes. Bound publication
    // by wall-clock age too, and reuse the normal poll to replace expired reads.
    const maxAge=Math.max(1500,prefs.requestTimeout*1000)
    setErr("");const h=historyFor(active)
    let flight:Promise<void>|undefined
    async function run(){
      if(!current())return
      if(request){
        if(Date.now()-request.at<maxAge)return
        request.abort.abort();request=undefined;h.resume()
      }
      const owned={abort:new AbortController(),at:Date.now()};request=owned
      const publishable=()=>current()&&request===owned&&Date.now()-owned.at<maxAge
      try{
        const xs=await loadConnections(active!,owned.abort.signal)
        if(publishable()){
          h.sample(xs,Date.now());setConns([...h.active]);setConnCache(sourceKey(active!),h.active);setClosed([...h.closed]);setErr("")
          const ids=[...h.active.map(x=>"a:"+x.id),...h.closed.map(x=>"c:"+x.id)]
          if(seenBox.init){
            const nw=ids.filter(id=>!seenBox.seen.has(id))
            if(nw.length){
              setFresh(f=>({...f,...Object.fromEntries(nw.map(id=>[id,1]))}))
              // Preserve the existing 60..600ms stagger, but batch rows sharing
              // a deadline instead of creating one timer/state update per row.
              for(let i=0;i<Math.min(nw.length,10);i++){
                const batch=i===9?nw.slice(i):[nw[i]]
                let timer:ReturnType<typeof setTimeout>
                timer=setTimeout(()=>{timers.delete(timer);if(current())setFresh(f=>{const o={...f};for(const id of batch)delete o[id];return o})},60*(i+1))
                timers.add(timer)
              }
            }
          }
          // Closed history is already bounded; do not retain every ID ever seen.
          seenBox.seen=new Set(ids);seenBox.init=true
        }
      }catch{if(publishable()){setErr(safeError())}}finally{if(request===owned){if(current()&&Date.now()-owned.at>=maxAge){h.resume()}request=undefined}}
    }
    // One owner for poll and pull: a pull joins the unexpired in-flight read instead of duplicating it.
    function refresh():Promise<void>{
      if(request&&flight&&Date.now()-request.at<maxAge)return flight
      const p:Promise<void>=run().finally(()=>{if(flight===p)flight=undefined});flight=p;return p
    }
    void refresh();const t=setInterval(refresh,1500)
    scene.pull=refresh
    const stop=()=>{if(!alive)return;alive=false;if(scene.pull===refresh)scene.pull=undefined;request?.abort.abort();request=undefined;clearInterval(t);for(const timer of timers)clearTimeout(timer);timers.clear()}
    scene.stop=stop
    return()=>{stop();if(scene.stop===stop)scene.stop=undefined}
  },[active&&sourceKey(active),version,selected,visible,tick,foreground,resume,prefs.requestTimeout])
  const sortFns:Record<string,(a:Conn,b:Conn)=>number>={new:(a,b)=>(b.start||0)-(a.start||0),old:(a,b)=>(a.start||0)-(b.start||0),down:(a,b)=>(b.downSpeed??0)-(a.downSpeed??0),up:(a,b)=>(b.upSpeed??0)-(a.upSpeed??0),traffic:(a,b)=>(b.up+b.down)-(a.up+a.down)}
  const shown=[...filterConnections((tab==="active"?conns:closed).filter(x=>!fresh[(tab==="active"?"a:":"c:")+x.id]),q,client,labels)].sort(sortFns[sort]),clients=Array.from(new Set([...conns,...closed].map(x=>x.sourceIP??"").filter(Boolean)))
  async function close(x?:Conn){if(!active)return;await attempt(async()=>{if(await confirmed(active.name,x?`断开到 ${x.host} 的连接（${x.src}）。应用可能重新建立连接。`:`断开此Mihomo内核的全部活动连接（当前观察 ${conns.length} 条）。应用可能重新建立连接。`,()=>x?closeConnection(active,x.id):closeAllConnections(active)))setTick(t=>t+1)})}
  // Pull-to-refresh joins the poll owner's read (no duplicate request or publish). Hidden/background: nothing to refresh.
  const pullConnections=():Promise<void>=>{
    if(!active||!selected||!visible||!foreground||!scene.active)return Promise.resolve()
    return scene.pull?scene.pull():Promise.resolve()
  }
  return Shell({title:active?.name??"连接",refresh:pullConnections,onAppear:()=>{scene.vis.appear();setVisible(true);setResume(n=>n+1)},onDisappear:()=>{if(scene.vis.disappear(Date.now())){scene.stop?.();setVisible(false)}}, toolbar:rootToolbar("connections",onClose,<Menu label={<Image systemName="ellipsis.circle"/>}><Button title="客户端标签" action={()=>setLabelsOpen(!labelsOpen)}/><Button title="清理已断开连接" action={async()=>{if(active&&await confirmed(`${active.name} · 本地历史`,"清理本脚本已观察到的已断开历史，不操作远端连接。",async()=>{historyFor(active).clear();setClosed([])}))feedback()}}/><Button title="打断全部连接" action={()=>close()}/></Menu>),children:<>{!active?<Empty/>:<><VStack spacing={6} padding={6} background={<RoundedRectangle cornerRadius={16} fill="secondarySystemBackground"/>}>
      <HStack spacing={6}>
        {(["active","closed"] as const).map(k=><Button key={k} buttonStyle="plain" action={()=>{setTab(k);setLimit(60)}}><HStack spacing={6} padding={{horizontal:8,vertical:6}} background={<RoundedRectangle cornerRadius={12} fill={tab===k?"systemBackground":"clear"}/>}><Circle fill={k==="active"?(tab===k?"systemGreen":"tertiaryLabel"):"tertiaryLabel"} frame={{width:6,height:6}}/><Text font={13} fontWeight={tab===k?"semibold":"regular"} foregroundStyle={tab===k?"label":"secondaryLabel"}>{k==="active"?"活动中":"已关闭"}</Text><Text font={11} foregroundStyle={tab===k?"systemGreen":"secondaryLabel"} padding={{horizontal:6,vertical:1}} background={<RoundedRectangle cornerRadius={8} fill="tertiarySystemFill"/>}>{String(k==="active"?conns.length:closed.length)}</Text></HStack></Button>)}
        <Spacer/>
        <Button buttonStyle="plain" action={()=>setSearch(!search)}><Image systemName="magnifyingglass" font={14} foregroundStyle={search?"systemBlue":"secondaryLabel"} frame={{width:32,height:32}} background={<RoundedRectangle cornerRadius={12} fill={search?"tertiarySystemFill":"clear"}/>}/></Button>
        <Menu label={<Image systemName="arrow.up.arrow.down" font={14} foregroundStyle="secondaryLabel" frame={{width:32,height:32}}/>}><Button title={sort==="new"?"✓ 最新优先":"最新优先"} action={()=>setSort("new")}/><Button title={sort==="old"?"✓ 最早优先":"最早优先"} action={()=>setSort("old")}/><Button title={sort==="down"?"✓ 下载速率":"下载速率"} action={()=>setSort("down")}/><Button title={sort==="up"?"✓ 上传速率":"上传速率"} action={()=>setSort("up")}/><Button title={sort==="traffic"?"✓ 累计流量":"累计流量"} action={()=>setSort("traffic")}/></Menu>
        
      </HStack>
      {search?<HStack spacing={0} background={<RoundedRectangle cornerRadius={10} fill="systemBackground"/>}>
        <TextField title="搜索连接..." prompt="搜索连接..." labelsHidden textFieldStyle="plain" axis="horizontal" lineLimit={1} value={q} onChanged={(v:string)=>{setQ(v);setLimit(60)}} font={16} padding={{horizontal:8}} frame={{height:36,maxWidth:"infinity"}}/>
        {q.length>0?<Button buttonStyle="plain" accessibilityLabel="清除连接搜索" action={()=>{setQ("");setLimit(60)}} padding={{trailing:4}}><Image systemName="xmark.circle.fill" font={16} foregroundStyle="secondaryLabel" frame={{width:32,height:32}}/></Button>:null}
      </HStack>:null}
    </VStack>{err?<Hint>{err}</Hint>:null}{labelsOpen?<Card><Hint>标签仅保存在本地，并按完整sourceIP匹配，不修改路由器。</Hint><Picker title="来源地址" pickerStyle="menu" value={labelIP} onChanged={(v:string)=>{setLabelIP(v);setLabel(labels[v]||"")}}><Text tag="">选择客户端</Text>{clients.map(ip=><Text key={ip} tag={ip}>{ip}</Text>)}</Picker><TextField title="客户端标签" value={label} onChanged={setLabel}/><Button title="保存本地标签" disabled={!labelIP} action={()=>attempt(async()=>{saveClientLabel(active,labelIP,label);setLabels(clientLabels(active))})}/></Card>:null}
    {shown.slice(0,limit).map(x=>{const ago=(t:number)=>{const m=Math.max(0,Math.floor((Date.now()-t)/60000));return m<1?"刚刚":m<60?`${m}分钟前`:m<1440?`${Math.floor(m/60)}小时前`:`${Math.floor(m/1440)}天前`},dh=x.host,dp=x.dst.lastIndexOf(":")>0?x.dst.slice(x.dst.lastIndexOf(":")):"",chain=x.chains??[],dur=x.start?fmtUptime(Math.max(0,((x.closedAt??Date.now())-x.start)/1000)):""
      return <Card compact key={x.id+(x.closedAt??"")} contextMenu={{menuItems:<>{!x.closedAt?<Button title="关闭连接" systemImage="xmark.circle" action={()=>void close(x)}/>:null}<Button title="筛选同源连接" systemImage="laptopcomputer" action={()=>{setClient(x.sourceIP??"");setLimit(60)}}/><Button title="筛选同域名连接" systemImage="globe" action={()=>{setQ(x.host);setSearch(true);setLimit(60)}}/><Button title="复制连接信息" systemImage="doc.on.doc" action={()=>{void Pasteboard.setString([x.host+(x.dst.lastIndexOf(":")>0?x.dst.slice(x.dst.lastIndexOf(":")):""),x.src,x.network,(x.chains??[]).join(" > "),x.rule].filter(Boolean).join("\n"));feedback()}}/></>}} opacity={1}>
        <HStack spacing={6}><NavigationLink destination={<ConnectionDetailPage x={x} onDisconnect={(y:Conn)=>void close(y)}/>}><HStack spacing={6}><Image systemName="clock.fill" font={11} foregroundStyle="secondaryLabel"/><Text font={11} foregroundStyle="secondaryLabel">{x.start?ago(x.start):"时间未提供"}</Text>{x.closedAt?(dur?<Chip small title={dur} color="secondaryLabel"/>:null):<><Image systemName="arrow.down" font={10} foregroundStyle="systemBlue"/><Text font={10}>{fmtSpeed(x.downSpeed??0)}</Text><Image systemName="arrow.up" font={11} foregroundStyle="systemGreen"/><Text font={10}>{fmtSpeed(x.upSpeed??0)}</Text></>}<Spacer/></HStack></NavigationLink>{!x.closedAt?<Button title="" buttonStyle="plain" systemImage="xmark.circle.fill" foregroundStyle="tertiaryLabel" action={()=>close(x)}/>:null}</HStack><NavigationLink destination={<ConnectionDetailPage x={x} onDisconnect={(y:Conn)=>void close(y)}/>}><VStack alignment="leading" spacing={6}>
        <HStack spacing={6}><Image systemName="globe" font={11} foregroundStyle="systemBlue"/><Text font={14} fontWeight="semibold" lineLimit={1}>{dh}</Text><Text font={11} foregroundStyle="secondaryLabel">{dp}</Text></HStack>
        {chain.length?<HStack spacing={6}><Image systemName="arrow.triangle.branch" font={11} foregroundStyle="systemOrange"/><Text font={11} foregroundStyle="secondaryLabel" lineLimit={1}>{chain.join(" > ")}</Text></HStack>:null}
        <HStack spacing={6}><Chip small title={x.network||"未提供"} color="systemGreen"/>{x.inboundType?<Chip small title={x.inboundType} color="systemBlue"/>:null}{prefs.connectionStyle==="standard"?<Text font={11} foregroundStyle="secondaryLabel" lineLimit={1}>{labels[x.sourceIP??""]?`${labels[x.sourceIP??""]} · ${x.src}`:x.src}</Text>:null}<Spacer/><Image systemName="arrow.down.circle.fill" font={11} foregroundStyle="systemBlue"/><Text font={11} foregroundStyle="systemBlue">{fmtBytes(x.down)}</Text><Image systemName="arrow.up.circle.fill" font={11} foregroundStyle="systemGreen"/><Text font={11} foregroundStyle="systemGreen">{fmtBytes(x.up)}</Text></HStack></VStack></NavigationLink>
      </Card>})}<Pages hideCount limit={limit} total={shown.length} more={()=>setLimit(limit+60)}/></>}</>})
}
export function DNSPage({c}:{c:Controller}) {
  const [name,setName]=useState(""),[type,setType]=useState("A"),[result,setResult]=useState(""),[busy,setBusy]=useState(false),[guard]=useState({alive:true});useEffect(()=>()=>{guard.alive=false},[])
  return <Form background="systemBackground" scrollContentBackground="hidden" navigationTitle="域名查询"><Section><TextField title="域名" value={name} onChanged={setName} prompt="输入要查询的域名"/><Picker title="类型" pickerStyle="menu" value={type} onChanged={setType}>{["A","AAAA","CNAME","TXT","MX","HTTPS"].map(t=><Text key={t} tag={t}>{t}</Text>)}</Picker><Button title={busy?"查询中…":"查询"} disabled={busy||!name} action={async()=>{setBusy(true);await attempt(async()=>{await confirmed(c.name,`通过当前内核DNS查询 ${name} (${type})，可能向其配置的DNS服务器发送域名。`,async()=>{const r=await queryDNS(c,name,type);if(guard.alive)setResult(`状态 ${r.status}\n`+r.answers.map((x:any)=>`${x.data} · TTL ${x.ttl}`).join("\n"))})});if(guard.alive)setBusy(false)}}/></Section><Section><Text font={13}>{result||"尚未查询"}</Text></Section></Form>
}
async function openPage(c:Controller,page:"home"|"profile"|"mixin"|"editor"|"log") { await attempt(async()=>{const url=await webpage(c,page);await confirmed(c.name,"打开当前设备的真实网页。不会传递控制器密钥或LuCI会话；浏览器需独立登录。后续网页中的保存/应用由Nikki官方页面处理。",async()=>{if(!await Safari.openURL(url))throw new Error("打开失败")})}) }
export function ManagementPage({c,kind}:{c:Controller;kind:"profile"|"subscription"|"rule"|"log"}) {
  if(kind!=="log")return NikkiManagementPage({c,kind})
  return NikkiLogPage({c})
}
function NikkiLogPage({c}:{c:Controller}) {
  const [tick,setTick]=useState(0),[,setVisible]=useState(true),nikki=c.kind==="openwrt"&&c.plugin==="nikki"
  return Shell({title:"运行日志",background:"systemBackground",onAppear:()=>setVisible(true),onDisappear:()=>setVisible(false),children:!nikki?<Hint>不可用：此入口需要当前来源为OpenWrt上的Nikki，不能将其他插件当作Nikki调用。</Hint>:<Card><Hint>此处为Nikki远程运行日志，可能包含访问域名与敏感信息，仅在设备自己的LuCI中查看，不复制至脚本日志。</Hint><Button title="打开Nikki官方管理页面" systemImage="safari" action={()=>openPage(c,"log")}/><Button title="刷新" action={()=>setTick(tick+1)}/></Card>})
}
// More-page styling stays local; other cards and native navigation are unchanged.
function MorePanel({children,contentInset=0,spacing=0}:any) {
  // Business inset must not occupy the host's common `padding` prop on MorePanel.
  if(contentInset)return <VStack alignment="leading" spacing={spacing} modifiers={modifiers().padding(contentInset).frame({minWidth:0,maxWidth:"infinity",alignment:"leading"}).background(<RoundedRectangle cornerRadius={14} fill="secondarySystemBackground"/>)}>{children}</VStack>
  return <VStack alignment="leading" spacing={spacing} frame={{maxWidth:"infinity",alignment:"leading"}} background={<RoundedRectangle cornerRadius={14} fill="secondarySystemBackground"/>}>{children}</VStack>
}
function MoreHeading({children}:any) { return <Text font={13} foregroundStyle="secondaryLabel" padding={{leading:16,top:20,bottom:0}} frame={{maxWidth:"infinity",alignment:"leading"}}>{children}</Text> }
function MoreLine({title,icon,color="systemBlue",detail,subtitle,arrow=false,updateDot=false}:any) { return <HStack alignment="center" spacing={14} padding={{horizontal:16,vertical:14}} frame={{maxWidth:"infinity",alignment:"leading"}}><Image systemName={icon} font={21} foregroundStyle={color} frame={{width:24}}/><VStack alignment="leading" spacing={6} frame={{maxWidth:"infinity",alignment:"leading"}}><HStack><Text font={17} foregroundStyle="label">{title}</Text><Spacer/>{detail?<Text font={14} foregroundStyle="secondaryLabel" fixedSize={{horizontal:true,vertical:false}} lineLimit={1} overlay={updateDot?{alignment:"topTrailing",content:<Circle fill="systemGreen" frame={{width:6,height:6}} offset={{x:5,y:-2}}/>}:undefined}>{detail}</Text>:null}{arrow?<Image systemName="chevron.right" font={12} foregroundStyle="tertiaryLabel"/>:null}</HStack>{subtitle?<Text font={12} foregroundStyle="secondaryLabel">{subtitle}</Text>:null}</VStack></HStack> }
function MoreSeparator() { return <Divider padding={{leading:54}}/> }
function MoreTile({title,icon,color}:any) { return <VStack alignment="center" spacing={10} modifiers={modifiers().frame({minWidth:0,maxWidth:"infinity",minHeight:88,maxHeight:88,alignment:"center"}).background(<RoundedRectangle cornerRadius={9} fill="tertiarySystemGroupedBackground"/>)}><Image systemName={icon} font={23} foregroundStyle={color} frame={{width:28,height:28,alignment:"center"}}/><Text font={12} foregroundStyle="label" lineLimit={1} frame={{height:18,alignment:"center"}}>{title}</Text></VStack> }
const moreSnapshots=new Map<string,{core?:string;app?:string;runtime?:NikkiRuntime;running?:boolean|null}>()
const morePrefetch=new Set<string>()
export function prefetchMoreVersions(active:Controller|null){
 if(!active)return;const key=sourceKey(active);if(morePrefetch.has(key))return;morePrefetch.add(key)
 try{const saved=Storage.get<any>("dashboard_versions_snapshot_v1");if(saved?.source===JSON.stringify(active))moreSnapshots.set(key,{...moreSnapshots.get(key),core:saved.core,app:saved.app})}catch{}
 const remember=(x:{core?:string;app?:string})=>{const patch:typeof x={};if(x.core&&x.core!=="未提供")patch.core=x.core;if(x.app&&x.app!=="未提供")patch.app=x.app;const value={...moreSnapshots.get(key),...patch};moreSnapshots.set(key,value);try{Storage.set("dashboard_versions_snapshot_v1",{source:JSON.stringify(active),core:value.core,app:value.app})}catch{}}
 const rememberRuntime=(runtime:NikkiRuntime)=>{moreSnapshots.set(key,{...moreSnapshots.get(key),runtime,running:runtime.running})}
 prefetchNikkiManagement(active)
 void Promise.all([
   loadRuntimeVersions(active,remember).then(remember).catch(()=>{}),
   active.kind==="openwrt"&&active.plugin==="nikki"?loadNikkiRuntime(active).then(rememberRuntime).catch(()=>{}):Promise.resolve()
 ]).finally(()=>morePrefetch.delete(key))
}
export function MorePage({active,onChanged,onClose,selected=true}:{active:Controller|null;onChanged:()=>void;onClose?:()=>void;selected?:boolean}) {
  const p=usePreferences(["theme","defaultPage"])
  const {scene,revision}=usePageScene()
  const cachedVersions=active?moreSnapshots.get(sourceKey(active)):undefined
  const [core,setCore]=useState(cachedVersions?.core??"未提供"),[app,setApp]=useState(cachedVersions?.app??"未提供"),[mode,setMode]=useState("未提供"),[err,setErr]=useState(""),[visible,setVisible]=useState(selected),[busy,setBusy]=useState(false),[running,setRunning]=useState<boolean|null>(cachedVersions?.running??null),[guard]=useState({alive:true,source:"",busy:false,view:"",epoch:0,versionEpoch:0,active:false}),[runtime,setRuntime]=useState<NikkiRuntime|null>(cachedVersions?.runtime??null),[,setClock]=useState(0),[notice,setNotice]=useState(""),[noticeKind,setNoticeKind]=useState("success")
  const [coreUpdate,setCoreUpdate]=useState<{source:string;version:string;available:boolean}|null>(null)
  guard.source=active?sourceKey(active):""
  const view=JSON.stringify([guard.source,selected,visible])
  if(guard.view!==view){guard.view=view;guard.epoch++}
  guard.active=selected&&visible
  useEffect(()=>()=>{guard.alive=false},[])
  scene.restore=()=>{if(selected)setVisible(true)}
  useEffect(()=>{setVisible(selected)},[selected])
  useEffect(()=>{
    setCoreUpdate(null)
    if(!active||!selected||!visible||!scene.active)return
    let alive=true,runtimeTimer:any,inFlight=false
    const epoch=scene.epoch,current=()=>alive&&scene.active&&scene.epoch===epoch
    const key=sourceKey(active),cached=moreSnapshots.get(key)??{},versionEpoch=guard.versionEpoch
    if(moreSnapshots.size>30)moreSnapshots.clear()
    const remember=(patch:typeof cached)=>{if(current())moreSnapshots.set(key,{...moreSnapshots.get(key),...patch})}
    setCore(cached.core??"读取中…");setApp(cached.app??"读取中…");setMode(lastControllerMode(active)??"读取中…");setRunning(cached.running??null);setRuntime(cached.runtime??null);setErr("")
    loadRuntimeVersions(active,x=>{if(current()&&versionEpoch===guard.versionEpoch){if(x.core!=="未提供"){setCore(x.core);remember({core:x.core})}if(x.app!=="未提供"){setApp(x.app);remember({app:x.app})}}}).then(x=>{if(current()&&versionEpoch===guard.versionEpoch){void checkCoreUpdate(x.core).then(available=>{if(current()&&guard.alive&&guard.source===key&&versionEpoch===guard.versionEpoch)setCoreUpdate(available===null?null:{source:key,version:x.core,available})});if(x.failed){if(!moreSnapshots.get(key)?.core)setCore("读取失败");if(!moreSnapshots.get(key)?.app)setApp("读取失败");setErr("部分版本信息读取失败；已保留同来源上次结果。")}}}).catch(()=>{if(current())setErr(safeError())})
    loadConfig(active).then(x=>{if(current())setMode(x.mode??"未提供")}).catch(()=>{if(current()&&!lastControllerMode(active))setMode("读取失败")})
    if(active.kind==="openwrt"&&active.plugin==="nikki"){
      const update=(x:NikkiRuntime)=>{if(current()){setRuntime(x);setRunning(x.running??null);remember({runtime:x,running:x.running})}}
      const readRuntime=async()=>{if(!current()||inFlight)return;inFlight=true;try{update(await loadNikkiRuntime(active))}catch{if(current())setErr("运行时间读取失败，请检查连接与读取权限。")}finally{inFlight=false}}
      void readRuntime();runtimeTimer=setInterval(readRuntime,30000)
    }
    return()=>{alive=false;if(runtimeTimer)clearInterval(runtimeTimer)}
  },[active&&sourceKey(active),selected,visible,revision])
  useEffect(()=>{if(!selected||!visible||!scene.active||!runtime||(runtime.coreSeconds===null&&runtime.serviceSeconds===null))return;const timer=setInterval(()=>{if(scene.active)setClock(n=>n+1)},1000);return()=>clearInterval(timer)},[selected,visible,runtime,revision])
  useEffect(()=>{setNotice("")},[active&&sourceKey(active),visible])
  useEffect(()=>{if(!notice||noticeKind==="progress")return;const timer=setTimeout(()=>setNotice(""),4500);return()=>clearTimeout(timer)},[notice,noticeKind])
  const duration=(value:number|null|undefined)=>value==null?"未提供":fmtUptime(value+Math.max(0,Math.floor((Date.now()-(runtime?.measuredAt??Date.now()))/1000)),true)
  async function act(action:CoreAction,label:string,impact:string){
    if(!active||guard.busy)return
    const source=sourceKey(active),epoch=guard.epoch,current=()=>guard.alive&&guard.source===source&&(action!=="upgrade"||(guard.active&&guard.epoch===epoch))
    if(!current())return
    guard.busy=true;setBusy(true);setNotice("")
    await attempt(async()=>{
      const options=action==="upgrade"?{title:"升级核心",message:"将下载并替换核心，可能重启并短暂中断代理服务。是否继续？",confirmLabel:"确认升级"}:action==="restart"?{title:"重启核心",message:"确定要重启核心吗？这将短暂中断代理服务。",confirmLabel:"确认重启"}:action==="reload"?{title:"重载配置",message:"将重新加载配置文件。",confirmLabel:"确认重载"}:null
      const ok=["geo","dns","fakeip"].includes(action)?true:options?await Dialog.confirm({...options,cancelLabel:"取消"}):await Dialog.confirm({title:label,message:impact,confirmLabel:"确认清除",cancelLabel:"取消"})
      if(!ok||!current())return
      if(action==="upgrade"){
        guard.versionEpoch++;setCoreUpdate(null)
        setNoticeKind("progress");setNotice("正在升级核心…")
        let checked:{verified:boolean;version:string|null}
        try{checked=await upgradeCoreAndVerify(active,current)}catch(error){if(!current())return;setNotice("");throw error}
        if(!current())return
        if(checked.version){
          setCore(checked.version)
          moreSnapshots.set(source,{...moreSnapshots.get(source),core:checked.version})
          const available=await checkCoreUpdate(checked.version)
          if(!current())return
          setCoreUpdate(available===null?null:{source,version:checked.version,available})
        }
        setNoticeKind(checked.verified?"success":"warning")
        setNotice(checked.verified?"核心升级成功":"尚未确认核心升级完成，版本未变化或无法验证")
        return
      }
      let before:NikkiRuntime|null=null
      if(action==="restart"){
        setNoticeKind("progress");setNotice("正在重启核心…")
        if(nikki)try{before=await loadNikkiRuntime(active)}catch{}
        if(!current())return
      }
      try{await coreAction(active,action)}catch(error){if(action!=="restart")throw error}
      if(!current())return
      if(action==="restart"){
        const checked=await verifyCoreRestart(active,before,current)
        if(!current())return
        if(checked.runtime)setRuntime(checked.runtime)
        setNoticeKind(checked.verified?"success":"warning")
        setNotice(checked.verified?"核心重启成功":"尚未确认核心重启完成，请检查运行状态")
        return
      }
      setNoticeKind("success")
      setNotice(({restart:"核心重启成功",reload:"配置已重载",geo:"GEO 数据库更新成功",dns:"DNS 缓存已清除",fakeip:"FakeIP 缓存已清除"})[action])
    })
    guard.busy=false;if(guard.alive){setBusy(false);setNoticeKind(k=>k==="progress"?"warning":k)}
  }
  async function service(action:"start"|"stop"|"restart"|"reload",title:string){
    if(!active||guard.busy)return
    const source=sourceKey(active),current=()=>guard.alive&&guard.source===source
    guard.busy=true;setBusy(true);setNotice("")
    await attempt(async()=>{
      if(!await Dialog.confirm({title:`${title}服务`,message:`确认要${title}相关服务吗？`,confirmLabel:`确认${title}`,cancelLabel:"取消"})||!current())return
      await nikkiService(active,action)
      if(!current())return
      setNoticeKind("success");setNotice(`${title}服务请求已发送`);setRunning(null);setRuntime(null)
      void nikkiServiceStatus(active).then(x=>{if(current())setRunning(x)}).catch(()=>{})
      void loadNikkiRuntime(active).then(x=>{if(current())setRuntime(x)}).catch(()=>{})
    })
    guard.busy=false;if(guard.alive)setBusy(false)
  }
  const nikki=active?.kind==="openwrt"&&active.plugin==="nikki"
  const actions:[CoreAction,string,string,string][]=[["upgrade","升级核心","arrow.up.circle","将下载并替换核心，可能重启并短暂中断代理服务。"],["restart","重启核心","arrow.clockwise","会短暂中断代理服务及连接；禁用管理API的内核可能拒绝。"],["reload","重载配置","arrow.triangle.2.circlepath","强制重新读取当前核心配置并应用，可能断开连接；不会保存Nikki UCI。"],["geo","更新GEO数据库","globe","内核将从其配置的上游下载GEO文件并替换本地数据库，产生外部请求。"]]
  return Shell({title:active?.name??"更多",background:"systemBackground",toolbar:rootToolbar("more",onClose),overlay:notice?{alignment:"top",content:<VStack padding={{horizontal:14,top:8}}><HStack spacing={14} padding={18} background={<RoundedRectangle cornerRadius={18} fill="secondarySystemBackground"/>}>{noticeKind==="progress"?<ProgressView/>:<Image systemName={noticeKind==="warning"?"exclamationmark.circle.fill":"checkmark.circle.fill"} font={24} foregroundStyle={noticeKind==="warning"?"systemOrange":"systemGreen"}/>}<Text font={16} fontWeight="medium">{notice}</Text><Spacer/><Button buttonStyle="plain" action={()=>setNotice("")}><Image systemName="xmark" font={16} foregroundStyle="secondaryLabel"/></Button></HStack></VStack>}:undefined,onAppear:()=>{scene.vis.appear();setVisible(true)},onDisappear:()=>{if(!scene.vis.disappear(Date.now()))return;guard.epoch++;guard.active=false;setVisible(false)},children:<>
    <MoreHeading>主题及启动</MoreHeading><MorePanel><HStack spacing={12} modifiers={modifiers().frame({height:49,alignment:"center"}).padding({horizontal:16}).frame({maxWidth:"infinity"})}><HStack frame={{minWidth:0,maxWidth:"infinity",alignment:"leading"}}><Choice title="外观模式" value={p.theme} values={[["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]]} onChanged={v=>updatePreference({theme:v as any})}/></HStack><HStack frame={{minWidth:0,maxWidth:"infinity",alignment:"trailing"}}><Choice title="默认打开界面" value={p.defaultPage} values={[["overview", "主页"], ["proxies", "代理"], ["rules", "规则"], ["connections", "连接"], ["more", "更多"]]} onChanged={v=>updatePreference({defaultPage:v as any})}/></HStack></HStack></MorePanel>
    {!active?<Empty/>:<>{err?<Hint>{err}</Hint>:null}
    <MoreHeading>运行信息</MoreHeading><MorePanel><MoreLine title="内核版本" icon="desktopcomputer" detail={core} updateDot={!!(selected&&visible&&active&&coreUpdate?.source===sourceKey(active)&&coreUpdate.version===core&&coreUpdate.available)} subtitle={`运行时间：${running===false?"未运行":duration(runtime?.coreSeconds)}`}/><MoreSeparator/><MoreLine title="插件版本" icon="shippingbox" color="systemOrange" detail={app} subtitle={`${nikki?"Nikki 服务":active.plugin??"独立控制器"}（运行时间：${running===false?"未运行":duration(runtime?.serviceSeconds)}）`}/></MorePanel>
    <MoreHeading>核心配置</MoreHeading><MorePanel><NavigationLink destination={<KernelConfigPage c={active}/>}><MoreLine title="代理配置" icon="slider.horizontal.3" color="systemOrange" arrow/></NavigationLink></MorePanel>
    <MoreHeading>快捷管理</MoreHeading><MorePanel contentInset={12}><HStack spacing={12} frame={{maxWidth:"infinity"}}><NavigationLink frame={{minWidth:0,maxWidth:"infinity"}} destination={<ManagementPage c={active} kind="profile"/>}><MoreTile title="配置管理" icon="gearshape" color="systemOrange"/></NavigationLink><NavigationLink frame={{minWidth:0,maxWidth:"infinity"}} destination={<ManagementPage c={active} kind="subscription"/>}><MoreTile title="订阅管理" icon="icloud.and.arrow.down" color="systemIndigo"/></NavigationLink><NavigationLink frame={{minWidth:0,maxWidth:"infinity"}} destination={<ManagementPage c={active} kind="rule"/>}><MoreTile title="附加规则" icon="list.bullet" color="systemPurple"/></NavigationLink></HStack></MorePanel>
    <MoreHeading>服务管理</MoreHeading><MorePanel contentInset={12} spacing={8}>{!nikki?<Hint>不可用：当前不是Nikki来源，不会对其他插件发送服务命令。</Hint>:<Hint>{`Nikki · ${running===null?"状态未提供":running?"运行中":"已停止"}`}</Hint>}<HStack spacing={8}>{([["start","启动","play.fill","systemGreen","#EEF9F0","#20382A"],["stop","停止","stop.fill","systemRed","#FDEEEE","#3D2426"],["restart","重启","arrow.clockwise","systemBlue","#EAF2FF","#20314A"],["reload","重载","arrow.triangle.2.circlepath","systemOrange","#FFF6E8","#403222"]] as const).map(([action,title,icon,color,light,dark])=><Button key={action} buttonStyle="plain" frame={{maxWidth:"infinity"}} disabled={!nikki||busy} action={()=>service(action,title)}><VStack spacing={10} padding={{vertical:4}}><Image systemName={icon} font={21} foregroundStyle={color} padding={14} background={<Circle fill={{light,dark}}/>}/><Text font={12} foregroundStyle="label">{title}</Text></VStack></Button>)}</HStack></MorePanel>
    <MoreHeading>核心操作</MoreHeading><MorePanel>{actions.map(([a,title,icon,impact],i)=><VStack key={a} spacing={0}>{i?<MoreSeparator/>:null}<Button buttonStyle="plain" disabled={busy} action={()=>act(a,title,impact)}><MoreLine title={title} icon={icon}/></Button></VStack>)}</MorePanel>
    <MoreHeading>DNS 工具</MoreHeading><MorePanel><Button buttonStyle="plain" disabled={busy} action={()=>act("dns","刷新DNS缓存","清空Mihomo内存DNS缓存，后续域名需重新解析，不是路由器dnsmasq缓存。")}><MoreLine title="刷新 DNS 缓存" icon="arrow.clockwise.circle" color="systemTeal"/></Button><MoreSeparator/><Button buttonStyle="plain" disabled={busy} action={()=>act("fakeip","刷新FakeIP缓存","清空Mihomo FakeIP映射，可能导致已有连接或旧DNS结果失效。") }><MoreLine title="刷新 FakeIP 缓存" icon="shield" color="systemTeal"/></Button><MoreSeparator/><NavigationLink destination={<DNSPage c={active}/>}><MoreLine title="域名查询" icon="magnifyingglass" color="systemTeal" arrow/></NavigationLink></MorePanel>
    </>}</>})
}

// Native Nikki management: kept in this shipped module so existing download lists remain complete.
const source = (c:Controller) => [c.id,c.kind,c.plugin,c.url,c.username].join("|")
const COMMIT_WARNING = "提交 UCI 后，OpenWrt 可能自动触发 Nikki 重载并短暂断流；远程优先订阅可能重新下载。此操作无法保证仅保存不生效，不会再额外发送重载请求。"
const errorText = (e:unknown) => e instanceof NikkiManagementError ? e.message : "请求未完成，请检查连接、认证与 Nikki/LuCI 权限。草稿仍保留；详情不会写入日志。"
function Note({children,error=false}:{children?:any;error?:boolean}) { return <Text font={12} foregroundStyle={error?"systemRed":"secondaryLabel"}>{children}</Text> }
function Panel({children}:{children?:any}) { return <VStack alignment="leading" spacing={14} padding={18} frame={{maxWidth:"infinity",alignment:"leading"}} background={<RoundedRectangle cornerRadius={18} fill="secondarySystemBackground"/>}>{children}</VStack> }
function Badge({children}:{children?:any}) { return <Text font={12} padding={{horizontal:8,vertical:4}} background={<RoundedRectangle cornerRadius={6} fill="tertiarySystemBackground"/>}>{children}</Text> }
function Status({work}:{work:ReturnType<typeof useWork>}) { return <>{work.error?<Note error>{work.error}</Note>:null}{work.notice?<Note>{work.notice}</Note>:null}</> }
// Busy is also synchronous, so double taps cannot race before the next native render.
function useWork(c:Controller) {
  const [owner]=useState(()=>({...c})),[guard]=useState({alive:true,visible:true,busy:false,leaving:false,task:null as Promise<void>|null,source:source(c)}),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("")
  guard.source=source(c)
  const current=()=>((guard.alive&&guard.visible)||guard.leaving)&&guard.source===source(owner)
  useEffect(()=>{guard.alive=true;return()=>{guard.alive=false;guard.visible=false}},[])
  async function run(fn:()=>Promise<void>) {if(guard.busy||!current())return;guard.busy=true;setBusy(true);setError("");setNotice("");try{await fn()}catch(e){if(current()){setError(errorText(e));if(guard.leaving)await Dialog.alert({title:"保存未完成",message:errorText(e)})}}finally{guard.busy=false;if(current())setBusy(false)}}
  // Leaving is an intentional operation, not a background refresh. Keep its source
  // guard valid through native disappearance/unmount, and never start it twice.
  function leave(save:()=>Promise<void>) {
    if(guard.task)return guard.task
    if(guard.source!==source(owner))return Promise.resolve()
    guard.leaving=true
    guard.task=save().finally(()=>{guard.leaving=false})
    guard.visible=false
    return guard.task
  }
  function afterLeave(fn:()=>void){if(guard.leaving&&guard.task)void guard.task.finally(fn);else fn()}
  async function confirm(effect:string,fn:()=>Promise<void>) {if(await Dialog.confirm({title:"确认操作",message:`目标：${owner.name}\n${effect}`,confirmLabel:"继续",cancelLabel:"取消"})&&current())await fn()}
  async function simpleConfirm(title:string,message:string,confirmLabel:string,fn:()=>Promise<void>) {if(await Dialog.confirm({title,message,confirmLabel,cancelLabel:"取消"})&&current())await fn()}
  const commitConfirm=(effect:string,fn:()=>Promise<void>)=>confirm(effect+"\n"+COMMIT_WARNING,fn)
  return {owner,guard,busy,error,notice,setNotice,resetStatus:()=>{if(!guard.leaving)guard.task=null;setError("");setNotice("")},current,run,leave,afterLeave,confirm,simpleConfirm,commitConfirm,changed:source(c)!==source(owner),onAppear:()=>{if(!guard.leaving)guard.task=null;guard.visible=true;setBusy(guard.busy)},onDisappear:()=>{guard.visible=false}}
}
type EditValue = {kind:"subscription"; value:NikkiSubscription|null}|{kind:"rule";value:NikkiRule|null}|{kind:"sort"}|{kind:"file";value:NikkiFile}
type EditTarget = EditValue & {entry:number; base:NikkiManagement}
// Memory-only, source-scoped last successful management read. It can hold subscription URLs,
// so it is never persisted, logged or shared across sources; writes invalidate it before re-reading.
const managementCache=new Map<string,NikkiManagement>()
function rememberManagement(c:Controller,d:NikkiManagement){if(managementCache.size>10&&!managementCache.has(source(c)))managementCache.clear();managementCache.set(source(c),d)}
export function prefetchNikkiManagement(c:Controller|null){
  if(!c||c.kind!=="openwrt"||c.plugin!=="nikki")return;const key=source(c)
  if(managementCache.has(key)||managementPrefetch.has(key))return;managementPrefetch.add(key)
  void loadNikkiManagement(c).then(d=>{if(!managementCache.has(key))rememberManagement(c,d)}).catch(()=>{}).finally(()=>managementPrefetch.delete(key))
}
const managementPrefetch=new Set<string>()
export function NikkiManagementPage({c,kind}:{c:Controller;kind:"profile"|"subscription"|"rule"}) {
  const work=useWork(c),[data,setData]=useState<NikkiManagement|null>(()=>c.kind==="openwrt"&&c.plugin==="nikki"?managementCache.get(source(c))??null:null),[fresh,setFresh]=useState(false),[error,setError]=useState(""),[tick,setTick]=useState(0),[visible,setVisible]=useState(true),[edit,setEdit]=useState<EditTarget|null>(null),[navigation]=useState({entry:0}),[updatingSubscription,setUpdatingSubscription]=useState<string|null>(null)
  const supported=c.kind==="openwrt"&&c.plugin==="nikki",title={profile:"配置文件",subscription:"订阅管理",rule:"附加规则"}[kind]
  const refresh=()=>setTick(t=>t+1)
  // After a write the cached copy is stale: drop it and block actions until the re-read lands.
  const refreshAfterWrite=()=>{managementCache.delete(source(c));setFresh(false);refresh()}
  useEffect(()=>{if(!supported||work.changed||!visible)return;let alive=true;setError("");loadNikkiManagement(work.owner).then(d=>{if(alive){setData(d);setFresh(true);rememberManagement(work.owner,d)}}).catch(e=>{if(alive){setFresh(false);setError(errorText(e))}});return()=>{alive=false}},[source(c),kind,tick,visible])
  const done=(saved=false,entry=navigation.entry)=>{if(entry===navigation.entry)setEdit(null);if(saved)refreshAfterWrite()}
  // Freeze both the object and its UCI snapshot at navigation entry. Native destinations
  // can be prebuilt/reused; identity must represent an opening, not only a component type.
  function openEdit(value:EditValue) {if(!data||!fresh||work.busy)return;const snapshot="value" in value&&value.value?{...value,value:{...value.value}}:value;setEdit({...snapshot,entry:++navigation.entry,base:data} as EditTarget)}
  const entryKey=edit?source(c)+":"+edit.entry:"closed"
  const content=edit ? edit.kind==="subscription"?<NikkiSubscriptionEditor key={entryKey} entryKey={entryKey} c={c} base={edit.base} value={edit.value} done={saved=>done(saved,edit.entry)}/>:edit.kind==="rule"?<NikkiRuleEditor key={entryKey} c={c} base={edit.base} value={edit.value} done={saved=>done(saved,edit.entry)}/>:edit.kind==="sort"?<NikkiRuleSort key={entryKey} c={c} base={edit.base} done={saved=>done(saved,edit.entry)}/>:<NikkiFileEditor key={entryKey} entryKey={entryKey} c={c} base={edit.base} file={edit.value} done={saved=>{if(saved)refresh()}}/> : <Text/>
  async function removeSubscription(s:NikkiSubscription) {if(!fresh)return;await work.run(()=>work.simpleConfirm("删除订阅",`确认要删除订阅「${s.name}」吗？`,"确认删除",async()=>{await deleteNikkiSubscription(work.owner,data!,s.id);if(work.current())refreshAfterWrite()}))}
  async function update(s:NikkiSubscription) {if(!fresh)return;await work.run(async()=>{setUpdatingSubscription(s.id);try{await updateNikkiSubscription(work.owner,s.id,data!);if(work.current())refreshAfterWrite()}finally{setUpdatingSubscription(null)}})}
  async function enable(f:NikkiFile) {if(!fresh||data?.profile===f.key)return;await work.run(()=>work.commitConfirm(`启用「${f.name}」？将提交为 Nikki 选用配置，由系统触发重载；配置选择成功不代表内核已成功加载。`,async()=>{
    await selectNikkiProfile(work.owner,data!,f.key)
    if(work.current())refreshAfterWrite()
    if(work.current())work.setNotice("配置选择已提交；系统可能已自动重载。请核实运行效果，未生效时可在服务管理单独重载")
  }))}
  const toolbar=!supported||work.changed?undefined:kind==="rule"?{topBarTrailing:<Menu accessibilityLabel="操作" label={<Image systemName="ellipsis"/>}><Button title="排序列表" disabled={!data||!fresh||work.busy||data.rules.length<2} action={()=>openEdit({kind:"sort"})}/><Button title={data?.appendRules?"禁用规则":"启用规则"} disabled={!data||!fresh||work.busy} action={()=>work.run(()=>work.commitConfirm(`将${data!.appendRules?"禁用":"启用"} Nikki 附加规则总开关。`,async()=>{await setNikkiRulesEnabled(work.owner,data!,!data!.appendRules);if(work.current()){refreshAfterWrite();work.setNotice("规则总开关已提交；系统可能已自动重载")}}))}/><Button title="添加规则" disabled={!data||!fresh||work.busy} action={()=>openEdit({kind:"rule",value:null})}/></Menu>}:kind==="subscription"?{topBarTrailing:<Button title="添加订阅" systemImage="plus" labelStyle="iconOnly" disabled={!data||!fresh||work.busy} action={()=>openEdit({kind:"subscription",value:null})}/>}:{topBarTrailing:<Button accessibilityLabel="刷新" disabled={work.busy} action={refresh}><Image systemName="arrow.triangle.2.circlepath"/></Button>}
  return <ScrollView background="systemBackground" navigationTitle={title} navigationBarTitleDisplayMode="inline" toolbar={toolbar} onAppear={()=>{work.onAppear();setVisible(true)}} onDisappear={()=>{work.onDisappear();setVisible(false)}} navigationDestination={{isPresented:edit!==null&&!work.changed,onChanged:(v:boolean)=>{if(!v)done()},content}}>
    <VStack spacing={16} padding={16} frame={{maxWidth:"infinity"}}>
      {!supported?<Note>不可用：当前来源不是 OpenWrt 上的 Nikki，不会向其他插件发送管理请求。</Note>:work.changed?<Note error>来源已改变，请返回后重新进入；不会沿用上一来源的草稿。</Note>:<>
        {error?<><Note error>{error}</Note><Button title="重试" action={refresh}/></>:null}<Status work={work}/>
        {!data&&!error?<Note>正在读取…</Note>:null}
        {data&&kind==="rule"?<>
          {data.rules.length===0?<VStack spacing={14} frame={{maxWidth:"infinity",minHeight:360}}><Image systemName="text.badge.plus" font={56} foregroundStyle="secondaryLabel"/><Text font="title2" fontWeight="bold">没有规则</Text><Note>点击右上角菜单添加规则</Note></VStack>:<><Note>{`总开关：${data.appendRules?"启用":"禁用"} · 提交可能自动重载 Nikki 服务`}</Note>{data.rules.map(r=><Panel key={r.id}><HStack><Text fontWeight="semibold">{r.type}</Text><Spacer/><Badge>{r.enabled?"启用":"禁用"}</Badge></HStack><Text>{r.matcher||"所有请求"}</Text><Note>{`${r.node}${r.noResolve?" · no-resolve":""}`}</Note><HStack><Button title="编辑" disabled={work.busy} action={()=>openEdit({kind:"rule",value:r})}/><Spacer/><Button title="删除规则" systemImage="trash" role="destructive" disabled={work.busy} action={()=>work.run(()=>work.commitConfirm(`删除规则「${r.type} · ${r.matcher}」？`,async()=>{await deleteNikkiRule(work.owner,data,r.id);if(work.current())refresh()}))}/></HStack></Panel>)}</>}
        </>:null}
        {data&&kind==="subscription"?<>{data.subscriptions.length===0?<Note>暂无订阅，请点击右上角 + 添加</Note>:data.subscriptions.map(s=>subscriptionCard({s,busy:work.busy,updating:updatingSubscription===s.id,edit:()=>openEdit({kind:"subscription",value:s}),update:()=>update(s),remove:()=>removeSubscription(s)}))}</>:null}
        {data&&kind==="profile"?<>
          {data.filesError?<Note error>部分目录无读取权限，文件列表或元信息可能不完整。</Note>:null}
          {data.files.length===0?<Note>没有配置文件，请先在订阅管理添加并更新订阅，或通过原有设备文件管理上传本地配置。</Note>:<>{data.files.map(f=><Panel key={f.key}><Button buttonStyle="plain" disabled={work.busy} action={()=>enable(f)}><VStack alignment="leading" spacing={10} frame={{maxWidth:"infinity",alignment:"topLeading"}}><HStack><Badge>{f.origin==="subscription"?"订阅":"本地"}</Badge><Spacer/>{data.profile===f.key?<Image systemName="checkmark.circle.fill" foregroundStyle="systemGreen"/>:null}</HStack><Text font={24} fontWeight="bold" lineLimit={2}>{f.name}</Text>{data.profile!==f.key?<Note>点击启用</Note>:null}<Note>{`更新于 ${f.mtime&&f.mtime>0?new Date(f.mtime*1000).toLocaleString():"未提供"}`}</Note><Note>{f.size===null?"文件大小未提供（可能尚未下载）":fmtBytes(f.size)}</Note></VStack></Button><Button accessibilityLabel="编辑" buttonStyle="plain" disabled={work.busy||f.size===null} action={()=>openEdit({kind:"file",value:f})}>{nikkiEditLabel()}</Button></Panel>)}</>}
        </>:null}
      </>}
    </VStack>
  </ScrollView>
}
export function nikkiRelativeUpdate(value:string,now=Date.now()):string {
  let at=NaN
  const trimmed=value.trim(),dateOnly=/^\d{4}-\d{2}-\d{2}$/.test(trimmed)
  value=dateOnly?trimmed+" 00:00:00":trimmed
  const local=value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/)
  if(local){const [y,m,d,h,min,sec]=local.slice(1).map(Number),date=new Date(y,m-1,d,h,min,sec);if(date.getFullYear()===y&&date.getMonth()===m-1&&date.getDate()===d&&date.getHours()===h&&date.getMinutes()===min&&date.getSeconds()===sec)at=date.getTime()}
  else if(/^\d{10}$/.test(value))at=Number(value)*1000
  else if(/^\d{13}$/.test(value))at=Number(value)
  else if(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/i.test(value))at=Date.parse(value)
  if(!Number.isFinite(at)||at<=0)return "未知"
  const seconds=Math.floor((now-at)/1000)
  if(seconds < -60)return "时间在未来（"+value+"）"
  if(seconds<60)return "刚刚"
  if(seconds<3600)return Math.floor(seconds/60)+"分钟前"
  if(seconds<86400)return Math.floor(seconds/3600)+"小时前"
  return Math.floor(seconds/86400)+"天前"
}
function nikkiEditLabel() {return <Image systemName="pencil" font={14} foregroundStyle="label" frame={{width:34,height:34}} background={<Circle fill="tertiarySystemFill"/>}/>}
function subscriptionCard({s,busy,updating,edit,update,remove}:{s:NikkiSubscription;busy:boolean;updating:boolean;edit:()=>void;update:()=>void;remove:()=>void}) {
  return <Panel key={s.id}>
    <HStack spacing={5} padding={{horizontal:8,vertical:5}} background={<RoundedRectangle cornerRadius={7} fill="tertiarySystemBackground"/>}><Image systemName="link" font={12}/><Text font={12}>订阅</Text></HStack>
    <Text font={24} fontWeight="bold" lineLimit={2}>{s.name}</Text>
    <Text font={13} foregroundStyle="secondaryLabel" lineLimit={1}>{s.url||"未设置URL"}</Text>
    <HStack spacing={6} foregroundStyle="secondaryLabel"><Image systemName="clock" font={12}/><Text font={12}>{`更新: ${nikkiRelativeUpdate(s.updated)}`}</Text></HStack>
    <HStack spacing={10}>
      <Button accessibilityLabel="编辑" buttonStyle="plain" disabled={busy} action={edit}>{nikkiEditLabel()}</Button>
      <Spacer/>
      <Button accessibilityLabel="更新订阅" buttonStyle="plain" disabled={busy} action={update}>{providerRefreshLabel(updating,"label")}</Button>
      <Button accessibilityLabel="删除订阅" buttonStyle="plain" disabled={busy} action={remove}><Image systemName="trash" font={14} foregroundStyle="label" frame={{width:34,height:34}} background={<Circle fill="tertiarySystemFill"/>}/></Button>
    </HStack>
  </Panel>
}
export function NikkiSubscriptionEditor({c,base,value,done,entryKey="direct"}:{c:Controller;base:NikkiManagement;value:NikkiSubscription|null;done:(saved?:boolean)=>void;entryKey?:string}) {
  const work=useWork(c),[,paint]=useState(0),[session]=useState({identity:"",draft:{name:"",url:"",ua:"clash",prefer:"remote"},base,value,done})
  const identity=source(c)+":"+entryKey+":"+(value?.id??"new")
  // useState(initialValue) is not prop synchronization. A retained/prebuilt native host
  // must adopt the new opening synchronously, even when it was first built with null.
  if(session.identity!==identity){session.identity=identity;session.draft={name:value?.name??"",url:value?.url??"",ua:value?.userAgent??"clash",prefer:value?.prefer??"remote"}}
  session.base=base;session.value=value;session.done=done
  useEffect(()=>work.resetStatus(),[identity])
  function change(key:keyof typeof session.draft,v:string){session.draft={...session.draft,[key]:v};paint(n=>n+1)}
  const {name,url,ua,prefer}=session.draft,setName=(v:string)=>change("name",v),setUrl=(v:string)=>change("url",v),setUA=(v:string)=>change("ua",v),setPrefer=(v:string)=>change("prefer",v)
  async function save(){const token=session.identity,initial=session.value,snapshot=session.base,draft={...session.draft};if(draft.name===(initial?.name??"")&&draft.url===(initial?.url??"")&&draft.ua===(initial?.userAgent??"clash")&&draft.prefer===(initial?.prefer??"remote"))return;await work.run(async()=>{if(session.identity!==token||!work.current())return;await saveNikkiSubscription(work.owner,snapshot,initial?.id??null,{name:draft.name,url:draft.url,userAgent:draft.ua,prefer:draft.prefer});if(work.current()&&session.identity===token)session.done(true)})}
  return <Form background="systemBackground" scrollContentBackground="hidden" navigationTitle="订阅设置" navigationBarTitleDisplayMode="inline" onAppear={work.onAppear} onDisappear={()=>work.leave(save)}>
    <Section header={<Text>基本信息</Text>}><TextField title="名称" value={name} onChanged={setName}/><TextField title="URL" value={url} onChanged={setUrl}/></Section>
    <Section header={<Text>User Agent</Text>}><Picker title="User Agent" pickerStyle="segmented" value={ua} onChanged={setUA}><Text tag="clash">Clash</Text><Text tag="clash.meta">Clash Meta</Text><Text tag="mihomo">Mihomo</Text></Picker>{!["clash","clash.meta","mihomo"].includes(ua)?<Note error>当前是自定义值，请明确选择后再保存</Note>:null}</Section>
    <Section header={<Text>配置优先级</Text>}><Picker title="配置优先级" pickerStyle="segmented" value={prefer} onChanged={setPrefer}><Text tag="remote">远程优先</Text><Text tag="local">本地优先</Text></Picker></Section>
    {work.error||work.notice||work.changed?<Section><Status work={work}/>{work.changed?<Note error>来源已改变，请返回后重新进入</Note>:null}</Section>:null}
  </Form>
}
export function NikkiRuleEditor({c,base,value,done}:{c:Controller;base:NikkiManagement;value:NikkiRule|null;done:(saved?:boolean)=>void}) {
  const work=useWork(c),[type,setType]=useState(value?.type??"DOMAIN-SUFFIX"),[matcher,setMatcher]=useState(value?.matcher??""),[node,setNode]=useState(value?.node??"GLOBAL"),[enabled,setEnabled]=useState(value?.enabled??true),[noResolve,setNoResolve]=useState(value?.noResolve??false)
  const [draft]=useState({type,matcher,node,enabled,noResolve})
  function change<K extends keyof typeof draft>(key:K,set:(v:typeof draft[K])=>void){return (v:typeof draft[K])=>{draft[key]=v;set(v)}}
  async function save(){const next={...draft};if(next.type===(value?.type??"DOMAIN-SUFFIX")&&next.matcher===(value?.matcher??"")&&next.node===(value?.node??"GLOBAL")&&next.enabled===(value?.enabled??true)&&next.noResolve===(value?.noResolve??false))return;await work.run(()=>work.commitConfirm("保存此附加规则？",async()=>{await saveNikkiRule(work.owner,base,value?.id??null,next);if(work.current())done(true)}))}
  return <Form background="systemBackground" scrollContentBackground="hidden" navigationTitle={value?"编辑规则":"添加规则"} navigationBarTitleDisplayMode="inline" onAppear={work.onAppear} onDisappear={()=>work.leave(save)}>
    <Section><Toggle title="启用" value={enabled} onChanged={change("enabled",setEnabled)}/><Picker title="规则类型" pickerStyle="menu" value={type} onChanged={change("type",setType)}>{Array.from(new Set([...NIKKI_RULE_TYPES,type])).map(t=><Text key={t} tag={t}>{t}</Text>)}</Picker><TextField title="类型（支持自定义）" value={type} onChanged={change("type",setType)}/>{type!=="MATCH"?<TextField title="匹配内容" value={matcher} onChanged={change("matcher",setMatcher)}/>:null}<TextField title="策略/节点" value={node} onChanged={change("node",setNode)}/>{/IP-CIDR6?|IP-ASN|GEOIP/.test(type)?<Toggle title="不解析域名（no-resolve）" value={noResolve} onChanged={change("noResolve",setNoResolve)}/>:null}</Section>
    <Section><Note>提交 Nikki 附加规则可能自动触发服务重载。MATCH 不需要匹配内容；复杂类型的最终合法性由 Mihomo 校验。</Note><Status work={work}/>{work.changed?<Note error>来源已改变，请返回后重新进入</Note>:null}</Section>
  </Form>
}
export function NikkiRuleSort({c,base,done}:{c:Controller;base:NikkiManagement;done:(saved?:boolean)=>void}) {
  const work=useWork(c),[ids,setIDs]=useState(()=>base.rules.map(r=>r.id)),[draft]=useState(()=>({ids:base.rules.map(r=>r.id)}))
  function move(i:number,d:number) {const next=[...draft.ids];[next[i],next[i+d]]=[next[i+d],next[i]];draft.ids=next;setIDs(next)}
  async function save(){const next=[...draft.ids];if(!next.some((id,i)=>id!==base.rules[i].id))return;await work.run(()=>work.commitConfirm("提交此规则顺序？",async()=>{await reorderNikkiRules(work.owner,base,next);if(work.current())done(true)}))}
  return <ScrollView background="systemBackground" navigationTitle="排序列表" navigationBarTitleDisplayMode="inline" onAppear={work.onAppear} onDisappear={()=>work.leave(save)}><VStack spacing={12} padding={16}><Note>调整顺序后返回保存；非规则配置的位置保持不变。</Note>{ids.map((id,i)=>{const r=base.rules.find(r=>r.id===id)!;return <Panel key={id}><Text>{`${i+1}. ${r.type} · ${r.matcher||r.node}`}</Text><HStack><Button title="上移" systemImage="arrow.up" disabled={work.busy||i===0} action={()=>move(i,-1)}/><Spacer/><Button title="下移" systemImage="arrow.down" disabled={work.busy||i===ids.length-1} action={()=>move(i,1)}/></HStack></Panel>})}<Status work={work}/></VStack></ScrollView>
}
// Map the textarea's normalized LF edits back to raw line endings. Unchanged prefix/suffix
// retain their exact CRLF/LF/CR bytes; inserted lines follow the document's first newline.
export function reconcileNikkiText(previous:string,input:string):string {
  const normalized=previous.replace(/\r\n|\r/g,"\n"),next=input.replace(/\r\n|\r/g,"\n")
  if(normalized===next)return previous
  let start=0,end=0
  while(start<normalized.length&&start<next.length&&normalized[start]===next[start])start++
  while(end<normalized.length-start&&end<next.length-start&&normalized[normalized.length-1-end]===next[next.length-1-end])end++
  function rawOffset(offset:number){let raw=0,n=0;while(n<offset){if(previous[raw]==="\r"&&previous[raw+1]==="\n")raw++;raw++;n++}return raw}
  const newline=previous.match(/\r\n|\r|\n/)?.[0]??"\n"
  return previous.slice(0,rawOffset(start))+next.slice(start,next.length-end).replace(/\n/g,newline)+previous.slice(rawOffset(normalized.length-end))
}
// File editing uses the existing native push stack; hiding the tab bar here
// preserves the full editor area without a downward modal dismissal.
// Recovery is source/file scoped and memory-only. A canceled confirmation, failed
// write or navigation teardown must not discard the last complete local document.
// Fold by code point, retaining original UTF-16 offsets even when lowercasing expands.
export function nikkiLiteralMatches(content:string,query:string):EditorTextRange[]{
  if(!query)return []
  let folded="",offset=0,line=1;const starts:number[]=[],ends:number[]=[],lines:number[]=[]
  for(const char of content){const lower=char.toLowerCase();for(let j=0;j<lower.length;j++){starts.push(offset);ends.push(offset+char.length);lines.push(line)}folded+=lower;offset+=char.length;if(char==="\n")line++}
  const needle=Array.from(query,char=>char.toLowerCase()).join(""),result:EditorTextRange[]=[]
  for(let i=0;(i=folded.indexOf(needle,i))!==-1;i+=needle.length){const last=i+needle.length-1;if((i===0||starts[i]!==starts[i-1])&&(last===ends.length-1||ends[last]!==ends[last+1]))result.push({start:starts[i],end:ends[last],line:lines[i]})}
  return result
}
// YAML support verified on device with the official Editor in its default script context.
export function nikkiEditorExtension(filename:string){
  const extensions:Record<string,"tsx"|"ts"|"js"|"jsx"|"txt"|"md"|"css"|"html"|"json"|"yaml">={tsx:"tsx",ts:"ts",js:"js",jsx:"jsx",txt:"txt",md:"md",css:"css",html:"html",json:"json",yaml:"yaml",yml:"yaml"}
  return extensions[filename.split(".").pop()?.toLowerCase()??""]??"txt"
}
const nikkiFileDrafts=new Map<string,{original:string;text:string}>()
type NikkiEditResult="confirmed"|"conflict"|"timeout"|"closed"
type NikkiPendingEdit={check:()=>void;finish:(result:NikkiEditResult)=>void}
type NikkiEditorSession={edit:NikkiPendingEdit|null;controller:EditorController;original:string;key:string;entry:string;closed:boolean;cancel:()=>void;closedSignal:Promise<void>}
export function NikkiFileEditor({c,base,file,done,entryKey="direct",onExit}:{c:Controller;base:NikkiManagement;file:NikkiFile;done:(saved?:boolean)=>void;entryKey?:string;onExit?:()=>void}) {
  const work=useWork(c),[host]=useState({session:null as NikkiEditorSession|null,exitNotified:false,searchEpoch:0,searchContent:null as string|null,localBusy:false}),[appeared,setAppeared]=useState(false),[tick,setTick]=useState(0),[,paint]=useState(0),[loadError,setLoadError]=useState("")
  const [localBusy,setLocalBusy]=useState(false),[localError,setLocalError]=useState(""),[localNotice,setLocalNotice]=useState(""),[replacing,setReplacing]=useState(false)
  const [searching,setSearching]=useState(false),[query,setQuery]=useState(""),[replacement,setReplacement]=useState(""),[matches,setMatches]=useState<EditorTextRange[]>([]),[index,setIndex]=useState(0),[searchStatus,setSearchStatus]=useState("输入关键字后点击搜索")
  const draftKey=JSON.stringify(work.owner)+":"+file.key
  const valid=(s:NikkiEditorSession)=>host.session===s&&s.key===draftKey&&s.entry===entryKey&&!s.closed&&!work.changed&&work.current()
  function retain(s:NikkiEditorSession){
    const text=s.controller.content
    if(text===s.original)nikkiFileDrafts.delete(s.key)
    else nikkiFileDrafts.set(s.key,{original:s.original,text})
    return text
  }
  function close(s:NikkiEditorSession|null){
    if(!s||s.closed)return
    retain(s);s.closed=true;s.edit?.finish("closed");s.edit=null;s.cancel();s.controller.onContentChanged=undefined;s.controller.dispose()
  }
  useEffect(()=>{
    if(!appeared||work.changed)return
    let alive=true,timer:ReturnType<typeof setTimeout>|undefined
    host.session=null;host.localBusy=false;host.searchEpoch++;setLoadError("");setMatches([]);setLocalBusy(false);setLocalError("");setLocalNotice("")
    const active=()=>alive&&work.current()
    async function load(){
      try{
        const text=await Promise.race([readNikkiFile(work.owner,file.key),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new NikkiManagementError("完整正文读取超时；未写入文件，请重试读取")),20000)})])
        if(!active())return
        const draft=nikkiFileDrafts.get(draftKey),restored=draft&&draft.text!==draft.original?draft:null
        const controller=new EditorController({content:restored?.text??text,ext:nikkiEditorExtension(file.filename),readOnly:false})
        let cancel=()=>{};const closedSignal=new Promise<void>(resolve=>{cancel=resolve})
        const s:NikkiEditorSession={edit:null,controller,original:restored?.original??text,key:draftKey,entry:entryKey,closed:false,cancel,closedSignal}
        host.session=s
        // Initial content is supplied before installing the user-change callback.
        controller.onContentChanged=()=>{if(active()&&!s.closed&&host.session===s){retain(s);if(s.edit){s.edit.check();paint(n=>n+1);return}if(s.controller.content!==host.searchContent){host.searchEpoch++;setMatches([]);setLocalNotice("");setSearchStatus("正文已改变，请重新搜索")}paint(n=>n+1)}}
        if(restored)work.setNotice("已恢复此来源的未保存草稿；保存仍会核对远端原文，不会覆盖并发修改")
        paint(n=>n+1)
      }catch(e){if(active())setLoadError(errorText(e))}
      finally{if(timer!==undefined)clearTimeout(timer)}
    }
    void load()
    return()=>{alive=false;if(timer!==undefined)clearTimeout(timer);close(host.session);host.session=null}
  },[appeared,file.key,entryKey,source(c),tick])
  function leave(){close(host.session);work.onDisappear();if(!host.exitNotified){host.exitNotified=true;onExit?.()}}
  async function save(){
    const s=host.session;if(!s||!valid(s)||host.localBusy||s.edit)return
    await work.run(async()=>{
      // SDK content is the current document; onContentChanged is delayed ~100ms.
      // Read here even if the UI has not received its first dirty notification.
      const draft=retain(s);if(draft===s.original)return
      const accepted=await Promise.race([Dialog.confirm({title:"确认操作",message:`目标：${work.owner.name}\n覆盖文件「${file.filename}」？可能是当前选用的配置。仅保存文件，不重载服务；大文件分块写入，失败可能留下部分内容，请勿在失败后重载。`,confirmLabel:"继续",cancelLabel:"取消"}),s.closedSignal.then(()=>false)])
      if(!accepted||!valid(s))return
      work.guard.leaving=true
      try{
        await saveNikkiFile(work.owner,file.key,s.original,draft)
        s.original=draft
        if(s.closed){const kept=nikkiFileDrafts.get(s.key);if(kept?.text===draft)nikkiFileDrafts.delete(s.key);else if(kept)nikkiFileDrafts.set(s.key,{original:draft,text:kept.text})}
        else{retain(s);if(valid(s)){work.setNotice("已保存");done(true);paint(n=>n+1)}}
      }catch(e){if(s.closed)await Dialog.alert({title:"保存未完成",message:errorText(e)});else throw e}
      finally{work.guard.leaving=false}
    })
  }
  function localDetail(error:unknown){return (error&&typeof error==="object"&&"message" in error?String(error.message):String(error)).slice(0,180)}
  function hideKeyboard(){
    try{if(typeof Keyboard==="undefined"||typeof Keyboard.hide!=="function")return "当前运行环境无 Keyboard.hide";Keyboard.hide();return ""}
    catch(e){return localDetail(e)}
  }
  async function localAction(action:(s:NikkiEditorSession)=>Promise<void>){
    const s=host.session;if(!s||!valid(s)||host.localBusy||work.busy)return
    if(s.edit){setLocalError("替换仍未确认，未执行新操作；正文与草稿保留");return}
    host.localBusy=true;setLocalBusy(true);setLocalError("");setLocalNotice("")
    try{await action(s)}catch(e){if(valid(s))setLocalError("本地操作失败："+localDetail(e))}
    finally{if(host.session===s){host.localBusy=false;if(valid(s))setLocalBusy(false)}}
  }
  async function locate(s:NikkiEditorSession,m:EditorTextRange){
    try{if(typeof s.controller.setSelection!=="function")throw Error("当前运行环境无 EditorController.setSelection");await s.controller.setSelection(m.start,m.end);return valid(s)}
    catch(e){if(valid(s))setLocalError("定位失败；匹配结果仍可查看："+localDetail(e));return false}
  }
  const queryEpoch=host.searchEpoch
  async function browseLocate(s:NikkiEditorSession,m:EditorTextRange){
    if(!valid(s)||host.searchEpoch!==queryEpoch)return false
    if(s.controller.content!==host.searchContent){setMatches([]);setSearchStatus("正文已改变，请重新搜索");return false}
    try{
      if(typeof s.controller.scrollToLine!=="function")throw Error("当前运行环境无 EditorController.scrollToLine")
      await s.controller.scrollToLine(m.line)
      return valid(s)&&host.searchEpoch===queryEpoch
    }catch(e){if(valid(s)&&host.searchEpoch===queryEpoch)setLocalError("定位失败；匹配结果仍可查看："+localDetail(e));return false}
  }
  function collect(s:NikkiEditorSession,preferred=0){
    const content=s.controller.content,result=nikkiLiteralMatches(content,query),i=result.length?Math.min(preferred,result.length-1):0
    host.searchContent=content;setMatches(result);setIndex(i);setSearchStatus(!query?"请输入查找内容":result.length?"":"无匹配")
    return {result,i,content}
  }
  async function search(){await localAction(async s=>{
    if(host.searchEpoch!==queryEpoch)return
    const {result,i}=collect(s),error=hideKeyboard()
    if(error)setLocalNotice("键盘未能自动收起："+error)
    if(result.length)await browseLocate(s,result[i])
  })}
  async function go(next:number){await localAction(async s=>{
    if(!matches.length||host.searchEpoch!==queryEpoch)return
    if(s.controller.content!==host.searchContent){setMatches([]);setSearchStatus("正文已改变，请重新搜索");return}
    const i=(next+matches.length)%matches.length;setIndex(i);await browseLocate(s,matches[i])
  })}
  // Command dispatch is not a document acknowledgement. Observe the complete
  // getter through onContentChanged, with a timeout bound (not a sleep/retry).
  async function applyEdit(s:NikkiEditorSession,before:string,expected:string,payload:string,label:string,preferred=0){
    if(!valid(s)||s.edit||s.controller.content!==before)return "closed"
    const epoch=host.searchEpoch
    let resolve:(r:NikkiEditResult)=>void=()=>{},timer:ReturnType<typeof setTimeout>|undefined,settled=false,dispatchError=""
    const result=new Promise<NikkiEditResult>(r=>{resolve=r})
    const finish=(outcome:NikkiEditResult)=>{
      if(timer!==undefined)clearTimeout(timer)
      if((outcome==="confirmed"||outcome==="closed")&&s.edit===edit)s.edit=null
      if(valid(s)&&outcome!=="closed"){
        retain(s)
        if(outcome==="confirmed"||outcome==="conflict"){
          if(host.searchEpoch===epoch)collect(s,preferred)
          else{setMatches([]);setSearchStatus("查询已改变，请重新搜索")}
          setLocalError(outcome==="confirmed"?"":"正文与替换预期不同；已保留实际完整正文，暂不可保存或再次替换")
          if(outcome==="confirmed")setLocalNotice(label+(dispatchError?`；正文已核对，接口异常：${dispatchError}`:""))
        }else setLocalError("替换尚未确认；已保留当前完整正文，暂不可保存或再次替换"+(dispatchError?`：${dispatchError}`:""))
        paint(n=>n+1)
      }
      if(!settled){settled=true;resolve(outcome)}
    }
    const edit:NikkiPendingEdit={check:()=>{
      if(s.edit!==edit)return
      if(!valid(s)){finish("closed");return}
      const actual=s.controller.content
      if(actual===expected)finish("confirmed")
      else if(actual!==before)finish("conflict")
    },finish}
    s.edit=edit
    timer=setTimeout(()=>{edit.check();if(s.edit===edit&&!settled)finish("timeout")},5000)
    const rejected=(error:unknown)=>{dispatchError=localDetail(error);if(s.edit===edit)edit.check()}
    try{Promise.resolve(s.controller.replaceSelection(payload)).then(()=>{if(s.edit===edit)edit.check()},rejected)}catch(e){rejected(e)}
    return result
  }
  async function replace(){await localAction(async s=>{
    if(!matches.length)return
    const m=matches[index],content=s.controller.content,epoch=host.searchEpoch
    if(content!==host.searchContent){collect(s);setLocalError("正文已改变，请重新选择匹配");return}
    if(!await locate(s,m)||!valid(s)||host.searchEpoch!==epoch||s.controller.content!==content)return
    if(typeof s.controller.replaceSelection!=="function"){setLocalError("此版本不支持替换；正文未改动");return}
    const expected=content.slice(0,m.start)+replacement+content.slice(m.end)
    const outcome=await applyEdit(s,content,expected,replacement,"已替换 1 处（未保存）",index)
    if(outcome==="confirmed"&&valid(s)&&host.searchEpoch===epoch){const {result,i}=collect(s,index);if(result.length)await browseLocate(s,result[i])}
  })}
  async function replaceAll(){await localAction(async s=>{
    if(!query||!matches.length)return
    const content=s.controller.content,epoch=host.searchEpoch
    if(content!==host.searchContent){collect(s);setLocalError("正文已改变，请重新搜索后替换");return}
    const ranges=nikkiLiteralMatches(content,query)
    if(!ranges.length){collect(s);return}
    const parts:string[]=[];let offset=0
    for(const m of ranges){parts.push(content.slice(offset,m.start),replacement);offset=m.end}
    parts.push(content.slice(offset));const updated=parts.join("")
    if(updated===content){setLocalNotice("正文未改变");return}
    if(typeof s.controller.replaceSelection!=="function"){setLocalError("此版本不支持替换；正文未改动");return}
    // Use one native edit (not a setter/async loop) to keep Editor undo handling.
    if(!await locate(s,{start:0,end:content.length,line:1})||!valid(s))return
    if(s.controller.content!==content||host.searchEpoch!==epoch){collect(s);setLocalError("正文或查询已改变，未执行全部替换");return}
    await applyEdit(s,content,updated,updated,`已替换 ${ranges.length} 处（未保存）`)
  })}
  const session=host.session,editPending=!!session?.edit,enabled=!!session&&valid(session)&&!loadError
  // Keep save available before the debounced dirty callback; unchanged saves are no-ops.
  const toolbar={topBarTrailing:<Button accessibilityLabel="保存" buttonStyle="plain" disabled={!enabled||work.busy||localBusy||editPending} action={save}><Image systemName="checkmark.circle"/></Button>}
  return <VStack alignment="leading" spacing={0} tabBarVisibility="hidden" background="systemBackground" frame={{maxWidth:"infinity",maxHeight:"infinity"}} navigationTitle={file.filename} navigationBarTitleDisplayMode="inline" toolbar={toolbar} onAppear={()=>{host.exitNotified=false;work.onAppear();if(appeared&&(!host.session||host.session.closed))setTick(n=>n+1);setAppeared(true)}} onDisappear={leave}>
    {/* Keep all changing controls/status inside one intrinsic-height header.
        The remaining-space body is a permanent sibling, so opening Find cannot
        shift the native Editor host even when null children are filtered. */}
    <VStack alignment="leading" spacing={0} frame={{maxWidth:"infinity"}}>
    <Status work={work}/>{work.changed?<Note error>来源已改变，请返回后重新进入</Note>:null}
    {loadError?<><Note error>{loadError}</Note><Button title="重试读取" action={()=>setTick(n=>n+1)}/></>:!session?<Note>正在完整读取配置正文…</Note>:null}
    {enabled?<><HStack spacing={12} padding={{horizontal:12,vertical:2}}><Button accessibilityLabel="撤销" buttonStyle="plain" disabled={work.busy||localBusy||editPending} action={()=>{if(session&&valid(session))session.controller.undo()}}><Image systemName="arrow.uturn.backward" frame={{minWidth:44,minHeight:44}}/></Button><Button accessibilityLabel="重做" buttonStyle="plain" disabled={work.busy||localBusy||editPending} action={()=>{if(session&&valid(session))session.controller.redo()}}><Image systemName="arrow.uturn.forward" frame={{minWidth:44,minHeight:44}}/></Button><Spacer/><Button accessibilityLabel="查找 / 替换" buttonStyle="plain" disabled={work.busy} action={()=>setSearching(!searching)}><Image systemName="magnifyingglass" frame={{minWidth:44,minHeight:44}}/></Button></HStack>
      {searching?<VStack spacing={2} padding={{horizontal:12}}>
        <HStack spacing={4}><TextField title="查找" prompt="查找" labelsHidden textFieldStyle="roundedBorder" value={query} onChanged={v=>{host.searchEpoch++;setQuery(v);setMatches([]);setLocalError("");setLocalNotice("");setSearchStatus("输入关键字后点击搜索")}}/><Button accessibilityLabel="搜索" buttonStyle="plain" disabled={work.busy||localBusy||editPending} action={search}><Image systemName="magnifyingglass" frame={{minWidth:44,minHeight:44}}/></Button><Button accessibilityLabel="展开替换" buttonStyle="plain" action={()=>setReplacing(!replacing)}><Image systemName={replacing?"chevron.up":"chevron.down"} frame={{minWidth:44,minHeight:44}}/></Button></HStack>
        <HStack spacing={4}><Text>{matches.length?`${index+1} / ${matches.length}`:searchStatus}</Text><Spacer/><Button accessibilityLabel="上一个" buttonStyle="plain" disabled={!matches.length||work.busy||localBusy||editPending} action={()=>go(index-1)}><Image systemName="chevron.up" frame={{minWidth:44,minHeight:44}}/></Button><Button accessibilityLabel="下一个" buttonStyle="plain" disabled={!matches.length||work.busy||localBusy||editPending} action={()=>go(index+1)}><Image systemName="chevron.down" frame={{minWidth:44,minHeight:44}}/></Button></HStack>
        {replacing?<HStack spacing={4}><TextField title="替换为" prompt="替换为" labelsHidden textFieldStyle="roundedBorder" value={replacement} onChanged={setReplacement}/><Button accessibilityLabel="替换" buttonStyle="plain" disabled={!matches.length||work.busy||localBusy||editPending} action={replace}><Image systemName="arrow.left.arrow.right" frame={{minWidth:44,minHeight:44}}/></Button><Button title="全部" accessibilityLabel="全部替换" disabled={!query||!matches.length||work.busy||localBusy||editPending} action={replaceAll} frame={{minWidth:44,minHeight:44}}/></HStack>:null}
        {localError?<Text foregroundStyle="red">{localError}</Text>:localNotice?<Text>{localNotice}</Text>:null}
      </VStack>:null}
    </>:null}
    </VStack>
    <VStack alignment="leading" spacing={0} frame={{maxWidth:"infinity",maxHeight:"infinity"}}>
      {enabled?<Editor controller={session!.controller} showAccessoryView disabled={work.busy} frame={{maxWidth:"infinity",maxHeight:"infinity"}}/>:null}
    </VStack>
  </VStack>
}
