import { NikkiManagement, NikkiSubscription, NikkiRule, NikkiFile, NikkiManagementError, NIKKI_RULE_TYPES, loadNikkiManagement, saveNikkiSubscription, deleteNikkiSubscription, updateNikkiSubscription, saveNikkiRule, deleteNikkiRule, setNikkiRulesEnabled, reorderNikkiRules, selectNikkiProfile, readNikkiFile, saveNikkiFile } from "./api"
import { rootToolbar } from "./root-toolbar"
import { AppEvents, Button, Divider, HStack, VStack, Text, Image, Circle, RoundedRectangle, Spacer, ScrollView, LazyVStack, NavigationLink, Menu, Picker, TextField, Toggle, Form, Section, Label, ProgressView, WebView, ZStack, modifiers, Safari, useState, useEffect } from "scripting"
import { Controller, Group, Conn, Rule, Provider, loadGroups, testGroup, testNodes, selectProxy, loadProviders, updateProvider, loadRules, loadConnections, closeConnection, closeAllConnections, fmtBytes, fmtSpeed, fmtUptime, delayColor, loadRuntimeVersions, loadNikkiRuntime, NikkiRuntime, verifyCoreRestart, lastControllerMode, loadConfig, nikkiService, nikkiServiceStatus, coreAction, CoreAction, queryDNS, webpage } from "./api"
import { usePreferences, KernelConfigPage } from "./settings-ui"
import { NODE_SORT_OPTIONS, savePreferences, cachedIcon, traceIconPreference, feedback } from "./preferences"
import { selectable, sortedNodes, historyFor, filterConnections, clientLabels, saveClientLabel, sourceKey, confirmed } from "./dashboard-model"
const FG = { light: "#41434B", dark: "#CFD0D7" }

export const safeError = () => "请求未完成：请检查连接、认证与当前内核/Nikki版本支持（404/权限不足可能不支持该操作）。详情不会写入日志。"
async function attempt(fn: () => Promise<any>) { try { await fn() } catch { await Dialog.alert({ title: "操作未完成", message: safeError() }) } }
function Card({children,compact=false,contextMenu,...rest}: {children?:any;animation?:any;transition?:any;compact?:boolean;opacity?:number;contextMenu?:any}) { const content=<VStack {...rest} alignment="leading" spacing={compact?6:10} font={compact?12:14} foregroundStyle={FG} modifiers={modifiers().frame({maxWidth:"infinity",alignment:"leading"}).padding({horizontal:compact?10:14,vertical:compact?10:14}).background(<RoundedRectangle cornerRadius={compact?16:22} fill="secondarySystemBackground"/>)}>{children}</VStack>;return contextMenu?<VStack spacing={0} frame={{maxWidth:"infinity"}} contextMenu={contextMenu}>{content}</VStack>:content }
function Shell({children,title,toolbar,onAppear,onDisappear,animation,background,overlay}:any) { return <ScrollView overlay={overlay} background={background} navigationTitle={title} navigationBarTitleDisplayMode="inline" toolbar={toolbar} onAppear={onAppear} onDisappear={onDisappear}><LazyVStack animation={animation} spacing={12} padding={{horizontal:14,vertical:8}}>{children}</LazyVStack></ScrollView> }
function Hint({children}:any) { return <Text font={12} foregroundStyle="secondaryLabel">{children}</Text> }
function Chip({title,color="systemBlue",small=false}:{title:string;color?:string;small?:boolean}) { return <Text font={small?10:11} foregroundStyle={color as any} padding={{horizontal:6,vertical:3}} background={<RoundedRectangle cornerRadius={6} fill="tertiarySystemBackground"/>}>{title}</Text> }
function Pages({limit,total,more,hideCount=false}:{limit:number;total:number;more:()=>void;hideCount?:boolean}) { if(hideCount&&limit>=total)return null;return <HStack>{hideCount?null:<Hint>{`已展示 ${Math.min(limit,total)} / ${total}`}</Hint>}<Spacer/>{limit<total ? <Button title="加载更多" action={more}/> : null}</HStack> }
function Empty() { return <Hint>尚未添加控制器，请从主页右上角进入设置。</Hint> }
export function GroupIcon({g}:{g:Group}) {
  const p=usePreferences(), [image,setImage]=useState<any>(null), symbol=p.groupIcons[g.name]
  useEffect(()=>{ let alive=true;setImage(null);if(p.customIcons&&!symbol&&g.icon) cachedIcon(g.icon).then(x=>{if(alive)setImage(x)}).catch(()=>{});return()=>{alive=false} },[p.customIcons,symbol,g.icon])
  traceIconPreference("icon-render", p.customIcons)
  if (!p.customIcons) return null
  return image ? <Image image={image} resizable scaleToFit frame={{width:28,height:28}}/> : <Image systemName={symbol || "point.3.connected.trianglepath.dotted"} foregroundStyle="systemBlue" frame={{width:26,height:26}}/>
}
export function GroupNodesPage({c,g,onChanged}:{c:Controller;g:Group;onChanged:()=>void}) {
  const prefs=usePreferences(), [current,setCurrent]=useState(g.now),[delays,setDelays]=useState(g.delays),[q,setQ]=useState(""),[limit,setLimit]=useState(80),[busy,setBusy]=useState(false),[guard]=useState({alive:true})
  useEffect(()=>()=>{guard.alive=false},[])
  const nodes=sortedNodes(g,delays).filter(x=>x.toLowerCase().includes(q.toLowerCase()))
  async function pick(n:string) { if(n===current||busy)return;setBusy(true);await attempt(async()=>{ await selectProxy(c,g.name,n);if(guard.alive){setCurrent(n);onChanged()} });if(guard.alive)setBusy(false) }
  async function test(){if(busy)return;setBusy(true);await attempt(async()=>{await confirmed(`${c.name} · ${g.name}`,"将通过组中节点访问偏好中设置的测速URL，产生外部网络请求。",async()=>{const ds=await testGroup(c,g);if(guard.alive)setDelays(ds)})});if(guard.alive)setBusy(false)}
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
  done()
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
export function GroupSection({c,g,onChanged,expanded=false}:{c:Controller;g:Group;onChanged:()=>void;expanded?:boolean}) {
  const prefs=usePreferences(),[busy,setBusy]=useState(false),storeKey=`${sourceKey(c)}|${g.name}`,merged=()=>{const o:Record<string,number>={...g.delays};for(const n of g.all){const v=testedNodes.get(`${sourceKey(c)}|${n}`);if(v!==undefined&&o[n]===undefined)o[n]=v}return{...o,...(testedDelays.get(storeKey)??{})}},[delays,setDelays]=useState(merged),[open,setOpen]=useState(false),[nodeLimit,setNodeLimit]=useState(40),[now,setNow]=useState(g.now),[failed,setFailed]=useState<Set<string>>(new Set()),[guard]=useState({alive:true});useEffect(()=>()=>{guard.alive=false},[])
  useEffect(()=>setDelays(merged()),[g.delays,storeKey]);useEffect(()=>setNow(g.now),[g.now]);const d=delays[now]
  traceIconPreference("group-render", prefs.customIcons)
  const isOpen=expanded||open
  useEffect(()=>{
    if(!isOpen)return
    const missing=g.all.filter(n=>delays[n]===undefined&&!failed.has(n)&&!probing.has(`${storeKey}|${n}`))
    if(!missing.length)return
    for(const n of missing)probing.add(`${storeKey}|${n}`)
    const keep=(d:Record<string,number>)=>{const ok:Record<string,number>={};for(const[k,v]of Object.entries(d))if(v>0){ok[k]=v;testedNodes.set(`${sourceKey(c)}|${k}`,v)}if(Object.keys(ok).length)testedDelays.set(storeKey,{...(testedDelays.get(storeKey)??{}),...ok});return ok}
    ;(async()=>{
      let ok=keep(await testNodes(c,missing).catch(()=>({} as Record<string,number>)))
      const rest=missing.filter(n=>ok[n]===undefined)
      if(rest.length){const second=keep(await testGroup(c,g).catch(()=>({} as Record<string,number>)));ok={...ok,...second}}
      const still=missing.filter(n=>ok[n]===undefined)
      if(guard.alive){setDelays(merged());if(still.length)setFailed(f=>new Set([...f,...still]))}
    })().finally(()=>{for(const n of missing)probing.delete(`${storeKey}|${n}`)})
  },[isOpen,storeKey,g.all.length])
  const toggleOpen=()=>{setOpen(!open);feedback()}
  return <Card><HStack onLongPressGesture={()=>{if(prefs.collapseGesture)toggleOpen()}}><Button buttonStyle="plain" frame={{maxWidth:"infinity",alignment:"leading"}} action={toggleOpen}><HStack spacing={12} frame={{maxWidth:"infinity",alignment:"leading"}} contentShape="rect">{prefs.customIcons ? <GroupIcon g={g}/> : null}<VStack alignment="leading" spacing={4}><Text font={16} fontWeight="semibold">{g.name}</Text><HStack spacing={4}><Text font={12} foregroundStyle="secondaryLabel">{now||"内核未提供当前节点"}</Text>{d!==undefined?<><Circle fill={delayColor(d) as any} frame={{width:6,height:6}}/><Text font={12} foregroundStyle={delayColor(d) as any}>{d>0?`${d}ms`:"超时"}</Text></>:null}</HStack></VStack><Spacer/></HStack></Button><Button title="" systemImage="bolt.fill" tint="systemOrange" action={async()=>{if(busy)return;setBusy(true);await attempt(async()=>{const d=await testGroup(c,g);testedDelays.set(storeKey,{...(testedDelays.get(storeKey)??{}),...d});for(const[k,v]of Object.entries(d))testedNodes.set(`${sourceKey(c)}|${k}`,v);if(guard.alive)setDelays(merged())});if(guard.alive)setBusy(false)}}/><Button buttonStyle="plain" action={toggleOpen}><VStack frame={{width:44,height:44}} contentShape="rect"><Image systemName={expanded||open?"chevron.down":"chevron.right"} font={12} foregroundStyle="tertiaryLabel" frame={{width:28,height:28}}/></VStack></Button></HStack>
    {prefs.collapseGesture?<Button title={open?"收起预览":"展开预览"} action={()=>{setOpen(!open);feedback()}}/>:null}
    {expanded||open?<>{(()=>{const ns=sortedNodes(g,delays).slice(0,nodeLimit),rows:string[][]=[];for(let i=0;i<ns.length;i+=2)rows.push(ns.slice(i,i+2));return rows.map(r=><HStack key={r[0]} spacing={8}>{r.map(n=>{const on=now===n,dn=delays[n];return <Button key={n} buttonStyle="plain" disabled={!selectable(g)} frame={{maxWidth:"infinity"}} action={()=>{if(n===now)return;const prev=now;setNow(n);void attempt(async()=>{try{await selectProxy(c,g.name,n)}catch(e){if(guard.alive)setNow(prev);throw e}if(guard.alive)onChanged()})}}><VStack alignment="leading" spacing={10} frame={{maxWidth:"infinity",alignment:"leading"}} padding={{horizontal:10,vertical:14}} background={<RoundedRectangle cornerRadius={12} fill={on?"systemBlue":"tertiarySystemBackground"}/>}><HStack><Text font={prefs.proxyStyle==="compact"?12:13} fontWeight="semibold" lineLimit={1} foregroundStyle={on?"white":FG}>{n}</Text><Spacer/>{on?<Image systemName="checkmark.circle.fill" font={13} foregroundStyle="white"/>:null}</HStack><HStack spacing={4} frame={{maxWidth:"infinity"}}><Circle fill={dn!==undefined?delayColor(dn) as any:"tertiarySystemFill"} frame={{width:6,height:6}}/><Text font={11} foregroundStyle={dn!==undefined?delayColor(dn) as any:"secondaryLabel"}>{dn===undefined?(failed.has(n)?"超时":"未测速"):dn>0?`${dn}ms`:"超时"}</Text><Spacer/><Text font={11} lineLimit={1} foregroundStyle={on?"white":"secondaryLabel"}>{g.types?.[n]||"协议未知"}</Text></HStack></VStack></Button>})}{r.length<2?<Spacer frame={{maxWidth:"infinity"}}/>:null}</HStack>)})()}<Pages hideCount limit={nodeLimit} total={g.all.length} more={()=>setNodeLimit(nodeLimit+40)}/></>:null}
  </Card>
}
const proxyCache=new Map<string,{groups:Group[];providers:Provider[]}>()
export function ProxiesPage({active,version,onClose,selected=true}:{active:Controller|null;version:number;onClose?:()=>void;selected?:boolean}) {
  const p=usePreferences(),cacheKey=active?sourceKey(active):"",cached=proxyCache.get(cacheKey),[groups,setGroups]=useState<Group[]>(cached?.groups??[]),[providers,setProviders]=useState<Provider[]>(cached?.providers??[]),[loaded,setLoaded]=useState(!!cached),[err,setErr]=useState(""),[tick,setTick]=useState(0),[expanded,setExpanded]=useState(false),[showProviders,setShowProviders]=useState(true),[limit,setLimit]=useState(40),[visible,setVisible]=useState(selected)
  traceIconPreference("proxies-render", p.customIcons)
  useEffect(()=>{const c=proxyCache.get(cacheKey);setGroups(c?.groups??[]);setProviders(c?.providers??[]);setLoaded(!!c)},[cacheKey])
  useEffect(()=>{if(!active||!visible)return;let alive=true;setErr("");loadGroups(active).then(x=>{if(alive){setGroups(x);setLoaded(true);setErr("");proxyCache.set(cacheKey,{groups:x,providers:proxyCache.get(cacheKey)?.providers??[]})}}).catch(()=>{if(alive)setErr(safeError())});return()=>{alive=false}},[active&&sourceKey(active),version,tick,p.showHidden,p.showGlobal,p.nestedDelay,visible])
  useEffect(()=>{if(!active||!showProviders||!visible)return;let alive=true;loadProviders(active,"proxies").then(x=>{if(alive){setProviders(x);proxyCache.set(cacheKey,{groups:proxyCache.get(cacheKey)?.groups??[],providers:x})}}).catch(()=>{if(alive)setErr("代理提供商读取不可用：当前内核不支持或权限不足；显示的0是已加载数量，不代表远端总数。")});return()=>{alive=false}},[active&&sourceKey(active),tick,showProviders,visible])
  const remote=providers.filter(x=>x.vehicleType.toLowerCase()==="http")
  const menu=<Menu label={<Image systemName="ellipsis.circle"/>}><Picker title="节点排序" pickerStyle="menu" value={p.nodeSort} onChanged={(v:string)=>savePreferences({nodeSort:v as any})}>{NODE_SORT_OPTIONS.map(([key, label]) => <Text key={key} tag={key}>{label}</Text>)}</Picker><Toggle title="显示Global代理组" value={p.showGlobal} onChanged={(v:boolean)=>savePreferences({showGlobal:v})}/><Toggle title="展示全部代理组" value={expanded} onChanged={setExpanded}/><Toggle title="显示隐藏组" value={p.showHidden} onChanged={(v:boolean)=>savePreferences({showHidden:v})}/><Toggle title="显示代理提供商" value={showProviders} onChanged={setShowProviders}/><Button title="全部更新" action={()=>{if(active)void updateAllProviders(active,"proxies",remote,()=>setTick(t=>t+1))}}/></Menu>
  return Shell({title:active?.name??"代理",toolbar:rootToolbar("proxies",onClose,menu),onAppear:()=>setVisible(true),onDisappear:()=>setVisible(false),children:<>{!active?<Empty/>:<>{err?<Hint>{err}</Hint>:null}{!err&&loaded&&groups.length===0?<Hint>未读取到策略组</Hint>:null}{groups.slice(0,limit).map(g=><GroupSection key={g.name} c={active} g={g} expanded={expanded} onChanged={()=>setTick(t=>t+1)}/>)}<Pages hideCount limit={limit} total={groups.length} more={()=>setLimit(limit+40)}/>{showProviders?<><HStack><Text font={20} fontWeight="bold" padding={{top:6}}>代理提供商</Text><Spacer/></HStack>{remote.slice(0,limit).map(p=><ProviderCard key={p.name} c={active} p={p} kind="proxies" onChanged={()=>setTick(t=>t+1)}/>)}<Pages hideCount limit={limit} total={remote.length} more={()=>setLimit(limit+40)}/></>:null}</>}</>})
}
function ruleColor(type:string) { return /AND|OR|NOT|MATCH/.test(type)?"systemRed":/PROCESS/i.test(type)?"systemPurple":/IP|GEOIP/i.test(type)?"systemGreen":"systemBlue" }
export function RulesPage({active,version,onClose,selected=true}:{active:Controller|null;version:number;onClose?:()=>void;selected?:boolean}) {
  const [rules,setRules]=useState<Rule[]>([]),[providers,setProviders]=useState<Provider[]>([]),[tab,setTab]=useState("rules"),[q,setQ]=useState(""),[search,setSearch]=useState(false),[limit,setLimit]=useState(80),[tick,setTick]=useState(0),[err,setErr]=useState(""),[visible,setVisible]=useState(selected)
  useEffect(()=>{setRules([]);setProviders([])},[active&&sourceKey(active)])
  useEffect(()=>{if(!active||!visible)return;let alive=true;setErr("");loadRules(active).then(xs=>{if(alive)setRules(xs)}).catch(()=>{if(alive)setErr(safeError())});loadProviders(active,"rules").then(xs=>{if(alive)setProviders(xs)}).catch(()=>{if(alive)setErr("规则提供者数量未提供：内核未支持或权限不足；分段显示的是已加载数量。规则列表独立读取。")});return()=>{alive=false}},[active&&sourceKey(active),version,tick,visible])
  const shown=rules.map((r,i)=>({...r,index:i+1})).filter(r=>[r.type,r.payload,r.proxy].join(" ").toLowerCase().includes(q.toLowerCase()))
  return Shell({title:active?.name??"规则",onAppear:()=>setVisible(true),onDisappear:()=>setVisible(false),toolbar:rootToolbar("rules",onClose,<Menu label={<Image systemName="ellipsis.circle"/>}><Button title="搜索规则" action={()=>setSearch(!search)}/><Button title="刷新规则" action={()=>setTick(tick+1)}/><Button title="全部更新" action={()=>{if(active)void updateAllProviders(active,"rules",providers,()=>setTick(t=>t+1))}}/></Menu>),children:<>{!active?<Empty/>:<><Picker title="规则与提供者" pickerStyle="segmented" value={tab} onChanged={setTab}><Text tag="rules">{`规则 ${rules.length}`}</Text><Text tag="providers">{`提供者 ${providers.length}`}</Text></Picker>{search?<TextField title="搜索规则" value={q} onChanged={(v:string)=>{setQ(v);setLimit(80)}}/>:null}{err?<Hint>{err}</Hint>:null}{tab==="providers"?<>{providers.slice(0,limit).map(p=><ProviderCard key={p.name} c={active} p={p} kind="rules" onChanged={()=>setTick(t=>t+1)}/>)}<Pages hideCount limit={limit} total={providers.length} more={()=>setLimit(limit+80)}/></>:<>{shown.slice(0,limit).map(r=><Card key={String(r.index)}><HStack spacing={8}><Hint>{`#${r.index}`}</Hint><Chip title={r.type} color={ruleColor(r.type)}/><Text font={13}>{r.payload||"—"}</Text><Spacer/><Text font={12} foregroundStyle="secondaryLabel">{r.proxy}</Text></HStack></Card>)}<Pages hideCount limit={limit} total={shown.length} more={()=>setLimit(limit+80)}/></>}</>}</>})
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
  const prefs=usePreferences(),[conns,setConns]=useState<Conn[]>([]),[closed,setClosed]=useState<Conn[]>([]),[paused,setPaused]=useState(false),[visible,setVisible]=useState(selected),[tab,setTab]=useState("active"),[err,setErr]=useState(""),[q,setQ]=useState(""),[search,setSearch]=useState(false),[client,setClient]=useState(""),[labelsOpen,setLabelsOpen]=useState(false),[labels,setLabels]=useState<Record<string,string>>({}),[labelIP,setLabelIP]=useState(""),[label,setLabel]=useState(""),[limit,setLimit]=useState(60),[tick,setTick]=useState(0),[fresh,setFresh]=useState<Record<string,number>>({}),[sort,setSort]=useState("new"),[seenBox]=useState({seen:new Set<string>(),init:false}),[foreground,setForeground]=useState(true),[scene]=useState({active:true,epoch:0})
  useEffect(()=>{const changed=(phase:string)=>{scene.active=phase==="active";scene.epoch++;setForeground(scene.active);if(scene.active){setErr("");setFresh({})}};AppEvents.scenePhase.addListener(changed);return()=>AppEvents.scenePhase.removeListener(changed)},[])
  useEffect(()=>{if(!active)return;seenBox.seen.clear();seenBox.init=false;setFresh({});setLabels(clientLabels(active));setConns([]);setClosed(historyFor(active).closed);setClient("")},[active&&sourceKey(active)])
  useEffect(()=>{if(active&&!paused&&visible&&foreground)historyFor(active).resume()},[active&&sourceKey(active),paused,visible,foreground])
  useEffect(()=>{if(!active||paused||!visible||!foreground)return;let alive=true,busy=false;const epoch=scene.epoch,current=()=>alive&&scene.active&&epoch===scene.epoch;setErr("");const h=historyFor(active);async function refresh(){if(!current()||busy)return;busy=true;try{const xs=await loadConnections(active!);if(current()){h.sample(xs,Date.now());setConns([...h.active]);setClosed([...h.closed]);setErr("");const ids=[...h.active.map(x=>"a:"+x.id),...h.closed.map(x=>"c:"+x.id)];if(seenBox.init){const nw=ids.filter(id=>!seenBox.seen.has(id));if(nw.length){setFresh(f=>({...f,...Object.fromEntries(nw.map(id=>[id,1]))}));nw.forEach((id,i)=>setTimeout(()=>{if(current())setFresh(f=>{const o={...f};delete o[id];return o})},60*(Math.min(i,9)+1)))}}for(const id of ids)seenBox.seen.add(id);seenBox.init=true}}catch{if(current())setErr(safeError())}finally{busy=false}}void refresh();const t=setInterval(refresh,1500);return()=>{alive=false;clearInterval(t)}},[active&&sourceKey(active),version,paused,visible,tick,foreground])
  const sortFns:Record<string,(a:Conn,b:Conn)=>number>={new:(a,b)=>(b.start||0)-(a.start||0),old:(a,b)=>(a.start||0)-(b.start||0),down:(a,b)=>(b.downSpeed??0)-(a.downSpeed??0),up:(a,b)=>(b.upSpeed??0)-(a.upSpeed??0),traffic:(a,b)=>(b.up+b.down)-(a.up+a.down)}
  const shown=[...filterConnections((tab==="active"?conns:closed).filter(x=>!fresh[(tab==="active"?"a:":"c:")+x.id]),q,client,labels)].sort(sortFns[sort]),clients=Array.from(new Set([...conns,...closed].map(x=>x.sourceIP??"").filter(Boolean)))
  async function close(x?:Conn){if(!active)return;await attempt(async()=>{if(await confirmed(active.name,x?`断开到 ${x.host} 的连接（${x.src}）。应用可能重新建立连接。`:`断开此Mihomo内核的全部活动连接（当前观察 ${conns.length} 条）。应用可能重新建立连接。`,()=>x?closeConnection(active,x.id):closeAllConnections(active)))setTick(t=>t+1)})}
  return Shell({title:active?.name??"连接",onAppear:()=>setVisible(true),onDisappear:()=>setVisible(false),toolbar:rootToolbar("connections",onClose,<Menu label={<Image systemName="ellipsis.circle"/>}><Button title="搜索连接" action={()=>setSearch(!search)}/><Button title={paused?"恢复监控":"暂停监控"} action={()=>setPaused(!paused)}/><Button title="客户端标签" action={()=>setLabelsOpen(!labelsOpen)}/><Button title="清理已断开连接" action={async()=>{if(active&&await confirmed(`${active.name} · 本地历史`,"清理本脚本已观察到的已断开历史，不操作远端连接。",async()=>{historyFor(active).clear();setClosed([])}))feedback()}}/><Button title="打断全部连接" action={()=>close()}/></Menu>),children:<>{!active?<Empty/>:<><VStack spacing={6} padding={6} background={<RoundedRectangle cornerRadius={16} fill="secondarySystemBackground"/>}>
      <HStack spacing={6}>
        {(["active","closed"] as const).map(k=><Button key={k} buttonStyle="plain" action={()=>{setTab(k);setLimit(60)}}><HStack spacing={6} padding={{horizontal:8,vertical:6}} background={<RoundedRectangle cornerRadius={12} fill={tab===k?"systemBackground":"clear"}/>}><Circle fill={k==="active"?(tab===k?"systemGreen":"tertiaryLabel"):"tertiaryLabel"} frame={{width:6,height:6}}/><Text font={13} fontWeight={tab===k?"semibold":"regular"} foregroundStyle={tab===k?"label":"secondaryLabel"}>{k==="active"?"活动中":"已关闭"}</Text><Text font={11} foregroundStyle={tab===k?"systemGreen":"secondaryLabel"} padding={{horizontal:6,vertical:1}} background={<RoundedRectangle cornerRadius={8} fill="tertiarySystemFill"/>}>{String(k==="active"?conns.length:closed.length)}</Text></HStack></Button>)}
        <Spacer/>
        <Button buttonStyle="plain" action={()=>setSearch(!search)}><Image systemName="magnifyingglass" font={14} foregroundStyle={search?"systemBlue":"secondaryLabel"} frame={{width:32,height:32}} background={<RoundedRectangle cornerRadius={12} fill={search?"tertiarySystemFill":"clear"}/>}/></Button>
        <Menu label={<Image systemName="arrow.up.arrow.down" font={14} foregroundStyle="secondaryLabel" frame={{width:32,height:32}}/>}><Button title={sort==="new"?"✓ 最新优先":"最新优先"} action={()=>setSort("new")}/><Button title={sort==="old"?"✓ 最早优先":"最早优先"} action={()=>setSort("old")}/><Button title={sort==="down"?"✓ 下载速率":"下载速率"} action={()=>setSort("down")}/><Button title={sort==="up"?"✓ 上传速率":"上传速率"} action={()=>setSort("up")}/><Button title={sort==="traffic"?"✓ 累计流量":"累计流量"} action={()=>setSort("traffic")}/></Menu>
        
      </HStack>
      {search?<TextField title="搜索连接..." value={q} onChanged={(v:string)=>{setQ(v);setLimit(60)}} padding={8} background={<RoundedRectangle cornerRadius={10} fill="systemBackground"/>}/>:null}
    </VStack>{err?<Hint>{err}</Hint>:null}{labelsOpen?<Card><Hint>标签仅保存在本地，并按完整sourceIP匹配，不修改路由器。</Hint><Picker title="来源地址" pickerStyle="menu" value={labelIP} onChanged={(v:string)=>{setLabelIP(v);setLabel(labels[v]||"")}}><Text tag="">选择客户端</Text>{clients.map(ip=><Text key={ip} tag={ip}>{ip}</Text>)}</Picker><TextField title="客户端标签" value={label} onChanged={setLabel}/><Button title="保存本地标签" disabled={!labelIP} action={()=>attempt(async()=>{saveClientLabel(active,labelIP,label);setLabels(clientLabels(active))})}/></Card>:null}
    {shown.slice(0,limit).map(x=>{const ago=(t:number)=>{const m=Math.max(0,Math.floor((Date.now()-t)/60000));return m<1?"刚刚":m<60?`${m}分钟前`:m<1440?`${Math.floor(m/60)}小时前`:`${Math.floor(m/1440)}天前`},dh=x.host,dp=x.dst.lastIndexOf(":")>0?x.dst.slice(x.dst.lastIndexOf(":")):"",chain=x.chains??[],dur=x.start?fmtUptime(Math.max(0,((x.closedAt??Date.now())-x.start)/1000)):""
      return <Card compact key={x.id+(x.closedAt??"")} contextMenu={{menuItems:<>{!x.closedAt?<Button title="关闭连接" systemImage="xmark.circle" action={()=>void close(x)}/>:null}<Button title="筛选同源连接" systemImage="laptopcomputer" action={()=>{setClient(x.sourceIP??"");setLimit(60)}}/><Button title="筛选同域名连接" systemImage="globe" action={()=>{setQ(x.host);setSearch(true);setLimit(60)}}/><Button title="复制连接信息" systemImage="doc.on.doc" action={()=>{void Pasteboard.setString([x.host+(x.dst.lastIndexOf(":")>0?x.dst.slice(x.dst.lastIndexOf(":")):""),x.src,x.network,(x.chains??[]).join(" > "),x.rule].filter(Boolean).join("\n"));feedback()}}/></>}} opacity={1}>
        <HStack spacing={6}><NavigationLink destination={<ConnectionDetailPage x={x} onDisconnect={(y:Conn)=>void close(y)}/>}><HStack spacing={6}><Image systemName="clock.fill" font={11} foregroundStyle="secondaryLabel"/><Text font={11} foregroundStyle="secondaryLabel">{x.start?ago(x.start):"时间未提供"}</Text>{x.closedAt?(dur?<Chip small title={dur} color="secondaryLabel"/>:null):<><Image systemName="arrow.down" font={10} foregroundStyle="systemBlue"/><Text font={10}>{fmtSpeed(x.downSpeed??0)}</Text><Image systemName="arrow.up" font={11} foregroundStyle="systemGreen"/><Text font={10}>{fmtSpeed(x.upSpeed??0)}</Text></>}<Spacer/></HStack></NavigationLink>{!x.closedAt?<Button title="" buttonStyle="plain" systemImage="xmark.circle.fill" foregroundStyle="tertiaryLabel" action={()=>close(x)}/>:null}</HStack><NavigationLink destination={<ConnectionDetailPage x={x} onDisconnect={(y:Conn)=>void close(y)}/>}><VStack alignment="leading" spacing={6}>
        <HStack spacing={6}><Image systemName="globe" font={11} foregroundStyle="systemBlue"/><Text font={14} fontWeight="semibold" lineLimit={1}>{dh}</Text><Text font={11} foregroundStyle="secondaryLabel">{dp}</Text></HStack>
        {chain.length?<HStack spacing={6}><Image systemName="arrow.triangle.branch" font={11} foregroundStyle="systemOrange"/><Text font={11} foregroundStyle="secondaryLabel" lineLimit={1}>{chain.join(" > ")}</Text></HStack>:null}
        <HStack spacing={6}><Chip small title={x.network||"未提供"} color="systemGreen"/>{prefs.connectionStyle==="standard"?<Text font={11} foregroundStyle="secondaryLabel" lineLimit={1}>{labels[x.sourceIP??""]?`${labels[x.sourceIP??""]} · ${x.src}`:x.src}</Text>:null}<Spacer/><Image systemName="arrow.down.circle.fill" font={11} foregroundStyle="systemBlue"/><Text font={11} foregroundStyle="systemBlue">{fmtBytes(x.down)}</Text><Image systemName="arrow.up.circle.fill" font={11} foregroundStyle="systemGreen"/><Text font={11} foregroundStyle="systemGreen">{fmtBytes(x.up)}</Text></HStack></VStack></NavigationLink>
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
function MoreLine({title,icon,color="systemBlue",detail,subtitle,arrow=false}:any) { return <HStack alignment="center" spacing={14} padding={{horizontal:16,vertical:14}} frame={{maxWidth:"infinity",alignment:"leading"}}><Image systemName={icon} font={21} foregroundStyle={color} frame={{width:24}}/><VStack alignment="leading" spacing={6} frame={{maxWidth:"infinity",alignment:"leading"}}><HStack><Text font={17} foregroundStyle="label">{title}</Text><Spacer/>{detail?<Text font={14} foregroundStyle="secondaryLabel" fixedSize={{horizontal:true,vertical:false}} lineLimit={1}>{detail}</Text>:null}{arrow?<Image systemName="chevron.right" font={12} foregroundStyle="tertiaryLabel"/>:null}</HStack>{subtitle?<Text font={12} foregroundStyle="secondaryLabel">{subtitle}</Text>:null}</VStack></HStack> }
function MoreSeparator() { return <Divider padding={{leading:54}}/> }
function MoreTile({title,icon,color}:any) { return <VStack alignment="center" spacing={10} modifiers={modifiers().frame({minWidth:0,maxWidth:"infinity",minHeight:88,maxHeight:88,alignment:"center"}).background(<RoundedRectangle cornerRadius={9} fill="tertiarySystemGroupedBackground"/>)}><Image systemName={icon} font={23} foregroundStyle={color} frame={{width:28,height:28,alignment:"center"}}/><Text font={12} foregroundStyle="label" lineLimit={1} frame={{height:18,alignment:"center"}}>{title}</Text></VStack> }
const moreSnapshots=new Map<string,{core?:string;app?:string;runtime?:NikkiRuntime;running?:boolean|null}>()
export function MorePage({active,onChanged,onClose,selected=true}:{active:Controller|null;onChanged:()=>void;onClose?:()=>void;selected?:boolean}) {
  const [core,setCore]=useState("未提供"),[app,setApp]=useState("未提供"),[mode,setMode]=useState("未提供"),[err,setErr]=useState(""),[visible,setVisible]=useState(selected),[busy,setBusy]=useState(false),[running,setRunning]=useState<boolean|null>(null),[guard]=useState({alive:true,source:"",busy:false}),[runtime,setRuntime]=useState<NikkiRuntime|null>(null),[,setClock]=useState(0),[notice,setNotice]=useState(""),[noticeKind,setNoticeKind]=useState("success")
  guard.source=active?sourceKey(active):""
  useEffect(()=>()=>{guard.alive=false},[])
  useEffect(()=>{setVisible(selected)},[selected])
  useEffect(()=>{
    if(!active||!selected||!visible)return
    let alive=true,runtimeTimer:any,inFlight=false
    const key=sourceKey(active),cached=moreSnapshots.get(key)??{}
    if(moreSnapshots.size>30)moreSnapshots.clear()
    const remember=(patch:typeof cached)=>{if(alive)moreSnapshots.set(key,{...moreSnapshots.get(key),...patch})}
    setCore(cached.core??"读取中…");setApp(cached.app??"读取中…");setMode(lastControllerMode(active)??"读取中…");setRunning(cached.running??null);setRuntime(cached.runtime??null);setErr("")
    loadRuntimeVersions(active,x=>{if(alive){if(x.core!=="未提供"){setCore(x.core);remember({core:x.core})}if(x.app!=="未提供"){setApp(x.app);remember({app:x.app})}}}).then(x=>{if(alive){if(x.failed){if(!moreSnapshots.get(key)?.core)setCore("读取失败");if(!moreSnapshots.get(key)?.app)setApp("读取失败");setErr("部分版本信息读取失败；已保留同来源上次结果。")}}}).catch(()=>{if(alive)setErr(safeError())})
    loadConfig(active).then(x=>{if(alive)setMode(x.mode??"未提供")}).catch(()=>{if(alive&&!lastControllerMode(active))setMode("读取失败")})
    if(active.kind==="openwrt"&&active.plugin==="nikki"){
      const update=(x:NikkiRuntime)=>{if(alive){setRuntime(x);setRunning(x.running??null);remember({runtime:x,running:x.running})}}
      const readRuntime=async()=>{if(inFlight)return;inFlight=true;try{update(await loadNikkiRuntime(active,update))}catch{if(alive)setErr("运行时间读取失败，请检查连接与读取权限。")}finally{inFlight=false}}
      void readRuntime();runtimeTimer=setInterval(readRuntime,30000)
    }
    return()=>{alive=false;if(runtimeTimer)clearInterval(runtimeTimer)}
  },[active&&sourceKey(active),selected,visible])
  useEffect(()=>{if(!selected||!visible||!runtime||(runtime.coreSeconds===null&&runtime.serviceSeconds===null))return;const timer=setInterval(()=>setClock(n=>n+1),1000);return()=>clearInterval(timer)},[selected,visible,runtime])
  useEffect(()=>{setNotice("")},[active&&sourceKey(active),visible])
  useEffect(()=>{if(!notice||noticeKind==="progress")return;const timer=setTimeout(()=>setNotice(""),4500);return()=>clearTimeout(timer)},[notice,noticeKind])
  const duration=(value:number|null|undefined)=>value==null?"未提供":fmtUptime(value+Math.max(0,Math.floor((Date.now()-(runtime?.measuredAt??Date.now()))/1000)),true)
  async function act(action:CoreAction,label:string,impact:string){
    if(!active||guard.busy)return
    const source=sourceKey(active),current=()=>guard.alive&&guard.source===source
    guard.busy=true;setBusy(true);setNotice("")
    await attempt(async()=>{
      const options=action==="restart"?{title:"重启核心",message:"确定要重启核心吗？这将短暂中断代理服务。",confirmLabel:"确认重启"}:action==="reload"?{title:"重载配置",message:"将重新加载配置文件。",confirmLabel:"确认重载"}:null
      const ok=["geo","dns","fakeip"].includes(action)?true:options?await Dialog.confirm({...options,cancelLabel:"取消"}):await Dialog.confirm({title:label,message:impact,confirmLabel:"确认清除",cancelLabel:"取消"})
      if(!ok||!current())return
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
  const actions:[CoreAction,string,string,string][]=[["restart","重启核心","arrow.clockwise","会短暂中断代理服务及连接；禁用管理API的内核可能拒绝。"],["reload","重载配置","arrow.triangle.2.circlepath","强制重新读取当前核心配置并应用，可能断开连接；不会保存Nikki UCI。"],["geo","更新GEO数据库","globe","内核将从其配置的上游下载GEO文件并替换本地数据库，产生外部请求。"]]
  return Shell({title:active?.name??"更多",background:"systemBackground",toolbar:rootToolbar("more",onClose),overlay:notice?{alignment:"top",content:<VStack padding={{horizontal:14,top:8}}><HStack spacing={14} padding={18} background={<RoundedRectangle cornerRadius={18} fill="secondarySystemBackground"/>}>{noticeKind==="progress"?<ProgressView/>:<Image systemName={noticeKind==="warning"?"exclamationmark.circle.fill":"checkmark.circle.fill"} font={24} foregroundStyle={noticeKind==="warning"?"systemOrange":"systemGreen"}/>}<Text font={16} fontWeight="medium">{notice}</Text><Spacer/><Button buttonStyle="plain" action={()=>setNotice("")}><Image systemName="xmark" font={16} foregroundStyle="secondaryLabel"/></Button></HStack></VStack>}:undefined,onAppear:()=>setVisible(true),onDisappear:()=>setVisible(false),children:<>{!active?<Empty/>:<>{err?<Hint>{err}</Hint>:null}
    <MoreHeading>运行信息</MoreHeading><MorePanel><MoreLine title="内核版本" icon="desktopcomputer" detail={core} subtitle={`运行时间：${running===false?"未运行":duration(runtime?.coreSeconds)}`}/><MoreSeparator/><MoreLine title="插件版本" icon="shippingbox" color="systemOrange" detail={app} subtitle={`${nikki?"Nikki 服务":active.plugin??"独立控制器"}（运行时间：${running===false?"未运行":duration(runtime?.serviceSeconds)}）`}/></MorePanel>
    <MoreHeading>核心配置</MoreHeading><MorePanel><NavigationLink destination={<KernelConfigPage c={active}/>}><MoreLine title="代理配置" icon="slider.horizontal.3" color="systemOrange" detail={mode==="rule"?"规则模式":mode==="global"?"全局模式":mode==="direct"?"直连模式":mode} arrow/></NavigationLink></MorePanel>
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
function Status({work}:{work:ReturnType<typeof useWork>}) { return <>{work.error?<Note error>{work.error}</Note>:null}{work.notice?<Note>{work.notice}</Note>:null}{work.busy?<Note>处理中…</Note>:null}</> }
// Busy is also synchronous, so double taps cannot race before the next native render.
function useWork(c:Controller) {
  const [owner]=useState(()=>({...c})),[guard]=useState({alive:true,visible:true,busy:false,source:source(c)}),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("")
  guard.source=source(c)
  const current=()=>guard.alive&&guard.visible&&guard.source===source(owner)
  useEffect(()=>{guard.alive=true;return()=>{guard.alive=false;guard.visible=false}},[])
  async function run(fn:()=>Promise<void>) {if(guard.busy||!current())return;guard.busy=true;setBusy(true);setError("");setNotice("");try{await fn()}catch(e){if(current())setError(errorText(e))}finally{guard.busy=false;if(current())setBusy(false)}}
  async function confirm(effect:string,fn:()=>Promise<void>) {if(await Dialog.confirm({title:"确认操作",message:`目标：${owner.name}\n${effect}`,confirmLabel:"继续",cancelLabel:"取消"})&&current())await fn()}
  const commitConfirm=(effect:string,fn:()=>Promise<void>)=>confirm(effect+"\n"+COMMIT_WARNING,fn)
  return {owner,guard,busy,error,notice,setNotice,resetStatus:()=>{setError("");setNotice("")},current,run,confirm,commitConfirm,changed:source(c)!==source(owner),onAppear:()=>{guard.visible=true;setBusy(guard.busy)},onDisappear:()=>{guard.visible=false}}
}
type EditValue = {kind:"subscription"; value:NikkiSubscription|null}|{kind:"rule";value:NikkiRule|null}|{kind:"sort"}|{kind:"file";value:NikkiFile}
type EditTarget = EditValue & {entry:number; base:NikkiManagement}
export function NikkiManagementPage({c,kind}:{c:Controller;kind:"profile"|"subscription"|"rule"}) {
  const work=useWork(c),[data,setData]=useState<NikkiManagement|null>(null),[error,setError]=useState(""),[tick,setTick]=useState(0),[visible,setVisible]=useState(true),[edit,setEdit]=useState<EditTarget|null>(null),[navigation]=useState({entry:0})
  const supported=c.kind==="openwrt"&&c.plugin==="nikki",title={profile:"配置文件",subscription:"订阅管理",rule:"附加规则"}[kind]
  const refresh=()=>setTick(t=>t+1)
  useEffect(()=>{if(!supported||work.changed||!visible)return;let alive=true;setError("");loadNikkiManagement(work.owner).then(d=>{if(alive)setData(d)}).catch(e=>{if(alive)setError(errorText(e))});return()=>{alive=false}},[source(c),kind,tick,visible])
  const done=(saved=false)=>{setEdit(null);if(saved)refresh()}
  // Freeze both the object and its UCI snapshot at navigation entry. Native destinations
  // can be prebuilt/reused; identity must represent an opening, not only a component type.
  function openEdit(value:EditValue) {if(!data||work.busy)return;const snapshot="value" in value&&value.value?{...value,value:{...value.value}}:value;setEdit({...snapshot,entry:++navigation.entry,base:data} as EditTarget)}
  const entryKey=edit?source(c)+":"+edit.entry:"closed"
  const content=edit ? edit.kind==="subscription"?<NikkiSubscriptionEditor key={entryKey} entryKey={entryKey} c={c} base={edit.base} value={edit.value} done={done}/>:edit.kind==="rule"?<NikkiRuleEditor key={entryKey} c={c} base={edit.base} value={edit.value} done={done}/>:edit.kind==="sort"?<NikkiRuleSort key={entryKey} c={c} base={edit.base} done={done}/>:<NikkiFileEditor key={entryKey} entryKey={entryKey} c={c} base={edit.base} file={edit.value} done={done}/> : <Text/>
  async function removeSubscription(s:NikkiSubscription) {await work.run(()=>work.commitConfirm(`删除订阅「${s.name}」？仅删除此订阅设置，保留已下载文件；当前选用订阅不可删除。`,async()=>{await deleteNikkiSubscription(work.owner,data!,s.id);if(work.current()){refresh();work.setNotice("订阅设置已删除；系统可能已自动重载")}}))}
  async function update(s:NikkiSubscription) {await work.run(()=>work.confirm(`更新订阅「${s.name}」？Nikki 将访问订阅地址并覆盖下载文件（包括对此文件的本地编辑），可能是当前选用配置。不会主动发送重载请求。`,async()=>{await updateNikkiSubscription(work.owner,s.id,data!);if(work.current()){refresh();work.setNotice("订阅已更新，未主动重载服务")}}))}
  async function enable(f:NikkiFile) {if(data?.profile===f.key)return;await work.run(()=>work.commitConfirm(`启用「${f.name}」？将提交为 Nikki 选用配置，由系统触发重载；配置选择成功不代表内核已成功加载。`,async()=>{
    await selectNikkiProfile(work.owner,data!,f.key)
    if(work.current())refresh()
    if(work.current())work.setNotice("配置选择已提交；系统可能已自动重载。请核实运行效果，未生效时可在服务管理单独重载")
  }))}
  const toolbar=!supported||work.changed?undefined:kind==="rule"?{topBarTrailing:<Menu accessibilityLabel="操作" label={<Image systemName="ellipsis"/>}><Button title="排序列表" systemImage="arrow.up.arrow.down" disabled={!data||work.busy||data.rules.length<2} action={()=>openEdit({kind:"sort"})}/><Button title={data?.appendRules?"禁用规则":"启用规则"} systemImage={data?.appendRules?"pause.circle":"play.circle"} disabled={!data||work.busy} action={()=>work.run(()=>work.commitConfirm(`将${data!.appendRules?"禁用":"启用"} Nikki 附加规则总开关。`,async()=>{await setNikkiRulesEnabled(work.owner,data!,!data!.appendRules);if(work.current()){refresh();work.setNotice("规则总开关已提交；系统可能已自动重载")}}))}/><Button title="添加规则" systemImage="plus.circle" disabled={!data||work.busy} action={()=>openEdit({kind:"rule",value:null})}/><Button title="刷新" disabled={work.busy} action={refresh}/></Menu>}:kind==="subscription"?{topBarTrailing:<Button title="添加订阅" systemImage="plus" labelStyle="iconOnly" disabled={!data||work.busy} action={()=>openEdit({kind:"subscription",value:null})}/>}:{topBarTrailing:<Button accessibilityLabel="刷新" disabled={work.busy} action={refresh}><Image systemName="arrow.triangle.2.circlepath"/></Button>}
  return <ScrollView background="systemBackground" navigationTitle={title} navigationBarTitleDisplayMode="inline" toolbar={toolbar} onAppear={()=>{work.onAppear();setVisible(true)}} onDisappear={()=>{work.onDisappear();setVisible(false)}} navigationDestination={{isPresented:edit!==null&&!work.changed,onChanged:(v:boolean)=>{if(!v)done()},content}}>
    <VStack spacing={16} padding={16} frame={{maxWidth:"infinity"}}>
      {!supported?<Note>不可用：当前来源不是 OpenWrt 上的 Nikki，不会向其他插件发送管理请求。</Note>:work.changed?<Note error>来源已改变，请返回后重新进入；不会沿用上一来源的草稿。</Note>:<>
        {error?<><Note error>{error}</Note><Button title="重试" action={refresh}/></>:null}<Status work={work}/>
        {!data&&!error?<Note>正在读取…</Note>:null}
        {data&&kind==="rule"?<>
          {data.rules.length===0?<VStack spacing={14} frame={{maxWidth:"infinity",minHeight:360}}><Image systemName="text.badge.plus" font={56} foregroundStyle="secondaryLabel"/><Text font="title2" fontWeight="bold">没有规则</Text><Note>点击右上角菜单添加规则</Note></VStack>:<><Note>{`总开关：${data.appendRules?"启用":"禁用"} · 提交可能自动重载 Nikki 服务`}</Note>{data.rules.map(r=><Panel key={r.id}><HStack><Text fontWeight="semibold">{r.type}</Text><Spacer/><Badge>{r.enabled?"启用":"禁用"}</Badge></HStack><Text>{r.matcher||"所有请求"}</Text><Note>{`${r.node}${r.noResolve?" · no-resolve":""}`}</Note><HStack><Button title="编辑" disabled={work.busy} action={()=>openEdit({kind:"rule",value:r})}/><Spacer/><Button title="删除规则" systemImage="trash" role="destructive" disabled={work.busy} action={()=>work.run(()=>work.commitConfirm(`删除规则「${r.type} · ${r.matcher}」？`,async()=>{await deleteNikkiRule(work.owner,data,r.id);if(work.current())refresh()}))}/></HStack></Panel>)}</>}
        </>:null}
        {data&&kind==="subscription"?<>{data.subscriptions.length===0?<Note>暂无订阅，请点击右上角 + 添加</Note>:data.subscriptions.map(s=>subscriptionCard({s,busy:work.busy,edit:()=>openEdit({kind:"subscription",value:s}),update:()=>update(s),remove:()=>removeSubscription(s)}))}</>:null}
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
function subscriptionCard({s,busy,edit,update,remove}:{s:NikkiSubscription;busy:boolean;edit:()=>void;update:()=>void;remove:()=>void}) {
  return <Panel key={s.id}>
    <HStack spacing={5} padding={{horizontal:8,vertical:5}} background={<RoundedRectangle cornerRadius={7} fill="tertiarySystemBackground"/>}><Image systemName="link" font={12}/><Text font={12}>订阅</Text></HStack>
    <Text font={24} fontWeight="bold" lineLimit={2}>{s.name}</Text>
    <Text font={13} foregroundStyle="secondaryLabel" lineLimit={1}>{s.url||"未设置URL"}</Text>
    <HStack spacing={6} foregroundStyle="secondaryLabel"><Image systemName="clock" font={12}/><Text font={12}>{`更新: ${nikkiRelativeUpdate(s.updated)}`}</Text></HStack>
    <HStack spacing={10}>
      <Button accessibilityLabel="编辑" buttonStyle="plain" disabled={busy} action={edit}>{nikkiEditLabel()}</Button>
      <Spacer/>
      <Button accessibilityLabel="更新订阅" buttonStyle="plain" disabled={busy} action={update}>{providerRefreshLabel(busy,"label")}</Button>
      <Button accessibilityLabel="删除订阅" buttonStyle="plain" disabled={busy} action={remove}><Image systemName="trash" font={14} foregroundStyle="label" frame={{width:34,height:34}} background={<Circle fill="tertiarySystemFill"/>}/></Button>
    </HStack>
  </Panel>
}
function EditorActions({work,done,save,disabled}:{work:ReturnType<typeof useWork>;done:(saved?:boolean)=>void;save:()=>void;disabled:boolean}) {return {topBarLeading:<Button title="取消" disabled={work.busy} action={()=>done()}/>,topBarTrailing:<Button title={work.busy?"保存中…":"保存"} disabled={work.busy||disabled||work.changed} action={save}/>}}
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
  const dirty=!value||name!==value.name||url!==value.url||ua!==value.userAgent||prefer!==value.prefer
  async function save(){const token=session.identity,initial=session.value,snapshot=session.base,draft={...session.draft};await work.run(()=>work.commitConfirm("保存此订阅设置？",async()=>{if(session.identity!==token||!work.current())return;await saveNikkiSubscription(work.owner,snapshot,initial?.id??null,{name:draft.name,url:draft.url,userAgent:draft.ua,prefer:draft.prefer});if(work.current()&&session.identity===token)session.done(true)}))}
  return <Form background="systemBackground" scrollContentBackground="hidden" navigationTitle="订阅设置" navigationBarTitleDisplayMode="inline" toolbar={EditorActions({work,done,save,disabled:!dirty})} onAppear={work.onAppear} onDisappear={work.onDisappear}>
    <Section header={<Text>基本信息</Text>}><TextField title="名称" value={name} onChanged={setName}/><TextField title="URL" value={url} onChanged={setUrl}/></Section>
    <Section header={<Text>User Agent</Text>}><Picker title="User Agent" pickerStyle="segmented" value={ua} onChanged={setUA}><Text tag="clash">Clash</Text><Text tag="clash.meta">Clash Meta</Text><Text tag="mihomo">Mihomo</Text></Picker>{!["clash","clash.meta","mihomo"].includes(ua)?<Note error>当前是自定义值，请明确选择后再保存</Note>:null}</Section>
    <Section header={<Text>配置优先级</Text>}><Picker title="配置优先级" pickerStyle="segmented" value={prefer} onChanged={setPrefer}><Text tag="remote">远程优先</Text><Text tag="local">本地优先</Text></Picker></Section>
    <Section><Note>仅修改此订阅的指定字段，其他未知字段保持不变。提交设置可能自动重载 Nikki；保存前会说明影响并确认。</Note><Status work={work}/>{work.changed?<Note error>来源已改变，请取消后重新进入</Note>:null}</Section>
  </Form>
}
export function NikkiRuleEditor({c,base,value,done}:{c:Controller;base:NikkiManagement;value:NikkiRule|null;done:(saved?:boolean)=>void}) {
  const work=useWork(c),[type,setType]=useState(value?.type??"DOMAIN-SUFFIX"),[matcher,setMatcher]=useState(value?.matcher??""),[node,setNode]=useState(value?.node??"GLOBAL"),[enabled,setEnabled]=useState(value?.enabled??true),[noResolve,setNoResolve]=useState(value?.noResolve??false)
  const dirty=!value||type!==value.type||matcher!==value.matcher||node!==value.node||enabled!==value.enabled||noResolve!==value.noResolve
  async function save(){await work.run(()=>work.commitConfirm("保存此附加规则？",async()=>{await saveNikkiRule(work.owner,base,value?.id??null,{type,matcher,node,enabled,noResolve});if(work.current())done(true)}))}
  return <Form background="systemBackground" scrollContentBackground="hidden" navigationTitle={value?"编辑规则":"添加规则"} navigationBarTitleDisplayMode="inline" toolbar={EditorActions({work,done,save,disabled:!dirty})} onAppear={work.onAppear} onDisappear={work.onDisappear}>
    <Section><Toggle title="启用" value={enabled} onChanged={setEnabled}/><Picker title="规则类型" pickerStyle="menu" value={type} onChanged={setType}>{Array.from(new Set([...NIKKI_RULE_TYPES,type])).map(t=><Text key={t} tag={t}>{t}</Text>)}</Picker><TextField title="类型（支持自定义）" value={type} onChanged={setType}/>{type!=="MATCH"?<TextField title="匹配内容" value={matcher} onChanged={setMatcher}/>:null}<TextField title="策略/节点" value={node} onChanged={setNode}/>{/IP-CIDR6?|IP-ASN|GEOIP/.test(type)?<Toggle title="不解析域名（no-resolve）" value={noResolve} onChanged={setNoResolve}/>:null}</Section>
    <Section><Note>提交 Nikki 附加规则可能自动触发服务重载。MATCH 不需要匹配内容；复杂类型的最终合法性由 Mihomo 校验。</Note><Status work={work}/>{work.changed?<Note error>来源已改变，请取消后重新进入</Note>:null}</Section>
  </Form>
}
export function NikkiRuleSort({c,base,done}:{c:Controller;base:NikkiManagement;done:(saved?:boolean)=>void}) {
  const work=useWork(c),[ids,setIDs]=useState(()=>base.rules.map(r=>r.id)),dirty=ids.some((id,i)=>id!==base.rules[i].id)
  function move(i:number,d:number) {const next=[...ids];[next[i],next[i+d]]=[next[i+d],next[i]];setIDs(next)}
  async function save(){await work.run(()=>work.commitConfirm("提交此规则顺序？",async()=>{await reorderNikkiRules(work.owner,base,ids);if(work.current())done(true)}))}
  return <ScrollView background="systemBackground" navigationTitle="排序列表" navigationBarTitleDisplayMode="inline" toolbar={EditorActions({work,done,save,disabled:!dirty})} onAppear={work.onAppear} onDisappear={work.onDisappear}><VStack spacing={12} padding={16}><Note>调整顺序后保存；取消不会修改设备。非规则配置的位置保持不变。</Note>{ids.map((id,i)=>{const r=base.rules.find(r=>r.id===id)!;return <Panel key={id}><Text>{`${i+1}. ${r.type} · ${r.matcher||r.node}`}</Text><HStack><Button title="上移" systemImage="arrow.up" disabled={work.busy||i===0} action={()=>move(i,-1)}/><Spacer/><Button title="下移" systemImage="arrow.down" disabled={work.busy||i===ids.length-1} action={()=>move(i,1)}/></HStack></Panel>})}<Status work={work}/></VStack></ScrollView>
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
export function nikkiEditorHTML(generation=0):string {
  // Static, self-contained document. Config text arrives through the ready-message reply,
  // never interpolated into HTML, URLs, persistent storage, logs, or an external editor.
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'"><style>
:root{color-scheme:light dark;--bg:#fff;--fg:#252529;--gutter:#f2f2f7;--muted:#787880;--border:#dedee3}
@media(prefers-color-scheme:dark){:root{--bg:#1c1c1e;--fg:#e5e5ea;--gutter:#252527;--muted:#929298;--border:#444448}}
:root[data-theme=light]{color-scheme:light;--bg:#fff;--fg:#252529;--gutter:#f2f2f7;--muted:#787880;--border:#dedee3}
:root[data-theme=dark]{color-scheme:dark;--bg:#1c1c1e;--fg:#e5e5ea;--gutter:#252527;--muted:#929298;--border:#444448}
*{box-sizing:border-box}html,body{margin:0;height:100%;overflow:hidden;background:var(--bg)}
#editor{display:flex;height:100%;overflow:hidden;border:1px solid var(--border);border-radius:10px}
.mono{font:16px/24px ui-monospace,SFMono-Regular,Menlo,monospace;tab-size:2;-webkit-text-size-adjust:100%;letter-spacing:0}
#gutter{flex:none;overflow:hidden;background:var(--gutter);color:var(--muted);border-right:1px solid var(--border);user-select:none}
#numbers{margin:0;padding:12px 9px;text-align:right;white-space:pre;will-change:transform}
#body{display:block;flex:1;min-width:0;width:100%;height:100%;margin:0;border:0;border-radius:0;padding:12px;resize:none;outline:none;overflow:auto;white-space:pre;overflow-wrap:normal;color:var(--fg);background:var(--bg)}
</style></head><body><div id="editor"><aside id="gutter" class="mono" aria-hidden="true"><pre id="numbers" class="mono">1</pre></aside><textarea id="body" class="mono" aria-label="配置内容" wrap="off" spellcheck="false" autocorrect="off" autocomplete="off" autocapitalize="off"></textarea></div><script>
(function(){
  const reconcile=${reconcileNikkiText.toString()};
  const body=document.getElementById('body'),numbers=document.getElementById('numbers'),gutter=document.getElementById('gutter');
  let raw='',revision=0,generation=0,lineCount=0;
  function syncScroll(){numbers.style.transform='translateY('+(-body.scrollTop)+'px)';}
  function lines(){const count=body.value.split('\\n').length;if(count!==lineCount){lineCount=count;numbers.textContent=Array.from({length:count},(_,i)=>String(i+1)).join('\\n');gutter.style.width='calc('+String(count).length+'ch + 19px)';}syncScroll();}
  function changed(){raw=reconcile(raw,body.value);revision++;lines();window.webkit.messageHandlers.editorChanged.postMessage({text:raw,revision,generation});}
  body.addEventListener('input',changed);body.addEventListener('scroll',syncScroll);
  body.addEventListener('keydown',function(event){if(event.key==='Tab'&&!body.readOnly){event.preventDefault();body.setRangeText('\\t',body.selectionStart,body.selectionEnd,'end');changed();}});
  window.nikkiEditor={
    setText:function(text,token,theme){raw=text;generation=token;revision=0;body.value=text;body.readOnly=false;body.scrollTop=0;body.scrollLeft=0;this.setTheme(theme);lines();},
    setTheme:function(theme){document.documentElement.dataset.theme=theme==='dark'||theme==='light'?theme:'system';},
    snapshot:function(){body.readOnly=true;return {text:raw,revision,generation};},
    unlock:function(){body.readOnly=false;}
  };
  lines();
  // The page itself confirms script readiness. Do not infer DOM readiness from loadHTML.
  Promise.resolve(window.webkit.messageHandlers.editorReady.postMessage({generation:${generation}})).then(function(initial){
    if(!initial||initial.generation!==${generation})return;
    window.nikkiEditor.setText(initial.text,initial.generation,initial.theme);
    window.webkit.messageHandlers.editorInitialized.postMessage({generation:initial.generation});
  }).catch(function(){window.webkit.messageHandlers.editorInitError.postMessage({generation:${generation}});});
})();
</script></body></html>`
}
export function NikkiFileEditor({c,base,file,done,entryKey="direct"}:{c:Controller;base:NikkiManagement;file:NikkiFile;done:(saved?:boolean)=>void;entryKey?:string}) {
  const work=useWork(c),p=usePreferences(["theme"]),[original,setOriginal]=useState<string|null>(null),[text,setText]=useState(""),[loadError,setLoadError]=useState(""),[tick,setTick]=useState(0),[ready,setReady]=useState(false),[appeared,setAppeared]=useState(false)
  const [host]=useState(()=>({controller:new WebViewController({ephemeral:true}),alive:true,generation:0,revision:0,theme:p.theme,registration:null as Promise<unknown>|null,initial:null as null|{text:string;generation:number;theme:string},initialized:null as null|((error?:string)=>void),snapshotRequest:0,snapshot:null as null|((value:{text:string;revision:number;generation:number})=>void)}))
  host.theme=p.theme
  const sameSource=()=>host.alive&&work.guard.alive&&work.guard.source===source(work.owner)
  useEffect(()=>{
    host.alive=true
    // No navigation URL is needed: loadHTML is entirely inline and CSP forbids all
    // external resources. Filtering the host's internal load URL can block the page itself.
    host.registration=Promise.all([
      host.controller.addScriptMessageHandler("editorReady",(value?:{generation:number})=>sameSource()&&value?.generation===host.generation?host.initial:null),
      host.controller.addScriptMessageHandler("editorInitialized",(value?:{generation:number})=>{if(sameSource()&&value?.generation===host.generation)host.initialized?.()}),
      host.controller.addScriptMessageHandler("editorInitError",(value?:{generation:number})=>{if(sameSource()&&value?.generation===host.generation)host.initialized?.("本地行号编辑器脚本初始化失败")}),host.controller.addScriptMessageHandler("editorSnapshot",(value?:{text:string;revision:number;generation:number;request:number})=>{if(value&&value.generation===host.generation&&value.request===host.snapshotRequest)host.snapshot?.(value)}),host.controller.addScriptMessageHandler("editorChanged",(message?:{text:string;revision:number;generation:number})=>{
      if(sameSource()&&message?.generation===host.generation&&Number.isInteger(message.revision)&&message.revision>host.revision&&typeof message.text==="string"){host.revision=message.revision;setText(message.text)}
    })])
    return()=>{host.alive=false;host.controller.dispose()}
  },[])
  useEffect(()=>{
    if(!appeared)return
    let alive=true;const generation=++host.generation;host.revision=0;host.initial=null;setOriginal(null);setText("");setReady(false);setLoadError("")
    const current=()=>alive&&sameSource()&&generation===host.generation
    const timers=new Set<ReturnType<typeof setTimeout>>()
    function bounded<T>(promise:Promise<T>,ms:number,message:string):Promise<T>{
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{timers.delete(timer);reject(new NikkiManagementError(message))},ms);timers.add(timer)
        promise.then(resolve,reject).finally(()=>{clearTimeout(timer);timers.delete(timer)})
      })
    }
    async function load(){
      try{
        const t=await bounded(readNikkiFile(work.owner,file.key),20000,"完整正文读取超时；未写入文件，请重试读取")
        if(!current())return
        // Keep the verified full body independently of WebView; initialization failure must
        // never hide a successfully read file behind an indefinite white loading panel.
        setOriginal(t);setText(t);host.initial={text:t,generation,theme:host.theme}
        await bounded((async()=>{
          await host.registration
          if(!current())return
          await new Promise<void>((resolve,reject)=>{
            host.initialized=error=>error?reject(new NikkiManagementError(error)):resolve()
            // Completion of this promise is NOT the readiness signal. The inline script
            // replies only after accepting the full body and constructing the line gutter.
            host.controller.loadHTML(nikkiEditorHTML(generation)).then(ok=>{if(!ok)reject(new NikkiManagementError("本地行号编辑器加载失败"))},()=>reject(new NikkiManagementError("本地行号编辑器加载失败")))
          })
        })(),10000,"本地行号编辑器初始化超时；完整正文已保留，可重试或查看只读正文")
        if(current())setReady(true)
      }catch(e){if(current()){host.initial=null;host.initialized=null;setLoadError(errorText(e))}}
    }
    void load();return()=>{alive=false;host.initialized=null;for(const timer of timers)clearTimeout(timer)}
  },[file.key,entryKey,tick,appeared])
  useEffect(()=>{if(ready)void host.controller.evaluateJavaScript(`window.nikkiEditor.setTheme(${JSON.stringify(p.theme)});`).catch(()=>{})},[p.theme,ready])
  async function save(){
    if(original===null||!ready)return
    const generation=host.generation
    await work.run(async()=>{
      try{
        // Pull the authoritative document, not a potentially delayed input-message state.
        // Official examples disagree on expression vs function-body evaluation. Return
        // values are unnecessary: the documented message bridge works under either mode.
        const request=++host.snapshotRequest
        let timer:ReturnType<typeof setTimeout>|undefined
        const response=new Promise<{text:string;revision:number;generation:number}>((resolve,reject)=>{
          host.snapshot=resolve
          timer=setTimeout(()=>reject(new NikkiManagementError("未收到本地编辑器快照，未写入文件；草稿仍保留")),5000)
        })
        // A timeout can fire while the host is still evaluating the message send.
        void response.catch(()=>{})
        const draft=await (async()=>{try{
          await host.controller.evaluateJavaScript(`window.webkit.messageHandlers.editorSnapshot.postMessage({...window.nikkiEditor.snapshot(),request:${request}});`)
          return await response
        }finally{if(timer!==undefined)clearTimeout(timer);host.snapshot=null}})()
        if(!work.current()||draft?.generation!==generation||typeof draft.text!=="string")return
        host.revision=Math.max(host.revision,draft.revision);setText(draft.text)
        await work.confirm(`覆盖文件「${file.filename}」？可能是当前选用的配置。仅保存文件，不重载服务；大文件分块写入，失败可能留下部分内容，请勿在失败后重载。`,async()=>{
          if(host.generation!==generation)return
          await saveNikkiFile(work.owner,file.key,original,draft.text)
          if(work.current()&&host.generation===generation){setOriginal(draft.text);work.setNotice("完整文件已保存并回读核验；未重载 Nikki 服务")}
        })
      }finally{if(sameSource()&&host.generation===generation)try{await host.controller.evaluateJavaScript("window.nikkiEditor.unlock();")}catch{}}
    })
  }
  return <VStack alignment="leading" spacing={12} padding={16} background="systemBackground" frame={{maxWidth:"infinity",maxHeight:"infinity"}} navigationTitle={file.name} navigationBarTitleDisplayMode="inline" toolbar={EditorActions({work,done,save,disabled:!ready||original===null||original===text})} onAppear={()=>{work.onAppear();setAppeared(true)}} onDisappear={work.onDisappear}>
    <Note>{base.profile===file.key?"当前选用 · 保存不会自动应用":"未选用"}</Note><HStack><Image systemName="doc.text"/><Text>{file.filename}</Text></HStack>
    <ZStack frame={{maxWidth:"infinity",maxHeight:"infinity",minHeight:280}}>
      {/* Keep the native host mounted from the first render, including before onAppear.
          Only visibility changes after the full-body handshake, never its identity. */}
      <WebView controller={host.controller} opacity={ready&&!loadError?1:0} disabled={!ready||!!loadError} frame={{maxWidth:"infinity",maxHeight:"infinity",minHeight:280}}/>
      {!ready||loadError?<VStack spacing={14} padding={16} background="secondarySystemBackground" frame={{maxWidth:"infinity",maxHeight:"infinity",minHeight:280}}>
        {loadError?<><Note error>{loadError}</Note><Button title="重试读取" action={()=>setTick(t=>t+1)}/>{original!==null?<><Note>完整正文（只读恢复显示；行号编辑器未就绪，不能保存）</Note><ScrollView frame={{maxHeight:"infinity"}}><Text font={13} fontDesign="monospaced">{text}</Text></ScrollView></>:null}</>:<><ProgressView progressViewStyle="circular" foregroundStyle="secondaryLabel"/><Note>{original===null?"正在完整读取配置正文…":"正文已完整读取，正在初始化本地行号编辑器…"}</Note></>}
      </VStack>:null}
    </ZStack>
    <Status work={work}/>{work.changed?<Note error>来源已改变，请取消后重新进入</Note>:null}
  </VStack>
}
