import { CpuSampler, CpuUsage, CpuMeta, parseCpuInfo, thermalCelsius } from "./openwrt-metrics"

import { getPreferences, customHeaders, recordEvent, controllerHealth, feedback } from "./preferences"
export const VERSION = "1.85"

export type Kind = "clash" | "openwrt"
export type Plugin = "openclash" | "nikki" | "mihomo"
export const PLUGINS: [Plugin, string][] = [["openclash", "OpenClash"], ["nikki", "Nikki"], ["mihomo", "MihomoTProxy"]]
export interface Controller {
  id: string; name: string; kind: Kind; url: string; username?: string
  host?: string; port?: number; https?: boolean; plugin?: Plugin; auto?: boolean; cport?: number
}
export interface ControllerInput { id?: string; name: string; host: string; port: number; https: boolean; username: string; plugin: Plugin; auto: boolean; cport: number }
export interface ProxyTestTarget { name: string; provider?: string; type?: string }
export interface Group { name: string; type: string; now: string; all: string[]; delays: Record<string, number>; types?: Record<string, string>; hidden?: boolean; icon?: string; testUrl?: string; testTargets?: Record<string, ProxyTestTarget> }
export interface Conn { id: string; host: string; src: string; dst: string; network: string; rule: string; chain: string; up: number; down: number; start: number; upSpeed?: number; downSpeed?: number; ruleType?: string; rulePayload?: string; sourceIP?: string; inboundType?: string; chains?: string[]; closedAt?: number }
// index/disabled come from Mihomo GET /rules (index, extra.disabled); absent on kernels without rule toggling.
export interface Rule { type: string; payload: string; proxy: string; index?: number; disabled?: boolean }
export interface Traffic { up: number; down: number; upTotal?: number; downTotal?: number }
export interface WrtInfo { model: string; release: string; uptime: number; load: number[]; memTotal: number; memFree?: number; wan: string; target?: string; kernel?: string; cpu?: number; cpus?: CpuUsage[]; cpuModel?: string; cpuMeta?: Record<string,CpuMeta>; arch?: string; temperature?: number; disk?: DiskUsage | null }
export interface Overview { version: string; mode: string; traffic: Traffic; upTotal: number; downTotal: number; connCount: number; wrt?: WrtInfo; mem?: number }
export interface WrtIface { name: string; proto: string; up: boolean; ip: string; device: string; uptime: number }
export interface DockerContainer { id: string; name: string; image: string; state: string; status: string }
export interface FrpProxy { id: string; name: string; type: string; local: string; remote: string }
export interface FrpInfo { running: boolean; enabled: boolean; server: string; proxies: FrpProxy[]; common: { addr: string; port: string; tls: boolean; token: string } }
export interface DockerContainerDetail { id: string; name: string; state: string; image: string; network: string; ports: string; command: string; created: number; paused: boolean; policy: string }
export interface DockerImage { id: string; tags: string[]; size: number; created: number; containers: string[] }
export interface DockerOverview { version: string; api: string; threads: number; memTotal: number; root: string; index: string; mirrors: string[]; containers: number; running: number; images: number }
export interface DockerSettings { logLevel: string; httpProxy: string; httpsProxy: string; noProxy: string; dataRoot: string }
export interface WrtLease { host: string; ip: string; mac: string; expires: number }

const K_LIST = "neko_controllers_v1"
const K_ACTIVE = "neko_active_v1"

export function listControllers(): Controller[] { return (Storage.get<Controller[]>(K_LIST) ?? []).filter(c => c.kind === "clash" || c.kind === "openwrt") }
function saveList(l: Controller[]) { Storage.set(K_LIST, l) }
const clashCache: Record<string, { at: number; c: Controller | null }> = {}
export function getSecret(id: string): string { return Keychain.get("neko_secret_" + id) ?? "" }
export function normalizeUrl(u: string): string {
  let s = u.trim().replace(/\/+$/, "")
  if (s && !/^https?:\/\//i.test(s)) s = "http://" + s
  return s
}
export function saveController(c: ControllerInput, password: string, clashSecret: string): Controller {
  const host = c.host.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/:\d+$/, "")
  if (!host) throw new Error("请填写路由器地址")
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535) throw new Error("端口无效")
  const id = c.id ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const defPort = c.https ? 443 : 80
  const url = `${c.https ? "https" : "http"}://${host.includes(":") ? "[" + host + "]" : host}${c.port === defPort ? "" : ":" + c.port}`
  const item: Controller = { id, name: c.name.trim() || host, kind: "openwrt", url, username: c.username.trim() || "root",
    host, port: c.port, https: c.https, plugin: c.plugin, auto: c.auto, cport: c.cport }
  const l = listControllers()
  const i = l.findIndex(x => x.id === id)
  if (i >= 0) l[i] = item; else l.push(item)
  saveList(l)
  Keychain.set("neko_secret_" + id, password)
  Keychain.set("neko_csecret_" + id, clashSecret.trim())
  delete clashCache[id]; delete sessions[id]
  if (!getActive()) setActive(id)
  recordEvent("controller", true)
  return item
}
export function removeController(id: string) {
  recordEvent("remove", true)
  saveList(listControllers().filter(c => c.id !== id))
  for (const k of ["neko_secret_" + id, "neko_csecret_" + id, "neko_secret_" + id + "~clash"]) Keychain.remove(k)
  Storage.remove("neko_prev_" + id)
  delete clashCache[id]; delete sessions[id]
  if (Storage.get<string>(K_ACTIVE) === id) Storage.remove(K_ACTIVE)
}
export function getClashSecret(id: string): string { return Keychain.get("neko_csecret_" + id) ?? "" }
export function getActive(): Controller | null {
  const l = listControllers(); const id = Storage.get<string>(K_ACTIVE)
  return l.find(c => c.id === id) ?? l[0] ?? null
}
export function setActive(id: string) { Storage.set(K_ACTIVE, id); feedback(); recordEvent("switch", true) }

class ControllerHTTPError extends Error {}
async function http(c: Controller, path: string, init: { method?: string; body?: any; timeout?: number; headers?: Record<string, string>; signal?: AbortController["signal"] } = {}): Promise<any> {
  const secret = getSecret(c.id)
  const headers: Record<string, string> = init.headers ? { ...init.headers } : customHeaders()
  if (init.body !== undefined) headers["Content-Type"] = "application/json"
  if (!init.headers && secret) headers["Authorization"] = "Bearer " + secret
  const r = await apiFetch(c.url + path, {
    method: init.method ?? "GET", headers, allowInsecureRequest: true, timeout: init.timeout ?? getPreferences().requestTimeout,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined, signal: init.signal,
  } as any, path)
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) throw new ControllerHTTPError("认证失败，请检查密钥")
    if (r.status === 404) throw new ControllerHTTPError("HTTP 404：该地址不是 Clash 控制器接口，请检查端口（通常是 9090）")
    throw new ControllerHTTPError(`请求失败 HTTP ${r.status}`)
  }
  const text = await r.text()
  if (!text) return {}
  try { return JSON.parse(text) } catch { return {} }
}
function routeOf(path: string): "configs" | "connections" | "proxies" | "rules" | "version" | "delay" | "other" {
  if (path.includes("/delay")) return "delay"
  const first = path.split("/")[1]?.split("?")[0]
  return ["configs", "connections", "proxies", "rules", "version"].includes(first) ? first as any : "other"
}
async function apiFetch(url: string, init: any, path: string): Promise<any> {
  const at = Date.now(), operation = init.method ?? "GET", route = routeOf(path)
  try {
    const r = await fetch(url, init)
    recordEvent("api", r.ok, { operation, route, status: r.status, duration: Date.now() - at })
    return r
  } catch (e) { recordEvent("api", false, { operation, route, duration: Date.now() - at }); throw e }
}
const enc = encodeURIComponent
const num = (v: any) => typeof v === "number" && Number.isFinite(v) ? v : 0

// 私有内存比较完整来源/认证，向界面与缓存只暴露不含凭证的不透明代次。
let sourceSerial = 0
const sourceIds = new Map<string,{signature:string;token:string}[]>()
export function overviewSource(c:Controller):string {
  const signature=JSON.stringify([c.kind,c.url,c.host,c.port,c.https,c.username,getSecret(c.id),customHeaders()])
  const identities=sourceIds.get(c.id)??[],prior=identities.find(x=>x.signature===signature);if(prior)return prior.token
  const token="wrt-source-"+(++sourceSerial);sourceIds.set(c.id,[...identities,{signature,token}].slice(-8));return token
}
const NULL_SID = "00000000000000000000000000000000"
const sessions: Record<string, { sid: string; at: number; source:string; auth?:string }> = {}
async function ubusRaw(c: Controller, sid: string, obj: string, method: string, params: any, timeout?: number): Promise<any> {
  try { return await ubusRequest(c, sid, obj, method, params, timeout) }
  catch (e) { recordEvent("ubus", false); throw e }
}
async function ubusRequest(c: Controller, sid: string, obj: string, method: string, params: any, timeout?: number): Promise<any> {
  const r = await fetch(c.url + "/ubus", {
    method: "POST", headers: { ...customHeaders(), "Content-Type": "application/json" }, allowInsecureRequest: true, timeout: timeout ?? getPreferences().requestTimeout,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "call", params: [sid, obj, method, params] }),
  } as any)
  if (r.status === 404) throw new Error("HTTP 404：该地址不是 OpenWrt 的 LuCI 地址，请检查端口")
  if (!r.ok) throw new Error(`请求失败 HTTP ${r.status}`)
  let j: any
  try { j = JSON.parse(await r.text()) } catch { throw new Error("返回内容不是 ubus 接口，请确认地址是 LuCI 后台（如 http://路由器IP）") }
  if (j.error) throw new Error("ubus 错误：" + (j.error.message ?? "未知"))
  const res = j.result
  if (!Array.isArray(res)) throw new Error("ubus 返回异常")
  if (res[0] === 6) throw new Error("ACCESS")
  if (res[0] !== 0) throw new Error("ubus 调用失败，代码 " + res[0])
  recordEvent("ubus", true)
  return res[1] ?? {}
}
const loginPending: Record<string, Promise<string> | undefined> = {}
async function wrtLogin(c: Controller): Promise<string> {
  const key=overviewSource(c)
  if (loginPending[key]) return loginPending[key]!
  const p = wrtLoginOnce(c)
  loginPending[key] = p
  try { return await p } finally { if (loginPending[key] === p) delete loginPending[key] }
}
async function wrtLoginOnce(c: Controller): Promise<string> {
  const user = c.username || "root", source=[c.url,c.username].join("|"), auth=overviewSource(c)
  try {
    const r = await ubusRaw(c, NULL_SID, "session", "login", { username: user, password: getSecret(c.id), timeout: 3600 })
    const sid = r.ubus_rpc_session
    if (!sid) throw new Error("登录失败")
    recordEvent("login", true)
    sessions[c.id] = { sid, at: Date.now(), source, auth }
    return sid
  } catch (e: any) {
    recordEvent("login", false)
    if (String(e?.message) === "ACCESS") throw new Error("登录失败，请检查用户名和密码")
    throw e
  }
}
async function ubus(c: Controller, obj: string, method: string, params: any = {}): Promise<any> {
  let sid = sessions[c.id]?.sid
  if (!sid || sessions[c.id].auth !== overviewSource(c) || Date.now() - sessions[c.id].at > 50 * 60 * 1000) sid = await wrtLogin(c)
  try { return await ubusRaw(c, sid, obj, method, params) } catch (e: any) {
    if (String(e?.message) !== "ACCESS") throw e
    sid = await wrtLogin(c)
    try { return await ubusRaw(c, sid, obj, method, params) } catch (e2: any) {
      throw new Error(String(e2?.message) === "ACCESS" ? "没有权限访问 " + obj + "." + method : e2.message)
    }
  }
}

type UbusCall = [string, string, any?]
async function ubusBatchRaw(c: Controller, sid: string, calls: UbusCall[], signal?: AbortController["signal"]): Promise<any[]> {
  if (signal?.aborted) throw new Error("来源或采样代次已改变")
  const r = await fetch(c.url + "/ubus", {
    method: "POST", headers: { ...customHeaders(), "Content-Type": "application/json" }, allowInsecureRequest: true, timeout: getPreferences().requestTimeout, signal,
    body: JSON.stringify(calls.map((x, i) => ({ jsonrpc: "2.0", id: i + 1, method: "call", params: [sid, x[0], x[1], x[2] ?? {}] }))),
  } as any)
  if (!r.ok) throw new Error(`请求失败 HTTP ${r.status}`)
  let j: any
  try {
    j=JSON.parse(await r.text())
  } catch { throw new Error("返回内容不是 ubus 接口") }
  const arr: any[] = Array.isArray(j) ? j : [j]
  const out: any[] = calls.map(() => null)
  let denied = false
  for (const x of arr) {
    const i = Number(x?.id) - 1
    if (!(i >= 0 && i < calls.length)) continue
    const res = x.result
    if (Array.isArray(res) && res[0] === 0) out[i] = res[1] ?? {}
    else if (Array.isArray(res) && res[0] === 6) denied = true
  }
  if (denied && out.every(v => v === null)) throw new Error("ACCESS")
  recordEvent("ubus", true)
  return out
}
async function ubusBatch(c: Controller, calls: UbusCall[], signal?: AbortController["signal"]): Promise<any[]> {
  let sid = sessions[c.id]?.sid
  if (!sid || sessions[c.id].auth !== overviewSource(c) || Date.now() - sessions[c.id].at > 50 * 60 * 1000) sid = await wrtLogin(c)
  try { return await ubusBatchRaw(c, sid, calls, signal) } catch (e: any) {
    if (String(e?.message) !== "ACCESS") throw e
    return await ubusBatchRaw(c, await wrtLogin(c), calls, signal)
  }
}
function pickWan(dump: any): { name: string; device: string } {
  const list: any[] = dump?.interface ?? []
  const hasDefault = (i: any) => (i.route ?? []).some((r: any) => r.target === "0.0.0.0" || r.target === "::")
  const w = list.find(hasDefault) ?? list.find(i => i.interface === "wan") ?? list.find(i => i.interface !== "loopback" && i.up)
  return { name: String(w?.interface ?? ""), device: String(w?.l3_device ?? w?.device ?? "") }
}
const MAX_RATE = 1.31e9
export interface DiskUsage { size:number; used:number; avail:number; mount?:string; device?:string }
const slowCache: Record<string, { at: number; board: any; dump: any; arch?:string; thermal:string[]; disk:DiskUsage|null }> = {}
const cpuSamplers: Record<string,CpuSampler>={}
const ratePrevious: Record<string,{t:number;rx:number;tx:number;up:number;down:number;uptime:number}>={}
const samplingEpoch:Record<string,number>={}
const overviewPending:Record<string,Promise<Overview>|undefined>={}
const overviewAbort:Record<string,AbortController|undefined>={}
// rpcd file.read reads only 4096 bytes for st_size=0 (/proc). Never use it for cpuinfo.
// Fixed path only; does not relax Nikki's path validation or grant any new ACL.
const CPUINFO_MAX_BYTES=2*1024*1024
const cpuInfoCache:Record<string,{at:number;ids:string;meta:ReturnType<typeof parseCpuInfo>;pending?:Promise<void>;abort?:AbortController}>={}
async function readCompleteCpuInfo(c:Controller,ids:string[],abort:AbortController):Promise<ReturnType<typeof parseCpuInfo>> {
  let sid=sessions[c.id]?.sid
  if(!sid||sessions[c.id].auth!==overviewSource(c)||Date.now()-sessions[c.id].at>50*60*1000)sid=await wrtLogin(c)
  if(abort.signal.aborted)throw new Error("CPU读取已取消")
  const r=await fetch(c.url+"/cgi-bin/cgi-download",{method:"POST",headers:{...customHeaders(),"Content-Type":"application/x-www-form-urlencoded"},
    body:"sessionid="+enc(sid)+"&path="+enc("/proc/cpuinfo"),allowInsecureRequest:true,timeout:getPreferences().requestTimeout,signal:abort.signal} as any)
  if(!r.ok)throw new Error("CPU完整读取不可用")
  const reader=r.body?.getReader?.()
  if(!reader)throw new Error("CPU完整读取需要流式响应")
  const chunks:Uint8Array[]=[];let length=0
  // proc stat size may be zero: only compare a positive HTTP Content-Length, never file stat.
  const declared=Number(r.headers.get("Content-Length"))
  try{
    if(Number.isFinite(declared)&&declared>CPUINFO_MAX_BYTES)throw new Error("CPU信息超过读取上限")
    while(true){const {done,value}=await reader.read();if(done)break
      if(abort.signal.aborted)throw new Error("CPU读取已取消")
      if(value){length+=value.byteLength;if(length>CPUINFO_MAX_BYTES)throw new Error("CPU信息超过读取上限");chunks.push(value)}
    }
    if(abort.signal.aborted||(Number.isFinite(declared)&&declared>0&&declared!==length))throw new Error("CPU读取未完整")
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
    const text=Data.fromUint8Array(bytes)?.toRawString("utf-8")
    if(!text||text.includes("\u0000")||!text.endsWith("\n"))throw new Error("CPU信息不是完整文本")
    const meta=parseCpuInfo(text)
    // Presence, not frequency/cache equality: legitimate missing fields remain unknown.
    if(!ids.length||ids.some(id=>!Object.prototype.hasOwnProperty.call(meta.cores,id)))throw new Error("CPU逻辑核信息不完整")
    return meta
  }catch(e){try{await reader.cancel()}catch{}throw e}finally{reader.releaseLock?.()}
}
function cpuInfoSnapshot(c:Controller,ids:string[],epoch:number):ReturnType<typeof parseCpuInfo> {
  const key=overviewSource(c),identity=ids.join(",")
  let entry=cpuInfoCache[key]
  if(!entry||entry.ids!==identity){entry?.abort?.abort();entry={at:0,ids:identity,meta:{cores:{}}};cpuInfoCache[key]=entry}
  if(!entry.pending&&Date.now()-entry.at>=5000&&ids.length){
    const current=entry,abort=new AbortController();current.abort=abort;current.at=Date.now()
    const pending=readCompleteCpuInfo(c,ids,abort).then(meta=>{
      if(cpuInfoCache[key]===current&&!abort.signal.aborted&&(samplingEpoch[key]??0)===epoch)current.meta=meta
    }).catch(()=>{if(cpuInfoCache[key]===current&&!abort.signal.aborted){current.meta={cores:{}};current.at=Date.now()+10000}}).finally(()=>{
      if(current.pending===pending){current.pending=undefined;current.abort=undefined}
    });current.pending=pending
  }
  // Metadata IO never delays the one-second usage sampling loop.
  return entry.meta
}
export function resetOverviewSampling(c:Controller, key=overviewSource(c)) { overviewAbort[key]?.abort();delete cpuSamplers[key];delete ratePrevious[key];samplingEpoch[key]=(samplingEpoch[key]??0)+1;const info=cpuInfoCache[key];if(info){info.abort?.abort();info.at=0} }
function mountUsage(r:any):DiskUsage|null {
  const list:any[]=Array.isArray(r?.result)?r.result:[]
  const m=list.find(x=>x.mount==="/overlay")??list.find(x=>x.mount==="/")
  return m&&typeof m.size==="number"&&m.size>0&&typeof m.avail==="number" ? {size:m.size,used:Math.max(0,m.size-m.avail),avail:m.avail,mount:String(m.mount),device:typeof m.device==="string"?m.device:undefined}:null
}
async function wrtOverview(c: Controller, signal?: AbortController["signal"]): Promise<Overview> {
  const key=overviewSource(c), cached=slowCache[key], stale=!cached||Date.now()-cached.at>60000
  const epoch=samplingEpoch[key]??0, sampler=cpuSamplers[key]??(cpuSamplers[key]=new CpuSampler())
  if(Object.keys(cpuSamplers).length>16){const old=Object.keys(cpuSamplers).find(k=>k!==key);if(old){delete cpuSamplers[old];delete ratePrevious[old];delete slowCache[old];cpuInfoCache[old]?.abort?.abort();delete cpuInfoCache[old]}}
  const zones=cached?.thermal??[]
  const calls:UbusCall[]=[
    ["system","info"],["network.device","status"],["file","read",{path:"/proc/stat"}],["file","read",{path:"/proc/sys/net/netfilter/nf_conntrack_count"}],
    ...zones.flatMap(z=>[["file","read",{path:`/sys/class/thermal/${z}/type`}],["file","read",{path:`/sys/class/thermal/${z}/temp`}]] as UbusCall[]),
    ...(stale?[["system","board"],["network.interface","dump"],["file","list",{path:"/sys/class/thermal"}],["file","read",{path:"/etc/openwrt_release"}],["luci","getMountPoints"]] as UbusCall[]:[]),
  ]
  const r=await ubusBatch(c,calls,signal)
  const info=r[0],devs=r[1]??{},stat=r[2]??{},ct=r[3]??{}
  if(!info)throw new Error("路由器未返回系统信息")
  // 同id改地址/认证后返回的旧响应不得进入任何新来源缓存。
  if(overviewSource(c)!==key||(samplingEpoch[key]??0)!==epoch)throw new Error("来源或采样代次已改变")
  if(stale){
    const i=4+zones.length*2
    if(!r[i]&&!cached)throw new Error("路由器未返回系统信息")
    const names=(r[i+2]?.entries??[]).map((x:any)=>String(x.name??"" )).filter((x:string)=>/^thermal_zone\d+$/.test(x)).slice(0,32)
    const arch=/^DISTRIB_ARCH=['"]?([^'"\s]+)["']?$/m.exec(String(r[i+3]?.data??""))?.[1]
    slowCache[key]={at:Date.now(),board:r[i]??cached?.board??{},dump:r[i+1]??cached?.dump??{},thermal:names,disk:mountUsage(r[i+4]),arch}
    if(Object.keys(slowCache).length>16){const oldest=Object.keys(slowCache).find(k=>k!==key);if(oldest){delete slowCache[oldest];delete ratePrevious[oldest];delete cpuSamplers[oldest];cpuInfoCache[oldest]?.abort?.abort();delete cpuInfoCache[oldest]}}
  }
  const slow=slowCache[key]??cached!,board=slow.board,dump=slow.dump,wan=pickWan(dump),st=devs?.[wan.device]?.statistics??{}
  const rx=num(st.rx_bytes),tx=num(st.tx_bytes),now=Date.now(),prev=ratePrevious[key]
  let up=0,down=0,keep=false
  if(prev&&num(info.uptime)>=prev.uptime&&now>prev.t&&rx>=prev.rx&&tx>=prev.tx&&now-prev.t<600000){
    const dt=(now-prev.t)/1000
    if(dt<0.5){up=prev.up;down=prev.down;keep=true}else{down=(rx-prev.rx)/dt;up=(tx-prev.tx)/dt;if(down>MAX_RATE||up>MAX_RATE){up=prev.up;down=prev.down}}
  }
  if(!keep)ratePrevious[key]={t:now,rx,tx,up,down,uptime:num(info.uptime)}
  const cpus=sampler.sample(String(stat.data??""),typeof info.uptime==="number"?info.uptime:undefined),meta=cpuInfoSnapshot(c,cpus.filter(x=>x.id!=="cpu").map(x=>x.id),epoch)
  let temperature:number|undefined
  for(let i=0;i<zones.length;i++){const value=thermalCelsius(String(r[4+i*2]?.data??""),String(r[5+i*2]?.data??""));if(value!==undefined){temperature=value;break}}
  return {version:String(board.release?.description??""),mode:"",traffic:{up,down},upTotal:tx,downTotal:rx,
    connCount:parseInt(String(ct.data??"0"),10)||0,
    wrt:{model:String(board.model??board.hostname??""),release:String(board.release?.description??""),uptime:num(info.uptime),
      load:(info.load??[]).map((v:number)=>num(v)/65536),memTotal:num(info.memory?.total),memFree:typeof (info.memory?.available??info.memory?.free)==="number"?num(info.memory?.available??info.memory?.free):undefined,wan:wan.name,
      target:board.release?.target?String(board.release.target):undefined,kernel:board.kernel?String(board.kernel):undefined,cpu:cpus.find(x=>x.id==="cpu")?.usage,cpus,
      cpuMeta:meta.cores,cpuModel:meta.model,arch:typeof board.release?.arch==="string"?board.release.arch:slow.arch,temperature,
      disk:slow.disk}}
}
export async function loadWrtInterfaces(c: Controller): Promise<WrtIface[]> {
  const j = await ubus(c, "network.interface", "dump")
  return (j.interface ?? []).filter((i: any) => i.interface !== "loopback").map((i: any): WrtIface => ({
    name: String(i.interface), proto: String(i.proto ?? ""), up: !!i.up, device: String(i.l3_device ?? i.device ?? ""),
    ip: String(i["ipv4-address"]?.[0]?.address ?? ""), uptime: num(i.uptime),
  }))
}
export async function loadWrtLeases(c: Controller): Promise<WrtLease[]> {
  const j = await ubus(c, "luci-rpc", "getDHCPLeases", { family: 4 })
  return (j.dhcp_leases ?? []).map((l: any): WrtLease => ({ host: String(l.hostname ?? ""), ip: String(l.ipaddr ?? ""), mac: String(l.macaddr ?? ""), expires: num(l.expires) }))
}

const UCI: Record<Plugin, { config: string; section: string; port: (v: any) => number; secret: string }> = {
  openclash: { config: "openclash", section: "config", port: v => parseInt(String(v.cn_port ?? ""), 10), secret: "dashboard_password" },
  nikki: { config: "nikki", section: "mixin", port: v => parseInt(String(v.api_listen ?? "").split(":").pop() ?? "", 10), secret: "api_secret" },
  mihomo: { config: "mihomo", section: "mixin", port: v => parseInt(String(v.api_listen ?? "").split(":").pop() ?? "", 10), secret: "api_secret" },
}
const resolvePending: Record<string, Promise<Controller> | undefined> = {}
export async function resolveClash(c: Controller): Promise<Controller> {
  if (resolvePending[c.id]) return resolvePending[c.id]!
  const p = resolveClashOnce(c).catch(e => { recordEvent(c.auto !== false ? "discovery" : "manual", false); throw e })
  resolvePending[c.id] = p
  try { return await p } finally { if (resolvePending[c.id] === p) delete resolvePending[c.id] }
}
async function resolveClashOnce(c: Controller): Promise<Controller> {
  const hit = clashCache[c.id]
  if (hit && Date.now() - hit.at < 60000 && hit.c) return hit.c
  const host = c.host ?? c.url.replace(/^https?:\/\//, "").replace(/:\d+$/, "")
  let port = c.cport ?? 9090, secret = getClashSecret(c.id)
  if (c.auto !== false) {
    const u = UCI[c.plugin ?? "openclash"]
    let v: any
    try { v = (await ubus(c, "uci", "get", { config: u.config, section: u.section })).values } catch (e: any) {
      throw new Error("自动获取配置失败：" + String(e?.message ?? e) + "（可关闭“自动获取配置”手动填写端口和密钥）")
    }
    if (!v) throw new Error("未找到 " + u.config + " 的配置，请确认插件类型是否选对")
    const p = u.port(v)
    if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error("没有从插件配置里读到控制器端口")
    port = p; secret = String(v[u.secret] ?? "")
  }
  const id = c.id + "~clash"
  Keychain.set("neko_secret_" + id, secret)
  const cc: Controller = { id, name: c.name, kind: "clash", url: `http://${host.includes(":") ? "[" + host + "]" : host}:${port}` }
  recordEvent(c.auto !== false ? "discovery" : "manual", true)
  clashCache[c.id] = { at: Date.now(), c: cc }
  return cc
}
async function cc(c: Controller): Promise<Controller> { return c.kind === "clash" ? c : resolveClash(c) }

function wsUrl(c: Controller, path: string): string {
  const s = getSecret(c.id)
  const base = c.url.replace(/^http/i, "ws")
  return base + path + (s ? (path.includes("?") ? "&" : "?") + "token=" + enc(s) : "")
}

export function subscribeClash(c0: Controller, path: string, onMsg: (j: any) => void): () => void {
  let closed = false, controller: AbortController | null = null, timer: any = null
  const later = (ms: number) => { if (!closed) timer = setTimeout(run, ms) }
  async function run() {
    if (closed) return
    try {
      const c = await cc(c0)
      if (closed) return
      if (path.startsWith("/connections")) {
        const j = await http(c, "/connections")
        if (!closed) onMsg(j)
        later(1500); return
      }
      controller = new AbortController()
      const r = await fetch(c.url + path, { headers: { ...customHeaders(), Authorization: "Bearer " + getSecret(c.id) }, allowInsecureRequest: true, signal: controller.signal, timeout: getPreferences().requestTimeout } as any)
      if (!r.ok) throw new Error("HTTP " + r.status)
      const reader = r.body.getReader(), decoder = new TextDecoder()
      let pending = ""
      try {
        while (!closed) {
          const { done, value } = await reader.read()
          if (done) break
          pending += decoder.decode(value, { stream: true })
          let n: number
          while ((n = pending.indexOf("\n")) >= 0) {
            const line = pending.slice(0,n).trim(); pending = pending.slice(n+1)
            if (line && !closed) onMsg(JSON.parse(line))
          }
        }
      } finally { try { await reader.cancel() } catch {} }
      later(2000)
    } catch { later(2000) }
  }
  run()
  return () => { closed = true; if (timer) clearTimeout(timer); controller?.abort() }
}
export const subscribeTraffic = (c: Controller, onData: (t: Traffic) => void) =>
  subscribeClash(c, "/traffic", j => onData({ up: num(j.up), down: num(j.down), upTotal: typeof j.upTotal === "number" ? j.upTotal : undefined, downTotal: typeof j.downTotal === "number" ? j.downTotal : undefined }))
export const subscribeMemory = (c: Controller, onData: (inuse: number) => void) =>
  subscribeClash(c, "/memory", j => { if (typeof j.inuse === "number") onData(j.inuse) })
export const subscribeConnCount = (c: Controller, onData: (n: number) => void) =>
  subscribeClash(c, "/connections", j => { if (Array.isArray(j.connections)) onData(j.connections.length) })

export async function loadOverview(c: Controller): Promise<Overview> {
  try {
    let o:Overview
    if(c.kind==="openwrt"){
      const key=overviewSource(c)
      if(!overviewPending[key]){const abort=new AbortController();overviewAbort[key]=abort;const pending=wrtOverview(c,abort.signal);overviewPending[key]=pending;void pending.finally(()=>{if(overviewPending[key]===pending){delete overviewPending[key];delete overviewAbort[key]}}).catch(()=>{})}
      o=await overviewPending[key]!
    }else o=await loadClashOverview(c)
    controllerHealth[c.id] = true; return o
  } catch (e) { controllerHealth[c.id] = false; throw e }
}
const observedModes=new Map<string,{mode:string;at:number}>()
export function lastControllerMode(c:Controller):string|null {const x=observedModes.get(JSON.stringify(c));return x&&Date.now()-x.at<60000?x.mode:null}
function observeMode(c:Controller,mode:unknown){if(typeof mode!=="string"||!mode)return;if(observedModes.size>30)observedModes.clear();observedModes.set(JSON.stringify(c),{mode,at:Date.now()})}
export async function loadClashOverview(c0: Controller): Promise<Overview> {
  const c = await cc(c0)
  {
    const [ver, cfg, conns] = await Promise.all([
      http(c, "/version").catch(() => ({})), http(c, "/configs"), http(c, "/connections"),
    ])
    observeMode(c0,cfg.mode)
    return {
      version: String(ver.version ?? ""), mode: String(cfg.mode ?? ""), traffic: { up: 0, down: 0 },
      mem: typeof conns.memory === "number" ? conns.memory : undefined,
      upTotal: num(conns.uploadTotal), downTotal: num(conns.downloadTotal), connCount: (conns.connections ?? []).length,
    }
  }
}

export const CLASH_MODES = [["rule", "规则"], ["global", "全局"], ["direct", "直连"]]
export const modesOf = (_k: Kind) => CLASH_MODES
export async function setMode(c: Controller, mode: string) { await patchConfig(c, { mode }); feedback() }

export async function loadGroups(c0: Controller, options: { includeGlobal?: boolean } = {}): Promise<Group[]> {
  const c = await cc(c0)
  {
    const [j, pj] = await Promise.all([http(c, "/proxies"), http(c, "/providers/proxies").catch(() => ({}))])
    const all: Record<string, any> = j.proxies ?? {}, providerNodes: Record<string, any> = {}, providerNames: Record<string, string> = {}
    const testableProviders = new Set<string>()
    for (const [name, provider] of Object.entries<any>(pj.providers ?? {})) {
      const testable = name !== "default" && provider.vehicleType !== "Compatible"
      if (testable) testableProviders.add(name)
      for (const node of provider.proxies ?? []) if (typeof node?.name === "string") {
        providerNodes[node.name] = node
        if (testable && !providerNames[node.name]) providerNames[node.name] = name
      }
    }
    const nodes: Record<string, any> = { ...providerNodes }
    for (const [name, node] of Object.entries<any>(all)) nodes[name] = { ...providerNodes[name], ...node }
    function targetOf(name: string): ProxyTestTarget {
      const seen = new Set<string>()
      let current = name, node = nodes[current]
      while (node?.now && node.now !== current && !seen.has(current)) {
        seen.add(current)
        if (!nodes[node.now]) break
        current = String(node.now); node = nodes[current]
      }
      const declared = node?.["provider-name"]
      const provider = typeof declared === "string" && testableProviders.has(declared) ? declared : providerNames[current]
      return { name: current, ...(provider ? { provider } : {}), ...(typeof node?.type === "string" ? { type: node.type } : {}) }
    }
    const order: string[] = all.GLOBAL?.all ?? Object.keys(all)
    const ordered = new Set(order)
    const names = [...order.filter(n => all[n]?.all), ...Object.keys(all).filter(n => all[n]?.all && !ordered.has(n))]
    const prefs = getPreferences()
    function lastDelay(node: any): number | undefined {
      const h = node?.history
      if (h?.length && num(h[h.length - 1].delay) > 0) return num(h[h.length - 1].delay)
      let best: { t: number; d: number } | undefined
      for (const st of Object.values<any>(node?.extra ?? {})) {
        const eh = st?.history
        const last = eh?.length ? eh[eh.length - 1] : undefined
        if (!last) continue
        const t = Date.parse(last.time) || 0
        if (!best || t > best.t) best = { t, d: num(last.delay) }
      }
      if (best && best.d > 0) return best.d
      return h?.length ? num(h[h.length - 1].delay) : best?.d
    }
    function delayOf(name: string, seen = new Set<string>()): number | undefined {
      if (seen.has(name)) return undefined
      seen.add(name)
      const node = nodes[name]
      if (prefs.nestedDelay && node?.all && node?.now) return delayOf(node.now, seen)
      return lastDelay(node)
    }
    const visible = names.filter(n => (n !== "GLOBAL" || prefs.showGlobal || options.includeGlobal === true) && (prefs.showHidden || !all[n]?.hidden))
    function protocolOf(name: string, seen = new Set<string>()): string | undefined {
      if (seen.has(name)) return undefined
      seen.add(name)
      const node = nodes[name]
      if (node?.all && node?.now) return protocolOf(String(node.now), seen) ?? (typeof node.type === "string" ? node.type : undefined)
      return typeof node?.type === "string" ? node.type : undefined
    }
    // Request-local, top-level results only: shared members need one traversal,
    // while recursive cycle detection keeps its original per-start semantics.
    const members = new Map<string, { delay: number | undefined; type: string; target: ProxyTestTarget }>()
    return visible.map(n => {
      const g = all[n]; const delays: Record<string, number> = {}, types: Record<string, string> = {}, testTargets: Record<string, ProxyTestTarget> = {}
      for (const m of g.all as string[]) {
        let member = members.get(m)
        if (!member) { member = { delay: delayOf(m), type: protocolOf(m) || (nodes[m] ? "无type字段" : "无节点信息"), target: targetOf(m) }; members.set(m, member) }
        if (member.delay !== undefined) delays[m] = member.delay
        types[m] = member.type; testTargets[m] = { ...member.target }
      }
      return { name: n, type: String(g.type ?? ""), now: String(g.now ?? ""), all: g.all, delays, types, testTargets, hidden: !!g.hidden, icon: typeof g.icon === "string" ? g.icon : undefined, testUrl: typeof g.testUrl === "string" && /^https?:\/\/[^\s]+$/i.test(g.testUrl) ? g.testUrl : undefined }
    })
  }
}
export async function selectProxy(c0: Controller, group: string, name: string) {
  const c = await cc(c0)
  await http(c, "/proxies/" + enc(group), { method: "PUT", body: { name } })
  feedback()
  if (getPreferences().disconnectOnSwitch) {
    try { await closeAllConnections(c) } catch { throw new Error("代理已切换，但断开旧连接失败，请手动检查连接") }
  }
}

// Only share requests still in flight. Completed measurements are never reused as a new test.
const pendingDelayRequests = new Map<string, Promise<any>>()
const delayQueue: Array<() => void> = []
let activeDelayRequests = 0
function pumpDelayQueue() {
  while (activeDelayRequests < 5 && delayQueue.length) { activeDelayRequests++; delayQueue.shift()!() }
}
function scheduleDelay(request: () => Promise<any>): Promise<any> {
  return new Promise((resolve, reject) => {
    delayQueue.push(() => { void request().then(resolve, reject).finally(() => { activeDelayRequests--; pumpDelayQueue() }) })
    pumpDelayQueue()
  })
}
async function delayRequest(c: Controller, path: string, timeout: number): Promise<any> {
  const headers = customHeaders(), secret = getSecret(c.id)
  if (secret) headers["Authorization"] = "Bearer " + secret
  const key = JSON.stringify([c, headers, path, timeout])
  const previous = pendingDelayRequests.get(key)
  if (previous) return previous
  const request = scheduleDelay(() => http(c, path, { timeout: Math.ceil(timeout / 1000) + 2, headers }))
  pendingDelayRequests.set(key, request)
  try { return await request } finally { if (pendingDelayRequests.get(key) === request) pendingDelayRequests.delete(key) }
}
async function probeNodes(c: Controller, names: string[], url: string, timeout: number, targets?: Record<string, ProxyTestTarget>, onProgress?: (name: string, delay: number) => void): Promise<Record<string, number>> {
  const res: Record<string, number> = {}
  await Promise.all([...new Set(names)].map(async n => {
    const target = targets?.[n] ?? { name: n }
    if (["reject", "rejectdrop", "reject-drop", "block"].includes(target.type?.toLowerCase() ?? "")) return
    const route = target.provider ? `/providers/proxies/${enc(target.provider)}/${enc(target.name)}/healthcheck` : `/proxies/${enc(target.name)}/delay`
    let d = 0
    try { const j = await delayRequest(c, `${route}?url=${enc(url)}&timeout=${timeout}`, timeout); d = num(j.delay) } catch { d = 0 }
    res[n] = d
    try { onProgress?.(n, d) } catch {}
  }))
  return res
}
export async function testNodes(c0: Controller, names: string[]): Promise<Record<string, number>> {
  const c = await cc(c0), prefs = getPreferences()
  return probeNodes(c, names, prefs.testURL, Math.min(2000, prefs.testTimeout))
}
export async function testGroup(c0: Controller, g: Group, onProgress?: (name: string, delay: number) => void): Promise<Record<string, number>> {
  const c = await cc(c0)
  const prefs = getPreferences(), testURL = prefs.testURL, timeout = Math.min(2000, prefs.testTimeout)
  const names = [...new Set(g.now && g.all.includes(g.now) ? [g.now, ...g.all] : g.all)]
  const res = await probeNodes(c, names, testURL, timeout, g.testTargets, onProgress)
  recordEvent("test", Object.values(res).some(v => v > 0))
  return res
}

export async function loadConnections(c0: Controller, signal?: AbortController["signal"]): Promise<Conn[]> {
  const c = await cc(c0)
  if (signal?.aborted) throw new Error("Connection read cancelled")
  if (c.kind === "clash") {
    const j = await http(c, "/connections", { signal })
    // A wake-up/captive/proxy 200 can be empty or non-JSON; http() normalizes that
    // to {}. Only an actual connections array (or Mihomo's null) is a real sample.
    if (!j || typeof j !== "object" || !("connections" in j) || (j.connections !== null && !Array.isArray(j.connections))) throw new ControllerHTTPError("连接响应无效")
    return (j.connections ?? []).map((x: any): Conn => {
      const m = x.metadata ?? {}
      return {
        sourceIP: String(m.sourceIP ?? ""), inboundType: String(m.type ?? ""), chains: (x.chains ?? []).slice().reverse().map(String),
        id: String(x.id), host: String(m.host || m.destinationIP || "-"), src: `${m.sourceIP ?? ""}${m.sourcePort ? ":" + m.sourcePort : ""}`,
        dst: `${m.destinationIP ?? ""}${m.destinationPort ? ":" + m.destinationPort : ""}`, network: String(m.network ?? "").toUpperCase(),
        rule: [x.rule, x.rulePayload].filter(Boolean).join(" · "), ruleType: String(x.rule ?? ""), rulePayload: String(x.rulePayload ?? ""), chain: (x.chains ?? []).slice().reverse().join(" → "),
        up: num(x.upload), down: num(x.download), start: Date.parse(x.start) || 0,
      }
    })
  }
}

export async function loadConnectionHosts(c0: Controller, limit = 20): Promise<string[]> {
  const c = await cc(c0)
  if (c.kind !== "clash") return []
  const j = await http(c, "/connections")
  const out: string[] = [], seen = new Set<string>()
  for (const x of (j.connections ?? [])) {
    const m = x?.metadata ?? {}, h = String(m.host || m.destinationIP || "")
    if (h && !seen.has(h)) { seen.add(h); out.push(h); if (out.length >= limit) break }
  }
  return out
}
export async function closeConnection(c: Controller, id: string) { await http(await cc(c), "/connections/" + enc(id), { method: "DELETE" }) }
export async function closeAllConnections(c: Controller) {
  await http(await cc(c), "/connections", { method: "DELETE" })
}

export async function loadRules(c0: Controller): Promise<Rule[]> {
  const c = await cc(c0)
  {
    const j = await http(c, "/rules")
    return (j.rules ?? []).map((r: any) => {
      const rule: Rule = { type: String(r.type), payload: String(r.payload ?? ""), proxy: String(r.proxy ?? "") }
      // Only a complete (integer index + boolean extra.disabled) pair means the kernel supports toggling.
      if (Number.isInteger(r.index) && typeof r.extra?.disabled === "boolean") { rule.index = r.index; rule.disabled = r.extra.disabled }
      return rule
    })
  }
}
export function ruleToggleSupported(r: Rule): boolean { return Number.isInteger(r.index) && typeof r.disabled === "boolean" }
// Mihomo PATCH /rules/disable: JSON object, key = rule index, value = disabled. Runtime state only (not persisted).
export async function setRuleDisabled(c: Controller, index: number, disabled: boolean) {
  await http(await cc(c), "/rules/disable", { method: "PATCH", body: { [String(index)]: disabled } })
}
const RULE_INTERRUPT_MAX = 500
// Closes only active connections hit by this rule (connection rule/rulePayload == rule type/payload), by id.
export async function closeRuleConnections(c: Controller, type: string, payload: string): Promise<{ matched: number; failed: number; readFailed?: boolean }> {
  let xs: Conn[]
  try { xs = await loadConnections(c) } catch { return { matched: 0, failed: 0, readFailed: true } }
  const ids = xs.filter(x => x.ruleType === type && (x.rulePayload ?? "") === payload).slice(0, RULE_INTERRUPT_MAX).map(x => x.id)
  const rs = await Promise.allSettled(ids.map(id => closeConnection(c, id)))
  return { matched: ids.length, failed: rs.filter(r => r.status === "rejected").length }
}

export interface ClashConfig { mode?: string; "log-level"?: string; port?: number; "socks-port"?: number; "mixed-port"?: number; "redir-port"?: number; "tproxy-port"?: number; "allow-lan"?: boolean; ipv6?: boolean; "bind-address"?: string; tun?: { enable?: boolean; [key:string]: any } }
// Memory-only, source-scoped copy of the non-sensitive fields shown on the kernel config page.
// The raw /configs object (secret, authentication, ...) is never retained here.
const KERNEL_CONFIG_KEYS = ["port", "socks-port", "mixed-port", "redir-port", "tproxy-port", "allow-lan", "ipv6", "bind-address", "log-level"] as const
const kernelConfigSnapshots = new Map<string, ClashConfig>()
function rememberKernelConfig(c: Controller, cfg: any) {
  if (!cfg || typeof cfg !== "object") return
  const snap: any = {}
  for (const k of KERNEL_CONFIG_KEYS) if (cfg[k] !== undefined && cfg[k] !== null) snap[k] = cfg[k]
  if (typeof cfg.tun?.enable === "boolean" || typeof cfg.tun?.stack === "string") {
    snap.tun = {}
    if (typeof cfg.tun.enable === "boolean") snap.tun.enable = cfg.tun.enable
    if (typeof cfg.tun.stack === "string") snap.tun.stack = cfg.tun.stack
  }
  const key = JSON.stringify(c)
  if (!Object.keys(snap).length) { kernelConfigSnapshots.delete(key); return }
  if (kernelConfigSnapshots.size > 30 && !kernelConfigSnapshots.has(key)) kernelConfigSnapshots.clear()
  kernelConfigSnapshots.set(key, snap)
}
export function cachedKernelConfig(c: Controller): ClashConfig | null { const x = kernelConfigSnapshots.get(JSON.stringify(c)); return x ? { ...x, ...(x.tun ? { tun: { ...x.tun } } : {}) } : null }
export function forgetKernelConfig(c: Controller) { kernelConfigSnapshots.delete(JSON.stringify(c)) }
export async function loadConfig(c: Controller): Promise<ClashConfig> { const cfg=await http(await cc(c), "/configs");observeMode(c,cfg.mode);rememberKernelConfig(c,cfg);return cfg }
export function validateConfigPatch(patch: Partial<ClashConfig>): Partial<ClashConfig> {
  const out: any = {}
  for (const [k, v] of Object.entries(patch)) {
    if (["port", "socks-port", "mixed-port", "redir-port", "tproxy-port"].includes(k)) {
      if (!Number.isInteger(v) || Number(v) < 0 || Number(v) > 65535) throw new Error("端口须为 0–65535 的整数")
    } else if (k === "allow-lan" || k === "ipv6") { if (typeof v !== "boolean") throw new Error("网络开关无效") }
    else if (k === "bind-address") { if (typeof v !== "string" || !v.trim() || v.length > 253 || /[\s/?#@]/.test(v)) throw new Error("绑定地址无效") }
    else if (k === "tun") { if (!v || typeof v !== "object" || Array.isArray(v) || typeof v.enable !== "boolean" || Object.keys(v).some(key=>key!=="enable")) throw new Error("仅支持修改 TUN 开关") }
    else if (k === "tun.stack") { if (!TUN_STACKS.some(([value]) => value === v)) throw new Error("Tun 堆栈值无效") }
    else if (k === "log-level") { if (!LOG_LEVELS.includes(String(v))) throw new Error("日志级别无效") }
    else if (k === "mode") { if (!CLASH_MODES.some(x => x[0] === v)) throw new Error("模式无效") }
    else throw new Error("不支持修改该配置字段")
    out[k] = v
  }
  if (!Object.keys(out).length) throw new Error("没有待保存的配置")
  return out
}
export async function patchConfig(c: Controller, patch: Partial<ClashConfig>) {
  const { "tun.stack": stack, ...flat } = patch as any
  const flatBody = validateConfigPatch("tun.stack" in (patch as any) ? { ...flat, "tun.stack": stack } : patch)
  const body = "tun.stack" in flatBody ? { ...flatBody, "tun.stack": undefined, tun: { enable: (flat as any).tun?.enable ?? !!cachedKernelConfig(c)?.tun?.enable, stack: flatBody["tun.stack"] } } as any : flatBody
  try { await http(await cc(c), "/configs", { method: "PATCH", body }); recordEvent("config", true);observeMode(c,body.mode);{ const known = cachedKernelConfig(c); if (known) rememberKernelConfig(c, { ...known, ...body, ...(body.tun ? { tun: { ...known.tun, enable: body.tun.enable, ...(body.tun as any).stack !== undefined ? { stack: (body.tun as any).stack } : {} } } : {}) }) } }
  catch (e) { recordEvent("config", false); throw e }
}
export const LOG_LEVELS = ["silent", "error", "warning", "info", "debug"]
// Canonical PATCH values are lowercase; Mihomo's GET /configs serializes TUNStack
// as "gVisor"/"System"/"Mixed"/"Mips" (constant/tun.go String()), so display
// matching must be case-insensitive while written values stay lowercase.
export const TUN_STACKS: [string, string][] = [["gVisor", "gVisor"], ["system", "System"], ["mixed", "Mixed"], ["mips", "Mips"]]
export function tunStackLabel(value: unknown): string | null {
  if (typeof value !== "string") return null
  const hit = TUN_STACKS.find(([canonical]) => canonical.toLowerCase() === value.toLowerCase())
  return hit ? hit[0] : null
}

export function fmtBytes(n: number): string {
  if (!n || n < 0) return "0 B"
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0, v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`
}
export function fmtUptime(sec: number, detailed = false): string {
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60)
  if (detailed) return `${d}天 ${h}时 ${m}分 ${Math.floor(sec % 60)}秒`
  return d ? `${d}天${h}时` : h ? `${h}时${m}分` : `${m}分`
}

export function fmtParts(n: number, perSec = false, decimals?: number): [string, string] {
  const v = Math.max(0, n || 0)
  const u = ["B", "KB", "MB", "GB", "TB"]
  let i = perSec ? 1 : 0, x = perSec ? v / 1024 : v
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i++ }
  return [x.toFixed(decimals ?? (i === 0 ? 0 : perSec && i === 1 ? 1 : 2)), u[i] + (perSec ? "/s" : "")]
}
export const fmtSpeed = (n: number) => fmtBytes(n) + "/s"
export function fmtDuration(startMs: number): string {
  if (!startMs) return "-"
  const s = Math.max(0, Math.floor((Date.now() - startMs) / 1000))
  if (s < 60) return s + "秒"
  if (s < 3600) return Math.floor(s / 60) + "分"
  return Math.floor(s / 3600) + "时" + Math.floor(s % 3600 / 60) + "分"
}
export function delayColor(ms: number | undefined): string {
  if (ms === undefined) return "secondaryLabel"
  if (ms <= 0) return "systemRed"
  const p = getPreferences()
  return ms < p.delayGreen ? "systemGreen" : ms <= p.delayRed ? "systemYellow" : "systemRed"
}

export interface Provider { name: string; type: string; vehicleType: string; count: number | null; updatedAt: string; behavior?: string; format?: string }
export function parseProviders(j: any, kind: "proxies" | "rules"): Provider[] {
  return Object.entries<any>(j?.providers ?? {}).map(([name,p]) => ({ name, type: String(p.type ?? "未提供"), vehicleType: String(p.vehicleType ?? "未提供"),
    count: kind === "proxies" ? (Array.isArray(p.proxies) ? p.proxies.length : null) : (typeof p.ruleCount === "number" ? p.ruleCount : null),
    updatedAt: typeof p.updatedAt === "string" && Date.parse(p.updatedAt)>0 ? p.updatedAt : "", behavior: p.behavior, format: p.format }))
}
export async function loadProviders(c: Controller, kind: "proxies" | "rules") { return parseProviders(await http(await cc(c), "/providers/"+kind),kind) }
export async function updateProvider(c: Controller, kind: "proxies" | "rules", name: string) { await http(await cc(c), "/providers/"+kind+"/"+enc(name), { method: "PUT" }) }
function requireNikki(c: Controller) { if (c.kind !== "openwrt" || c.plugin !== "nikki") throw new Error("仅支持 Nikki 的 LuCI RPC；当前来源不是 Nikki") }
export async function nikkiInfo(c: Controller): Promise<{ app: string; core: string }> { requireNikki(c); const j = await ubus(c,"luci.nikki","version"); return { app: String(j.app || "未提供"), core: String(j.core || "未提供") } }
export async function coreVersion(c: Controller) { return String((await http(await cc(c),"/version")).version || "未提供") }
// Official updater uses Prerelease-Alpha for alpha builds, latest release otherwise.
// Unknown/custom builds are deliberately not treated as upgradeable. Public requests
// never use http()/customHeaders(), controller URLs, or controller credentials.
const coreUpdatePending = new Map<string, Promise<boolean | null>>()
export async function checkCoreUpdate(version: string): Promise<boolean | null> {
  if (!/^alpha-[0-9a-f]{7,40}$/.test(version) && !/^v?\d+\.\d+\.\d+$/.test(version)) return null
  const pending = coreUpdatePending.get(version)
  if (pending) return pending
  const request = readCoreUpdate(version).catch(() => null)
  coreUpdatePending.set(version, request)
  try { return await request } finally { if (coreUpdatePending.get(version) === request) coreUpdatePending.delete(version) }
}
async function readCoreUpdate(version: string): Promise<boolean | null> {
  const alpha = version.startsWith("alpha-")
  const response = await fetch(alpha
    ? "https://github.com/MetaCubeX/mihomo/releases/download/Prerelease-Alpha/version.txt"
    : "https://github.com/MetaCubeX/mihomo/releases/latest/download/version.txt",
    { headers: {}, timeout: getPreferences().requestTimeout })
  if (!response.ok) return null
  const latest = (await response.text()).trim()
  if (alpha) {
    if (!/^alpha-[0-9a-f]{7,40}$/.test(latest)) return null
    if (latest === version) return false
    // Different hashes alone do not prove newer: require official commit ancestry.
    const comparison = await fetch(`https://api.github.com/repos/MetaCubeX/mihomo/compare/${version.slice(6)}...${latest.slice(6)}`,
      { headers: { Accept: "application/vnd.github+json" }, timeout: getPreferences().requestTimeout })
    if (!comparison.ok) return null
    const result = JSON.parse(await comparison.text())
    if (result.status === "ahead" && result.ahead_by > 0 && result.behind_by === 0) return true
    if (result.status === "identical" || result.status === "behind") return false
    return null
  }
  const parse = (s: string) => /^v?\d+\.\d+\.\d+$/.test(s) ? s.replace(/^v/, "").split(".").map(Number) : null
  const current = parse(version), target = parse(latest)
  if (!current || !target || [...current, ...target].some(n => !Number.isSafeInteger(n))) return null
  for (let i = 0; i < 3; i++) if (target[i] !== current[i]) return target[i] > current[i]
  return false
}
// Prefer the live core API, with Nikki's local version as a read-only fallback.
// Resolve both results together so a slower missing value cannot overwrite a valid version.
export async function loadRuntimeVersions(c: Controller, onUpdate?: (value:{core:string;app:string;failed:boolean})=>void): Promise<{core:string;app:string;failed:boolean}> {
  const nikki=c.kind==="openwrt"&&c.plugin==="nikki"
  const present=(v:any)=>typeof v==="string"&&v.trim()&&v!=="未提供"?v.trim():null
  let direct:string|null=null,local:{core:string;app:string}|null=null
  const result=()=>({core:present(direct)??present(local?.core)??"未提供",app:nikki?present(local?.app)??"未提供":"不适用",failed:!(present(direct)??present(local?.core))||(nikki&&!present(local?.app))})
  await Promise.all([
    coreVersion(c).then(x=>{direct=x;onUpdate?.(result())}).catch(()=>{}),
    nikki?nikkiInfo(c).then(x=>{local=x;onUpdate?.(result())}).catch(()=>{}):Promise.resolve()
  ])
  return result()
}
// AT_CLKTCK is read from rpcd's auxiliary vector, rather than assuming a kernel HZ.
export function linuxClockTicks(encoded: string): number | null {
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",bytes:number[]=[]
  let acc=0,bits=0
  for(const char of encoded.replace(/\s/g,"")) { if(char==="=")break;const n=alphabet.indexOf(char);if(n<0)return null;acc=(acc<<6)|n;bits+=6;if(bits>=8){bits-=8;bytes.push((acc>>bits)&255);acc&=(1<<bits)-1} }
  const candidates=new Set<number>()
  for(const size of [4,8])for(const little of [true,false]){
    if(!bytes.length||bytes.length%(size*2))continue
    const integer=(at:number)=>{let n=0;for(let i=0;i<size;i++)n=n*256+bytes[at+(little?size-1-i:i)];return n}
    let tick:number|null=null,valid=true,ended=false
    for(let at=0;at<bytes.length;at+=size*2){const type=integer(at),value=integer(at+size);if(type===0){ended=true;break}if(!Number.isSafeInteger(type)||type>255){valid=false;break}if(type===17){if(!Number.isSafeInteger(value)||value<1||value>1000000){valid=false;break}tick=value}}
    if(valid&&ended&&tick!==null)candidates.add(tick)
  }
  return candidates.size===1?[...candidates][0]:null
}
export function linuxProcessSeconds(uptime: string, stat: string, ticks: number, pid: number): number | null {
  const end=stat.lastIndexOf(")"),start=Number(stat.slice(end+2).trim().split(/\s+/)[19]),now=Number(uptime.trim().split(/\s+/)[0])
  if(end<0||!stat.startsWith(pid+" (")||!Number.isFinite(now)||!Number.isSafeInteger(start)||start<0||!Number.isFinite(ticks)||ticks<=0)return null
  const seconds=now-start/ticks
  return seconds>=0?Math.floor(seconds):null
}
// ubus localtime includes the POSIX timezone offset. Refuse DST/unknown zones rather than guess.
export function nikkiServiceSeconds(localtime: unknown, uptime: unknown, timezone: string, mtime: unknown): number | null {
  const zone=timezone.trim().match(/^(?:[A-Za-z]{3,}|<[^>]+>)([+-]?)(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?$/)
  if(!zone||typeof localtime!=="number"||!Number.isFinite(localtime)||typeof uptime!=="number"||!Number.isFinite(uptime)||uptime<0||typeof mtime!=="number"||!Number.isSafeInteger(mtime))return null
  const hours=Number(zone[2]),minutes=Number(zone[3]??0),seconds=Number(zone[4]??0)
  if(hours>24||minutes>59||seconds>59)return null
  const offset=(hours*3600+minutes*60+seconds)*(zone[1]==="-"?-1:1),age=localtime+offset-mtime
  return age>=0&&age<=uptime?Math.floor(age):null
}
export function linuxCoreIdentity(stat:string,pid:number):string|null {
  const end=stat.lastIndexOf(")"),fields=stat.slice(end+2).trim().split(/\s+/)
  if(end<0||!stat.startsWith(pid+" (")||![fields[19],fields[25]].every(x=>/^\d+$/.test(x??"")&&Number(x)>0))return null
  // execve keeps PID/starttime, but replaces the user stack. Never rely on PID alone.
  return `${pid}:${fields[19]}:${fields[25]}`
}
export interface NikkiRuntime { coreSeconds:number|null;serviceSeconds:number|null;measuredAt:number;coreIdentity?:string|null;running?:boolean|null }
export async function loadNikkiRuntime(c: Controller,onUpdate?:(value:NikkiRuntime)=>void): Promise<NikkiRuntime> {
  requireNikki(c)
  const result:NikkiRuntime={coreSeconds:null,serviceSeconds:null,measuredAt:Date.now(),coreIdentity:null,running:null}
  const [services,info,flag,tz]=await ubusBatch(c,[
    ["service","list",{name:"nikki"}], ["system","info"],
    ["file","stat",{path:"/var/run/nikki/started.flag"}], ["file","read",{path:"/etc/TZ"}]
  ])
  const instances:any[]=Object.values(services?.nikki?.instances??{})
  const instance=instances.find(x=>x.running===true&&Number.isInteger(x.pid)&&x.pid>0)
  result.running=services?.nikki?!!instance:null
  if(!instance){onUpdate?.({...result});return result}
  if(flag?.type==="file")result.serviceSeconds=nikkiServiceSeconds(info?.localtime,info?.uptime,String(tz?.data??""),flag.mtime)
  result.measuredAt=Date.now();onUpdate?.({...result})
  const pid=instance.pid
  const [uptime,aux,stat,comm]=await ubusBatch(c,[
    ["file","read",{path:"/proc/uptime"}], ["file","read",{path:"/proc/self/auxv",base64:true}],
    ["file","read",{path:`/proc/${pid}/stat`}], ["file","read",{path:`/proc/${pid}/comm`}]
  ])
  const ticks=linuxClockTicks(String(aux?.data??""))
  if(String(comm?.data??"").trim()==="mihomo"){
    result.coreIdentity=linuxCoreIdentity(String(stat?.data??""),pid)
    if(ticks!==null)result.coreSeconds=linuxProcessSeconds(String(uptime?.data??""),String(stat?.data??""),ticks,pid)
  }
  // Keep plugin age aligned with the later sample.
  if(result.serviceSeconds!==null)result.serviceSeconds+=Math.max(0,Math.floor((Date.now()-result.measuredAt)/1000))
  result.measuredAt=Date.now()
  return result
}
export async function verifyCoreRestart(c:Controller,before:NikkiRuntime|null,current:()=>boolean=()=>true):Promise<{verified:boolean;runtime:NikkiRuntime|null}> {
  let unavailable=false,last:NikkiRuntime|null=null
  const resolved=await cc(c)
  for(let attempt=0;attempt<6&&current();attempt++){
    await new Promise<void>(resolve=>setTimeout(resolve,700))
    if(!current())break
    const [health,runtime]=await Promise.all([
      http(resolved,"/version",{timeout:2}).then(x=>typeof x.version==="string"&&!!x.version).catch(()=>false),
      c.kind==="openwrt"&&c.plugin==="nikki"?loadNikkiRuntime(c).catch(()=>null):Promise.resolve(null)
    ])
    if(!current())break
    if(runtime)last=runtime
    if(!health){unavailable=true;continue}
    const changed=!!(before?.coreIdentity&&runtime?.coreIdentity&&before.coreIdentity!==runtime.coreIdentity)
    if(changed||unavailable)return {verified:true,runtime:last}
  }
  return {verified:false,runtime:last}
}
// A dropped POST response can be caused by the upgrade's restart. Never retry
// that write: only bounded live /version reads can establish a changed version.
export async function upgradeCoreAndVerify(c:Controller,current:()=>boolean=()=>true):Promise<{verified:boolean;version:string|null}> {
  const resolved=await cc(c)
  const read=async()=>{
    try {
      const value=(await http(resolved,"/version",{timeout:2})).version
      return typeof value==="string"&&value.trim()&&!/^(unknown|未提供|读取失败)$/i.test(value.trim())?value.trim():null
    } catch { return null }
  }
  if(!current())return {verified:false,version:null}
  const before=await read()
  if(!current())return {verified:false,version:null}
  try { await coreAction(resolved,"upgrade") } catch(error) {
    if(error instanceof ControllerHTTPError)throw error
    // Transport timeout/disconnect is not an acknowledgement, nor proof of failure.
  }
  let last:string|null=null
  for(let attempt=0;attempt<8&&current();attempt++){
    await new Promise<void>(resolve=>setTimeout(resolve,1000))
    if(!current())break
    const version=await read()
    if(!current())break
    if(version)last=version
    if(before&&version&&version!==before)return {verified:true,version}
  }
  return {verified:false,version:last}
}
export async function nikkiService(c: Controller, action: "start"|"stop"|"restart"|"reload") { requireNikki(c); if (!["start","stop","restart","reload"].includes(action)) throw new Error("不支持的服务动作"); await ubus(c,"rc","init",{name:"nikki",action}) }
export type CoreAction = "upgrade"|"restart"|"reload"|"geo"|"dns"|"fakeip"
export async function coreAction(c: Controller, action: CoreAction) {
  // Mihomo hub/route/upgrade.go: POST /upgrade uses the core's default channel,
  // downloads/replaces its executable and schedules a restart (not a version probe).
  const paths = { upgrade: ["POST","/upgrade"], restart: ["POST","/restart"], reload: ["PUT","/configs?force=true"], geo: ["POST","/configs/geo"], dns: ["POST","/cache/dns/flush"], fakeip: ["POST","/cache/fakeip/flush"] }
  const entry = paths[action]; if (!entry) throw new Error("不支持的核心动作")
  await http(await cc(c),entry[1],{method:entry[0], ...(action === "reload" ? {body:{}} : {})})
}
export async function queryDNS(c: Controller, name: string, type: string) {
  if (!/^(?=.{1,253}\.?$)[a-z0-9_*-]+(?:\.[a-z0-9_-]+)*\.?$/i.test(name) || !["A","AAAA","CNAME","TXT","MX","HTTPS"].includes(type)) throw new Error("域名或查询类型无效")
  const j = await http(await cc(c),`/dns/query?name=${enc(name)}&type=${enc(type)}`)
  return { status: num(j.Status), answers: (j.Answer ?? []).map((x:any) => ({ data:String(x.data ?? ""), type:num(x.type), ttl:num(x.TTL) })) }
}
// Nikki semantics: OpenWrt-nikki 78e1a751, tools/nikki.js + view/nikki/{app,profile,mixin,editor}.js.
// All bodies, UCI snapshots and drafts stay in memory; never send them to recordEvent/Storage.
export interface NikkiSubscription { id:string; name:string; url:string; userAgent:string; prefer:string; updated:string; used:string; total:string; expire:string }
export interface NikkiRule { id:string; type:string; matcher:string; node:string; enabled:boolean; noResolve:boolean }
export interface NikkiFile { key:string; name:string; filename:string; origin:"file"|"subscription"; size:number|null; mtime:number|null }
export interface NikkiManagement { profile:string; files:NikkiFile[]; subscriptions:NikkiSubscription[]; rules:NikkiRule[]; appendRules:boolean; filesError:boolean }
export class NikkiManagementError extends Error {}
const nikkiFail = (message:string):never => { throw new NikkiManagementError(message) }
const nikkiSnapshots = new WeakMap<NikkiManagement,{source:string; values:any}>()
const nikkiBusy = new Set<string>()
const nikkiSource = (c:Controller) => [c.id,c.kind,c.plugin,c.url,c.username].join("|")
function nikkiID(id:string) { if (!/^[a-zA-Z0-9_]+$/.test(id)) nikkiFail("标识无效") }
function nikkiFilename(name:string) { if (!name || name.length>255 || /[:\/\\\x00-\x1f\x7f]/.test(name) || name==="." || name===".." || !/\.ya?ml$/i.test(name)) nikkiFail("配置文件名无效") }
export function nikkiFilePath(key:string) {
  if(key.startsWith("file:")){const name=key.slice(5);nikkiFilename(name);return "/etc/nikki/profiles/"+name}
  if(key.startsWith("subscription:")){const id=key.slice(13);nikkiID(id);return "/etc/nikki/subscriptions/"+id+".yaml"}
  return nikkiFail("配置来源无效")
}
function canonical(v:any):string { if(Array.isArray(v))return "["+v.map(canonical).join(",")+"]";if(v&&typeof v==="object")return "{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+canonical(v[k])).join(",")+"}";return JSON.stringify(v) }
async function nikkiSession(c:Controller) { requireNikki(c); if(!sessions[c.id]||sessions[c.id].source!==[c.url,c.username].join("|")||Date.now()-sessions[c.id].at>50*60*1000)await wrtLogin(c);if(sessions[c.id]?.source!==[c.url,c.username].join("|"))return nikkiFail("认证来源已改变，请重试");return sessions[c.id].sid }
// Read-only requests may refresh an expired shared login; writes below never replay.
async function nikkiRead(c:Controller,obj:string,method:string,args:any) {await nikkiSession(c);return ubus(c,obj,method,args)}
async function nikkiExclusive<T>(c:Controller,fn:()=>Promise<T>):Promise<T> {
  requireNikki(c);const key=nikkiSource(c);if(nikkiBusy.has(key))return nikkiFail("该来源正在执行管理操作，请稍后重试")
  nikkiBusy.add(key);try{return await fn()}finally{nikkiBusy.delete(key)}
}
export async function loadNikkiManagement(c:Controller):Promise<NikkiManagement> {
  requireNikki(c)
  const call=(obj:string,method:string,args:any)=>nikkiRead(c,obj,method,args)
  const [j,local,remote]=await Promise.all([call("uci","get",{config:"nikki"}),call("file","list",{path:"/etc/nikki/profiles"}).catch(()=>null),call("file","list",{path:"/etc/nikki/subscriptions"}).catch(()=>null)])
  if(!j.values||typeof j.values!=="object")return nikkiFail("未能读取 Nikki 配置")
  const vs:any[]=Object.entries(j.values).map(([id,v]:[string,any])=>({...v,".name":id})).sort((a,b)=>(a[".index"]??0)-(b[".index"]??0))
  const subscriptions:NikkiSubscription[]=vs.filter(x=>x[".type"]==="subscription").map(x=>({id:x[".name"],name:String(x.name||x[".name"]),url:String(x.url??""),userAgent:String(x.user_agent??"clash"),prefer:String(x.prefer??"remote"),updated:String(x.update||"未提供"),used:String(x.used||"未提供"),total:String(x.total||"未提供"),expire:String(x.expire||"未提供")}))
  const safeEntries=(j:any)=>(j?.entries??[]).filter((x:any)=>{try{nikkiFilename(x.name);return x.type==="file"}catch{return false}})
  const localFiles:NikkiFile[]=safeEntries(local).map((x:any)=>({key:"file:"+x.name,name:String(x.name),filename:String(x.name),origin:"file",size:typeof x.size==="number"?x.size:null,mtime:typeof x.mtime==="number"?x.mtime:null}))
  const remoteEntries=safeEntries(remote)
  const files=[...localFiles,...subscriptions.map(s=>{const x=remoteEntries.find((f:any)=>f.name===s.id+".yaml");return {key:"subscription:"+s.id,name:s.name,filename:s.id+".yaml",origin:"subscription" as const,size:x?.size??null,mtime:x?.mtime??null}})]
  const result:NikkiManagement={profile:String(j.values.config?.profile??""),appendRules:j.values.mixin?.rule==="1",files,subscriptions,rules:vs.filter(x=>x[".type"]==="rule").map(x=>({id:x[".name"],type:String(x.type??""),matcher:String(x.matcher??""),node:String(x.node??""),enabled:x.enabled==="1",noResolve:x.no_resolve==="1"})),filesError:!local||!remote}
  nikkiSnapshots.set(result,{source:nikkiSource(c),values:j.values});return result
}
// A get alone can echo session staging. Only a matching full target bracketed by
// clean changes reads on the SAME pinned session can confirm a lost commit reply.
async function verifyNikkiCommit(c:Controller,sid:string,expected:string):Promise<boolean> {
  const source=nikkiSource(c)
  for(let attempt=0;attempt<3;attempt++){
    if(attempt)await new Promise<void>(resolve=>setTimeout(resolve,500))
    if(nikkiSource(c)!==source)return false
    try {
      const read=(method:string)=>ubusRaw(c,sid,"uci",method,{config:"nikki"},2)
      const before=await read("changes")
      if(!Array.isArray(before.changes))return false
      if(before.changes.length)continue
      const actual=await read("get"),after=await read("changes")
      if(nikkiSource(c)!==source)return false
      if(Array.isArray(after.changes)&&after.changes.length===0&&actual.values&&canonical(actual.values)===expected)return true
    } catch { /* Read-only retries only; never re-login into another session's staging. */ }
  }
  return false
}
// Mutations pin one authenticated session: never replay add/append/commit after an ambiguous response.
// Refuse dirty sessions rather than committing/reverting somebody else's staged UCI changes.
async function nikkiTransaction(c:Controller,base:NikkiManagement,mutate:(call:(method:string,args?:any)=>Promise<any>,values:any)=>Promise<void>) {
  return nikkiExclusive(c,async()=>{
    const snap=nikkiSnapshots.get(base);if(!snap||snap.source!==nikkiSource(c))return nikkiFail("来源已改变，请返回并刷新")
    const changes=await nikkiRead(c,"uci","changes",{config:"nikki"})
    if(!Array.isArray(changes.changes))return nikkiFail("无法核验当前会话的 Nikki 暂存状态（uci.changes 返回结构异常），未写入；草稿仍保留")
    if(changes.changes.length>0)return nikkiFail("当前会话有未提交的 Nikki 改动，未写入；请先处理暂存改动后刷新，草稿仍保留")
    let staged=false,committing=false
    const sid=await nikkiSession(c),call=(method:string,args:any={})=>{if(["set","add","delete","order"].includes(method))staged=true;return ubusRaw(c,sid,"uci",method,{config:"nikki",...args})}
    const current=(await call("get")).values
    if(canonical(current)!==canonical(snap.values))return nikkiFail("设备配置已改变，请刷新后重新编辑；当前草稿未丢弃")
    // rpcd commit emits config.change; Nikki registers procd_add_reload_trigger("nikki").
    // No explicit rc.init: committing can still trigger this upstream side effect.
    let expected=""
    try {
      await mutate(call,current)
      // Capture rpcd's complete staged target, including generated section ids/order.
      const target=(await call("get")).values
      if(!target||typeof target!=="object")return nikkiFail("未能读取本次暂存目标，未提交；草稿仍保留")
      expected=canonical(target)
      committing=true;await call("commit")
    }
    catch(e) {
      if(!committing&&staged){try{await call("revert")}catch{return nikkiFail("保存未完成且清理暂存失败，请检查设备；草稿仍保留")}}
      if(committing&&await verifyNikkiCommit(c,sid,expected))return
      if(e instanceof NikkiManagementError)throw e
      // Keep only protocol status, never arbitrary transport text (which may contain private URLs).
      const message=e instanceof Error?e.message:"",status=message==="ACCESS"?"ubus状态6（权限拒绝）":/^ubus 调用失败，代码 \d+$/.test(message)?message:/^请求失败 HTTP \d+$/.test(message)?message:"未取得有效提交响应"
      return nikkiFail(committing?`提交结果未确认（${status}），只读核验未通过，系统可能已触发重载。请刷新核实；不会自动重试`:"保存未完成；草稿仍保留，请检查权限与连接")
    }
  })
}
export function validateNikkiSubscription(s:Pick<NikkiSubscription,"name"|"url"|"userAgent"|"prefer">) {
  if(!s.name.trim()||s.name.length>200)return nikkiFail("请填写订阅名称（最多200字）")
  if(!/^https?:\/\/[^/?#\s]+(?:[/?#][^\s]*)?$/i.test(s.url)||/[\x00-\x20\x7f]/.test(s.url))return nikkiFail("订阅URL须为完整的HTTP或HTTPS地址")
  if(!["clash","clash.meta","mihomo"].includes(s.userAgent)||!["remote","local"].includes(s.prefer))return nikkiFail("不支持的 User Agent 或配置优先级，请明确选择")
}
export async function saveNikkiSubscription(c:Controller,base:NikkiManagement,id:string|null,s:Pick<NikkiSubscription,"name"|"url"|"userAgent"|"prefer">) {
  requireNikki(c);validateNikkiSubscription(s);if(id)nikkiID(id)
  await nikkiTransaction(c,base,async(call,vs)=>{const values={name:s.name,url:s.url,user_agent:s.userAgent,prefer:s.prefer};if(id){if(vs[id]?.[".type"]!=="subscription")return nikkiFail("订阅已不存在");await call("set",{section:id,values})}else await call("add",{type:"subscription",values})})
}
export async function deleteNikkiSubscription(c:Controller,base:NikkiManagement,id:string) {
  nikkiID(id);await nikkiTransaction(c,base,async(call,vs)=>{if(vs[id]?.[".type"]!=="subscription")return nikkiFail("订阅已不存在");if(vs.config?.profile==="subscription:"+id)return nikkiFail("不能删除当前选用订阅，请先切换配置")
    // Match LuCI: remove only this UCI section, not the downloaded file or unrelated sections.
    await call("delete",{section:id})})
}
export const NIKKI_RULE_TYPES=["DOMAIN","DOMAIN-SUFFIX","DOMAIN-WILDCARD","DOMAIN-KEYWORD","DOMAIN-REGEX","IP-CIDR","IP-CIDR6","DST-PORT","SRC-PORT","PROCESS-NAME","RULE-SET","GEOSITE","GEOIP","IP-ASN","MATCH"]
export function validateNikkiRule(r:Omit<NikkiRule,"id">) {
  if(!/^[A-Z][A-Z0-9-]*$/.test(r.type)||!r.node.trim()||/[\r\n,\x00]/.test(r.node))return nikkiFail("请填写有效规则类型和策略名称")
  if(r.type!=="MATCH"&&(!r.matcher.trim()||/[\r\n\x00]/.test(r.matcher)))return nikkiFail("请填写匹配内容")
  if(/^(DST|SRC)-PORT$/.test(r.type)&&!r.matcher.split("/").every(v=>{const m=v.match(/^(\d+)(?:-(\d+))?$/);return !!m&&+m[1]>=1&&+m[1]<=65535&&(!m[2]||(+m[2]>=+m[1]&&+m[2]<=65535))}))return nikkiFail("端口须为1–65535或有效范围，可用 / 分隔")
  if(r.type==="DOMAIN"||r.type==="DOMAIN-SUFFIX")if(!/^(?:[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?\.)*[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?\.?$/i.test(r.matcher))return nikkiFail("域名匹配内容无效")
  if(r.type==="IP-CIDR"){const m=r.matcher.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);if(!m||m.slice(1,5).some(v=>+v>255)||+m[5]>32)return nikkiFail("请填写有效IPv4 CIDR")}
  if(r.type==="IP-CIDR6"){
    const [raw,prefix,...rest]=r.matcher.split("/");let ip=raw
    if(ip.includes(".")){const pos=ip.lastIndexOf(":"),tail=ip.slice(pos+1).split(".");if(tail.length!==4||tail.some(v=>!/^\d{1,3}$/.test(v)||+v>255))return nikkiFail("请填写有效IPv6 CIDR");ip=ip.slice(0,pos+1)+"0:0"}
    const halves=ip.split("::"),valid=(s:string)=>s.split(":").every(v=>/^[0-9a-f]{1,4}$/i.test(v))
    const validIP=halves.length===1?valid(ip)&&ip.split(":").length===8:halves.length===2&&halves.every(s=>!s||valid(s))&&halves.reduce((n,s)=>n+(s?s.split(":").length:0),0)<8
    if(rest.length||!/^\d{1,3}$/.test(prefix??"")||+prefix>128||!validIP)return nikkiFail("请填写有效IPv6 CIDR")
  }
  // DOMAIN-REGEX is a Mihomo/Go expression, not JavaScript RegExp; do not reject valid Go syntax here.
}
export async function saveNikkiRule(c:Controller,base:NikkiManagement,id:string|null,r:Omit<NikkiRule,"id">) {
  requireNikki(c);validateNikkiRule(r);if(id)nikkiID(id)
  await nikkiTransaction(c,base,async(call,vs)=>{const values={type:r.type,matcher:r.type==="MATCH"?"":r.matcher,node:r.node,enabled:r.enabled?"1":"0",no_resolve:r.noResolve?"1":"0"};if(id){if(vs[id]?.[".type"]!=="rule")return nikkiFail("规则已不存在");await call("set",{section:id,values})}else await call("add",{type:"rule",values})})
}
export async function deleteNikkiRule(c:Controller,base:NikkiManagement,id:string) {nikkiID(id);await nikkiTransaction(c,base,async(call,vs)=>{if(vs[id]?.[".type"]!=="rule")return nikkiFail("规则已不存在");await call("delete",{section:id})})}
export async function setNikkiRulesEnabled(c:Controller,base:NikkiManagement,enabled:boolean) {await nikkiTransaction(c,base,async(call,vs)=>{if(!vs.mixin)return nikkiFail("mixin配置不存在");await call("set",{section:"mixin",values:{rule:enabled?"1":"0"}})})}
export async function reorderNikkiRules(c:Controller,base:NikkiManagement,ids:string[]) {
  ids.forEach(nikkiID)
  if(ids.length!==base.rules.length||new Set(ids).size!==ids.length||ids.some(id=>!base.rules.some(r=>r.id===id)))return nikkiFail("规则排序列表无效")
  await nikkiTransaction(c,base,async(call,vs)=>{let i=0;const all=Object.keys(vs).sort((a,b)=>(vs[a][".index"]??0)-(vs[b][".index"]??0));await call("order",{sections:all.map(id=>vs[id][".type"]==="rule"?ids[i++]:id)})})
}
export async function selectNikkiProfile(c:Controller,base:NikkiManagement,key:string) {
  nikkiFilePath(key);if(!base.files.some(f=>f.key===key))return nikkiFail("配置不在当前文件列表")
  await nikkiRegularFile(c,key)
  await nikkiTransaction(c,base,async(call,vs)=>{if(!vs.config)return nikkiFail("config配置不存在");await call("set",{section:"config",values:{profile:key}})})
  // No extra rc.init: rpcd commit may already trigger Nikki reload. Never reload twice implicitly.
}
async function nikkiRegularFile(c:Controller,key:string) {
  requireNikki(c);const path=nikkiFilePath(key),slash=path.lastIndexOf("/")
  // file.list on older rpcd follows links. lstat every non-root ancestor and the leaf,
  // concurrently with the metadata listing: no exec permission and no serial path RTTs.
  const parts=path.split("/").filter(Boolean),paths=parts.map((_,i)=>"/"+parts.slice(0,i+1).join("/"))
  const [list,checks]=await Promise.all([
    nikkiRead(c,"file","list",{path:path.slice(0,slash)}),
    Promise.all(paths.map(async p=>{try{return {value:await nikkiRead(c,"file","lstat",{path:p}),error:""}}catch(e:any){return {value:null,error:String(e?.message??"")}}}))
  ])
  const entry=list.entries?.find((x:any)=>x.name===path.slice(slash+1))
  if(!entry||entry.type!=="file"||typeof entry.size!=="number")return nikkiFail("配置文件不存在、不是普通文件或无读取权限；订阅请先更新")
  for(let i=0;i<checks.length;i++)if(!checks[i].error&&checks[i].value?.type!==(i===checks.length-1?"file":"directory"))return nikkiFail("文件或祖先路径不是普通文件/目录（可能含符号链接），已拒绝操作")
  if(checks.every(x=>!x.error))return entry
  // Only METHOD_NOT_FOUND for every path proves an old rpcd without lstat. Permission
  // errors, missing paths, malformed metadata, and mixed results never authorize fallback.
  if(!checks.every(x=>x.error==="ubus 调用失败，代码 3"))return nikkiFail("file.lstat 路径核验未完成，请检查读取权限或文件状态；已拒绝文件操作")
  let resolved:any
  try{resolved=await nikkiRead(c,"file","exec",{command:"/bin/busybox",params:["readlink","-f",path]})}
  catch{return nikkiFail("旧设备不支持 file.lstat 且缺少只读路径核验权限（BusyBox readlink），已拒绝文件操作")}
  if(resolved.code!==0||String(resolved.stdout??"").replace(/\n$/,"")!==path)return nikkiFail("文件路径含符号链接、不能核验或已越出 Nikki 配置目录，已拒绝操作")
  return entry
}
// LuCI fs.read_direct -> cgi-io download streams to EOF. file.read is NOT a full-file API:
// rpcd file.c uses a single read(st_size), 4096 for size=0, and rejects >=256KiB.
export async function readNikkiFile(c:Controller,key:string):Promise<string> {
  requireNikki(c);const path=nikkiFilePath(key),before=await nikkiRegularFile(c,key),sid=await nikkiSession(c)
  const r=await fetch(c.url+"/cgi-bin/cgi-download",{method:"POST",headers:{...customHeaders(),"Content-Type":"application/x-www-form-urlencoded"},body:"sessionid="+enc(sid)+"&path="+enc(path),allowInsecureRequest:true,timeout:getPreferences().requestTimeout} as any)
  if(!r.ok)return nikkiFail("完整文件读取失败：需要 LuCI cgi-download 及该路径的读取权限；不回退到截断读取")
  const text=await r.text(),after=await nikkiRegularFile(c,key)
  if(utf8Length(text)!==before.size||before.size!==after.size||before.mtime!==after.mtime)return nikkiFail("文件未完整读取、编码不是UTF-8或读取期间已改变，请重试")
  if(text.includes("\u0000"))return nikkiFail("文件不是可编辑的UTF-8文本")
  return text
}
function utf8Length(s:string) {let n=0;for(const ch of s){const cp=ch.codePointAt(0)!;n+=cp<0x80?1:cp<0x800?2:cp<0x10000?3:4}return n}
export async function saveNikkiFile(c:Controller,key:string,original:string,text:string) {
  requireNikki(c);const path=nikkiFilePath(key);if(text.includes("\u0000"))return nikkiFail("配置不能包含NUL字符")
  await nikkiExclusive(c,async()=>{
    if(await readNikkiFile(c,key)!==original)return nikkiFail("设备文件已改变，未覆盖；请保留草稿并重新打开文件核对")
    const stat=await nikkiRegularFile(c,key),sid=await nikkiSession(c)
    if(!Number.isInteger(stat.mode))return nikkiFail("文件权限元信息缺失，未写入；请检查设备文件接口")
    // Same chunked protocol as Nikki.writefile, but split by Unicode code point to preserve UTF-8.
    let chunk="",bytes=0,append=false
    const write=async()=>{await ubusRaw(c,sid,"file","write",{path,data:chunk,append,mode:stat.mode&0o777});append=true;chunk="";bytes=0}
    try{for(const ch of text){const n=utf8Length(ch);if(bytes+n>8192)await write();chunk+=ch;bytes+=n}if(chunk||!append)await write();if(await readNikkiFile(c,key)!==text)throw new Error("verify")}
    catch{return nikkiFail("文件保存或完整性核验失败，设备可能只写入部分内容。草稿仍保留，请勿重载服务；核对设备文件后恢复/重试")}
  })
}
export async function updateNikkiSubscription(c:Controller,id:string,base?:NikkiManagement) {
  requireNikki(c);nikkiID(id);await nikkiExclusive(c,async()=>{
    const snap=base?nikkiSnapshots.get(base):undefined
    if(base&&(!snap||snap.source!==nikkiSource(c)))return nikkiFail("来源已改变，请刷新后更新")
    const changes=await nikkiRead(c,"uci","changes",{config:"nikki"})
    if(!Array.isArray(changes.changes)||changes.changes.length)return nikkiFail("存在未提交的 Nikki 改动或无法核验，请先处理后再更新订阅")
    const current=await nikkiRead(c,"uci","get",{config:"nikki",section:id})
    if(current.values?.[".type"]!=="subscription")return nikkiFail("订阅已不存在或类型不符")
    const options=(v:any)=>Object.fromEntries(Object.entries(v??{}).filter(([k])=>!k.startsWith(".")))
    if(snap&&canonical(options(snap.values[id]))!==canonical(options(current.values)))return nikkiFail("订阅设置已改变，请刷新后更新")
    const sid=await nikkiSession(c),j=await ubusRaw(c,sid,"luci.nikki","update_subscription",{section_id:id},Math.max(getPreferences().requestTimeout,30))
    if(j.success!==true)return nikkiFail("Nikki报告订阅更新失败，请核对下载文件；不会自动重试")
  })
}
export async function webpage(c: Controller, page: "home"|"profile"|"mixin"|"log"|"editor" = "home") {
  if (page !== "home") requireNikki(c)

  const base = c.kind === "openwrt" ? c.url : (await cc(c)).url
  if (!/^https?:\/\/[^/?#@]+\/?$/.test(base)) throw new Error("当前地址含路径或认证参数，不允许交给浏览器")
  return base.replace(/\/$/,"") + (c.kind === "openwrt" ? "/cgi-bin/luci/"+(page === "home" ? "" : "admin/services/nikki/"+page) : "/ui/")
}
export async function nikkiServiceStatus(c: Controller): Promise<boolean | null> { requireNikki(c); const j = await ubus(c,"rc","list",{name:"nikki"}); return typeof j.nikki?.running === "boolean" ? j.nikki.running : null }

const dockerBody = (j: any) => { if (!j || typeof j.code !== "number" || j.code >= 400) throw new Error("Docker 请求失败（" + String(j?.code ?? "无响应") + "）"); return j.body }
export async function loadDockerContainers(c: Controller): Promise<DockerContainer[]> {
  const body = dockerBody(await ubus(c, "docker.container", "list", { query: { all: "true" } }))
  return (Array.isArray(body) ? body : []).map((x: any): DockerContainer => ({
    id: String(x.Id ?? ""), name: String((x.Names?.[0] ?? "").replace(/^\//, "") || String(x.Id ?? "").slice(0, 12)),
    image: String(x.Image ?? ""), state: String(x.State ?? ""), status: String(x.Status ?? ""),
  })).filter(x => /^[0-9a-f]{12,64}$/.test(x.id))
}
export async function dockerAction(c: Controller, id: string, action: "start" | "stop" | "restart") {
  if (!/^[0-9a-f]{12,64}$/.test(id)) throw new Error("容器标识无效")
  dockerBody(await ubus(c, "docker.container", action, { id, query: {} }))
}
export async function loadFrp(c: Controller): Promise<FrpInfo> {
  const [rc, uci] = await Promise.all([ubus(c, "rc", "list", { name: "frpc" }), ubus(c, "uci", "get", { config: "frpc" })])
  const values: Record<string, any> = uci.values ?? {}, st = rc?.frpc ?? {}
  const proxies = Object.values(values).filter((v: any) => v?.[".type"] === "conf" && v.type && v.name && v[".name"] !== "common").map((v: any): FrpProxy => ({
    id: String(v[".name"]), name: String(v.name), type: String(v.type), local: `${v.local_ip ?? ""}:${v.local_port ?? ""}`, remote: String(v.remote_port ?? v.custom_domains ?? v.subdomain ?? ""),
  }))
  const common = values.common ?? {}
  return { running: !!st.running, enabled: !!st.enabled, server: common.server_addr ? `${common.server_addr}:${common.server_port ?? ""}` : "", proxies,
    common: { addr: String(common.server_addr ?? ""), port: String(common.server_port ?? ""), tls: common.tls_enable === "true" || common.tls_enable === "1", token: String(common.token ?? "") } }
}
export async function frpAction(c: Controller, action: "start" | "stop" | "restart") {
  await ubus(c, "rc", "init", { name: "frpc", action })
}

const okName = (v: string) => /^[A-Za-z0-9_.-]{1,40}$/.test(v)
const okHost = (v: string) => /^[A-Za-z0-9._:-]{1,253}$/.test(v)
const okPort = (v: string) => /^\d{1,5}$/.test(v) && +v >= 1 && +v <= 65535
async function uciCommit(c: Controller, config: string, steps: (() => Promise<any>)[]) {
  try { for (const f of steps) await f(); await ubus(c, "uci", "commit", { config }) }
  catch (e) { try { await ubus(c, "uci", "revert", { config }) } catch {} throw e }
}
export async function saveFrpCommon(c: Controller, v: { addr: string; port: string; tls: boolean; token?: string }) {
  if (!okHost(v.addr)) throw new Error("服务器地址无效"); if (!okPort(v.port)) throw new Error("服务器端口无效（1-65535）")
  const values: Record<string, string> = { server_addr: v.addr, server_port: v.port, tls_enable: v.tls ? "true" : "false" }
  if (v.token !== undefined && /^[\x21-\x7e]{0,128}$/.test(v.token)) { if (v.token) values.token = v.token } else if (v.token !== undefined) throw new Error("Token 含非法字符")
  await uciCommit(c, "frpc", [() => ubus(c, "uci", "set", { config: "frpc", section: "common", values })])
  await frpAction(c, "restart")
}
export async function saveFrpProxy(c: Controller, p: { id?: string; name: string; type: string; local_ip: string; local_port: string; remote_port: string }) {
  if (!okName(p.name)) throw new Error("规则名只能含字母数字._-"); if (!["tcp", "udp"].includes(p.type)) throw new Error("类型仅支持 tcp/udp")
  if (!okHost(p.local_ip)) throw new Error("本地 IP 无效"); if (!okPort(p.local_port) || !okPort(p.remote_port)) throw new Error("端口无效（1-65535）")
  const values = { name: p.name, type: p.type, local_ip: p.local_ip, local_port: p.local_port, remote_port: p.remote_port }
  await uciCommit(c, "frpc", [() => p.id ? ubus(c, "uci", "set", { config: "frpc", section: p.id, values }) : ubus(c, "uci", "add", { config: "frpc", type: "conf", values })])
  await frpAction(c, "restart")
}
export async function deleteFrpProxy(c: Controller, id: string) {
  if (!okName(id)) throw new Error("规则标识无效")
  await uciCommit(c, "frpc", [() => ubus(c, "uci", "delete", { config: "frpc", section: id })])
  await frpAction(c, "restart")
}
export async function loadDockerSettings(c: Controller): Promise<DockerSettings> {
  const v = (await ubus(c, "uci", "get", { config: "dockerd" })).values ?? {}, g = v.globals ?? {}, p = v.proxies ?? {}
  return { logLevel: String(g.log_level ?? ""), httpProxy: String(p.http_proxy ?? ""), httpsProxy: String(p.https_proxy ?? ""), noProxy: String(p.no_proxy ?? ""), dataRoot: String(g.data_root ?? "") }
}
export async function saveDockerSettings(c: Controller, s: { logLevel: string; httpProxy: string; httpsProxy: string; noProxy: string }) {
  if (!["debug", "info", "warn", "error", "fatal"].includes(s.logLevel)) throw new Error("日志级别无效")
  const url = (x: string) => x === "" || /^https?:\/\/[^\s'"`$;&|<>]+$/.test(x)
  if (!url(s.httpProxy) || !url(s.httpsProxy)) throw new Error("代理地址需为空或 http(s):// 开头且不含空格/特殊符号")
  if (!/^[A-Za-z0-9.,:/_-]*$/.test(s.noProxy)) throw new Error("no_proxy 含非法字符")
  const proxies: Record<string, string> = {}, drop: string[] = []
  for (const [k, v] of [["http_proxy", s.httpProxy], ["https_proxy", s.httpsProxy], ["no_proxy", s.noProxy]]) v ? proxies[k] = v : drop.push(k)
  const find = async (name: string) => (await ubus(c, "uci", "get", { config: "dockerd", section: name }).catch(() => null)) != null
  await uciCommit(c, "dockerd", [
    () => ubus(c, "uci", "set", { config: "dockerd", section: "globals", values: { log_level: s.logLevel } }),
    async () => { if (Object.keys(proxies).length) { if (await find("proxies")) await ubus(c, "uci", "set", { config: "dockerd", section: "proxies", values: proxies }); else await ubus(c, "uci", "add", { config: "dockerd", type: "proxies", name: "proxies", values: proxies }) } },
    async () => { if (drop.length && await find("proxies")) await ubus(c, "uci", "delete", { config: "dockerd", section: "proxies", options: drop }) },
  ])
  await ubus(c, "rc", "init", { name: "dockerd", action: "restart" })
}
export async function loadContainerPolicy(c: Controller, id: string): Promise<string> {
  if (!/^[0-9a-f]{12,64}$/.test(id)) throw new Error("容器标识无效")
  const b = dockerBody(await ubus(c, "docker.container", "inspect", { id, query: {} }))
  return String(b?.HostConfig?.RestartPolicy?.Name || "no")
}
export async function saveContainerPolicy(c: Controller, id: string, name: string) {
  if (!/^[0-9a-f]{12,64}$/.test(id)) throw new Error("容器标识无效")
  if (!["no", "always", "unless-stopped", "on-failure"].includes(name)) throw new Error("重启策略无效")
  dockerBody(await ubus(c, "docker.container", "update", { id, body: { RestartPolicy: { Name: name } } }))
}

export async function loadDockerOverview(c: Controller): Promise<DockerOverview> {
  const [info, ver, imgs] = await ubusBatch(c, [["docker", "info"], ["docker", "version"], ["docker.image", "list", { query: {} }]])
  const i = dockerBody(info), v = dockerBody(ver), im = imgs ? dockerBody(imgs) : []
  const mirrors = Array.isArray(i?.RegistryConfig?.Mirrors) ? i.RegistryConfig.Mirrors.map(String) : []
  return {
    version: String(v?.Version ?? i?.ServerVersion ?? ""), api: String(v?.ApiVersion ?? ""), threads: num(i?.NGoroutines), memTotal: num(i?.MemTotal),
    root: String(i?.DockerRootDir ?? ""), index: String(i?.IndexServerAddress ?? ""), mirrors, containers: num(i?.Containers), running: num(i?.ContainersRunning),
    images: Array.isArray(im) ? im.length : num(i?.Images),
  }
}

export async function loadContainerDetail(c: Controller, id: string): Promise<DockerContainerDetail> {
  if (!/^[0-9a-f]{12,64}$/.test(id)) throw new Error("容器标识无效")
  const b = dockerBody(await ubus(c, "docker.container", "inspect", { id, query: {} })) ?? {}
  const ports = Object.entries(b.NetworkSettings?.Ports ?? {}).map(([k, v]: [string, any]) => v?.[0]?.HostPort ? `${v[0].HostPort}→${k}` : k).join(", ")
  const cmd = [b.Path, ...(Array.isArray(b.Args) ? b.Args : [])].filter(Boolean).join(" ")
  return {
    id: String(b.Id ?? id), name: String(b.Name ?? "").replace(/^\//, ""), state: String(b.State?.Status ?? ""), image: String(b.Config?.Image ?? ""),
    network: String(b.HostConfig?.NetworkMode ?? ""), ports, command: cmd, created: Date.parse(b.Created) || 0, paused: !!b.State?.Paused, policy: String(b.HostConfig?.RestartPolicy?.Name || "no"),
  }
}
export async function dockerContainerOp(c: Controller, id: string, op: "pause" | "unpause" | "kill" | "remove" | "force-remove") {
  if (!/^[0-9a-f]{12,64}$/.test(id)) throw new Error("容器标识无效")
  if (op === "pause" || op === "unpause") dockerBody(await ubus(c, "docker.container", op, { id }))
  else if (op === "kill") dockerBody(await ubus(c, "docker.container", "kill", { id, query: {} }))
  else dockerBody(await ubus(c, "docker.container", "remove", { id, query: op === "force-remove" ? { force: "true" } : {} }))
}
export async function loadDockerImages(c: Controller): Promise<DockerImage[]> {
  const [imgs, ctrs] = await ubusBatch(c, [["docker.image", "list", { query: {} }], ["docker.container", "list", { query: { all: "true" } }]])
  const list = dockerBody(imgs), cs = ctrs ? dockerBody(ctrs) : []
  return (Array.isArray(list) ? list : []).map((x: any): DockerImage => ({
    id: String(x.Id ?? ""), tags: Array.isArray(x.RepoTags) ? x.RepoTags.map(String) : [], size: num(x.Size), created: num(x.Created) * 1000,
    containers: (Array.isArray(cs) ? cs : []).filter((k: any) => k.ImageID === x.Id).map((k: any) => String((k.Names?.[0] ?? "").replace(/^\//, ""))),
  })).filter(x => x.id)
}
export async function dockerImageRemove(c: Controller, id: string, force: boolean) {
  if (!/^sha256:[0-9a-f]{64}$/.test(id) && !/^[0-9a-f]{12,64}$/.test(id)) throw new Error("镜像标识无效")
  dockerBody(await ubus(c, "docker.image", "remove", { id, query: force ? { force: "true" } : {} }))
}

export interface Pkg { name: string; version: string; size: number; desc: string; installed: boolean; upgradeTo?: string }
const PKG = "/usr/libexec/package-manager-call"
const okPkg = (n: string) => /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(n)
async function pkgExec(c: Controller, args: string[], timeoutSec = 60): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let sid = sessions[c.id]?.sid
    if (!sid || sessions[c.id].auth !== overviewSource(c) || Date.now() - sessions[c.id].at > 50 * 60 * 1000) sid = await wrtLogin(c)
    const body = `sessionid=${enc(sid)}&command=${enc([PKG, ...args].join(" "))}&stderr=1`
    const r = await fetch(c.url + "/cgi-bin/cgi-exec", {
      method: "POST", headers: { ...customHeaders(), "Content-Type": "application/x-www-form-urlencoded" }, body, allowInsecureRequest: true, timeout: timeoutSec,
    } as any)
    if (r.status === 403 && attempt === 0) { delete sessions[c.id]; continue }
    if (r.status === 403) throw new Error("没有权限执行软件包命令")
    if (!r.ok) throw new Error(`请求失败 HTTP ${r.status}`)
    return await r.text()
  }
  throw new Error("请求失败")
}
function parsePkgs(text: string, installed: boolean): Pkg[] {
  let arr: any[]
  try { arr = JSON.parse(text) } catch { throw new Error("软件包列表格式无法识别") }
  return (Array.isArray(arr) ? arr : []).map((x: any): Pkg => ({
    name: String(x.name ?? ""), version: String(x.version ?? ""), size: num(installed ? x["installed-size"] : x["file-size"]),
    desc: String(x.description ?? "").slice(0, 400), installed,
  })).filter(x => x.name)
}
export async function loadInstalledPkgs(c: Controller): Promise<Pkg[]> {
  const list = parsePkgs(await pkgExec(c, ["list-installed"], 90), true)
  list.sort((a, b) => a.name.localeCompare(b.name))
  return list
}
let availableCache: Record<string, { at: number; list: Pkg[] }> = {}
export async function loadAvailablePkgs(c: Controller, force = false): Promise<Pkg[]> {
  const key=overviewSource(c), hit = availableCache[key]
  if (!force && hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.list
  const list = parsePkgs(await pkgExec(c, ["list-available"], 120), false)
  list.sort((a, b) => a.name.localeCompare(b.name))
  if(overviewSource(c)!==key)throw new Error("来源或读取代次已改变")
  availableCache[key] = { at: Date.now(), list }
  return list
}
export function upgradablePkgs(installed: Pkg[], available: Pkg[]): Pkg[] {
  const av = new Map(available.map(p => [p.name, p.version]))
  return installed.filter(p => { const v = av.get(p.name); return !!v && v !== p.version }).map(p => ({ ...p, upgradeTo: av.get(p.name) }))
}
export function filterPkgs(list: Pkg[], q: string, limit = 100, offset = 0): { items: Pkg[]; total: number } {
  const k = q.trim().toLowerCase()
  const hit = k ? list.filter(p => p.name.toLowerCase().includes(k) || p.desc.toLowerCase().includes(k)) : list
  return { items: hit.slice(offset, offset + limit), total: hit.length }
}
export interface PkgResult { code: number; out: string }
async function pkgOp(c: Controller, args: string[]): Promise<PkgResult> {
  const text = await pkgExec(c, args, 300)
  try { const j = JSON.parse(text); return { code: num(j.code), out: [j.stdout, j.stderr].filter(Boolean).join("\n").slice(0, 3000) } }
  catch { return { code: 255, out: text.slice(0, 500) } }
}
export async function pkgUpdateLists(c: Controller) { delete availableCache[overviewSource(c)]; return pkgOp(c, ["update"]) }
export async function pkgInstall(c: Controller, names: string[]) { if (!names.length || !names.every(okPkg)) throw new Error("软件包名称无效"); delete availableCache[overviewSource(c)]; return pkgOp(c, ["install", ...names]) }
export async function pkgRemove(c: Controller, names: string[]) { if (!names.length || !names.every(okPkg)) throw new Error("软件包名称无效"); return pkgOp(c, ["remove", ...names]) }
export async function pkgUpgrade(c: Controller, names: string[]) { if (!names.length || !names.every(okPkg)) throw new Error("软件包名称无效"); delete availableCache[overviewSource(c)]; return pkgOp(c, ["upgrade", ...names]) }

export async function loadDiskUsage(c: Controller): Promise<DiskUsage | null> {
  return mountUsage(await ubus(c,"luci","getMountPoints"))
}
