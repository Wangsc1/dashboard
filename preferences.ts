
export interface Preferences {
  theme: "system" | "light" | "dark"; connectionStyle: "standard" | "compact"; proxyStyle: "list" | "compact"
  collapseGesture: boolean; removalFade: boolean; delayGreen: number; delayRed: number
  showHidden: boolean; customIcons: boolean; groupIcons: Record<string, string>
  showWrt: boolean; droplets: boolean; connectionBackground: boolean; ripple: boolean
  foldOffline: boolean; disconnectOnSwitch: boolean; haptics: boolean
  defaultPage: "overview" | "proxies" | "rules" | "connections" | "more"
  nestedDelay: boolean; nodeSort: "default" | "delay" | "name" | "nameDesc" | "delayDesc"; showGlobal: boolean
  headersEnabled: boolean; requestTimeout: number; testURL: string; testTimeout: number; logLimit: number; detailedAPI: boolean
}
export const DEFAULTS: Preferences = {
  theme: "system", connectionStyle: "standard", proxyStyle: "list", collapseGesture: false, removalFade: false,
  delayGreen: 240, delayRed: 500, showHidden: false, customIcons: true, groupIcons: {},
  showWrt: true, droplets: false, connectionBackground: false, ripple: false,
  foldOffline: false, disconnectOnSwitch: false, haptics: false, defaultPage: "overview",
  headersEnabled: true, nestedDelay: false, nodeSort: "default", showGlobal: false, requestTimeout: 8,
  testURL: "https://www.gstatic.com/generate_204", testTimeout: 5000, logLimit: 500, detailedAPI: false,
}
const KEY = "dashboard_preferences_v140"
const listeners = new Set<() => void>()
let preferenceRevision = 0
const preferenceInstance = Math.random().toString(36).slice(2, 10)
export function traceIconPreference(stage: "change" | "accepted" | "global-render" | "proxies-render" | "group-render" | "icon-render", enabled: boolean) {
  // Diagnostic only: never expose URLs, group names, headers or other settings.
  // A failed diagnostic must not interrupt a settings write or UI render.
  try {
    const raw = Storage.get<Partial<Preferences>>(KEY)
    const stored = typeof raw?.customIcons === "boolean" ? raw.customIcons : "unavailable"
    console.log(`[preferences-icon] build=1.5.85 instance=${preferenceInstance} revision=${preferenceRevision} stage=${stage} enabled=${enabled} snapshot=${getPreferences().customIcons} stored=${stored}`)
  } catch { console.log("[preferences-icon] diagnostic-unavailable") }
}
export function preferenceTrace(stage: string) { console.log(`[preferences] revision=${preferenceRevision} ${stage}`) }
export function subscribePreferences(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } }
// Storage persists asynchronously. Keep an accepted write visible to this instance
// instead of rereading an older persisted value during navigation/subscriber updates.
let preferenceSnapshot: Preferences | undefined
export function getPreferences(): Preferences {
  if (!preferenceSnapshot) preferenceSnapshot = normalizePreferences(Storage.get<Partial<Preferences>>(KEY) ?? {})
  return normalizePreferences(preferenceSnapshot)
}
export function normalizePreferences(raw: Partial<Preferences>): Preferences {
  const p = { ...DEFAULTS }
  for (const k of Object.keys(DEFAULTS) as (keyof Preferences)[]) {
    const v = raw[k]
    if (typeof v === typeof DEFAULTS[k] && v !== null) (p as any)[k] = v
  }
  for (const [k, choices] of Object.entries({ theme: ["system", "light", "dark"], connectionStyle: ["standard", "compact"], proxyStyle: ["list", "compact"], defaultPage: ["overview", "proxies", "rules", "connections", "more"], nodeSort: ["default", "name", "nameDesc", "delay", "delayDesc"] })) {
    if (!choices.includes((p as any)[k])) (p as any)[k] = (DEFAULTS as any)[k]
  }
  for (const [k, min, max] of [["requestTimeout", 1, 30], ["testTimeout", 1000, 10000], ["logLimit", 100, 2000], ["delayGreen", 1, 9999], ["delayRed", 1, 10000]] as [keyof Preferences, number, number][]) {
    if (!Number.isInteger(p[k]) || Number(p[k]) < min || Number(p[k]) > max) (p as any)[k] = DEFAULTS[k]
  }
  if (p.delayGreen >= p.delayRed) { p.delayGreen = DEFAULTS.delayGreen; p.delayRed = DEFAULTS.delayRed }
  if (!/^https?:\/\/[^\s]+$/i.test(p.testURL) || /https?:\/\/[^/]*@/i.test(p.testURL)) p.testURL = DEFAULTS.testURL
  if (Array.isArray(p.groupIcons) || typeof p.groupIcons !== "object") p.groupIcons = {}
  p.groupIcons = Object.fromEntries(Object.entries(p.groupIcons).filter(([k, v]) => k.length <= 200 && typeof v === "string" && /^[A-Za-z0-9.]+$/.test(v)))
  return p
}
export function savePreferences(patch: Partial<Preferences>) {
  const p = normalizePreferences({ ...getPreferences(), ...patch })
  if (!Storage.set(KEY, p)) throw new Error("本地设置保存失败")
  preferenceSnapshot = p
  preferenceRevision++
  preferenceTrace("saved")
  if (typeof patch.customIcons === "boolean") traceIconPreference("accepted", p.customIcons)
  // The write has succeeded. Maintenance or one failed UI listener must not
  // block the other pages or turn an accepted write into a save-failed alert.
  try { trimLogs(p.logLimit) } catch { preferenceTrace("log-trim-failed") }
  for (const fn of [...listeners]) {
    if (!listeners.has(fn)) continue
    try { fn() } catch { preferenceTrace("listener-failed") }
  }
}
export function feedback() { if (getPreferences().haptics) { try { HapticFeedback.selection() } catch {} } }

export type LogLevel = "info" | "success" | "warning" | "error"
export interface AppLog { id: string; at: number; level: LogLevel; category: "NETWORK" | "CONFIG" | "APP"; title: string; detail: string; count: number }
const LOG_KEY = "dashboard_logs_v140"

const EVENTS = {
  login: "路由器登录", discovery: "自动获取代理配置", manual: "手动代理配置解析", test: "策略组测速", api: "控制器 API", ubus: "路由器 API",
  start: "脚本启动", fallback: "组测速回退逐节点测速", config: "内核配置更新", controller: "控制器保存", remove: "控制器删除", switch: "切换控制器", cache: "清除图片缓存",
} as const
export type LogEvent = keyof typeof EVENTS
export function getLogs(): AppLog[] { return Storage.get<AppLog[]>(LOG_KEY) ?? [] }
export function trimLogs(limit = getPreferences().logLimit) {
  const logs = getLogs(); if (logs.length > limit) Storage.set(LOG_KEY, logs.slice(-limit))
}
export function clearLogs() { Storage.remove(LOG_KEY) }
export function recordEvent(event: LogEvent, ok: boolean, options: { status?: number; duration?: number; operation?: "GET" | "PATCH" | "PUT" | "DELETE" | "POST"; route?: "configs" | "connections" | "proxies" | "rules" | "version" | "delay" | "other"; warning?: boolean } = {}) {
  if (!Object.prototype.hasOwnProperty.call(EVENTS, event)) return
  const p = getPreferences()

  if ((event === "api" || event === "ubus") && ok && !p.detailedAPI && (!options.operation || options.operation === "GET" || event === "ubus")) return
  const level: LogLevel = event === "start" ? "info" : options.warning ? "warning" : ok ? "success" : "error"
  const detail = [["GET", "PATCH", "PUT", "DELETE", "POST"].includes(options.operation ?? "") ? options.operation : "", ["configs", "connections", "proxies", "rules", "version", "delay", "other"].includes(options.route ?? "") ? options.route : "",
    Number.isInteger(options.status) ? `HTTP ${options.status}` : "",
    Number.isFinite(options.duration) ? `${Math.max(0, Math.round(options.duration!))} ms` : ""].filter(Boolean).join(" · ")
  const title = EVENTS[event] + (event === "start" || event === "fallback" ? "" : ok ? "成功" : "失败")
  const category = event === "config" ? "CONFIG" : ["api", "ubus", "login", "discovery", "manual", "test"].includes(event) ? "NETWORK" : "APP"
  const logs = getLogs(), now = Date.now()
  const prior = logs.slice().reverse().find(x => x.title === title && x.level === level && x.detail.replace(/\d+ ms/g, "") === detail.replace(/\d+ ms/g, "") && now - x.at < 60000)
  if (prior) { prior.at = now; prior.count++; prior.detail = detail; logs.splice(logs.indexOf(prior), 1); logs.push(prior) }
  else logs.push({ id: now.toString(36) + Math.random().toString(36).slice(2, 7), at: now, level, category, title, detail, count: 1 })
  Storage.set(LOG_KEY, logs.slice(-p.logLimit))
}
export function logTime(at: number) { const d = new Date(at); return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, "0")).join(":") + "." + String(d.getMilliseconds()).padStart(3, "0") }
export function exportLogs() { return getLogs().map(l => `${new Date(l.at).toISOString()} [${l.level}] ${l.category} ${l.title}${l.count > 1 ? ` ×${l.count}` : ""}${l.detail ? " — " + l.detail : ""}`).join("\n") }

const HEADERS_KEY = "dashboard_headers_v140"
export function getHeaderText(): string { return Keychain.get(HEADERS_KEY) ?? "{}" }
export function parseHeaders(text: string): Record<string, string> {
  let obj: any
  try { obj = JSON.parse(text) } catch { throw new Error("请输入 JSON 对象，例如 {\"X-Client\":\"dashboard\"}") }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("请求头必须是 JSON 对象")
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k) || typeof v !== "string" || /[\r\n]/.test(v)) throw new Error("请求头名称或值无效")
    if (["authorization", "cookie", "host", "content-type", "content-length", "connection", "proxy-authorization"].includes(k.toLowerCase())) throw new Error("认证及传输请求头由脚本管理，不可覆盖")
    out[k] = v
  }
  return out
}
export function customHeaders() { if (!getPreferences().headersEnabled) return {}; try { return parseHeaders(getHeaderText()) } catch { return {} } }
export function saveHeaders(text: string) { const h = parseHeaders(text); if (Keychain.set(HEADERS_KEY, JSON.stringify(h)) === false) throw new Error("请求头保存失败") }

export const controllerHealth: Record<string, boolean | undefined> = {}

const IMAGE_INDEX = "dashboard_image_index_v140"
let imageGeneration = 0
export async function cachedIcon(url: string): Promise<any> {

  if (!/^https:\/\//i.test(url) || /[?#]/.test(url) || /^https:\/\/[^/]*@/i.test(url)) return null
  const key = "dashboard_image_v140_" + encodeURIComponent(url)
  const data = Storage.getData(key)
  if (data) return UIImage.fromData(data)
  const generation = imageGeneration
  const r = await fetch(url, { timeout: getPreferences().requestTimeout })
  if (!r.ok) return null
  const content = r.headers.get("content-type") ?? ""
  if (!content.startsWith("image/")) return null
  const bytes = await r.data()
  const image = UIImage.fromData(bytes)
  if (image && generation === imageGeneration) {
    let keys = Storage.get<string[]>(IMAGE_INDEX) ?? []
    if (keys.length >= 100) { Storage.remove(keys[0]); keys = keys.slice(1) }
    if (Storage.set(IMAGE_INDEX, [...keys.filter(k => k !== key), key])) Storage.setData(key, bytes)
  }
  return image
}
export function clearImageCache() {
  imageGeneration++
  const keys = Storage.get<string[]>(IMAGE_INDEX) ?? []
  for (const k of keys) if (k.startsWith("dashboard_image_v140_")) Storage.remove(k)
  Storage.remove(IMAGE_INDEX); recordEvent("cache", true)
  return keys.length
}

export const NODE_SORT_OPTIONS: [Preferences["nodeSort"], string][] = [["default", "默认（按配置排序）"], ["name", "按名称升序"], ["nameDesc", "按名称降序"], ["delay", "按测速延迟升序"], ["delayDesc", "按测速延迟降序"]]
