// dashboard 数据层：Clash 外部控制 API 与 OpenWrt（LuCI ubus JSON-RPC）
import { getPreferences, customHeaders, recordEvent, controllerHealth, feedback } from "./preferences"
export const VERSION = "1.4.1"

export type Kind = "clash" | "openwrt"
export type Plugin = "openclash" | "nikki" | "mihomo"
export const PLUGINS: [Plugin, string][] = [["openclash", "OpenClash"], ["nikki", "Nikki"], ["mihomo", "MihomoTProxy"]]
export interface Controller {
  id: string; name: string; kind: Kind; url: string; username?: string
  host?: string; port?: number; https?: boolean; plugin?: Plugin; auto?: boolean; cport?: number
}
export interface ControllerInput { id?: string; name: string; host: string; port: number; https: boolean; username: string; plugin: Plugin; auto: boolean; cport: number }
export interface Group { name: string; type: string; now: string; all: string[]; delays: Record<string, number>; hidden?: boolean; icon?: string }
export interface Conn { id: string; host: string; src: string; dst: string; network: string; rule: string; chain: string; up: number; down: number; start: number; upSpeed?: number; downSpeed?: number }
export interface Rule { type: string; payload: string; proxy: string }
export interface Traffic { up: number; down: number; upTotal?: number; downTotal?: number }
export interface WrtInfo { model: string; release: string; uptime: number; load: number[]; memTotal: number; memFree: number; wan: string }
export interface Overview { version: string; mode: string; traffic: Traffic; upTotal: number; downTotal: number; connCount: number; wrt?: WrtInfo; mem?: number }
export interface WrtIface { name: string; proto: string; up: boolean; ip: string; device: string; uptime: number }
export interface WrtLease { host: string; ip: string; mac: string; expires: number }

const K_LIST = "neko_controllers_v1"
const K_ACTIVE = "neko_active_v1"

// ---------- 控制器存储：地址/名称在 Storage，密钥在 Keychain ----------
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

// ---------- HTTP ----------
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

// ---------- OpenWrt：LuCI ubus JSON-RPC ----------
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
function pickWan(dump: any): { name: string; device: string } {
  const list: any[] = dump?.interface ?? []
  const hasDefault = (i: any) => (i.route ?? []).some((r: any) => r.target === "0.0.0.0" || r.target === "::")
  const w = list.find(hasDefault) ?? list.find(i => i.interface === "wan") ?? list.find(i => i.interface !== "loopback" && i.up)
  return { name: String(w?.interface ?? ""), device: String(w?.l3_device ?? w?.device ?? "") }
}
async function wrtOverview(c: Controller): Promise<Overview> {
  const [board, info, dump, devs, ct] = await Promise.all([
    ubus(c, "system", "board"), ubus(c, "system", "info"), ubus(c, "network.interface", "dump").catch(() => ({})),
    ubus(c, "network.device", "status").catch(() => ({})), ubus(c, "file", "read", { path: "/proc/sys/net/netfilter/nf_conntrack_count" }).catch(() => ({})),
  ])
  const wan = pickWan(dump)
  const st = devs?.[wan.device]?.statistics ?? {}
  const rx = num(st.rx_bytes), tx = num(st.tx_bytes), now = Date.now()
  const key = "neko_prev_" + c.id
  const prev = Storage.get<{ t: number; rx: number; tx: number }>(key)
  let up = 0, down = 0
  if (prev && now > prev.t && rx >= prev.rx && tx >= prev.tx && now - prev.t < 10 * 60 * 1000) {
    const dt = (now - prev.t) / 1000; down = (rx - prev.rx) / dt; up = (tx - prev.tx) / dt
  }
  Storage.set(key, { t: now, rx, tx })
  return {
    version: String(board.release?.description ?? ""), mode: "", traffic: { up, down }, upTotal: tx, downTotal: rx,
    connCount: parseInt(String(ct.data ?? "0"), 10) || 0,
    wrt: { model: String(board.model ?? board.hostname ?? ""), release: String(board.release?.description ?? ""), uptime: num(info.uptime),
      load: (info.load ?? []).map((v: number) => num(v) / 65536), memTotal: num(info.memory?.total), memFree: num(info.memory?.available ?? info.memory?.free), wan: wan.name },
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

// ---------- 自动获取 Clash 控制器（通过 ubus uci 读取插件配置）----------
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
// Mihomo 的 traffic/memory 同时支持 HTTP NDJSON。使用带认证头的原生 HTTP 流，
// 避免 WebSocket 失败被吞掉后显示假 0；connections 使用有限频率的 HTTP 快照。
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

// ---------- 概览 ----------
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

// ---------- 模式 ----------
export const CLASH_MODES = [["rule", "规则"], ["global", "全局"], ["direct", "直连"]]
export const modesOf = (_k: Kind) => CLASH_MODES
export async function setMode(c: Controller, mode: string) { await patchConfig(c, { mode }); feedback() }

// ---------- 策略组 ----------
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
    return names.filter(n => (n !== "GLOBAL" || prefs.showGlobal || order.includes("GLOBAL")) && (prefs.showHidden || !all[n]?.hidden)).map(n => {
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
// 测速整组，返回 节点→毫秒（0 表示超时/失败）
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
    } catch { recordEvent("fallback", false, { warning: true }) /* 非策略组端点或旧内核：逐个测 */ }
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

// ---------- 连接 ----------
export async function loadConnections(c0: Controller): Promise<Conn[]> {
  const c = await cc(c0)
  if (c.kind === "clash") {
    const j = await http(c, "/connections")
    return (j.connections ?? []).map((x: any): Conn => {
      const m = x.metadata ?? {}
      return {
        id: String(x.id), host: String(m.host || m.destinationIP || "-"), src: `${m.sourceIP ?? ""}${m.sourcePort ? ":" + m.sourcePort : ""}`,
        dst: `${m.destinationIP ?? ""}${m.destinationPort ? ":" + m.destinationPort : ""}`, network: String(m.network ?? "").toUpperCase(),
        rule: [x.rule, x.rulePayload].filter(Boolean).join(" · "), chain: (x.chains ?? []).slice().reverse().join(" → "),
        up: num(x.upload), down: num(x.download), start: Date.parse(x.start) || 0,
      }
    })
  }
}
export async function closeConnection(c: Controller, id: string) { await http(await cc(c), "/connections/" + enc(id), { method: "DELETE" }) }
export async function closeAllConnections(c: Controller) {
  await http(await cc(c), "/connections", { method: "DELETE" })
}

// ---------- 规则 ----------
export async function loadRules(c0: Controller): Promise<Rule[]> {
  const c = await cc(c0)
  {
    const j = await http(c, "/rules")
    return (j.rules ?? []).map((r: any) => ({ type: String(r.type), payload: String(r.payload ?? ""), proxy: String(r.proxy ?? "") }))
  }
}

// ---------- 配置（仅 Clash） ----------
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

// ---------- 格式化 ----------
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
// 拆成 [数值, 单位]，用于大号数字 + 小号单位的显示
export function fmtParts(n: number, perSec = false): [string, string] {
  const v = Math.max(0, n || 0)
  const u = ["B", "KB", "MB", "GB", "TB"]
  let i = perSec ? 1 : 0, x = perSec ? v / 1024 : v
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i++ }
  return [i === 0 ? x.toFixed(0) : x.toFixed(perSec && i === 1 ? 1 : 2), u[i] + (perSec ? "/s" : "")]
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

