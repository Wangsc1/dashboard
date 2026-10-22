import { ScrollView, Button, Circle, GeometryReader, ZStack, RoundedRectangle, gradient, Form, HStack, Image, Label, Menu, NavigationLink, Picker, Section, SecureField, Slider, Spacer, Text, TextField, Toggle, VStack, useEffect, useState } from "scripting"
import { Controller, ClashConfig, CLASH_MODES, LOG_LEVELS, loadConfig, patchConfig, validateConfigPatch } from "./api"
import { Preferences, AppLog, LogLevel, getPreferences, savePreferences, subscribePreferences, preferenceTrace, traceIconPreference, feedback, getLogs, clearLogs, exportLogs, logTime, getHeaderText, saveHeaders, clearImageCache } from "./preferences"

import { makeBackup, restoreBackup, validateBackup } from "./cloud-backup"

export function usePreferences(keys?: (keyof Preferences)[], enabled = true, trace = false) {
  const [p, setP] = useState(() => getPreferences())
  const [track] = useState({ value: p })
  const signature = keys?.join(",") ?? "*"
  useEffect(() => {
    if (!enabled) return
    const refresh = () => {
      if (trace) preferenceTrace("global-listener")
      const next = getPreferences()
      const watched = keys ?? Object.keys(next) as (keyof Preferences)[]
      if (!watched.some(k => JSON.stringify(track.value[k]) !== JSON.stringify(next[k]))) return
      setP(next)
      track.value = next
      if (trace) preferenceTrace("global-set-state")
    }
    refresh()
    const unsubscribe = subscribePreferences(refresh)
    if (trace) preferenceTrace("global-subscribe")
    return () => { unsubscribe(); if (trace) preferenceTrace("global-unsubscribe") }
  }, [signature, enabled, trace])
  return p
}
function update(patch: Partial<Preferences>) { if (typeof patch.customIcons === "boolean") traceIconPreference("change", patch.customIcons); preferenceTrace("changed"); try { savePreferences(patch); feedback() } catch { void Dialog.alert({ message: "本地设置保存失败，请重试" }) } }
export { update as updatePreference }
function Choice({ title, value, values, onChanged, disabled = false }: { title: string; value: string; values: string[][]; onChanged: (v: string) => void; disabled?: boolean }) {
  return <Picker title={title} pickerStyle="menu" value={value} onChanged={onChanged} disabled={disabled}>{values.map(([v, l]) => <Text key={v} tag={v}>{l}</Text>)}</Picker>
}
function Range({ title, value, min, max, step = 1, suffix = "", divider = false, onChanged }: { title: string; value: number; min: number; max: number; step?: number; suffix?: string; divider?: boolean; onChanged: (n: number) => void }) {
  const [draft, setDraft] = useState(value)
  const snap = (n: number) => Math.max(min, Math.min(max, min + Math.round((n - min) / step) * step))
  const [drag] = useState(() => {
    type Event = { translation: { width: number; height: number } }
    const state = { width: 1, active: false, base: value, latest: value, lastPaint: -Infinity, value, onChanged,
      gesture: {} as { minDistance: number; onChanged: (e: Event) => void; onEnded: (e: Event) => void } }
    function move(e: Event, final = false) {
      if (!state.active) { state.active = true; state.base = state.latest = state.value }
      state.latest = snap(state.base + e.translation.width / state.width * (max - min))
      const now = Date.now()
      if (final || now - state.lastPaint >= 32) { state.lastPaint = now; setDraft(state.latest) }
    }
    state.gesture = { minDistance: 2, onChanged: e => move(e), onEnded: e => {
      move(e, true)
      const next = state.latest
      state.active = false; state.lastPaint = -Infinity
      if (next !== state.value) state.onChanged(next)
    } }
    return state
  })
  drag.value = value; drag.onChanged = onChanged
  useEffect(() => { if (!drag.active) setDraft(snap(value)) }, [value])
  const shown = snap(draft)
  return <VStack alignment="leading" spacing={10} padding={{ vertical: 6 }}>
    <Text>{`${title}：${shown}${suffix}`}</Text>
    {divider ? <RoundedRectangle cornerRadius={0} fill={{ light: "#C6C6C8", dark: "#38383A" }} frame={{ maxWidth: "infinity", height: 0.5 }} /> : null}
    <HStack spacing={10}>
      <Text font={14} foregroundStyle="secondaryLabel">{String(min)}</Text>
      <GeometryReader frame={{ height: 28 }}>{(proxy: { size: { width: number } }) => {
        const width = Math.max(1, proxy.size.width - 28)
        drag.width = width
        const x = 14 + (shown - min) / (max - min) * width
        return <ZStack alignment="leading" frame={{ width: proxy.size.width, height: 28 }} background="clear" onDragGesture={drag.gesture}>
          <RoundedRectangle cornerRadius={2} fill="tertiarySystemFill" frame={{ width, height: 4 }} offset={{ x: 14, y: 0 }} />
          <RoundedRectangle cornerRadius={2} fill="systemBlue" frame={{ width: Math.max(0, x - 14), height: 4 }} offset={{ x: 14, y: 0 }} />
          <Circle fill="white" stroke={{ shapeStyle: "#DDDDDD", strokeStyle: { lineWidth: 0.5 } }} frame={{ width: 26, height: 26 }} offset={{ x: x - 13, y: 0 }} />
        </ZStack>
      }}</GeometryReader>
      <Text font={14} foregroundStyle="secondaryLabel">{String(max)}</Text>
    </HStack>
  </VStack>
}

export function thresholdPair(green: number, red: number, handle: "green" | "red", value: number) {
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)))
  const g = clamp(green, 100, 799), r = clamp(red, g + 1, 800)
  return handle === "green" ? { delayGreen: clamp(value, 100, r - 1), delayRed: r }
    : { delayGreen: g, delayRed: clamp(value, g + 1, 800) }
}
export function ThresholdRange() {
  const p = usePreferences(["delayGreen", "delayRed"])
  const [draft, setDraft] = useState({ delayGreen: p.delayGreen, delayRed: p.delayRed })
  // The recognizer belongs to the FIXED track, not a thumb whose local origin
  // moves under the finger. Keep its callbacks stable across bridge renders.
  const [drag] = useState(() => {
    type Event = { startLocation: { x: number; y: number }; translation: { width: number; height: number } }
    const state = { width: 1, handle: null as "green" | "red" | null, base: draft, pair: draft, lastPaint: -Infinity,
      gesture: {} as { minDistance: number; onChanged: (e: Event) => void; onEnded: (e: Event) => void } }
    const position = (n: number) => 22 + (Math.max(100, Math.min(800, n)) - 100) / 700 * state.width
    function move(e: Event, final = false) {
      if (!state.handle) {
        if (Math.abs(e.translation.height) > Math.abs(e.translation.width)) return
        const current = getPreferences()
        state.base = { delayGreen: current.delayGreen, delayRed: current.delayRed }
        state.handle = Math.abs(e.startLocation.x - position(state.base.delayGreen)) <= Math.abs(e.startLocation.x - position(state.base.delayRed)) ? "green" : "red"
      }
      const key = state.handle === "green" ? "delayGreen" : "delayRed"
      const start = Math.max(100, Math.min(800, state.base[key]))
      const next = thresholdPair(state.base.delayGreen, state.base.delayRed, state.handle, start + e.translation.width / state.width * 700)
      state.pair = next
      // Coalesce high-rate native callbacks; no timers, disk writes, feedback or
      // global preference notifications while the finger is moving.
      const now = Date.now()
      if (final || now - state.lastPaint >= 32) { state.lastPaint = now; setDraft(next) }
    }
    state.gesture = { minDistance: 8, onChanged: e => move(e), onEnded: e => {
      move(e, true)
      if (state.handle && (state.pair.delayGreen !== state.base.delayGreen || state.pair.delayRed !== state.base.delayRed)) {
        try { savePreferences(state.pair); feedback() }
        catch { state.pair = state.base; setDraft(state.base); void Dialog.alert({ message: "本地设置保存失败，请重试" }) }
      }
      state.handle = null; state.lastPaint = -Infinity
    } }
    return state
  })
  useEffect(() => {
    if (!drag.handle) {
      const next = { delayGreen: p.delayGreen, delayRed: p.delayRed }
      drag.pair = next; setDraft(next)
    }
  }, [p.delayGreen, p.delayRed])
  return <VStack alignment="leading" spacing={18} padding={{ vertical: 8 }} listRowSeparator="hidden">
    <HStack><Text>延迟阈值范围</Text><Spacer /><Text foregroundStyle="secondaryLabel">{`${draft.delayGreen}–${draft.delayRed} ms`}</Text></HStack>
    <GeometryReader frame={{ height: 56 }}>{(proxy: { size: { width: number } }) => {
      const width = Math.max(1, proxy.size.width - 44)
      drag.width = width
      const x = (n: number) => 22 + (Math.max(100, Math.min(800, n)) - 100) / 700 * width
      return <ZStack alignment="leading" frame={{ width: proxy.size.width, height: 56 }} background="clear" onDragGesture={drag.gesture}>
        <RoundedRectangle cornerRadius={2} fill={gradient("linear", { colors: ["systemGreen", "systemYellow", "systemOrange", "systemRed"], startPoint: "leading", endPoint: "trailing" })} frame={{ width, height: 4 }} offset={{ x: 22, y: 0 }} />
        {(["green", "red"] as const).map(handle => <Circle key={handle} fill="white" stroke={{ shapeStyle: "#DDDDDD", strokeStyle: { lineWidth: 0.5 } }} frame={{ width: 26, height: 26 }} offset={{ x: x(handle === "green" ? draft.delayGreen : draft.delayRed) - 13, y: 0 }} />)}
      </ZStack>
    }}</GeometryReader>
    <Text font={12} foregroundStyle="tertiaryLabel">{`低于${draft.delayGreen}ms显示为绿色，${draft.delayGreen}ms到${draft.delayRed}ms之间显示为黄色，高于${draft.delayRed}ms或超时显示为红色。`}</Text>
    {p.delayGreen < 100 || p.delayRed > 800 ? <Text font={12} foregroundStyle="secondaryLabel">当前保留原阈值；首次拖动将调整到100–800 ms范围。</Text> : null}
  </VStack>
}

function IconsPage() {
  const p = usePreferences(), [text, setText] = useState(JSON.stringify(p.groupIcons)), [err, setErr] = useState("")
  function save() {
    try {
      const icons = JSON.parse(text)
      if (!icons || Array.isArray(icons) || typeof icons !== "object" || Object.values(icons).some(v => typeof v !== "string" || !/^[A-Za-z0-9.]+$/.test(v as string))) throw new Error("请输入组名到 SF Symbol 名称的 JSON 对象")
      savePreferences({ groupIcons: icons }); setErr("已保存；启用自定义代理组图标后生效")
    } catch (e: any) { setErr(String(e.message)) }
  }
  return <Form background="systemBackground" scrollContentBackground="hidden" navigationTitle="自定义代理组图标" navigationBarTitleDisplayMode="inline"><Section footer={<Text>本地替代：按组名配置 SF Symbols；未覆盖时使用内核提供的 HTTPS 图标（仅脚本管理的缓存）。不修改内核配置。</Text>}><TextField title="图标映射 JSON" value={text} onChanged={setText} prompt={'{"节点选择":"globe"}'} /><Button title="保存图标" action={save} /><Text foregroundStyle="secondaryLabel">{err}</Text></Section></Form>
}
function HeaderFields() {
  const p = usePreferences()
  const [rows, setRows] = useState(() => {
    try { const entries = Object.entries(JSON.parse(getHeaderText())).map(([key, value]) => ({ key, value: String(value) })); return entries.length ? entries : [{ key: "", value: "" }] }
    catch { return [{ key: "", value: "" }] }
  })
  const [error, setError] = useState("")
  function edit(i: number, field: "key" | "value", value: string) {
    const next = rows.map((r, j) => j === i ? { ...r, [field]: value } : r)
    setRows(next)
    if (next.some(r => !r.key.trim() && r.value)) { setError("请输入 Key"); return }
    const obj: Record<string, string> = {}
    for (const r of next) {
      if (!r.key.trim()) continue
      if (Object.keys(obj).some(k => k.toLowerCase() === r.key.trim().toLowerCase())) { setError("Key 不能重复"); return }
      obj[r.key.trim()] = r.value
    }
    try { saveHeaders(JSON.stringify(obj)); setError("") } catch (e: any) { setError(String(e.message)) }
  }
  return <>
    <Toggle title="自定义请求头" value={p.headersEnabled} onChanged={(v: boolean) => update({ headersEnabled: v })} />
    {p.headersEnabled ? rows.flatMap((r, i) => [
      <HStack key={`header-key-${i}`} spacing={16}><Text frame={{ width: 64, alignment: "leading" }}>Key</Text><TextField title="例如 X-Is-Me" value={r.key} onChanged={(v: string) => edit(i, "key", v)} autocorrectionDisabled textInputAutocapitalization="never" /></HStack>,
      <HStack key={`header-value-${i}`} spacing={16}><Text frame={{ width: 64, alignment: "leading" }}>Value</Text><TextField title="例如 YES" value={r.value} onChanged={(v: string) => edit(i, "value", v)} autocorrectionDisabled textInputAutocapitalization="never" /></HStack>,
    ]) : null}
    {error ? <Text font={12} foregroundStyle="systemRed">{error}</Text> : null}
  </>
}

export function KernelConfigPage({ c }: { c: Controller }) {
  // One source-scoped session owns drafts and a serial, latest-value queue.
  // Native callbacks may outlive their render; never read their captured state.
  type Edit = { value: any; revision: number }
  type Session = { source: string; controller: Controller; active: boolean; cfg: ClashConfig | null; dirty: Record<string, any>; revisions: Record<string, number>; pending: Map<string, Edit>; errors: Record<string, string>; loading: boolean; saving: boolean }
  const [holder] = useState<{ current: Session | null }>({ current: null })
  const [, redraw] = useState(0)
  const source = JSON.stringify(c)
  if (holder.current?.source !== source) holder.current = { source, controller: { ...c }, active: true, cfg: null, dirty: {}, revisions: {}, pending: new Map(), errors: {}, loading: true, saving: false }
  const session = holder.current!
  const current = () => session.active && holder.current === session
  const paint = () => { if (current()) redraw(n => n + 1) }
  useEffect(() => {
    void (async () => {
      try { const result = await loadConfig(session.controller); if (current()) session.cfg = result }
      catch { if (current()) session.errors.load = "读取内核配置失败，请检查控制器连接与权限后重新进入此页" }
      finally { if (current()) { session.loading = false; paint() } }
    })()
    return () => { session.active = false; session.pending.clear() }
  }, [session])
  const provided = (key: string) => key === "tun" ? typeof session.cfg?.tun?.enable === "boolean" : (session.cfg as any)?.[key] !== undefined
  async function drain() {
    if (!current() || session.loading || session.saving) return
    session.saving = true; paint()
    try {
      while (current() && session.pending.size) {
        const batch = new Map(session.pending); session.pending.clear()
        const patch: any = {}
        for (const [key, edit] of batch) {
          const previous = key === "tun" ? session.cfg?.tun?.enable : (session.cfg as any)?.[key]
          const next = key === "tun" ? edit.value.enable : edit.value
          if (next !== previous) patch[key] = edit.value
        }
        try {
          if (Object.keys(patch).length) await patchConfig(session.controller, patch)
          if (!current()) return
          session.cfg = { ...session.cfg, ...patch, ...(patch.tun ? { tun: { ...session.cfg?.tun, enable: patch.tun.enable } } : {}) }
          for (const [key, edit] of batch) {
            if (session.revisions[key] === edit.revision) { delete session.dirty[key]; delete session.errors[key] }
          }
          if (Object.keys(patch).length) feedback()
        } catch {
          if (!current()) return
          for (const key of batch.keys()) session.errors[key] = "保存失败；改动已保留，请再次选择或结束编辑重试"
        }
        paint()
      }
    } finally { if (current()) { session.saving = false; paint() } }
  }
  function commit(key: string) {
    if (!current() || session.loading || !provided(key) || !(key in session.dirty)) return
    let value = session.dirty[key]
    if (key.endsWith("port")) {
      if (!/^\d+$/.test(String(value)) || Number(value) > 65535) { session.errors[key] = "端口必须为 0–65535 的整数；空值不会写回"; paint(); return }
      value = Number(value)
    }
    try { validateConfigPatch({ [key]: value }) }
    catch (e: any) { session.errors[key] = String(e.message); paint(); return }
    delete session.errors[key]
    session.pending.set(key, { value, revision: session.revisions[key] })
    void drain(); paint()
  }
  function change(key: string, value: any, immediate = true) {
    if (!current() || session.loading || !provided(key)) return
    session.dirty[key] = value
    session.revisions[key] = (session.revisions[key] ?? 0) + 1
    // A newly edited input supersedes an older queued commit, but stays local
    // until blur/submit. An already in-flight request cannot be cancelled.
    session.pending.delete(key)
    delete session.errors[key]; paint()
    if (immediate) commit(key)
  }
  const cfg = session.cfg, dirty = session.dirty, busy = session.loading
  const err = Object.values(session.errors).join("\n")
  const icon = (name: string, color: string) => <Image systemName={name} font={21} foregroundStyle={color} frame={{ width: 24 }} />
  const separator = () => <RoundedRectangle cornerRadius={0} fill={{ light: "#E8E8ED", dark: "#38383A" }} frame={{ maxWidth: "infinity", height: 0.5 }} />
  const card = (children: any) => <VStack spacing={0} padding={{ horizontal: 14 }} frame={{maxWidth:"infinity",alignment:"leading"}} background={<RoundedRectangle cornerRadius={16} fill={{ light: "#F2F2F7", dark: "#1C1C1E" }} stroke={{ shapeStyle: { light: "#ECECF1", dark: "#38383A" }, strokeStyle: { lineWidth: 0.5 } }} />}>{children}</VStack>
  const heading = (title: string) => <Text font={13} foregroundStyle="secondaryLabel" padding={{ leading: 14 }}>{title}</Text>
  const field = (key: string, title: string, port = true) => <TextField key={key} title={title} value={String(dirty[key] ?? (cfg as any)?.[key] ?? "")} prompt="未提供" onChanged={(v: string) => change(key, v, false)} onBlur={() => commit(key)} onSubmit={() => commit(key)} submitLabel="done" disabled={busy || !provided(key)} keyboardType={port ? "numberPad" : "default"} autocorrectionDisabled textInputAutocapitalization="never" multilineTextAlignment="trailing" frame={{ width: port ? 100 : 142, height: 22 }} padding={{ horizontal: 10, vertical: 8 }} background={{ style: { light: "#E5E5EA", dark: "#2C2C2E" }, shape: { type: "rect", cornerRadius: 8 } }} />
  const toggle = (key: string, title: string) => provided(key)
    ? <Toggle title={title} value={key === "tun" ? (dirty.tun?.enable ?? cfg?.tun?.enable) : (dirty[key] ?? (cfg as any)?.[key])} onChanged={(v: boolean) => change(key, key === "tun" ? { enable: v } : v)} disabled={busy} frame={{height:31}} />
    : <HStack frame={{minHeight:31,maxHeight:31,maxWidth:"infinity"}}><Text>{title}</Text><Spacer /><Text font={14} foregroundStyle="secondaryLabel">未提供</Text></HStack>
  return <ScrollView navigationTitle="代理配置" navigationBarTitleDisplayMode="inline" background="systemBackground">
    <VStack alignment="leading" spacing={10} padding={{ horizontal: 20, vertical: 16 }} frame={{maxWidth:"infinity",alignment:"leading"}}>
      {heading("代理模式")}
      {card(([ ["rule", "规则模式"], ["global", "全局模式"], ["direct", "直连模式"] ]).map(([value, title], i) => <VStack key={value} spacing={0}>
        {i ? separator() : null}
        <Button disabled={busy || !provided("mode")} buttonStyle="plain" action={() => change("mode", value)}>
          <HStack padding={{ vertical: 15 }}><Text>{title}</Text><Spacer /><ZStack frame={{width:20,height:20}}>{(dirty.mode ?? cfg?.mode) === value ? <Image systemName="checkmark" font={18} foregroundStyle="systemBlue" /> : null}</ZStack></HStack>
        </Button>
      </VStack>))}
      {heading("端口配置")}
      {card(([ ["mixed-port", "混合端口"], ["port", "HTTP 端口"], ["socks-port", "SOCKS5 端口"], ["redir-port", "透明代理端口"], ["tproxy-port", "TProxy 端口"] ]).map(([key, title], i) => <VStack key={key} spacing={0}>
        {i ? separator() : null}<HStack padding={{ vertical: 10 }}><Text>{title}</Text><Spacer />{field(key, title)}</HStack>
      </VStack>))}
      {heading("网络设置")}
      {card(<>
        <HStack spacing={12} padding={{ vertical: 12 }}>{icon("wifi", "systemBlue")}{toggle("allow-lan", "允许局域网连接")}</HStack>
        {separator()}
        <HStack spacing={12} padding={{ vertical: 12 }}>{icon("number", "systemPurple")}{toggle("ipv6", "IPv6")}</HStack>
        {separator()}
        <HStack spacing={12} padding={{ vertical: 12 }}>{icon("link", "systemGreen")}<Text>绑定地址</Text><Spacer />{field("bind-address", "绑定地址", false)}</HStack>
      </>)}
      {heading("TUN 模式")}
      {card(<HStack spacing={12} padding={{ vertical: 12 }}>{icon("shield", "systemPurple")}{toggle("tun", "TUN 模式")}</HStack>)}
      {heading("日志")}
      {card(<HStack spacing={12} padding={{ vertical: 12 }}>{icon("doc.text", "systemGray")}<Text>日志级别</Text><Spacer />
        <Menu disabled={busy || !provided("log-level")} label={<HStack spacing={6}><Text foregroundStyle="secondaryLabel">{({silent:"静默",error:"错误",warning:"警告",info:"信息",debug:"调试"} as Record<string,string>)[dirty["log-level"] ?? cfg?.["log-level"] ?? ""] ?? "未提供"}</Text><Image systemName="chevron.up.chevron.down" font={12} foregroundStyle="secondaryLabel" /></HStack>}>
          {LOG_LEVELS.map(value => <Button key={value} title={({silent:"静默",error:"错误",warning:"警告",info:"信息",debug:"调试"} as Record<string,string>)[value]??value} action={() => change("log-level", value)} />)}
        </Menu>
      </HStack>)}
      <VStack alignment="leading" spacing={4} frame={{minHeight:20,maxWidth:"infinity",alignment:"leading"}}>
        {busy ? <Text font={13} foregroundStyle="secondaryLabel">读取中…</Text> : null}
        {session.saving ? <Text font={13} foregroundStyle="secondaryLabel">保存中…</Text> : null}
        {err ? <Text font={13} foregroundStyle="secondaryLabel">{err}</Text> : null}
      </VStack>
    </VStack>
  </ScrollView>
}

function TestURLField() {
  const p = usePreferences(["testURL"])
  const [url, setURL] = useState(() => p.testURL), [error, setError] = useState("")
  const [draft] = useState({ value: p.testURL, editing: false })
  useEffect(() => { if (!draft.editing) { draft.value = p.testURL; setURL(p.testURL) } }, [p.testURL])
  function save() {
    const value = draft.value.trim()
    if (value === getPreferences().testURL) { setError(""); return }
    if (!/^https?:\/\/[^\s]+$/i.test(value) || /https?:\/\/[^/]*@/i.test(value)) { setError("请输入不含账号密码的 HTTP(S) 测速链接"); return }
    try { savePreferences({ testURL: value }); draft.value = value; setURL(value); setError("") }
    catch { setError("本地设置保存失败，请重试") }
  }
  return <VStack alignment="leading" spacing={4}>
    <TextField title="测速链接（策略组未指定时使用）" value={url} onFocus={() => { draft.editing = true }} onChanged={(value: string) => { draft.value = value; setURL(value); setError("") }} onBlur={() => { draft.editing = false; save() }} onSubmit={save} submitLabel="done" />
    {error ? <Text font={12} foregroundStyle="systemRed">{error}</Text> : null}
  </VStack>
}
export function GlobalConfigPage({ active }: { active: Controller | null }) {
  const p = usePreferences()
  const toggle = (key: keyof Preferences, title: string) => <Toggle key={key} title={title} value={!!p[key]} onChanged={(v: boolean) => update({ [key]: v })} />
  async function clear() {
    if (!await Dialog.confirm({ title: "清除图片缓存", message: "仅删除本脚本缓存的代理组图片；不会删除账号、密码、密钥、设置或日志。", confirmLabel: "清除" })) return
    const n = clearImageCache(); await Dialog.alert({ message: `已清除 ${n} 项脚本图片缓存；已显示图片在重新进入代理页后重载。` })
  }
  return <Form background="systemBackground" scrollContentBackground="hidden" navigationTitle="全局配置" navigationBarTitleDisplayMode="inline">
    <Section header={<Text>主题</Text>}><Choice title="外观模式" value={p.theme} values={[["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]]} onChanged={v => update({ theme: v as any })} /></Section>
    <Section header={<Text>启动设置</Text>}><Choice title="默认打开界面" value={p.defaultPage} values={[["overview", "主页"], ["proxies", "代理"], ["rules", "规则"], ["connections", "连接"], ["more", "更多"]]} onChanged={v => update({ defaultPage: v as any })} /></Section>
    <Section header={<Text>缓存管理</Text>}><Button title="清除图片缓存" action={clear} /></Section>
    <Section header={<Text>控制器管理</Text>}>{toggle("foldOffline", "自动折叠离线控制器")}</Section>
    <Section header={<Text>交互体验</Text>}>{toggle("haptics", "触感反馈")}</Section>
    <Section header={<Text>延迟阈值设置</Text>}><ThresholdRange /></Section>
    <Section header={<Text>网络请求</Text>}>
      <HeaderFields />
      {toggle("nestedDelay", "嵌套代理组延迟显示")}
    </Section>
    <Section header={<Text>连接超时</Text>}><Range title="连接超时时间" divider min={1} max={30} value={p.requestTimeout} suffix=" s" onChanged={n => update({ requestTimeout: n })} /></Section>
    <Section header={<Text>测速设置</Text>}><TestURLField /><Range title="超时时间" min={1000} max={10000} step={100} value={p.testTimeout} suffix=" ms" onChanged={n => update({ testTimeout: n })} /></Section>
    <Section header={<Text>运行日志</Text>}><Range title="最大记录条数" min={100} max={2000} step={100} value={p.logLimit} onChanged={n => update({ logLimit: n })} />{toggle("detailedAPI", "记录详细 API 请求")}</Section>
  </Form>
}
function CloudSettingsPage() {
  const [status, setStatus] = useState(Storage.get<string>("dashboard_cloud_last") ?? "尚未备份"), [busy, setBusy] = useState(false)
  async function transfer(read: boolean) {
    if (busy) return
    if (!FileManager.isiCloudEnabled) { await Dialog.alert({ message: "iCloud 不可用，请先在系统和 Scripting 中启用" }); return }
    if (!await Dialog.confirm({ title: read ? "从 iCloud 恢复设置" : "备份设置到 iCloud", message: read ? "覆盖外观与全局偏好，按 ID 合并控制器地址（不删除本地控制器）。已有密码保留，新增控制器需要重新填写密码。" : "上传控制器地址/用户名及外观与全局偏好，不含密码、密钥、请求头、日志或图片。测速链接可能含自定义参数，请确认没有秘密。", confirmLabel: read ? "恢复" : "备份" })) return
    setBusy(true)
    try {
      const file = FileManager.iCloudDocumentsDirectory + "/dashboard-preferences-v140.json"
      if (read) {
        await FileManager.downloadFileFromiCloud(file)
        const data = JSON.parse(await FileManager.readAsString(file))
        restoreBackup(data)
      } else {
        const backup = makeBackup(); validateBackup(backup)
        await FileManager.writeAsString(file, JSON.stringify(backup))
      }
      const text = `${read ? "已恢复" : "已提交 iCloud 备份"}：${new Date().toLocaleString()}`
      Storage.set("dashboard_cloud_last", text); setStatus(text)
    } catch { setStatus("操作失败，请检查备份格式、iCloud 文件、网络与权限；若本地存储失败，可能已部分合并，请检查控制器。未确认云端同步") } finally { setBusy(false) }
  }
  return <Form background="systemBackground" scrollContentBackground="hidden" navigationTitle="iCloud 设置备份" navigationBarTitleDisplayMode="inline"><Section footer={<Text>非原样同步：采用官方 FileManager 的 iCloud 文档，手动备份/恢复控制器地址与设置；不支持自动跨设备冲突合并或账号凭据同步。系统负责上传，脚本无法保证其他设备立即收到。</Text>}><Text>{status}</Text><Button title="立即备份" disabled={busy} action={() => transfer(false)} /><Button title="从 iCloud 恢复" disabled={busy} action={() => transfer(true)} /></Section></Form>
}
const LEVELS: [LogLevel, string, string][] = [["info", "信息", "systemBlue"], ["success", "成功", "systemGreen"], ["warning", "警告", "systemOrange"], ["error", "错误", "systemRed"]]
export function LogsPage() {
  const [logs, setLogs] = useState<AppLog[]>(getLogs()), [query, setQuery] = useState(""), [search, setSearch] = useState(false), [levels, setLevels] = useState<LogLevel[]>(LEVELS.map(x => x[0]))
  useEffect(() => { const t = setInterval(() => setLogs(getLogs()), 2000); return () => clearInterval(t) }, [])
  const shown = logs.filter(l => levels.includes(l.level) && (!query || (l.title + l.detail + l.category).toLowerCase().includes(query.toLowerCase()))).slice().reverse()
  async function clear() { if (await Dialog.confirm({ title: "清空运行日志", message: "将删除本脚本的全部应用日志，无法撤销。", confirmLabel: "清空" })) { clearLogs(); setLogs([]) } }
  return <Form background="systemBackground" scrollContentBackground="hidden" navigationTitle="运行日志" navigationBarTitleDisplayMode="inline" toolbar={{ topBarTrailing: <Menu label={<Image systemName="ellipsis.circle" />}>
    <Button title={search ? "隐藏搜索" : "搜索日志"} systemImage="magnifyingglass" action={() => setSearch(!search)} />
    {LEVELS.map(([v, title]) => <Button key={v} title={`${levels.includes(v) ? "✓ " : ""}${title}`} action={() => setLevels(s => s.includes(v) ? s.filter(x => x !== v) : [...s, v])} />)}
    <Button title="刷新" systemImage="arrow.clockwise" action={() => setLogs(getLogs())} />
    <Button title="复制全部" systemImage="doc.on.doc" action={async () => { try { await Pasteboard.setString(exportLogs()); await Dialog.alert({ message: "已复制全部日志（不受筛选影响）" }) } catch { await Dialog.alert({ message: "复制失败" }) } }} />
    <Button title="清空日志" systemImage="trash" action={clear} />
  </Menu> }}>
    <Section><Text foregroundStyle="secondaryLabel">{`${logs.length} 条日志 · 当前 ${shown.length} 条`}</Text>{search ? <TextField title="搜索日志" value={query} onChanged={setQuery} /> : null}</Section>
    <Section>{shown.map(l => <VStack key={l.id} alignment="leading" spacing={4}><HStack spacing={6}><Circle fill={LEVELS.find(x => x[0] === l.level)?.[2] ?? "systemBlue"} frame={{ width: 6, height: 6 }} /><Text font={12} foregroundStyle="secondaryLabel">{logTime(l.at)}</Text><Spacer /><Text font={11} foregroundStyle="secondaryLabel">{l.category}</Text></HStack><Text>{l.title + (l.count > 1 ? ` ×${l.count}` : "")}</Text>{l.detail ? <Text font={12} foregroundStyle="secondaryLabel">{l.detail}</Text> : null}</VStack>)}{!shown.length ? <Text foregroundStyle="secondaryLabel">暂无符合条件的应用日志</Text> : null}</Section>
  </Form>
}
