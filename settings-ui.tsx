import { Button, Circle, Form, HStack, Image, Label, Menu, NavigationLink, Picker, Section, SecureField, Slider, Spacer, Text, TextField, Toggle, VStack, useEffect, useState } from "scripting"
import { Controller, ClashConfig, CLASH_MODES, LOG_LEVELS, loadConfig, patchConfig } from "./api"
import { Preferences, AppLog, LogLevel, getPreferences, savePreferences, subscribePreferences, feedback, getLogs, clearLogs, exportLogs, logTime, getHeaderText, saveHeaders, clearImageCache } from "./preferences"

import { makeBackup, restoreBackup, validateBackup } from "./cloud-backup"

export function usePreferences() {
  const [p, setP] = useState(getPreferences())
  useEffect(() => subscribePreferences(() => setP(getPreferences())), [])
  return p
}
function update(patch: Partial<Preferences>) { try { savePreferences(patch); feedback() } catch { void Dialog.alert({ message: "本地设置保存失败，请重试" }) } }
function Choice({ title, value, values, onChanged, disabled = false }: { title: string; value: string; values: string[][]; onChanged: (v: string) => void; disabled?: boolean }) {
  return <Picker title={title} pickerStyle="menu" value={value} onChanged={onChanged} disabled={disabled}>{values.map(([v, l]) => <Text key={v} tag={v}>{l}</Text>)}</Picker>
}
function Range({ title, value, min, max, step = 1, suffix = "", onChanged }: { title: string; value: number; min: number; max: number; step?: number; suffix?: string; onChanged: (n: number) => void }) {
  return <VStack alignment="leading"><Text>{`${title}：${value}${suffix}`}</Text><Slider min={min} max={max} step={step} value={value} onChanged={onChanged} label={<Text>{title}</Text>} minValueLabel={<Text>{min}</Text>} maxValueLabel={<Text>{max}</Text>} /></VStack>
}

function ThresholdPage() {
  const p = usePreferences()
  const [green, setGreen] = useState(String(p.delayGreen)), [red, setRed] = useState(String(p.delayRed))
  async function save() {
    const a = Number(green), b = Number(red)
    if (!green.trim() || !red.trim() || !Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b > 10000 || a >= b) return Dialog.alert({ message: "请输入 1–10000 ms 内递增的两个整数" })
    try { savePreferences({ delayGreen: a, delayRed: b }); await Dialog.alert({ message: "延迟颜色阈值已保存" }) } catch { await Dialog.alert({ message: "保存失败" }) }
  }
  return <Form navigationTitle="延迟阈值范围" navigationBarTitleDisplayMode="inline">
    <Section footer={<Text>低于下限为绿色，下限到上限（含）为黄色，高于上限或超时为红色。</Text>}><TextField title="绿色上限（ms）" value={green} onChanged={setGreen} /><TextField title="黄色上限（ms）" value={red} onChanged={setRed} /><Button title="保存阈值" action={save} /></Section>
  </Form>
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
  return <Form navigationTitle="自定义代理组图标" navigationBarTitleDisplayMode="inline"><Section footer={<Text>本地替代：按组名配置 SF Symbols；未覆盖时使用内核提供的 HTTPS 图标（仅脚本管理的缓存）。不修改内核配置。</Text>}><TextField title="图标映射 JSON" value={text} onChanged={setText} prompt={'{"节点选择":"globe"}'} /><Button title="保存图标" action={save} /><Text foregroundStyle="secondaryLabel">{err}</Text></Section></Form>
}
export function AppearancePage() {
  const p = usePreferences()
  const toggle = (key: keyof Preferences, title: string) => <Toggle key={key} title={title} value={!!p[key]} onChanged={(v: boolean) => update({ [key]: v })} />
  async function clear() {
    if (!await Dialog.confirm({ title: "清除图片缓存", message: "仅删除本脚本缓存的代理组图片；不会删除账号、密码、密钥、设置或日志。", confirmLabel: "清除" })) return
    const n = clearImageCache(); await Dialog.alert({ message: `已清除 ${n} 项脚本图片缓存；已显示图片在重新进入代理页后重载。` })
  }
  return <Form navigationTitle="外观设置" navigationBarTitleDisplayMode="inline">
    <Section header={<Text>主题</Text>}><Choice title="外观模式" value={p.theme} values={[["system", "跟随系统"], ["light", "浅色"], ["dark", "深色"]]} onChanged={v => update({ theme: v as any })} /></Section>
    <Section header={<Text>列表与动画</Text>} footer={<Text>截图未展开代理卡片样式选项：此处简约为本地替代。碎片化移除原生粒子效果无官方接口，以系统淡出/缩小替代，仅用于连接移除，不改变控制器左滑删除。</Text>}>
      <Choice title="连接列表样式" value={p.connectionStyle} values={[["standard", "标准"], ["compact", "简约"]]} onChanged={v => update({ connectionStyle: v as any })} />
      <Choice title="代理卡片样式" value={p.proxyStyle} values={[["list", "列表"], ["compact", "简约（本地替代）"]]} onChanged={v => update({ proxyStyle: v as any })} />
      {toggle("collapseGesture", "卡片折叠菜单手势（长按组标题）")}{toggle("removalFade", "碎片化移除特效（淡出替代）")}
    </Section>
    <Section header={<Text>延迟阈值设置</Text>}><NavigationLink destination={<ThresholdPage />}><Text>{`延迟阈值范围　${p.delayGreen}–${p.delayRed} ms`}</Text></NavigationLink></Section>
    <Section header={<Text>代理组</Text>}>{toggle("showHidden", "显示隐藏代理组")}{toggle("customIcons", "自定义代理组图标")}<NavigationLink destination={<IconsPage />}><Label title="编辑组图标" systemImage="paintbrush" /></NavigationLink></Section>
    <Section header={<Text>概览页面</Text>} footer={<Text>水滴显示在上传/下载总量卡片；活动连接背景滚动显示真实连接主机（读取失败不展示）；点击卡片显示水波纹。动画为脚本绘制替代，并非原应用着色器。</Text>}>{toggle("showWrt", "显示 OpenWrt 状态")}{toggle("droplets", "水滴动画效果")}{toggle("connectionBackground", "连接信息背景")}{toggle("ripple", "概览卡片水波纹特效")}</Section>
    <Section header={<Text>缓存管理</Text>}><Button title="清除图片缓存" action={clear} /></Section>
  </Form>
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
    <Toggle value={p.headersEnabled} onChanged={(v: boolean) => update({ headersEnabled: v })}><Label title="自定义请求头" systemImage="network" /></Toggle>
    {p.headersEnabled ? rows.map((r, i) => <VStack key={i} spacing={0}>
      <HStack><Text>Key</Text><TextField title="例如 X-Is-Me" value={r.key} onChanged={(v: string) => edit(i, "key", v)} autocorrectionDisabled textInputAutocapitalization="never" /></HStack>
      <HStack><Text>Value</Text><TextField title="例如 YES" value={r.value} onChanged={(v: string) => edit(i, "value", v)} autocorrectionDisabled textInputAutocapitalization="never" /></HStack>
    </VStack>) : null}
    {error ? <Text font={12} foregroundStyle="systemRed">{error}</Text> : null}
  </>
}

export function KernelConfigPage({ c }: { c: Controller }) {
  const [cfg, setCfg] = useState<ClashConfig | null>(null), [dirty, setDirty] = useState<Record<string, any>>({}), [err, setErr] = useState(""), [busy, setBusy] = useState(false)
  async function reload() { setBusy(true); try { setCfg(await loadConfig(c)); setDirty({}); setErr("") } catch { setErr("读取内核配置失败，请检查控制器连接与权限后重试") } finally { setBusy(false) } }
  useEffect(() => { void reload() }, [c.id])
  const change = (key: string, v: any) => setDirty(d => ({ ...d, [key]: v }))
  async function save() {
    if (!cfg || busy) return
    const patch: any = {}
    for (const [k, v] of Object.entries(dirty)) {
      if (k.endsWith("port") || k === "port") {
        if (!String(v).trim() || !/^\d+$/.test(String(v)) || Number(v) > 65535) { setErr("端口必须为 0–65535 的整数；空值不会写回"); return }
        if (Number(v) !== (cfg as any)[k]) patch[k] = Number(v)
      } else if (v !== (cfg as any)[k]) patch[k] = v
    }
    if (!Object.keys(patch).length) { setErr("没有待保存的更改"); return }
    if (!await Dialog.confirm({ title: `保存到 ${c.name} 的代理内核`, message: `仅 PATCH：${Object.keys(patch).join("、")}。不会修改 OpenWrt UCI 文件；内核重启后可能被插件配置覆盖。端口或 LAN 修改可能影响连接。`, confirmLabel: "保存" })) return
    setBusy(true)
    try { await patchConfig(c, patch); setCfg({ ...cfg, ...patch }); setDirty({}); setErr("已保存到当前代理内核（仅本次运行配置）"); feedback() } catch { setErr("保存失败；未确认的改动保留，请检查控制器后重试。若响应丢失，请重新读取核对。") } finally { setBusy(false) }
  }
  const field = (key: string, title: string) => <TextField key={key} title={title} value={String(dirty[key] ?? (cfg as any)?.[key] ?? "")} prompt="未返回，不写回" onChanged={(v: string) => change(key, v)} disabled={busy || (cfg as any)?.[key] === undefined} />
  return <Form navigationTitle="代理内核配置" navigationBarTitleDisplayMode="inline">
    <Section header={<Text>{c.name}</Text>} footer={<Text>先读取，修改后点击保存。缺失字段不显示假默认值，也不会写回。仅影响所选控制器的 Mihomo/Clash 运行配置。</Text>}>
      {cfg ? <>
        {cfg.mode !== undefined ? <Choice disabled={busy} title="运行模式" value={dirty.mode ?? cfg.mode} values={CLASH_MODES} onChanged={v => change("mode", v)} /> : null}
        {cfg["log-level"] !== undefined ? <Choice disabled={busy} title="内核日志级别（非应用日志）" value={dirty["log-level"] ?? cfg["log-level"]!} values={LOG_LEVELS.map(v => [v, v])} onChanged={v => change("log-level", v)} /> : null}
        {cfg["allow-lan"] !== undefined ? <Toggle title="允许局域网连接" value={dirty["allow-lan"] ?? cfg["allow-lan"]!} onChanged={(v: boolean) => change("allow-lan", v)} disabled={busy} /> : null}
        {field("port", "HTTP 端口（0 关闭）")}{field("socks-port", "SOCKS 端口")}{field("mixed-port", "混合端口")}
        <Button title={busy ? "处理中…" : "保存修改字段"} disabled={busy || !Object.keys(dirty).length} action={save} />
      </> : <Text>{busy ? "读取中…" : "尚未读取配置"}</Text>}
      <Button title="重新读取（丢弃未保存修改）" disabled={busy} action={async () => { if (!Object.keys(dirty).length || await Dialog.confirm({ title: "重新读取", message: "丢弃当前未保存修改？", confirmLabel: "重新读取" })) await reload() }} />
      {err ? <Text foregroundStyle="secondaryLabel">{err}</Text> : null}
    </Section>
  </Form>
}
export function GlobalConfigPage({ active }: { active: Controller | null }) {
  const p = usePreferences(), [url, setURL] = useState(p.testURL)
  const toggle = (key: keyof Preferences, title: string) => <Toggle key={key} title={title} value={!!p[key]} onChanged={(v: boolean) => update({ [key]: v })} />
  async function saveURL() {
    if (!/^https?:\/\/[^\s]+$/i.test(url) || /https?:\/\/[^/]*@/i.test(url)) return Dialog.alert({ message: "请输入不含账号密码的 HTTP(S) 测速链接" })
    try { savePreferences({ testURL: url.trim() }); await Dialog.alert({ message: "测速链接已保存；下一次测速生效" }) } catch { await Dialog.alert({ message: "保存失败" }) }
  }
  return <Form navigationTitle="全局配置" navigationBarTitleDisplayMode="inline">
    <Section header={<Text>控制器管理</Text>}>{toggle("foldOffline", "自动折叠离线控制器")}</Section>
    <Section header={<Text>切换代理设置</Text>}>{toggle("disconnectOnSwitch", "自动断开旧连接")}</Section>
    <Section header={<Text>交互体验</Text>}>{toggle("haptics", "触感反馈")}</Section>
    <Section header={<Text>启动设置</Text>}><Choice title="默认打开界面" value={p.defaultPage} values={[["overview", "主页"], ["proxies", "代理"], ["rules", "规则"], ["connections", "连接"], ["more", "更多"]]} onChanged={v => update({ defaultPage: v as any })} /></Section>
    <Section header={<Text>网络请求</Text>}>
      <HeaderFields />
      {toggle("nestedDelay", "嵌套代理组延迟显示")}
      <Choice title="代理组节点排序" value={p.nodeSort} values={[["default", "默认（配置顺序）"], ["delay", "延迟（超时最后）"], ["name", "名称"]]} onChanged={v => update({ nodeSort: v as any })} />
      {toggle("showGlobal", "显示 Global 代理组")}
      <Range title="连接超时时间" min={1} max={30} value={p.requestTimeout} suffix=" s" onChanged={n => update({ requestTimeout: n })} />
    </Section>
    <Section header={<Text>测速设置</Text>}><TextField title="测速链接" value={url} onChanged={setURL} /><Button title="保存测速链接" action={saveURL} /><Range title="超时时间" min={1000} max={10000} step={100} value={p.testTimeout} suffix=" ms" onChanged={n => update({ testTimeout: n })} /></Section>
    <Section header={<Text>运行日志</Text>}><Range title="最大记录条数" min={100} max={2000} step={100} value={p.logLimit} onChanged={n => update({ logLimit: n })} />{toggle("detailedAPI", "记录详细 API 请求（安全摘要）")}</Section>
    <Section header={<Text>iCloud 同步</Text>}><NavigationLink destination={<CloudSettingsPage />}><Label title="iCloud 控制器与设置备份（手动替代）" systemImage="icloud" /></NavigationLink></Section>
    <Section header={<Text>代理内核</Text>}>{active ? <NavigationLink destination={<KernelConfigPage c={active} />}><Label title="读取 / 修改当前控制器内核配置" systemImage="gearshape.2" /></NavigationLink> : <Text>请先添加控制器</Text>}</Section>
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
  return <Form navigationTitle="iCloud 设置备份" navigationBarTitleDisplayMode="inline"><Section footer={<Text>非原样同步：采用官方 FileManager 的 iCloud 文档，手动备份/恢复控制器地址与设置；不支持自动跨设备冲突合并或账号凭据同步。系统负责上传，脚本无法保证其他设备立即收到。</Text>}><Text>{status}</Text><Button title="立即备份" disabled={busy} action={() => transfer(false)} /><Button title="从 iCloud 恢复" disabled={busy} action={() => transfer(true)} /></Section></Form>
}
const LEVELS: [LogLevel, string, string][] = [["info", "信息", "systemBlue"], ["success", "成功", "systemGreen"], ["warning", "警告", "systemOrange"], ["error", "错误", "systemRed"]]
export function LogsPage() {
  const [logs, setLogs] = useState<AppLog[]>(getLogs()), [query, setQuery] = useState(""), [search, setSearch] = useState(false), [levels, setLevels] = useState<LogLevel[]>(LEVELS.map(x => x[0]))
  useEffect(() => { const t = setInterval(() => setLogs(getLogs()), 2000); return () => clearInterval(t) }, [])
  const shown = logs.filter(l => levels.includes(l.level) && (!query || (l.title + l.detail + l.category).toLowerCase().includes(query.toLowerCase()))).slice().reverse()
  async function clear() { if (await Dialog.confirm({ title: "清空运行日志", message: "将删除本脚本的全部应用日志，无法撤销。", confirmLabel: "清空" })) { clearLogs(); setLogs([]) } }
  return <Form navigationTitle="运行日志" navigationBarTitleDisplayMode="inline" toolbar={{ topBarTrailing: <Menu label={<Image systemName="ellipsis.circle" />}>
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
