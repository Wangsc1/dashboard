import {
  Animation, Transition, Button, ForEach, Form, HStack, Label, Navigation, NavigationLink, NavigationStack, Picker, Script, Section, SecureField, Spacer,
  Image, Menu, RoundedRectangle, Circle, ScrollView, SVG, Text, ZStack, modifiers, TextField, Toggle, VStack, TabView, Tab, useObservable, useEffect, useState,
} from "scripting"
import {
  VERSION, Controller, Group, Conn, Rule, Overview, Plugin, PLUGINS, listControllers, saveController, removeController, getActive, setActive, getSecret, getClashSecret,
  loadOverview, loadClashOverview, loadWrtInterfaces, loadWrtLeases, WrtIface, WrtLease, loadGroups, selectProxy, testGroup, loadConnections, closeConnection,
  closeAllConnections, loadRules, fmtBytes, fmtSpeed, fmtParts, fmtUptime, fmtDuration, delayColor,
} from "./api"

import { useSmoothPlot } from "./chart-ui"
import { CHART_HISTORY } from "./chart"
import { AppearancePage, GlobalConfigPage, LogsPage, KernelConfigPage, usePreferences } from "./settings-ui"
import { getPreferences, controllerHealth, cachedIcon, feedback, recordEvent } from "./preferences"

const msg = (e: any) => String(e?.message ?? e ?? "未知错误")

// ---------- 通用：自动定时刷新 ----------
function useInterval(fn: () => void, ms: number, deps: any[]) {
  useEffect(() => {
    fn()
    const t = setInterval(fn, ms)
    return () => clearInterval(t)
  }, deps)
}

function NoController() {
  return <Section><Text foregroundStyle="secondaryLabel">尚未添加控制器，请到“设置”页添加 OpenWrt 路由器。</Text></Section>
}

// ---------- 概览 ----------
const MAIN_FG = { light: "#41434B", dark: "#CFD0D7" }
const CARD_BG = "secondarySystemBackground"
const cardMods = () => modifiers().frame({ maxWidth: "infinity", alignment: "leading" as any }).padding({ horizontal: 16, vertical: 14 }).background(<RoundedRectangle cornerRadius={22} fill={CARD_BG} />)
function Card({ children }: { children?: any }) {
  return <VStack alignment="leading" spacing={10} foregroundStyle={MAIN_FG} font={14} modifiers={cardMods()}>{children}</VStack>
}
function Badge({ icon, color }: { icon: string; color: string }) {
  return <ZStack modifiers={modifiers().frame({ width: 20, height: 20 }).background(<RoundedRectangle cornerRadius={6} fill={`rgba(${parseInt(color.slice(1,3),16)},${parseInt(color.slice(3,5),16)},${parseInt(color.slice(5,7),16)},0.15)`} />)}>
    <Image systemName={icon} resizable scaleToFit foregroundStyle={color as any} frame={{ width: 11, height: 11 }} />
  </ZStack>
}
function Big({ parts }: { parts: [string, string] | null }) {
  const target = parts?.[0] ?? "-", unit = parts?.[1] ?? ""
  const [shown, setShown] = useState(target)
  const [track] = useState({ value: target, unit })
  useEffect(() => {
    const start = Number(track.value), end = Number(target)
    if (!Number.isFinite(start) || !Number.isFinite(end) || track.unit !== unit) {
      track.value = target; track.unit = unit; setShown(target); return
    }
    const at = Date.now(), decimals = target.includes(".") ? target.split(".")[1].length : 0
    const t = setInterval(() => {
      const p = Math.min(1, (Date.now() - at) / 280)
      const next = (start + (end - start) * (1 - Math.pow(1 - p, 3))).toFixed(decimals)
      track.value = next; setShown(next)
      if (p === 1) clearInterval(t)
    }, 40)
    return () => clearInterval(t)
  }, [target, unit])
  // 普通 Text 保持可见，不再依赖原生 numericText 转场；数字以插值平滑更新。
  return <Text font={24} fontWeight="bold" foregroundStyle={MAIN_FG} lineLimit={1}
    frame={{ maxWidth: "infinity", minHeight: 34, alignment: "leading" }}>
    {`${shown}${unit ? " " + unit : ""}`}
  </Text>
}
const HIST = CHART_HISTORY
const STAT_HEIGHT = 104
function Spark({ data, color, floor = 1024, enabled = true }: { data: number[]; color: string; floor?: number; enabled?: boolean }) {
  const W = 100, H = STAT_HEIGHT
  const plot = useSmoothPlot(data, undefined, enabled, W, H, floor, 2)
  const line = plot.paths[0]
  const firstX = plot.points[0][0]?.x ?? W
  const area = line ? `${line} L ${W},${H} L ${firstX},${H} Z` : ""
  const code = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${area}" fill="${color}" fill-opacity="0.10"/><path d="${line}" fill="none" stroke="${color}" stroke-opacity="0.28" stroke-width="1.4" stroke-linecap="round"/></svg>`
  return <SVG code={code} resizable frame={{ maxWidth: "infinity", height: STAT_HEIGHT }} />
}
function StatCard({ icon, color, title, parts, spark, floor, droplets, connectionHosts, enabled = true }: { icon: string; color: string; title: string; parts: [string, string] | null; spark?: number[]; floor?: number; droplets?: boolean; connectionHosts?: string[]; enabled?: boolean }) {
  const p = usePreferences()
  const [phase, setPhase] = useState(0), [rippleAt, setRippleAt] = useState(0), [wave, setWave] = useState(0)
  useEffect(() => {
    if (!enabled || (!(p.droplets && droplets) && !(p.connectionBackground && connectionHosts?.length))) return
    const t = setInterval(() => setPhase(v => (v + 1) % 7200), 120)
    return () => clearInterval(t)
  }, [p.droplets, p.connectionBackground, droplets, connectionHosts?.length, enabled])
  useEffect(() => {
    if (!enabled || !rippleAt || !p.ripple) return
    const t = setInterval(() => {
      const age = Date.now() - rippleAt
      if (age > 650) { setRippleAt(0); setWave(0); clearInterval(t) } else setWave(age / 650)
    }, 35)
    return () => clearInterval(t)
  }, [rippleAt, p.ripple, enabled])
  const dropletSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100">${[0, 1, 2, 3].map(i => `<path d="M ${24+i*34} ${(phase*3+i*24)%115-12} q -9 12 0 14 q 9 -2 0 -14" fill="${color}" opacity="0.10"/>`).join("")}</svg>`
  const rippleSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 104"><circle cx="80" cy="52" r="${wave * 100}" stroke="${color}" fill="none" stroke-width="3" opacity="${(1-wave)*0.25}"/></svg>`
  return <ZStack alignment="bottom" frame={{ maxWidth: "infinity", height: STAT_HEIGHT }}
    onTapGesture={() => { if (p.ripple) { setRippleAt(Date.now()); feedback() } }}
    clipShape={{ type: "rect", cornerRadius: 22 }}>
    <RoundedRectangle cornerRadius={22} fill={CARD_BG} />
    {spark ? <Spark data={spark} color={color} floor={floor} enabled={enabled} /> : null}
    {p.droplets && droplets ? <SVG code={dropletSVG} resizable frame={{ maxWidth: "infinity", height: 100 }} /> : null}
    {p.connectionBackground && connectionHosts?.length ? <Text font={10} foregroundStyle="tertiaryLabel" lineLimit={1} padding={{ bottom: 5 }} offset={{ x: 60 - (phase % 60) * 3, y: 0 }}>{connectionHosts[Math.floor(phase / 60) % connectionHosts.length]}</Text> : null}
    {p.ripple && rippleAt ? <SVG code={rippleSVG} resizable frame={{ maxWidth: "infinity", height: STAT_HEIGHT }} /> : null}
    <VStack alignment="leading" spacing={10} foregroundStyle={MAIN_FG}
      modifiers={modifiers().frame({ maxWidth: "infinity", height: 78, alignment: "topLeading" }).padding({ horizontal: 14, vertical: 11 })}>
      <HStack spacing={8}><Badge icon={icon} color={color} /><Text font={13} foregroundStyle="secondaryLabel">{title}</Text></HStack>
      <Big parts={parts} />
      <Spacer />
    </VStack>
  </ZStack>
}
function InfoItem({ icon, color, title, value }: { icon: string; color: string; title: string; value: string }) {
  return <HStack spacing={8} frame={{ maxWidth: "infinity", alignment: "leading" as any }}>
    <Badge icon={icon} color={color} />
    <VStack alignment="leading" spacing={1}><Text font={13} foregroundStyle="secondaryLabel">{title}</Text><Text fontWeight="semibold">{value}</Text></VStack>
  </HStack>
}
function RateChart({ down, up, enabled = true }: { down: number[]; up: number[]; enabled?: boolean }) {
  const W = 300, H = 120
  const plot = useSmoothPlot(down, up, enabled, W, H)
  const max = plot.scale
  const line = (i: number, color: string) => plot.paths[i] ? `<path d="${plot.paths[i]}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>` : ""
  const code = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${line(0, "#3B82F6")}${line(1, "#34C759")}</svg>`
  const label = (f: number) => fmtSpeed(max * f)
  return <Card>
    <HStack>
      <HStack spacing={8}><Badge icon="chart.xyaxis.line" color="#6366F1" /><Text fontWeight="semibold" font={15}>速率图表</Text></HStack>
      <Spacer />
      <HStack spacing={4}><Circle fill="#3B82F6" frame={{ width: 5, height: 5 }} /><Text font={12} foregroundStyle="secondaryLabel">下载</Text></HStack><HStack spacing={4}><Circle fill="#34C759" frame={{ width: 5, height: 5 }} /><Text font={12} foregroundStyle="secondaryLabel">上传</Text></HStack>
    </HStack>
    <HStack alignment="top" spacing={8} frame={{ maxWidth: "infinity" }}>
      <VStack alignment="leading" spacing={0} frame={{ width: 72, height: H }}>
        {[1, 0.75, 0.5, 0.25].map(f => <VStack key={String(f)} spacing={0}>
          <HStack spacing={0}><Text font={11} lineLimit={1} fixedSize={{ horizontal: true, vertical: false }} foregroundStyle="secondaryLabel">{label(f)}</Text><Spacer /></HStack>
          <Spacer />
        </VStack>)}
      </VStack>
      <SVG code={code} resizable frame={{ maxWidth: "infinity", height: H }} />
    </HStack>
  </Card>
}

function OverviewPage({ active, version, onSwitch }: { active: Controller | null; version: number; onSwitch: () => void }) {
  const prefs = usePreferences()
  const [hosts, setHosts] = useState<string[]>([])
  const [ov, setOv] = useState<Overview | null>(null)
  const [err, setErr] = useState("")
  const [dn, setDn] = useState<number[]>([])
  const [upH, setUpH] = useState<number[]>([])
  const [visible, setVisible] = useState(true)
  const all = listControllers()
  const [page, setPage] = useState<"" | "settings" | "appearance" | "global" | "logs">("")
  const showCharts = visible && page === ""
  useEffect(() => { setDn([]); setUpH([]); setOv(null) }, [active?.id, active?.url])
  useEffect(() => {
    if (!active || !showCharts) return
    if (active.kind !== "openwrt") { setErr("主页仅支持 OpenWrt 路由器数据，请在设置添加 OpenWrt"); return }
    let alive = true, refreshing = false
    async function refresh() {
      if (!alive || refreshing) return
      refreshing = true
      try {
        const o = await loadOverview(active!)
        if (alive) { setOv(o); setErr(""); setDn(h => [...h, o.traffic.down].slice(-HIST)); setUpH(h => [...h, o.traffic.up].slice(-HIST)) }
      } catch (e) { if (alive) setErr(msg(e)) }
      finally { refreshing = false }
    }
    void refresh(); const t = setInterval(refresh, 1000)
    return () => { alive = false; clearInterval(t) }
  }, [active?.id, active?.url, version, showCharts])
  useEffect(() => {
    setHosts([])
    if (!active || !prefs.connectionBackground || !showCharts) return
    let alive = true
    const read = () => loadConnections(active).then(xs => { if (alive) setHosts(xs.map(x => x.host).filter(Boolean).slice(0, 20)) }).catch(() => { if (alive) setHosts([]) })
    void read(); const t = setInterval(read, 10000)
    return () => { alive = false; clearInterval(t) }
  }, [active?.id, prefs.connectionBackground, showCharts])
  const rate = ov?.traffic ?? null
  const w = ov?.wrt
  const memUsed = w ? Math.max(0, w.memTotal - w.memFree) : 0
  const toolbar = {
    topBarTrailing: <Menu label={<Image systemName="ellipsis.circle" />}>
      <Button title="设置" systemImage="gearshape" action={() => setPage("settings")} />
      <Button title="运行日志" systemImage="doc.text" action={() => setPage("logs")} />
      <Button title="外观设置" systemImage="paintpalette" action={() => setPage("appearance")} />
      <Button title="全局配置" systemImage="slider.horizontal.3" action={() => setPage("global")} />
    </Menu>,
  }
  const destination = {
    isPresented: page !== "",
    onChanged: (v: boolean) => { if (!v) setPage("") },
    content: page === "settings" ? <SettingsPage active={active} onChanged={onSwitch} />
      : page === "appearance" ? <AppearancePage />
      : page === "global" ? <GlobalConfigPage active={active} />
      : page === "logs" ? <LogsPage />
      : <Text>-</Text>,
  }
  if (!active) return <Form navigationTitle="dashboard" navigationBarTitleDisplayMode="inline" toolbar={toolbar} navigationDestination={destination}><NoController /></Form>
  return <ScrollView onAppear={() => setVisible(true)} onDisappear={() => setVisible(false)} navigationTitle={active.name} navigationBarTitleDisplayMode="inline" toolbar={toolbar} navigationDestination={destination}>
    <VStack spacing={12} padding={{ horizontal: 14, vertical: 8 }}>
      {all.length > 1 ? <Card>
        <Picker title="当前路由器" pickerStyle="menu" value={active.id} onChanged={(v: string) => { setActive(v); onSwitch() }}>
          {all.map(c => <Text key={c.id} tag={c.id}>{c.name}</Text>)}
        </Picker>
      </Card> : null}
      {err ? <Text font={13} foregroundStyle="systemRed">{err}</Text> : null}

      {prefs.showWrt ? <Card>
        <HStack>
          <Badge icon="laptopcomputer" color="#6366F1" />
          <Text fontWeight="semibold" font={15}>OpenWrt 状态</Text>
          <Spacer />
          <HStack spacing={4}><Circle fill={err ? "systemRed" : "systemGreen"} frame={{ width: 5, height: 5 }} /><Text font={12} foregroundStyle={err ? "systemRed" : "systemGreen"}>{err ? "连接失败" : ov ? "运行正常" : "连接中"}</Text></HStack>
        </HStack>
        <InfoItem icon="clock" color="#3B82F6" title="运行时间" value={w ? fmtUptime(w.uptime, true) : "-"} />
        <InfoItem icon="waveform.path.ecg" color="#F59E0B" title="系统负载" value={w ? w.load.map(v => v.toFixed(2)).join(" ") : "-"} />
      </Card> : null}

      <HStack spacing={12}>
        <StatCard enabled={showCharts} icon="arrow.down.circle.fill" color="#3B82F6" title="下载速率" parts={rate ? fmtParts(rate.down, true) : null} spark={dn} />
        <StatCard enabled={showCharts} icon="arrow.up.circle.fill" color="#34C759" title="上传速率" parts={rate ? fmtParts(rate.up, true) : null} spark={upH} />
      </HStack>
      <HStack spacing={12}>
        <StatCard enabled={showCharts} icon="icloud.and.arrow.down.fill" color="#3B82F6" title="下载总量" droplets parts={ov ? fmtParts(ov.downTotal) : null} />
        <StatCard enabled={showCharts} icon="icloud.and.arrow.up.fill" color="#34C759" title="上传总量" droplets parts={ov ? fmtParts(ov.upTotal) : null} />
      </HStack>
      <HStack spacing={12}>
        <StatCard enabled={showCharts} icon="link" color="#A855F7" title="活动连接" connectionHosts={hosts} parts={ov ? [String(ov.connCount), ""] : null} />
        <StatCard enabled={showCharts} icon="square.stack.3d.up.fill" color="#F59E0B" title="内存使用" parts={w ? fmtParts(memUsed) : null} />
      </HStack>

      <RateChart down={dn} up={upH} enabled={showCharts} />


    </VStack>
  </ScrollView>
}

// ---------- 策略组 ----------
function GroupIcon({ g }: { g: Group }) {
  const p = usePreferences(), [image, setImage] = useState<any>(null)
  const symbol = p.groupIcons[g.name]
  useEffect(() => {
    let alive = true; setImage(null)
    if (p.customIcons && !symbol && g.icon) cachedIcon(g.icon).then(img => { if (alive) setImage(img) }).catch(() => {})
    return () => { alive = false }
  }, [p.customIcons, symbol, g.icon])
  if (!p.customIcons) return null
  return image ? <Image image={image} resizable scaleToFit frame={{ width: 20, height: 20 }} /> : <Image systemName={symbol || "point.3.connected.trianglepath.dotted"} frame={{ width: 20, height: 20 }} />
}
function GroupSection({ c, g, onChanged }: { c: Controller; g: Group; onChanged: () => void }) {
  const prefs = usePreferences()
  const [delays, setDelays] = useState<Record<string, number>>(g.delays)
  useEffect(() => setDelays(g.delays), [g.delays])
  const [testing, setTesting] = useState(false)
  const [open, setOpen] = useState(false)
  async function test() {
    setTesting(true)
    try { setDelays(await testGroup(c, g)) } catch (e) { await Dialog.alert({ message: msg(e) }) } finally { setTesting(false) }
  }
  async function pick(n: string) {
    if (n === g.now) return
    try { await selectProxy(c, g.name, n); onChanged() } catch (e) { await Dialog.alert({ message: msg(e) }) }
  }
  const nodes = [...g.all]
  if (prefs.nodeSort === "name") nodes.sort((a, b) => a.localeCompare(b))
  if (prefs.nodeSort === "delay") nodes.sort((a, b) => (delays[a] > 0 ? delays[a] : Infinity) - (delays[b] > 0 ? delays[b] : Infinity))
  return <Section header={<HStack onLongPressGesture={() => { if (prefs.collapseGesture) { setOpen(!open); feedback() } }}><GroupIcon g={g} /><Text>{g.name}</Text><Spacer />{prefs.proxyStyle === "list" ? <Text>{g.type}</Text> : null}</HStack>}
    footer={prefs.proxyStyle === "list" ? <Text>{`当前：${g.now || "-"}`}</Text> : undefined}>
    <HStack>
      <Button title={open ? "收起节点" : `展开节点（${g.all.length}）`} action={() => { setOpen(!open); feedback() }} />
      <Spacer />
      <Button title={testing ? "测速中…" : "测速"} systemImage="bolt.fill" disabled={testing} action={test} />
    </HStack>
    {open ? nodes.map(n => <Button key={n} action={() => pick(n)}>
      <HStack>
        <Text font={prefs.proxyStyle === "compact" ? 12 : 15} foregroundStyle={n === g.now ? "systemBlue" : "label"}>{`${n === g.now ? "✓ " : ""}${n}`}</Text>
        <Spacer />
        {delays[n] !== undefined ? <Text font={13} foregroundStyle={delayColor(delays[n]) as any}>{delays[n] > 0 ? `${delays[n]} ms` : "超时"}</Text> : null}
      </HStack>
    </Button>) : null}
  </Section>
}
function ProxiesPage({ active, version }: { active: Controller | null; version: number }) {
  const prefs = usePreferences()
  const [groups, setGroups] = useState<Group[]>([])
  const [err, setErr] = useState("")
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    let alive = true
    loadGroups(active).then(g => { if (alive) { setGroups(g); setErr("") } }).catch(e => { if (alive) setErr(msg(e)) })
    return () => { alive = false }
  }, [active?.id, version, tick, prefs.nestedDelay, prefs.showHidden, prefs.showGlobal])
  return <Form navigationTitle="策略组" navigationBarTitleDisplayMode="inline"
    toolbar={{ primaryAction: <Button title="刷新" systemImage="arrow.clockwise" action={() => setTick(tick + 1)} /> }}>
    {!active ? <NoController /> : <>
      {err ? <Section><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
      {groups.map(g => <GroupSection key={g.name + tick + (active?.id ?? "")} c={active} g={g} onChanged={() => setTick(tick + 1)} />)}
    </>}
  </Form>
}

// ---------- 连接 ----------
function ConnectionsPage({ active, version }: { active: Controller | null; version: number }) {
  const prefs = usePreferences()
  const [conns, setConns] = useState<Conn[]>([])
  const [err, setErr] = useState("")
  const [q, setQ] = useState("")
  async function refresh() {
    if (!active) return
    try { setConns(await loadConnections(active)); setErr("") } catch (e) { setErr(msg(e)) }
  }
  useInterval(refresh, 3000, [active?.id, version])
  const shown = conns.filter(x => !q || (x.host + x.chain + x.rule + x.src).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.start - a.start).slice(0, 200)
  async function close(x: Conn) {
    if (!active) return
    if (await Dialog.confirm({ title: "断开连接", message: x.host, confirmLabel: "断开" })) {
      try { await closeConnection(active, x.id); await refresh() } catch (e) { await Dialog.alert({ message: msg(e) }) }
    }
  }
  async function closeAll() {
    if (!active) return
    if (await Dialog.confirm({ title: "断开全部连接", message: `共 ${conns.length} 条`, confirmLabel: "全部断开" })) {
      try { await closeAllConnections(active); await refresh() } catch (e) { await Dialog.alert({ message: msg(e) }) }
    }
  }
  return <Form navigationTitle={`连接 (${conns.length})`} navigationBarTitleDisplayMode="inline"
    toolbar={{ primaryAction: <Button title="全部断开" systemImage="xmark.circle" action={closeAll} /> }}>
    {!active ? <NoController /> : <>
      <Section><TextField title="筛选" value={q} onChanged={setQ} prompt="域名 / 规则 / 节点 / 源地址" /></Section>
      {err ? <Section><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
      <Section animation={prefs.removalFade ? { animation: Animation.easeOut(0.3), value: shown.map(x => x.id).join(",") } : undefined} footer={conns.length > shown.length ? <Text>仅显示最新 200 条；点击条目可断开</Text> : <Text>点击条目可断开</Text>}>
        {shown.map(x => <Button key={x.id} transition={prefs.removalFade ? Transition.opacity().combined(Transition.scale(0.85)) : undefined} action={() => close(x)}>
          <VStack alignment="leading" spacing={2}>
            <Text font={15}>{x.host}</Text>
            {prefs.connectionStyle === "standard" ? <Text font={12} foregroundStyle="secondaryLabel">{`${x.network} ${x.src} → ${x.dst}`}</Text> : null}
            {prefs.connectionStyle === "standard" ? <Text font={12} foregroundStyle="secondaryLabel">{`${x.chain || "-"} | ${x.rule || "-"}`}</Text> : null}
            <Text font={12} foregroundStyle="secondaryLabel">{`↑${fmtBytes(x.up)} ↓${fmtBytes(x.down)} · ${fmtDuration(x.start)}`}</Text>
          </VStack>
        </Button>)}
      </Section>
    </>}
  </Form>
}

// ---------- 规则 ----------
function RulesPage({ active, version }: { active: Controller | null; version: number }) {
  const [rules, setRules] = useState<Rule[]>([])
  const [err, setErr] = useState("")
  const [q, setQ] = useState("")
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!active) return
    let alive = true
    setLoading(true)
    loadRules(active).then(r => { if (alive) { setRules(r); setErr("") } }).catch(e => { if (alive) setErr(msg(e)) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [active?.id, version])
  const shown = rules.filter(r => !q || (r.type + r.payload + r.proxy).toLowerCase().includes(q.toLowerCase()))
  return <Form navigationTitle={`规则 (${rules.length})`} navigationBarTitleDisplayMode="inline">
    {!active ? <NoController /> : <>
      <Section><TextField title="筛选" value={q} onChanged={setQ} prompt="类型 / 内容 / 策略" /></Section>
      {err ? <Section><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
      <Section footer={shown.length > 300 ? <Text>仅显示前 300 条，请用筛选缩小范围</Text> : loading ? <Text>加载中…</Text> : undefined}>
        {shown.slice(0, 300).map((r, i) => <VStack key={String(i)} alignment="leading" spacing={2}>
          <Text font={15}>{r.payload || r.type}</Text>
          <Text font={12} foregroundStyle="secondaryLabel">{`${r.type} → ${r.proxy}`}</Text>
        </VStack>)}
      </Section>
    </>}
  </Form>
}

// ---------- OpenWrt 页面 ----------
function WrtInterfacesPage({ active, version }: { active: Controller; version: number }) {
  const [list, setList] = useState<WrtIface[]>([])
  const [err, setErr] = useState("")
  useInterval(() => { loadWrtInterfaces(active).then(l => { setList(l); setErr("") }).catch(e => setErr(msg(e))) }, 5000, [active.id, version])
  return <Form navigationTitle="网络接口" navigationBarTitleDisplayMode="inline">
    {err ? <Section><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
    <Section>
      {list.map(i => <VStack key={i.name} alignment="leading" spacing={2}>
        <HStack><Text>{i.name}</Text><Spacer /><Text font={13} foregroundStyle={i.up ? "systemGreen" : "systemRed"}>{i.up ? "已连接" : "未连接"}</Text></HStack>
        <Text font={12} foregroundStyle="secondaryLabel">{`${i.proto || "-"} · ${i.device || "-"} · ${i.ip || "无 IPv4"}${i.up ? " · " + fmtUptime(i.uptime) : ""}`}</Text>
      </VStack>)}
    </Section>
  </Form>
}
function WrtLeasesPage({ active, version }: { active: Controller; version: number }) {
  const [list, setList] = useState<WrtLease[]>([])
  const [err, setErr] = useState("")
  useInterval(() => { loadWrtLeases(active).then(l => { setList(l); setErr("") }).catch(e => setErr(msg(e))) }, 10000, [active.id, version])
  return <Form navigationTitle={`在线设备 (${list.length})`} navigationBarTitleDisplayMode="inline">
    {err ? <Section><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
    <Section footer={<Text>来自 DHCP 租约，不含静态地址设备。</Text>}>
      {list.map(l => <VStack key={l.mac + l.ip} alignment="leading" spacing={2}>
        <Text>{l.host || "未命名设备"}</Text>
        <Text font={12} foregroundStyle="secondaryLabel">{`${l.ip} · ${l.mac}`}</Text>
      </VStack>)}
    </Section>
  </Form>
}

// ---------- 设置 ----------
function HelpPage() {
  return <Form navigationTitle="使用说明" navigationBarTitleDisplayMode="inline">
    <Section header={<Text>OpenWrt</Text>}>
      <Text>地址填路由器 LuCI 后台的 IP，端口为 LuCI 的端口（默认 80；开启 HTTPS 时通常 443）。用户名、密码是登录 LuCI 的账号。</Text>
    </Section>
    <Section header={<Text>自动获取配置</Text>}>
      <Text>开启后，登录路由器读取所选插件（OpenClash / Nikki / MihomoTProxy）的配置，自动得到 Clash 控制器端口和密钥，无需手动填写。需要账号有读取配置的权限。</Text>
      <Text>关闭后可手动填写控制器端口和密钥。</Text>
    </Section>
    <Section header={<Text>注意</Text>}>
      <Text>Clash 控制器通过“路由器地址 + 控制器端口”访问，请确认该端口监听在局域网地址，而不是只监听 127.0.0.1。</Text>
      <Text>密码和密钥保存在 Keychain。</Text>
    </Section>
  </Form>
}

function EditController({ initial, onDone }: { initial?: Controller; onDone: () => void }) {
  const dismiss = Navigation.useDismiss()
  const [name, setName] = useState(initial?.name ?? "")
  const [host, setHost] = useState(initial?.host ?? "")
  const [port, setPort] = useState(String(initial?.port ?? 80))
  const [https, setHttps] = useState(initial?.https ?? false)
  const [username, setUsername] = useState(initial?.username ?? "root")
  const [password, setPassword] = useState(initial ? getSecret(initial.id) : "")
  const [plugin, setPlugin] = useState<Plugin>(initial?.plugin ?? "openclash")
  const [auto, setAuto] = useState(initial?.auto ?? true)
  const [cport, setCport] = useState(String(initial?.cport ?? 9090))
  const [csecret, setCsecret] = useState(initial ? getClashSecret(initial.id) : "")
  const [err, setErr] = useState("")
  const [saving, setSaving] = useState(false)
  function toggleHttps(v: boolean) {
    setHttps(v)
    if (v && port === "80") setPort("443")
    if (!v && port === "443") setPort("80")
  }
  async function save() {
    if (saving) return
    setSaving(true); setErr("")
    try {
      const c = saveController({ id: initial?.id, name, host, port: Number(port), https, username, plugin, auto, cport: Number(cport) || 9090 }, password, csecret)
      try { await loadOverview(c) } catch (e) { await Dialog.alert({ title: "已保存，但连接测试失败", message: msg(e) }); onDone(); dismiss(); return }
      try { await loadClashOverview(c) } catch (e) { await Dialog.alert({ title: "已保存，路由器已连接，但代理控制器获取失败", message: msg(e) }) }
      onDone(); dismiss()
    } catch (e) { setErr(msg(e)) } finally { setSaving(false) }
  }
  return <Form navigationTitle={initial ? "编辑 OpenWrt" : "添加 OpenWrt"} navigationBarTitleDisplayMode="inline"
    toolbar={{ confirmationAction: <Button title={saving ? "保存中…" : "保存"} disabled={saving} action={save} /> }}>
    <Section header={<Text>基本信息</Text>}>
      <TextField title="名称" value={name} onChanged={setName} prompt="例如：家庭路由" />
      <TextField title="地址" value={host} onChanged={setHost} prompt="IP 地址" />
      <TextField title="端口" value={port} onChanged={setPort} prompt="80" />
      <Toggle title="启用 SSL (HTTPS)" value={https} onChanged={toggleHttps} />
    </Section>
    <Section header={<Text>认证</Text>}>
      <TextField title="用户名" value={username} onChanged={setUsername} prompt="root" />
      <SecureField title="密码" value={password} onChanged={setPassword} prompt="LuCI 登录密码" />
    </Section>
    <Section header={<Text>插件配置</Text>}>
      <Picker title="插件" pickerStyle="segmented" value={plugin} onChanged={(v: string) => setPlugin(v as Plugin)}>
        {PLUGINS.map(([v, l]) => <Text key={v} tag={v}>{l}</Text>)}
      </Picker>
      <Toggle title="自动获取配置" value={auto} onChanged={setAuto} />
      {!auto ? <>
        <TextField title="控制器端口" value={cport} onChanged={setCport} prompt="9090" />
        <SecureField title="控制器密钥" value={csecret} onChanged={setCsecret} prompt="Secret（无则留空）" />
      </> : null}
    </Section>
    {err ? <Section><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
    <Section>
      <NavigationLink destination={<HelpPage />}><Label title="使用说明" systemImage="questionmark.circle.fill" /></NavigationLink>
    </Section>
  </Form>
}

function SettingsPage({ active, onChanged }: { active: Controller | null; onChanged: () => void }) {
  const prefs = usePreferences()
  const [revealed, setRevealed] = useState<string[]>([])
  const [list, setList] = useState(listControllers())
  const reload = () => { setList(listControllers()); onChanged() }
  // 系统滑动删除：回调触发时该行已被移除，只同步数据源；其余刷新延后，避免与删除动画冲突
  function onDelete(indices: number[]) {
    const ids = indices.map(i => list[i]?.id).filter(Boolean) as string[]
    for (const id of ids) removeController(id)
    setList(listControllers())
    setTimeout(onChanged, 500)
  }
  return <Form navigationTitle="设置" navigationBarTitleDisplayMode="inline">
    <Section header={<Text>OpenWrt</Text>}>
      <ForEach count={list.length}
        itemBuilder={i => <NavigationLink key={list[i].id} destination={<EditController initial={list[i]} onDone={reload} />}>
          <VStack alignment="leading" onLongPressGesture={() => setRevealed([...revealed, list[i].id])}><Text>{list[i].name}</Text>{prefs.foldOffline && controllerHealth[list[i].id] === false && !revealed.includes(list[i].id)
            ? <Text font={12} foregroundStyle="secondaryLabel">连接失败 · 长按展开地址</Text>
            : <Text font={12} foregroundStyle="secondaryLabel">{list[i].url}</Text>}</VStack>
        </NavigationLink>}
        onDelete={onDelete} />
      <NavigationLink destination={<EditController onDone={reload} />}><Label title="添加 OpenWrt" systemImage="plus" /></NavigationLink>
    </Section>
    {active ? <Section header={<Text>路由器详情</Text>}>
      <NavigationLink destination={<WrtInterfacesPage active={active} version={0} />}><Label title="网络接口" systemImage="network" /></NavigationLink>
      <NavigationLink destination={<WrtLeasesPage active={active} version={0} />}><Label title="在线设备" systemImage="laptopcomputer.and.iphone" /></NavigationLink>
      <NavigationLink destination={<KernelConfigPage c={active} />}><Label title="代理内核配置" systemImage="gearshape.2" /></NavigationLink>
    </Section> : null}
    <Section footer={<Text>密码和密钥保存在 Keychain，不会上传或写入脚本文件。</Text>}>
      <Text foregroundStyle="secondaryLabel">{`dashboard v${VERSION}（非官方实现）`}</Text>
    </Section>
  </Form>
}

// ---------- 根：与 scriptgit 一致的原生 TabView；每个 tab 独立 NavigationStack ----------
type RootTab = "home" | "proxies" | "rules" | "connections" | "more"
const ROOT_TABS: [RootTab, string, string][] = [["home", "主页", "house.fill"], ["proxies", "代理", "point.3.connected.trianglepath.dotted"], ["rules", "规则", "list.bullet.rectangle"], ["connections", "连接", "arrow.up.arrow.down"], ["more", "更多", "ellipsis.circle"]]
function MorePage({ active, onChanged }: { active: Controller | null; onChanged: () => void }) {
  return <Form navigationTitle="更多" navigationBarTitleDisplayMode="inline">
    <Section header={<Text>当前代理控制器</Text>} footer={<Text>代理 / 规则 / 连接及内核配置使用当前 OpenWrt 的插件自动获取结果（或手动填写的控制器），与主页路由器统计独立。</Text>}>
      {active ? <><Text>{active.name}</Text><NavigationLink destination={<KernelConfigPage c={active} />}><Label title="运行模式与内核配置" systemImage="gearshape.2" /></NavigationLink></> : <Text>请先在设置添加控制器</Text>}
    </Section>
    <Section header={<Text>应用设置（本地）</Text>}>
      <NavigationLink destination={<LogsPage />}><Label title="运行日志" systemImage="doc.text" /></NavigationLink>
      <NavigationLink destination={<AppearancePage />}><Label title="外观设置" systemImage="paintpalette" /></NavigationLink>
      <NavigationLink destination={<GlobalConfigPage active={active} />}><Label title="全局配置" systemImage="slider.horizontal.3" /></NavigationLink>
      <NavigationLink destination={<SettingsPage active={active} onChanged={onChanged} />}><Label title="设置（控制器管理）" systemImage="gearshape" /></NavigationLink>
    </Section>
  </Form>
}
function Root() {
  const prefs = usePreferences(), dismiss = Navigation.useDismiss()
  const [version, setVersion] = useState(0)
  const selection = useObservable<RootTab>(() => { const p = getPreferences().defaultPage; return p === "overview" ? "home" : p })
  const tab = selection.value
  const active = getActive(), bump = () => { setVersion(v => v + 1) }
  // 原生 TabView 可留存各栈，因此显式只挂载所选页的业务内容。
  // 切走主页必定卸载采样/曲线；不依赖系统是否销毁隐藏 Tab，也不仿造拖动手势。
  const content = tab === "home" ? <OverviewPage key={active?.id ?? "empty"} active={active} version={version} onSwitch={bump} />
    : tab === "proxies" ? <ProxiesPage key={active?.id ?? "empty"} active={active} version={version} />
    : tab === "rules" ? <RulesPage key={active?.id ?? "empty"} active={active} version={version} />
    : tab === "connections" ? <ConnectionsPage key={active?.id ?? "empty"} active={active} version={version} />
    : <MorePage active={active} onChanged={bump} />
  return <TabView selection={selection} preferredColorScheme={prefs.theme === "system" ? undefined : prefs.theme} font={14} foregroundStyle={MAIN_FG}>
    {ROOT_TABS.map(([id, title, icon]) => <Tab key={id} title={title} systemImage={icon} value={id}>
      <NavigationStack>
        <VStack spacing={0} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}
          toolbar={{ topBarLeading: <Button title="" systemImage="xmark" action={dismiss} /> }}>
          {tab === id ? content : null}
        </VStack>
      </NavigationStack>
    </Tab>)}
  </TabView>
}

async function run() {
  recordEvent("start", true)
  await Navigation.present({ element: <Root />, modalPresentationStyle: "fullScreen" })
  Script.exit()
}
run()
