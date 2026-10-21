
import { getPreferences, customHeaders, recordEvent, controllerHealth, feedback } from "./preferences"
export const VERSION = "1.5.71"

export type Kind = "clash" | "openwrt"
export type Plugin = "openclash" | "nikki" | "mihomo"
export const PLUGINS: [Plugin, string][] = [["openclash", "OpenClash"], ["nikki", "Nikki"], ["mihomo", "MihomoTProxy"]]
export interface Controller {
  id: string; name: string; kind: Kind; url: string; username?: string
  host?: string; port?: number; https?: boolean; plugin?: Plugin; auto?: boolean; cport?: number
}
export interface ControllerInput { id?: string; name: string; host: string; port: number; https: boolean; username: string; plugin: Plugin; auto: boolean; cport: number }
export interface Group { name: string; type: string; now: string; all: string[]; delays: Record<string, number>; hidden?: boolean; icon?: string }
export interface Conn { id: string; host: string; src: string; dst: string; network: string; rule: string; chain: string; up: number; down: number; start: number; upSpeed?: number; downSpeed?: number; sourceIP?: string; inboundType?: string; chains?: string[]; closedAt?: number }
export interface Rule { type: string; payload: string; proxy: string }
export interface Traffic { up: number; down: number; upTotal?: number; downTotal?: number }
export interface WrtInfo { model: string; release: string; uptime: number; load: number[]; memTotal: number; memFree: number; wan: string; target?: string; kernel?: string; cpu?: number }
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

async function http(c: Controller, path: string, init: { method?: string; body?: any; timeout?: number } = {}): Promise<any> {
  const secret = getSecret(c.id)
  const headers: Record<string, string> = customHeaders()
  if (init.body !== undefined) headers["Content-Type"] = "application/json"
  if (secret) headers["Authorization"] = "Bearer " + secret
  const r = await apiFetch(c.url + path, {
    method: init.method ?? "GET", headers, allowInsecureRequest: true, timeout: init.timeout ?? getPreferences().requestTimeout,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  } as any, path)
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) throw new Error("认证失败，请检查密钥")
    if (r.status === 404) throw new Error("HTTP 404：该地址不是 Clash 控制器接口，请检查端口（通常是 9090）")
    throw new Error(`请求失败 HTTP ${r.status}`)
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

const NULL_SID = "00000000000000000000000000000000"
const sessions: Record<string, { sid: string; at: number }> = {}
async function ubusRaw(c: Controller, sid: string, obj: string, method: string, params: any): Promise<any> {
  try { return await ubusRequest(c, sid, obj, method, params) }
  catch (e) { recordEvent("ubus", false); throw e }
}
async function ubusRequest(c: Controller, sid: string, obj: string, method: string, params: any): Promise<any> {
  const r = await fetch(c.url + "/ubus", {
    method: "POST", headers: { ...customHeaders(), "Content-Type": "application/json" }, allowInsecureRequest: true, timeout: getPreferences().requestTimeout,
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
  if (loginPending[c.id]) return loginPending[c.id]!
  const p = wrtLoginOnce(c)
  loginPending[c.id] = p
  try { return await p } finally { if (loginPending[c.id] === p) delete loginPending[c.id] }
}
async function wrtLoginOnce(c: Controller): Promise<string> {
  const user = c.username || "root"
  try {
    const r = await ubusRaw(c, NULL_SID, "session", "login", { username: user, password: getSecret(c.id), timeout: 3600 })
    const sid = r.ubus_rpc_session
    if (!sid) throw new Error("登录失败")
    recordEvent("login", true)
    sessions[c.id] = { sid, at: Date.now() }
    return sid
  } catch (e: any) {
    recordEvent("login", false)
    if (String(e?.message) === "ACCESS") throw new Error("登录失败，请检查用户名和密码")
    throw e
  }
}
async function ubus(c: Controller, obj: string, method: string, params: any = {}): Promise<any> {
  let sid = sessions[c.id]?.sid
  if (!sid || Date.now() - sessions[c.id].at > 50 * 60 * 1000) sid = await wrtLogin(c)
  try { return await ubusRaw(c, sid, obj, method, params) } catch (e: any) {
    if (String(e?.message) !== "ACCESS") throw e
    sid = await wrtLogin(c)
    try { return await ubusRaw(c, sid, obj, method, params) } catch (e2: any) {
      throw new Error(String(e2?.message) === "ACCESS" ? "没有权限访问 " + obj + "." + method : e2.message)
    }
  }
}

type UbusCall = [string, string, any?]
async function ubusBatchRaw(c: Controller, sid: string, calls: UbusCall[]): Promise<any[]> {
  const r = await fetch(c.url + "/ubus", {
    method: "POST", headers: { ...customHeaders(), "Content-Type": "application/json" }, allowInsecureRequest: true, timeout: getPreferences().requestTimeout,
    body: JSON.stringify(calls.map((x, i) => ({ jsonrpc: "2.0", id: i + 1, method: "call", params: [sid, x[0], x[1], x[2] ?? {}] }))),
  } as any)
  if (!r.ok) throw new Error(`请求失败 HTTP ${r.status}`)
  let j: any
  try { j = JSON.parse(await r.text()) } catch { throw new Error("返回内容不是 ubus 接口") }
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
async function ubusBatch(c: Controller, calls: UbusCall[]): Promise<any[]> {
  let sid = sessions[c.id]?.sid
  if (!sid || Date.now() - sessions[c.id].at > 50 * 60 * 1000) sid = await wrtLogin(c)
  try { return await ubusBatchRaw(c, sid, calls) } catch (e: any) {
    if (String(e?.message) !== "ACCESS") throw e
    return await ubusBatchRaw(c, await wrtLogin(c), calls)
  }
}
function pickWan(dump: any): { name: string; device: string } {
  const list: any[] = dump?.interface ?? []
  const hasDefault = (i: any) => (i.route ?? []).some((r: any) => r.target === "0.0.0.0" || r.target === "::")
  const w = list.find(hasDefault) ?? list.find(i => i.interface === "wan") ?? list.find(i => i.interface !== "loopback" && i.up)
  return { name: String(w?.interface ?? ""), device: String(w?.l3_device ?? w?.device ?? "") }
}
let lastCpu: Record<string, { total: number; idle: number }> = {}

function cpuPercent(id: string, raw: any): number | undefined {
  const line = String(raw?.data ?? "").split("\n").find(l => /^cpu\s/.test(l))
  if (!line) return undefined
  const v = line.trim().split(/\s+/).slice(1).map(Number)
  if (v.length < 4 || v.some(x => !Number.isFinite(x))) return undefined
  const idle = v[3] + (v[4] ?? 0), total = v.slice(0, 8).reduce((a, b) => a + b, 0), prev = lastCpu[id]
  lastCpu[id] = { total, idle }
  if (!prev || total <= prev.total) return undefined
  return Math.max(0, Math.min(100, (1 - (idle - prev.idle) / (total - prev.total)) * 100))
}
const MAX_RATE = 1.25e9
const slowCache: Record<string, { at: number; board: any; dump: any }> = {}
async function wrtOverview(c: Controller): Promise<Overview> {

  const cached = slowCache[c.id], stale = !cached || Date.now() - cached.at > 60000
  const calls: UbusCall[] = [
    ["system", "info"], ["network.device", "status"], ["file", "read", { path: "/proc/stat" }], ["file", "read", { path: "/proc/sys/net/netfilter/nf_conntrack_count" }],
    ...(stale ? [["system", "board"], ["network.interface", "dump"]] as UbusCall[] : []),
  ]
  const r = await ubusBatch(c, calls)
  const info = r[0], devs = r[1] ?? {}, stat = r[2] ?? {}, ct = r[3] ?? {}
  if (!info) throw new Error("路由器未返回系统信息")
  if (stale) {
    if (!r[4] && !cached) throw new Error("路由器未返回系统信息")
    slowCache[c.id] = { at: Date.now(), board: r[4] ?? cached?.board ?? {}, dump: r[5] ?? cached?.dump ?? {} }
  }
  const board = slowCache[c.id].board, dump = slowCache[c.id].dump
  const wan = pickWan(dump)
  const st = devs?.[wan.device]?.statistics ?? {}
  const rx = num(st.rx_bytes), tx = num(st.tx_bytes), now = Date.now()
  const key = "neko_prev_" + c.id
  const prev = Storage.get<{ t: number; rx: number; tx: number; up?: number; down?: number }>(key)
  let up = 0, down = 0, keep = false
  if (prev && now > prev.t && rx >= prev.rx && tx >= prev.tx && now - prev.t < 10 * 60 * 1000) {
    const dt = (now - prev.t) / 1000
    if (dt < 0.5) { up = prev.up ?? 0; down = prev.down ?? 0; keep = true }
    else {
      down = (rx - prev.rx) / dt; up = (tx - prev.tx) / dt
      if (down > MAX_RATE || up > MAX_RATE) { up = prev.up ?? 0; down = prev.down ?? 0 }
    }
  }
  if (!keep) Storage.set(key, { t: now, rx, tx, up, down })
  return {
    version: String(board.release?.description ?? ""), mode: "", traffic: { up, down }, upTotal: tx, downTotal: rx,
    connCount: parseInt(String(ct.data ?? "0"), 10) || 0,
    wrt: { model: String(board.model ?? board.hostname ?? ""), release: String(board.release?.description ?? ""), uptime: num(info.uptime),
      load: (info.load ?? []).map((v: number) => num(v) / 65536), memTotal: num(info.memory?.total), memFree: num(info.memory?.available ?? info.memory?.free), wan: wan.name,
      target: board.release?.target ? String(board.release.target) : undefined, kernel: board.kernel ? String(board.kernel) : undefined, cpu: cpuPercent(c.id, stat) },
  }
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
    const o = c.kind === "openwrt" ? await wrtOverview(c) : await loadClashOverview(c)
    controllerHealth[c.id] = true; return o
  } catch (e) { controllerHealth[c.id] = false; throw e }
}
export async function loadClashOverview(c0: Controller): Promise<Overview> {
  const c = await cc(c0)
  {
    const [ver, cfg, conns] = await Promise.all([
      http(c, "/version").catch(() => ({})), http(c, "/configs"), http(c, "/connections"),
    ])
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

export async function loadGroups(c0: Controller): Promise<Group[]> {
  const c = await cc(c0)
  {
    const j = await http(c, "/proxies")
    const all: Record<string, any> = j.proxies ?? {}
    const order: string[] = all.GLOBAL?.all ?? Object.keys(all)
    const names = [...order.filter(n => all[n]?.all), ...Object.keys(all).filter(n => all[n]?.all && !order.includes(n))]
    const prefs = getPreferences()
    function delayOf(name: string, seen = new Set<string>()): number | undefined {
      if (seen.has(name)) return undefined
      seen.add(name)
      const node = all[name]
      if (prefs.nestedDelay && node?.all && node?.now) return delayOf(node.now, seen)
      const h = node?.history
      return h?.length ? num(h[h.length - 1].delay) : undefined
    }
    return names.filter(n => (n !== "GLOBAL" || prefs.showGlobal) && (prefs.showHidden || !all[n]?.hidden)).map(n => {
      const g = all[n]; const delays: Record<string, number> = {}
      for (const m of g.all as string[]) { const delay = delayOf(m); if (delay !== undefined) delays[m] = delay }
      return { name: n, type: String(g.type ?? ""), now: String(g.now ?? ""), all: g.all, delays, hidden: !!g.hidden, icon: typeof g.icon === "string" ? g.icon : undefined }
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

export async function testGroup(c0: Controller, g: Group): Promise<Record<string, number>> {
  const c = await cc(c0)
  const res: Record<string, number> = {}
  const prefs = getPreferences(), testURL = prefs.testURL, timeout = prefs.testTimeout
  {
    try {
      const j = await http(c, `/group/${enc(g.name)}/delay?url=${enc(testURL)}&timeout=${timeout}`, { timeout: Math.ceil(timeout / 1000) + 2 })
      for (const [k, v] of Object.entries<any>(j)) res[k] = num(v)
      recordEvent("test", Object.values(res).some(v => v > 0))
      return res
    } catch { recordEvent("fallback", false, { warning: true })  }
    const queue = [...g.all]
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const n = queue.shift()!
        try { const j = await http(c, `/proxies/${enc(n)}/delay?url=${enc(testURL)}&timeout=${timeout}`, { timeout: Math.ceil(timeout / 1000) + 2 }); res[n] = num(j.delay) } catch { res[n] = 0 }
      }
    }))
    recordEvent("test", Object.values(res).some(v => v > 0))
    return res
  }
  return res
}

export async function loadConnections(c0: Controller): Promise<Conn[]> {
  const c = await cc(c0)
  if (c.kind === "clash") {
    const j = await http(c, "/connections")
    return (j.connections ?? []).map((x: any): Conn => {
      const m = x.metadata ?? {}
      return {
        sourceIP: String(m.sourceIP ?? ""), inboundType: String(m.type ?? ""), chains: (x.chains ?? []).slice().reverse().map(String),
        id: String(x.id), host: String(m.host || m.destinationIP || "-"), src: `${m.sourceIP ?? ""}${m.sourcePort ? ":" + m.sourcePort : ""}`,
        dst: `${m.destinationIP ?? ""}${m.destinationPort ? ":" + m.destinationPort : ""}`, network: String(m.network ?? "").toUpperCase(),
        rule: [x.rule, x.rulePayload].filter(Boolean).join(" · "), chain: (x.chains ?? []).slice().reverse().join(" → "),
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
    return (j.rules ?? []).map((r: any) => ({ type: String(r.type), payload: String(r.payload ?? ""), proxy: String(r.proxy ?? "") }))
  }
}

export interface ClashConfig { mode?: string; "log-level"?: string; port?: number; "socks-port"?: number; "mixed-port"?: number; "allow-lan"?: boolean }
export async function loadConfig(c: Controller): Promise<ClashConfig> { return await http(await cc(c), "/configs") }
export function validateConfigPatch(patch: Partial<ClashConfig>): Partial<ClashConfig> {
  const out: any = {}
  for (const [k, v] of Object.entries(patch)) {
    if (["port", "socks-port", "mixed-port"].includes(k)) {
      if (!Number.isInteger(v) || Number(v) < 0 || Number(v) > 65535) throw new Error("端口须为 0–65535 的整数")
    } else if (k === "allow-lan") { if (typeof v !== "boolean") throw new Error("局域网开关无效") }
    else if (k === "log-level") { if (!LOG_LEVELS.includes(String(v))) throw new Error("日志级别无效") }
    else if (k === "mode") { if (!CLASH_MODES.some(x => x[0] === v)) throw new Error("模式无效") }
    else throw new Error("不支持修改该配置字段")
    out[k] = v
  }
  if (!Object.keys(out).length) throw new Error("没有待保存的配置")
  return out
}
export async function patchConfig(c: Controller, patch: Partial<ClashConfig>) {
  const body = validateConfigPatch(patch)
  try { await http(await cc(c), "/configs", { method: "PATCH", body }); recordEvent("config", true) }
  catch (e) { recordEvent("config", false); throw e }
}
export const LOG_LEVELS = ["silent", "error", "warning", "info", "debug"]

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
export async function nikkiService(c: Controller, action: "start"|"stop"|"restart"|"reload") { requireNikki(c); if (!["start","stop","restart","reload"].includes(action)) throw new Error("不支持的服务动作"); await ubus(c,"rc","init",{name:"nikki",action}) }
export type CoreAction = "restart"|"reload"|"geo"|"dns"|"fakeip"
export async function coreAction(c: Controller, action: CoreAction) {
  const paths = { restart: ["POST","/restart"], reload: ["PUT","/configs?force=true"], geo: ["POST","/configs/geo"], dns: ["POST","/cache/dns/flush"], fakeip: ["POST","/cache/fakeip/flush"] }
  const entry = paths[action]; if (!entry) throw new Error("不支持的核心动作")
  await http(await cc(c),entry[1],{method:entry[0], ...(action === "reload" ? {body:{}} : {})})
}
export async function queryDNS(c: Controller, name: string, type: string) {
  if (!/^(?=.{1,253}\.?$)[a-z0-9_*-]+(?:\.[a-z0-9_-]+)*\.?$/i.test(name) || !["A","AAAA","CNAME","TXT","MX","HTTPS"].includes(type)) throw new Error("域名或查询类型无效")
  const j = await http(await cc(c),`/dns/query?name=${enc(name)}&type=${enc(type)}`)
  return { status: num(j.Status), answers: (j.Answer ?? []).map((x:any) => ({ data:String(x.data ?? ""), type:num(x.type), ttl:num(x.TTL) })) }
}
export interface NikkiSubscription { id: string; name: string; updated: string; used: string; total: string; expire: string }
export interface NikkiManagement { profile: string; files: {name:string; size:number}[]; subscriptions: NikkiSubscription[]; rules: {id:string; type:string; matcher:string; node:string; enabled:boolean}[]; appendRules: boolean }
export async function loadNikkiManagement(c: Controller): Promise<NikkiManagement> {
  requireNikki(c)
  const [j,files] = await Promise.all([ubus(c,"uci","get",{config:"nikki"}),ubus(c,"file","list",{path:"/etc/nikki/profiles"})])
  const vs: any[] = Object.values(j.values ?? {})
  return { profile:String(j.values?.config?.profile ?? "未提供"), appendRules: j.values?.mixin?.rule === "1",
    files:(files.entries ?? []).filter((x:any)=>x.type === "file" && /^[^/]+\.ya?ml$/i.test(x.name)).map((x:any)=>({name:String(x.name),size:num(x.size)})),
    subscriptions:vs.filter(x=>x[".type"] === "subscription").map(x=>({id:String(x[".name"]),name:String(x.name || x[".name"]),updated:String(x.update || "未提供"),used:String(x.used || "未提供"),total:String(x.total || "未提供"),expire:String(x.expire || "未提供")})),
    rules:vs.filter(x=>x[".type"] === "rule").map(x=>({id:String(x[".name"]),type:String(x.type??""),matcher:String(x.matcher??""),node:String(x.node??""),enabled:x.enabled === "1"})) }
}
export async function updateNikkiSubscription(c: Controller, id: string) { requireNikki(c); if (!/^[a-zA-Z0-9_]+$/.test(id)) throw new Error("订阅标识无效"); const j = await ubus(c,"luci.nikki","update_subscription",{section_id:id}); if (j.success !== true) throw new Error("Nikki报告订阅更新失败") }
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
    if (!sid || Date.now() - sessions[c.id].at > 50 * 60 * 1000) sid = await wrtLogin(c)
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
  const hit = availableCache[c.id]
  if (!force && hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.list
  const list = parsePkgs(await pkgExec(c, ["list-available"], 120), false)
  list.sort((a, b) => a.name.localeCompare(b.name))
  availableCache[c.id] = { at: Date.now(), list }
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
export async function pkgUpdateLists(c: Controller) { delete availableCache[c.id]; return pkgOp(c, ["update"]) }
export async function pkgInstall(c: Controller, names: string[]) { if (!names.length || !names.every(okPkg)) throw new Error("软件包名称无效"); delete availableCache[c.id]; return pkgOp(c, ["install", ...names]) }
export async function pkgRemove(c: Controller, names: string[]) { if (!names.length || !names.every(okPkg)) throw new Error("软件包名称无效"); return pkgOp(c, ["remove", ...names]) }
export async function pkgUpgrade(c: Controller, names: string[]) { if (!names.length || !names.every(okPkg)) throw new Error("软件包名称无效"); delete availableCache[c.id]; return pkgOp(c, ["upgrade", ...names]) }

export async function loadDiskUsage(c: Controller): Promise<{ size: number; used: number; avail: number } | null> {
  const r = await ubus(c, "luci", "getMountPoints")
  const list: any[] = r?.result ?? []
  const m = list.find(x => x.mount === "/overlay") ?? list.find(x => x.mount === "/")
  return m ? { size: num(m.size), used: num(m.size) - num(m.avail), avail: num(m.avail) } : null
}
