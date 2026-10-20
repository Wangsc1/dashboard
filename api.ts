// Neko Dash for Scripting - 数据层：Clash(Mihomo/OpenClash/OpenWrt 的 Clash API) 与 Surge HTTP API
export const VERSION = "1.0.3"

export type Kind = "clash" | "surge"
export interface Controller { id: string; name: string; kind: Kind; url: string }
export interface Group { name: string; type: string; now: string; all: string[]; delays: Record<string, number> }
export interface Conn { id: string; host: string; src: string; dst: string; network: string; rule: string; chain: string; up: number; down: number; start: number; upSpeed?: number; downSpeed?: number }
export interface Rule { type: string; payload: string; proxy: string }
export interface Traffic { up: number; down: number }
export interface Overview { version: string; mode: string; traffic: Traffic; upTotal: number; downTotal: number; connCount: number }

const K_LIST = "neko_controllers_v1"
const K_ACTIVE = "neko_active_v1"
const K_REFRESH = "neko_refresh_min_v1"
const K_CACHE = "neko_cache_v1"
const TEST_URL = "http://www.gstatic.com/generate_204"

// ---------- 控制器存储：地址/名称在 Storage，密钥在 Keychain ----------
export function listControllers(): Controller[] { return Storage.get<Controller[]>(K_LIST) ?? [] }
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
  const item: Controller = { id, name: c.name.trim() || url.replace(/^https?:\/\//, ""), kind: c.kind, url }
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
  if (secret) { if (c.kind === "surge") headers["X-Key"] = secret; else headers["Authorization"] = "Bearer " + secret }
  const r = await fetch(c.url + path, {
    method: init.method ?? "GET", headers, allowInsecureRequest: true, timeout: init.timeout ?? 8,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  } as any)
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) throw new Error("认证失败，请检查密钥")
    throw new Error(`请求失败 HTTP ${r.status}`)
  }
  const text = await r.text()
  if (!text) return {}
  try { return JSON.parse(text) } catch { return {} }
}
const enc = encodeURIComponent
const num = (v: any) => typeof v === "number" && Number.isFinite(v) ? v : 0

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
  if (c.kind === "clash") {
    const [ver, cfg, conns, tr] = await Promise.all([
      http(c, "/version").catch(() => ({})), http(c, "/configs"), http(c, "/connections"), clashTrafficOnce(c),
    ])
    return {
      version: String(ver.version ?? ""), mode: String(cfg.mode ?? ""), traffic: tr ?? { up: 0, down: 0 },
      upTotal: num(conns.uploadTotal), downTotal: num(conns.downloadTotal), connCount: (conns.connections ?? []).length,
    }
  }
  const [env, out, tr, req] = await Promise.all([
    http(c, "/v1/environment").catch(() => ({})), http(c, "/v1/outbound"), http(c, "/v1/traffic").catch(() => ({})), http(c, "/v1/requests/active").catch(() => ({})),
  ])
  let up = 0, down = 0, upT = 0, downT = 0
  for (const v of Object.values<any>(tr.interface ?? {})) { up += num(v.outCurrentSpeed); down += num(v.inCurrentSpeed); upT += num(v.out); downT += num(v.in) }
  return { version: String(env.surgeVersion ?? ""), mode: String(out.mode ?? ""), traffic: { up, down }, upTotal: upT, downTotal: downT, connCount: (req.requests ?? []).length }
}

// ---------- 模式 ----------
export const CLASH_MODES = [["rule", "规则"], ["global", "全局"], ["direct", "直连"]]
export const SURGE_MODES = [["rule", "规则"], ["proxy", "全局代理"], ["direct", "全局直连"]]
export const modesOf = (k: Kind) => k === "clash" ? CLASH_MODES : SURGE_MODES
export async function setMode(c: Controller, mode: string) {
  if (c.kind === "clash") await http(c, "/configs", { method: "PATCH", body: { mode } })
  else await http(c, "/v1/outbound", { method: "POST", body: { mode } })
}

// ---------- 策略组 ----------
export async function loadGroups(c: Controller): Promise<Group[]> {
  if (c.kind === "clash") {
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
  const j = await http(c, "/v1/policy_groups")
  const out: Group[] = []
  for (const [name, members] of Object.entries<any>(j)) {
    if (!Array.isArray(members)) continue
    let now = ""
    try { const s = await http(c, "/v1/policy_groups/select?group_name=" + enc(name)); now = String(s.policy ?? "") } catch { }
    out.push({ name, type: now ? "Select" : "Group", now, all: members.map((m: any) => String(m.name ?? m)), delays: {} })
  }
  return out
}
export async function selectProxy(c: Controller, group: string, name: string) {
  if (c.kind === "clash") await http(c, "/proxies/" + enc(group), { method: "PUT", body: { name } })
  else await http(c, "/v1/policy_groups/select", { method: "POST", body: { group_name: group, policy: name } })
}
// 测速整组，返回 节点→毫秒（0 表示超时/失败）
export async function testGroup(c: Controller, g: Group): Promise<Record<string, number>> {
  const res: Record<string, number> = {}
  if (c.kind === "clash") {
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
  const j = await http(c, "/v1/policies/test", { method: "POST", body: { policy_names: g.all, url: TEST_URL }, timeout: 20 })
  for (const n of g.all) {
    const v = j?.[n]
    res[n] = typeof v === "number" ? v : num(v?.lastTestScoreInMS ?? v?.delay ?? v?.score)
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
  const j = await http(c, "/v1/requests/active")
  return (j.requests ?? []).map((x: any): Conn => ({
    id: String(x.id), host: String(x.remoteHost || x.URL || "-"), src: String(x.sourceAddress ?? ""), dst: String(x.remoteAddress ?? ""),
    network: String(x.method ?? ""), rule: String(x.rule ?? ""), chain: String(x.policyName ?? ""),
    up: num(x.outBytes), down: num(x.inBytes), start: num(x.startDate) * 1000, upSpeed: num(x.outCurrentSpeed), downSpeed: num(x.inCurrentSpeed),
  }))
}
export async function closeConnection(c: Controller, id: string) {
  if (c.kind === "clash") await http(c, "/connections/" + enc(id), { method: "DELETE" })
  else await http(c, "/v1/requests/kill", { method: "POST", body: { id: Number(id) } })
}
export async function closeAllConnections(c: Controller) {
  if (c.kind === "clash") await http(c, "/connections", { method: "DELETE" })
  else for (const x of await loadConnections(c)) await closeConnection(c, x.id).catch(() => { })
}

// ---------- 规则 ----------
export async function loadRules(c: Controller): Promise<Rule[]> {
  if (c.kind === "clash") {
    const j = await http(c, "/rules", { timeout: 15 })
    return (j.rules ?? []).map((r: any) => ({ type: String(r.type), payload: String(r.payload ?? ""), proxy: String(r.proxy ?? "") }))
  }
  const j = await http(c, "/v1/rules", { timeout: 15 })
  return (j.rules ?? []).map((line: any) => {
    const p = String(line).split(",").map(s => s.trim())
    return { type: p[0] ?? "", payload: p.length > 2 ? p[1] : "", proxy: p.length > 2 ? p[2] : (p[1] ?? "") }
  })
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
