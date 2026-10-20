// dashboard 数据层：Clash 外部控制 API 与 OpenWrt（LuCI ubus JSON-RPC）
export const VERSION = "1.1.0"

export type Kind = "clash" | "openwrt"
export interface Controller { id: string; name: string; kind: Kind; url: string; username?: string }
export interface Group { name: string; type: string; now: string; all: string[]; delays: Record<string, number> }
export interface Conn { id: string; host: string; src: string; dst: string; network: string; rule: string; chain: string; up: number; down: number; start: number; upSpeed?: number; downSpeed?: number }
export interface Rule { type: string; payload: string; proxy: string }
export interface Traffic { up: number; down: number }
export interface WrtInfo { model: string; release: string; uptime: number; load: number[]; memTotal: number; memFree: number; wan: string }
export interface Overview { version: string; mode: string; traffic: Traffic; upTotal: number; downTotal: number; connCount: number; wrt?: WrtInfo }
export interface WrtIface { name: string; proto: string; up: boolean; ip: string; device: string; uptime: number }
export interface WrtLease { host: string; ip: string; mac: string; expires: number }

const K_LIST = "neko_controllers_v1"
const K_ACTIVE = "neko_active_v1"
const K_REFRESH = "neko_refresh_min_v1"
const K_CACHE = "neko_cache_v1"
const TEST_URL = "http://www.gstatic.com/generate_204"

// ---------- 控制器存储：地址/名称在 Storage，密钥在 Keychain ----------
export function listControllers(): Controller[] { return (Storage.get<Controller[]>(K_LIST) ?? []).filter(c => c.kind === "clash" || c.kind === "openwrt") }
function saveList(l: Controller[]) { Storage.set(K_LIST, l) }
export function getSecret(id: string): string { return Keychain.get("neko_secret_" + id) ?? "" }
export function normalizeUrl(u: string): string {
  let s = u.trim().replace(/\/+$/, "")
  if (s && !/^https?:\/\//i.test(s)) s = "http://" + s
  return s
}
export function saveController(c: Omit<Controller, "id"> & { id?: string }, secret: string): Controller {
  const url = normalizeUrl(c.url)
  if (!url) throw new Error("请填写控制器地址")
  const id = c.id ?? Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const item: Controller = { id, name: c.name.trim() || url.replace(/^https?:\/\//, ""), kind: c.kind, url, username: c.kind === "openwrt" ? (c.username?.trim() || "root") : undefined }
  const l = listControllers()
  const i = l.findIndex(x => x.id === id)
  if (i >= 0) l[i] = item; else l.push(item)
  saveList(l)
  Keychain.set("neko_secret_" + id, secret.trim())
  if (!getActive()) setActive(id)
  return item
}
export function removeController(id: string) {
  saveList(listControllers().filter(c => c.id !== id))
  Keychain.remove("neko_secret_" + id)
  Storage.remove(K_CACHE + id)
  if (Storage.get<string>(K_ACTIVE) === id) Storage.remove(K_ACTIVE)
}
export function getActive(): Controller | null {
  const l = listControllers(); const id = Storage.get<string>(K_ACTIVE)
  return l.find(c => c.id === id) ?? l[0] ?? null
}
export function setActive(id: string) { Storage.set(K_ACTIVE, id) }
export function getRefreshMinutes(): number { const m = Storage.get<number>(K_REFRESH); return m && m >= 5 ? m : 15 }
export function saveRefreshMinutes(m: number) { Storage.set(K_REFRESH, m) }
export const REFRESH_OPTIONS = [5, 15, 30, 60]

// ---------- HTTP ----------
async function http(c: Controller, path: string, init: { method?: string; body?: any; timeout?: number } = {}): Promise<any> {
  const secret = getSecret(c.id)
  const headers: Record<string, string> = {}
  if (init.body !== undefined) headers["Content-Type"] = "application/json"
  if (secret) headers["Authorization"] = "Bearer " + secret
  const r = await fetch(c.url + path, {
    method: init.method ?? "GET", headers, allowInsecureRequest: true, timeout: init.timeout ?? 8,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  } as any)
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) throw new Error("认证失败，请检查密钥")
    if (r.status === 404) throw new Error("HTTP 404：该地址不是 Clash 控制器接口，请检查端口（通常是 9090）")
    throw new Error(`请求失败 HTTP ${r.status}`)
  }
  const text = await r.text()
  if (!text) return {}
  try { return JSON.parse(text) } catch { return {} }
}
const enc = encodeURIComponent
const num = (v: any) => typeof v === "number" && Number.isFinite(v) ? v : 0

// ---------- OpenWrt：LuCI ubus JSON-RPC ----------
const NULL_SID = "00000000000000000000000000000000"
const sessions: Record<string, { sid: string; at: number }> = {}
async function ubusRaw(c: Controller, sid: string, obj: string, method: string, params: any): Promise<any> {
  const r = await fetch(c.url + "/ubus", {
    method: "POST", headers: { "Content-Type": "application/json" }, allowInsecureRequest: true, timeout: 10,
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
  return res[1] ?? {}
}
async function wrtLogin(c: Controller): Promise<string> {
  const user = c.username || "root"
  try {
    const r = await ubusRaw(c, NULL_SID, "session", "login", { username: user, password: getSecret(c.id), timeout: 3600 })
    const sid = r.ubus_rpc_session
    if (!sid) throw new Error("登录失败")
    sessions[c.id] = { sid, at: Date.now() }
    return sid
  } catch (e: any) {
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

function wsUrl(c: Controller, path: string): string {
  const s = getSecret(c.id)
  const base = c.url.replace(/^http/i, "ws")
  return base + path + (s ? (path.includes("?") ? "&" : "?") + "token=" + enc(s) : "")
}
// 读取 Clash /traffic 的第一条消息（B/s）
function clashTrafficOnce(c: Controller, timeoutMs = 3000): Promise<Traffic | null> {
  return new Promise(resolve => {
    let done = false, ws: WebSocket | null = null
    const finish = (t: Traffic | null) => { if (done) return; done = true; try { ws?.close(1000) } catch { } resolve(t) }
    try {
      ws = new WebSocket(wsUrl(c, "/traffic"))
      ws.addEventListener("message", (m: any) => {
        try { const j = JSON.parse(typeof m === "string" ? m : String(m)); finish({ up: num(j.up), down: num(j.down) }) } catch { finish(null) }
      })
      ws.addEventListener("error", () => finish(null))
      ws.addEventListener("close", () => finish(null))
    } catch { finish(null) }
    setTimeout(() => finish(null), timeoutMs)
  })
}

// ---------- 概览 ----------
export async function loadOverview(c: Controller): Promise<Overview> {
  if (c.kind === "openwrt") return wrtOverview(c)
  {
    const [ver, cfg, conns, tr] = await Promise.all([
      http(c, "/version").catch(() => ({})), http(c, "/configs"), http(c, "/connections"), clashTrafficOnce(c),
    ])
    return {
      version: String(ver.version ?? ""), mode: String(cfg.mode ?? ""), traffic: tr ?? { up: 0, down: 0 },
      upTotal: num(conns.uploadTotal), downTotal: num(conns.downloadTotal), connCount: (conns.connections ?? []).length,
    }
  }
}

// ---------- 模式 ----------
export const CLASH_MODES = [["rule", "规则"], ["global", "全局"], ["direct", "直连"]]
export const modesOf = (_k: Kind) => CLASH_MODES
export async function setMode(c: Controller, mode: string) { await http(c, "/configs", { method: "PATCH", body: { mode } }) }

// ---------- 策略组 ----------
export async function loadGroups(c: Controller): Promise<Group[]> {
  {
    const j = await http(c, "/proxies")
    const all: Record<string, any> = j.proxies ?? {}
    const order: string[] = all.GLOBAL?.all ?? Object.keys(all)
    const names = [...order.filter(n => all[n]?.all), ...Object.keys(all).filter(n => all[n]?.all && !order.includes(n))]
    return names.filter(n => n !== "GLOBAL" || order.includes("GLOBAL")).map(n => {
      const g = all[n]; const delays: Record<string, number> = {}
      for (const m of g.all as string[]) { const h = all[m]?.history; if (h?.length) delays[m] = num(h[h.length - 1].delay) }
      return { name: n, type: String(g.type ?? ""), now: String(g.now ?? ""), all: g.all, delays }
    })
  }
}
export async function selectProxy(c: Controller, group: string, name: string) {
  await http(c, "/proxies/" + enc(group), { method: "PUT", body: { name } })
}
// 测速整组，返回 节点→毫秒（0 表示超时/失败）
export async function testGroup(c: Controller, g: Group): Promise<Record<string, number>> {
  const res: Record<string, number> = {}
  {
    try {
      const j = await http(c, `/group/${enc(g.name)}/delay?url=${enc(TEST_URL)}&timeout=5000`, { timeout: 15 })
      for (const [k, v] of Object.entries<any>(j)) res[k] = num(v)
      return res
    } catch { /* 非策略组端点或旧内核：逐个测 */ }
    const queue = [...g.all]
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const n = queue.shift()!
        try { const j = await http(c, `/proxies/${enc(n)}/delay?url=${enc(TEST_URL)}&timeout=5000`, { timeout: 8 }); res[n] = num(j.delay) } catch { res[n] = 0 }
      }
    }))
    return res
  }
  return res
}

// ---------- 连接 ----------
export async function loadConnections(c: Controller): Promise<Conn[]> {
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
export async function closeConnection(c: Controller, id: string) { await http(c, "/connections/" + enc(id), { method: "DELETE" }) }
export async function closeAllConnections(c: Controller) {
  await http(c, "/connections", { method: "DELETE" })
}

// ---------- 规则 ----------
export async function loadRules(c: Controller): Promise<Rule[]> {
  {
    const j = await http(c, "/rules", { timeout: 15 })
    return (j.rules ?? []).map((r: any) => ({ type: String(r.type), payload: String(r.payload ?? ""), proxy: String(r.proxy ?? "") }))
  }
}

// ---------- 配置（仅 Clash） ----------
export interface ClashConfig { mode: string; "log-level": string; port: number; "socks-port": number; "mixed-port": number; "allow-lan": boolean }
export async function loadConfig(c: Controller): Promise<ClashConfig> { return await http(c, "/configs") }
export async function patchConfig(c: Controller, patch: Partial<ClashConfig>) { await http(c, "/configs", { method: "PATCH", body: patch }) }
export const LOG_LEVELS = ["silent", "error", "warning", "info", "debug"]

// ---------- 格式化 ----------
export function fmtBytes(n: number): string {
  if (!n || n < 0) return "0 B"
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0, v = n
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${u[i]}`
}
export function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60)
  return d ? `${d}天${h}时` : h ? `${h}时${m}分` : `${m}分`
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
  return ms < 300 ? "systemGreen" : ms < 800 ? "systemOrange" : "systemRed"
}

// ---------- 小组件缓存 ----------
export function saveCache(id: string, o: Overview) { Storage.set(K_CACHE + id, { at: Date.now(), o }) }
export function loadCache(id: string): { at: number; o: Overview } | null { return Storage.get(K_CACHE + id) ?? null }
