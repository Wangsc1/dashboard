import { rootToolbar } from "./root-toolbar"
import { ProxiesPage, ConnectionsPage, RulesPage, GroupSection, MorePage as DashboardMorePage } from "./dashboard-pages"
import {
  Animation, Transition, Button, ForEach, Form, HStack, Label, Navigation, NavigationLink, NavigationStack, Picker, Script, Section, SecureField, Spacer,
  Image, Menu, RoundedRectangle, Circle, ScrollView, SVG, Text, ZStack, modifiers, TextField, Toggle, VStack, TabView, Tab, useObservable, useEffect, useState,
} from "scripting"
import {
  VERSION, Controller, Group, Conn, Rule, Overview, Plugin, PLUGINS, listControllers, saveController, removeController, getActive, setActive, getSecret, getClashSecret,
  loadOverview, loadClashOverview, loadWrtInterfaces, loadWrtLeases, WrtIface, WrtLease, loadGroups, selectProxy, testGroup, loadConnections, loadConnectionHosts, closeConnection,
  closeAllConnections, loadRules, DockerContainer, FrpInfo, FrpProxy, DockerSettings, loadDockerContainers, dockerAction, loadFrp, frpAction, saveFrpCommon, saveFrpProxy, deleteFrpProxy, loadDockerSettings, saveDockerSettings, loadContainerPolicy, saveContainerPolicy, fmtBytes, fmtSpeed, fmtParts, fmtUptime, fmtDuration, delayColor,
} from "./api"

import { confirmed } from "./dashboard-model"
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
  const [track] = useState({ value: target, unit, at: Date.now() })
  useEffect(() => {
    const start = Number(track.value), end = Number(target)
    if (!Number.isFinite(start) || !Number.isFinite(end) || track.unit !== unit) {
      track.value = target; track.unit = unit; setShown(target); return
    }
    if (track.value === target) return
    const at = Date.now(), decimals = target.includes(".") ? target.split(".")[1].length : 0
    const span = Math.max(300, Math.min(2500, at - track.at)); track.at = at // 动画时长跟随实际到样间隔，慢样本时数字不提前停住
    const t = setInterval(() => {
      const p = Math.min(1, (Date.now() - at) / span)
      const next = (start + (end - start) * (p * p * (3 - 2 * p))).toFixed(decimals)
      if (track.value !== next) { track.value = next; setShown(next) }
      if (p === 1) clearInterval(t)
    }, 16)
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
  const plot = useSmoothPlot(data, undefined, enabled, W, H, floor, 0)
  const line = plot.paths[0]
  const code = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${line}" fill="none" stroke="${color}" stroke-opacity="0.28" stroke-width="1.4" stroke-linecap="round"/></svg>`
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
  const plot = useSmoothPlot(down, up, enabled, W, H, undefined, undefined, true)
  const max = plot.scale
  const line = (i: number, color: string) => plot.paths[i] ? `<path d="${plot.paths[i]}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"/>` : ""
  const code = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${line(0, "#3B82F6")}${line(1, "#34C759")}</svg>`
  const label = (f: number) => fmtSpeed(max * f)
  return <Card>
    <HStack>
      <HStack spacing={8}><Badge icon="chart.xyaxis.line" color="#6366F1" /><Text fontWeight="semibold" font={15}>速度</Text></HStack>
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

function OverviewPage({ active, version, onSwitch, onClose }: { active: Controller | null; version: number; onSwitch: () => void; onClose?: () => void }) {
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
    let reading = false
    const read = () => {
      if (reading) return
      reading = true
      loadConnectionHosts(active).then(xs => { if (alive) setHosts(h => h.length === xs.length && h.every((v, i) => v === xs[i]) ? h : xs) }).catch(() => { if (alive) setHosts([]) }).finally(() => { reading = false })
    }
    void read(); const t = setInterval(read, 30000)
    return () => { alive = false; clearInterval(t) }
  }, [active?.id, prefs.connectionBackground, showCharts])
  const w = ov?.wrt
  const memUsed = w ? Math.max(0, w.memTotal - w.memFree) : 0
  const toolbar = rootToolbar("home", onClose, <Menu label={<Image systemName="ellipsis.circle" />}>
      <Button title="添加面板" systemImage="gearshape" action={() => setPage("settings")} />
      <Button title="运行日志" systemImage="doc.text" action={() => setPage("logs")} />
      <Button title="外观设置" systemImage="paintpalette" action={() => setPage("appearance")} />
      <Button title="全局配置" systemImage="slider.horizontal.3" action={() => setPage("global")} />
    </Menu>)
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
  return <ScrollView onAppear={() => setVisible(true)} onDisappear={() => setVisible(false)} navigationTitle="OpenWrt 状态" navigationBarTitleDisplayMode="inline" toolbar={toolbar} navigationDestination={destination}>
    <VStack spacing={12} padding={{ horizontal: 14, top: 2, bottom: 8 }}>
      <HStack spacing={4} frame={{ maxWidth: "infinity" }} padding={{ top: -14 }}>
        <Spacer />
        <Circle fill={err ? "systemRed" : "systemGreen"} frame={{ width: 5, height: 5 }} />
        <Text font={11} foregroundStyle={err ? "systemRed" : "systemGreen"}>{err ? "连接失败" : ov ? "运行正常" : "连接中"}</Text>
        <Spacer />
      </HStack>
      {all.length > 1 ? <Card>
        <Picker title="当前路由器" pickerStyle="menu" value={active.id} onChanged={(v: string) => { setActive(v); onSwitch() }}>
          {all.map(c => <Text key={c.id} tag={c.id}>{c.name}</Text>)}
        </Picker>
      </Card> : null}

      {prefs.showWrt ? <Card>
        <InfoItem icon="cpu" color="#10B981" title="目标平台" value={w?.target || "-"} />
        <InfoItem icon="shippingbox" color="#A855F7" title="内核版本" value={w?.kernel || "-"} />
        <InfoItem icon="gauge.medium" color="#EF4444" title="CPU 使用率" value={w?.cpu !== undefined ? `${w.cpu.toFixed(0)}%` : "-"} />
        <InfoItem icon="clock" color="#3B82F6" title="运行时间" value={w ? fmtUptime(w.uptime, true) : "-"} />
        <InfoItem icon="waveform.path.ecg" color="#F59E0B" title="系统负载" value={w ? w.load.map(v => v.toFixed(2)).join(" ") : "-"} />
      </Card> : null}

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

// Docker 官方品牌图标（Simple Icons，CC0），官方蓝 #2496ED。
const DOCKER_SVG = (size: number) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}"><path fill="#2496ED" d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.185.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.185.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.185.186.186m5.893 2.715h2.118a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.184-.186h-2.12a.186.186 0 00-.186.186v1.887c0 .102.084.185.186.185m-2.92 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.082.185.185.185M23.763 9.89c-.065-.051-.672-.51-1.954-.51-.338.001-.676.03-1.01.087-.248-1.7-1.653-2.53-1.716-2.566l-.344-.199-.226.327c-.284.438-.49.922-.612 1.43-.23.97-.09 1.882.403 2.661-.595.332-1.55.413-1.744.42H.751a.751.751 0 00-.75.748 11.376 11.376 0 00.692 4.062c.545 1.428 1.355 2.48 2.41 3.124 1.18.723 3.1 1.137 5.275 1.137.983.003 1.963-.086 2.93-.266a12.248 12.248 0 003.823-1.389c.98-.567 1.86-1.288 2.61-2.136 1.252-1.418 1.998-2.997 2.553-4.4h.221c1.372 0 2.215-.549 2.68-1.009.309-.293.55-.65.707-1.046l.098-.288Z"/></svg>`
function DockerLogo({ size = 24 }: { size?: number }) { return <SVG code={DOCKER_SVG(size)} resizable frame={{ width: size, height: size }} /> }
async function guarded(setBusy: (v: boolean) => void, fn: () => Promise<any>) {
  setBusy(true)
  try { await fn() } catch (e: any) { await Dialog.alert({ title: "操作未完成", message: String(e?.message || "路由器未响应或权限不足。").slice(0, 120) }) } finally { setBusy(false) }
}
function Field({ title, value, onChanged, keyboard }: { title: string; value: string; onChanged: (v: string) => void; keyboard?: string }) {
  return <HStack><Text>{title}</Text><Spacer /><TextField title="" value={value} onChanged={onChanged} multilineTextAlignment="trailing" autocorrectionDisabled textInputAutocapitalization="never" /></HStack>
}

function DockerPage({ active }: { active: Controller }) {
  const [list, setList] = useState<DockerContainer[]>([])
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false), [tick, setTick] = useState(0)
  useEffect(() => { let alive = true; loadDockerContainers(active).then(x => { if (alive) { setList(x); setErr("") } }).catch(() => { if (alive) setErr("Docker 读取不可用：路由器未启用 Docker 或账号权限不足。") }); return () => { alive = false } }, [active.id, tick])
  const act = (x: DockerContainer, action: "start" | "stop" | "restart", label: string) => {
    if (busy) return
    void guarded(setBusy, async () => { await confirmed(`${active.name} · ${x.name}`, `${label}容器；会影响该容器承载的服务。`, () => dockerAction(active, x.id, action)); setTick(t => t + 1) })
  }
  return <Form navigationTitle="Docker 管理" navigationBarTitleDisplayMode="inline" toolbar={{ topBarTrailing: <Button title="刷新" systemImage="arrow.clockwise" action={() => setTick(t => t + 1)} /> }}>
    {err ? <Section><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
    <Section><NavigationLink destination={<DockerSettingsPage active={active} />}><HStack spacing={10}><DockerLogo size={22} /><Text>Docker 参数</Text></HStack></NavigationLink></Section>
    <Section header={<Text>{`容器 ${list.length}`}</Text>} footer={<Text>左滑启动、停止或重启；点进容器可改重启策略。</Text>}>
      {list.map(x => <NavigationLink key={x.id} destination={<ContainerPage active={active} x={x} />}
          trailingSwipeActions={{ allowsFullSwipe: false, actions: [
            x.state === "running" ? <Button title="停止" systemImage="stop.fill" tint="systemRed" action={() => act(x, "stop", "停止")} /> : <Button title="启动" systemImage="play.fill" tint="systemGreen" action={() => act(x, "start", "启动")} />,
            <Button title="重启" systemImage="arrow.clockwise" tint="systemBlue" action={() => act(x, "restart", "重启")} />,
          ] }}>
        <HStack spacing={10}>
          <DockerLogo size={26} />
          <VStack alignment="leading" spacing={3}>
            <HStack spacing={6}><Text fontWeight="semibold">{x.name}</Text><Circle fill={x.state === "running" ? "systemGreen" : "systemGray"} frame={{ width: 7, height: 7 }} /></HStack>
            <Text font={12} foregroundStyle="secondaryLabel">{x.image}</Text>
            <Text font={12} foregroundStyle="secondaryLabel">{x.status}</Text>
          </VStack>
        </HStack>
      </NavigationLink>)}
    </Section>
  </Form>
}

function ContainerPage({ active, x }: { active: Controller; x: DockerContainer }) {
  const [policy, setPolicy] = useState(""), [orig, setOrig] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("")
  useEffect(() => { let alive = true; loadContainerPolicy(active, x.id).then(v => { if (alive) { setPolicy(v); setOrig(v) } }).catch(() => { if (alive) setErr("读取容器参数失败") }); return () => { alive = false } }, [x.id])
  const save = () => guarded(setBusy, async () => { await confirmed(`${active.name} · ${x.name}`, `将重启策略改为 ${policy}，不重启容器。`, () => saveContainerPolicy(active, x.id, policy)); setOrig(policy) })
  return <Form navigationTitle={x.name} navigationBarTitleDisplayMode="inline">
    {err ? <Section><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
    <Section header={<Text>信息</Text>}>
      <HStack><Text>镜像</Text><Spacer /><Text foregroundStyle="secondaryLabel">{x.image}</Text></HStack>
      <HStack><Text>状态</Text><Spacer /><Text foregroundStyle="secondaryLabel">{x.status}</Text></HStack>
    </Section>
    {policy ? <Section header={<Text>参数</Text>} footer={<Text>仅修改重启策略；端口、挂载、环境变量需重建容器，这里不提供。</Text>}>
      <Picker title="重启策略" pickerStyle="menu" value={policy} onChanged={setPolicy}>
        <Text tag="no">不自动重启</Text><Text tag="always">总是重启</Text><Text tag="unless-stopped">除非手动停止</Text><Text tag="on-failure">失败时重启</Text>
      </Picker>
      <Button title="保存" systemImage="checkmark" disabled={busy || policy === orig} action={save} />
    </Section> : null}
  </Form>
}

function DockerSettingsPage({ active }: { active: Controller }) {
  const [s, setS] = useState<DockerSettings | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState("")
  useEffect(() => { let alive = true; loadDockerSettings(active).then(v => { if (alive) setS(v) }).catch(() => { if (alive) setErr("读取 Docker 参数失败") }); return () => { alive = false } }, [active.id])
  const set = (k: keyof DockerSettings, v: string) => setS(o => o ? { ...o, [k]: v } : o)
  const save = () => s && guarded(setBusy, async () => { await confirmed(`${active.name} · dockerd`, "保存后将重启 Docker 服务，所有容器会短暂中断。", () => saveDockerSettings(active, s)) })
  return <Form navigationTitle="Docker 参数" navigationBarTitleDisplayMode="inline">
    {err ? <Section><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
    {s ? <Section header={<Text>常规</Text>} footer={<Text>数据目录为只读（改动会让现有容器消失）。保存会重启 Docker。</Text>}>
      <HStack><Text>数据目录</Text><Spacer /><Text foregroundStyle="secondaryLabel">{s.dataRoot}</Text></HStack>
      <Picker title="日志级别" pickerStyle="menu" value={s.logLevel} onChanged={(v: string) => set("logLevel", v)}>
        {["debug", "info", "warn", "error", "fatal"].map(l => <Text key={l} tag={l}>{l}</Text>)}
      </Picker>
    </Section> : null}
    {s ? <Section header={<Text>代理</Text>} footer={<Text>留空表示不使用。地址需以 http:// 或 https:// 开头。</Text>}>
      <Field title="HTTP" value={s.httpProxy} onChanged={v => set("httpProxy", v)} />
      <Field title="HTTPS" value={s.httpsProxy} onChanged={v => set("httpsProxy", v)} />
      <Field title="不代理" value={s.noProxy} onChanged={v => set("noProxy", v)} />
    </Section> : null}
    {s ? <Section><Button title="保存并重启 Docker" systemImage="checkmark" disabled={busy} action={save} /></Section> : null}
  </Form>
}

function FrpPage({ active }: { active: Controller }) {
  const [info, setInfo] = useState<FrpInfo | null>(null)
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false), [tick, setTick] = useState(0)
  useEffect(() => { let alive = true; loadFrp(active).then(x => { if (alive) { setInfo(x); setErr("") } }).catch(() => { if (alive) setErr("frp 读取不可用：路由器未安装 frpc 或账号权限不足。") }); return () => { alive = false } }, [active.id, tick])
  const act = (action: "start" | "stop" | "restart", label: string) => {
    if (busy) return
    void guarded(setBusy, async () => { await confirmed(`${active.name} · frpc`, `${label} frp 客户端；穿透服务会短暂中断。`, () => frpAction(active, action)); setTimeout(() => setTick(t => t + 1), 1500) })
  }
  const reload = () => setTimeout(() => setTick(t => t + 1), 1500)
  return <Form navigationTitle="FRP 管理" navigationBarTitleDisplayMode="inline" toolbar={{ topBarTrailing: <Button title="刷新" systemImage="arrow.clockwise" action={() => setTick(t => t + 1)} /> }}>
    {err ? <Section><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
    {info ? <Section header={<Text>服务</Text>}>
      <HStack><Text>状态</Text><Spacer /><HStack spacing={6}><Circle fill={info.running ? "systemGreen" : "systemRed"} frame={{ width: 7, height: 7 }} /><Text foregroundStyle="secondaryLabel">{info.running ? "运行中" : "已停止"}</Text></HStack></HStack>
      <HStack><Text>开机启动</Text><Spacer /><Text foregroundStyle="secondaryLabel">{info.enabled ? "已启用" : "未启用"}</Text></HStack>
      <NavigationLink destination={<FrpCommonPage active={active} info={info} onDone={reload} />}><HStack><Text>服务端参数</Text><Spacer /><Text foregroundStyle="secondaryLabel">{info.server}</Text></HStack></NavigationLink>
      <Button title={info.running ? "停止" : "启动"} systemImage={info.running ? "stop.fill" : "play.fill"} disabled={busy} action={() => act(info.running ? "stop" : "start", info.running ? "停止" : "启动")} />
      <Button title="重启" systemImage="arrow.clockwise" disabled={busy} action={() => act("restart", "重启")} />
    </Section> : null}
    {info ? <Section header={<Text>{`穿透规则 ${info.proxies.length}`}</Text>} footer={<Text>点进可编辑，左滑删除；保存后会重启 frpc。</Text>}>
      {info.proxies.map(x => <NavigationLink key={x.id} destination={<FrpProxyPage active={active} initial={x} onDone={reload} />}
          trailingSwipeActions={{ allowsFullSwipe: false, actions: [<Button title="删除" systemImage="trash" tint="systemRed" action={() => { void guarded(setBusy, async () => { await confirmed(`${active.name} · ${x.name}`, "删除该穿透规则并重启 frpc。", () => deleteFrpProxy(active, x.id)); reload() }) }} />] }}>
        <VStack alignment="leading" spacing={2}>
          <Text fontWeight="semibold">{x.name}</Text>
          <Text font={12} foregroundStyle="secondaryLabel">{`${x.type.toUpperCase()} · ${x.local} → ${x.remote}`}</Text>
        </VStack>
      </NavigationLink>)}
      <NavigationLink destination={<FrpProxyPage active={active} onDone={reload} />}><Label title="添加规则" systemImage="plus" /></NavigationLink>
    </Section> : null}
  </Form>
}

function FrpCommonPage({ active, info, onDone }: { active: Controller; info: FrpInfo; onDone: () => void }) {
  const dismiss = Navigation.useDismiss()
  const [addr, setAddr] = useState(info.common.addr), [port, setPort] = useState(info.common.port), [tls, setTls] = useState(info.common.tls), [token, setToken] = useState(""), [busy, setBusy] = useState(false)
  const save = () => guarded(setBusy, async () => { if (await confirmed(`${active.name} · frpc`, "保存服务端参数并重启 frpc；穿透会短暂中断，参数错误会导致断连。", () => saveFrpCommon(active, { addr: addr.trim(), port: port.trim(), tls, token: token || undefined }))) { onDone(); dismiss() } })
  return <Form navigationTitle="服务端参数" navigationBarTitleDisplayMode="inline">
    <Section footer={<Text>{info.common.hasToken ? "已设置 Token；不显示，留空表示不修改。" : "尚未设置 Token。"}</Text>}>
      <Field title="服务器地址" value={addr} onChanged={setAddr} />
      <Field title="服务器端口" value={port} onChanged={setPort} />
      <Toggle title="启用 TLS" value={tls} onChanged={setTls} />
      <SecureField title="Token（留空不修改）" value={token} onChanged={setToken} />
    </Section>
    <Section><Button title="保存并重启 frpc" systemImage="checkmark" disabled={busy} action={save} /></Section>
  </Form>
}

function FrpProxyPage({ active, initial, onDone }: { active: Controller; initial?: FrpProxy; onDone: () => void }) {
  const dismiss = Navigation.useDismiss()
  const [rawLocal] = [initial?.local ?? ":"], idx = rawLocal.lastIndexOf(":")
  const [name, setName] = useState(initial?.name ?? ""), [type, setType] = useState(initial?.type ?? "tcp")
  const [lip, setLip] = useState(initial ? rawLocal.slice(0, idx) : "10.0.0.1"), [lport, setLport] = useState(initial ? rawLocal.slice(idx + 1) : "")
  const [rport, setRport] = useState(initial?.remote ?? ""), [busy, setBusy] = useState(false)
  const save = () => guarded(setBusy, async () => { if (await confirmed(`${active.name} · ${name || "新规则"}`, `${initial ? "修改" : "添加"}穿透规则并重启 frpc。`, () => saveFrpProxy(active, { id: initial?.id, name: name.trim(), type, local_ip: lip.trim(), local_port: lport.trim(), remote_port: rport.trim() }))) { onDone(); dismiss() } })
  return <Form navigationTitle={initial ? initial.name : "添加规则"} navigationBarTitleDisplayMode="inline">
    <Section>
      <Field title="名称" value={name} onChanged={setName} />
      <Picker title="类型" pickerStyle="menu" value={type} onChanged={setType}><Text tag="tcp">TCP</Text><Text tag="udp">UDP</Text></Picker>
      <Field title="本地 IP" value={lip} onChanged={setLip} />
      <Field title="本地端口" value={lport} onChanged={setLport} />
      <Field title="远程端口" value={rport} onChanged={setRport} />
    </Section>
    <Section><Button title="保存并重启 frpc" systemImage="checkmark" disabled={busy} action={save} /></Section>
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
  // 左滑“删除”按钮（同 ScriptGit 的 trailingSwipeActions）；先同步数据源，其余刷新延后避免与动画冲突
  function remove(id: string) {
    removeController(id)
    setList(listControllers())
    setTimeout(onChanged, 500)
  }
  return <Form navigationTitle="面板设置" navigationBarTitleDisplayMode="inline">
    <Section header={<HStack><Text>OpenWrt</Text><Spacer /><Text font={12} foregroundStyle="secondaryLabel">{`v${VERSION}`}</Text></HStack>}>
      {list.map(c => <NavigationLink key={c.id} destination={<EditController initial={c} onDone={reload} />}
          trailingSwipeActions={{ allowsFullSwipe: false, actions: [<Button title="删除" systemImage="trash" tint="systemRed" action={() => remove(c.id)} />] }}>
          <VStack alignment="leading" onLongPressGesture={() => setRevealed([...revealed, c.id])}><Text>{c.name}</Text>{prefs.foldOffline && controllerHealth[c.id] === false && !revealed.includes(c.id)
            ? <Text font={12} foregroundStyle="secondaryLabel">连接失败 · 长按展开地址</Text>
            : <Text font={12} foregroundStyle="secondaryLabel">{c.url}</Text>}</VStack>
        </NavigationLink>)}
      <NavigationLink destination={<EditController onDone={reload} />}><Label title="添加 OpenWrt" systemImage="plus" /></NavigationLink>
    </Section>
    {active ? <Section header={<Text>路由器详情</Text>}>
      <NavigationLink destination={<WrtInterfacesPage active={active} version={0} />}><Label title="网络接口" systemImage="network" /></NavigationLink>
      <NavigationLink destination={<WrtLeasesPage active={active} version={0} />}><Label title="在线设备" systemImage="laptopcomputer.and.iphone" /></NavigationLink>
      <NavigationLink destination={<DockerPage active={active} />}><Label title="Docker 管理" systemImage="shippingbox" /></NavigationLink>
      <NavigationLink destination={<FrpPage active={active} />}><Label title="FRP 管理" systemImage="arrow.left.arrow.right" /></NavigationLink>
    </Section> : null}
  </Form>
}

// ---------- 根：共享 NavigationStack 承载原生 TabView ----------
type RootTab = "home" | "proxies" | "rules" | "connections" | "more"
function MorePage({ active, onChanged, onClose }: { active: Controller | null; onChanged: () => void; onClose?: () => void }) {
  return <DashboardMorePage active={active} onChanged={onChanged} onClose={onClose} settings={<Card>
    <NavigationLink destination={<AppearancePage />}><Label title="外观设置" systemImage="paintpalette" /></NavigationLink>
    <NavigationLink destination={<GlobalConfigPage active={active} />}><Label title="全局配置" systemImage="slider.horizontal.3" /></NavigationLink>
    <NavigationLink destination={<SettingsPage active={active} onChanged={onChanged} />}><Label title="设置（控制器管理）" systemImage="gearshape" /></NavigationLink>
  </Card>} />
}
function Root() {
  const prefs = usePreferences(), dismiss = Navigation.useDismiss()
  const [version, setVersion] = useState(0)
  const selection = useObservable<RootTab>(() => { const p = getPreferences().defaultPage; return p === "overview" ? "home" : p })
  const tab = selection.value
  const active = getActive(), bump = () => { setVersion(v => v + 1) }
  // 每Tab独立栈（同ScriptGit）；栈的直接子节点就是业务页，不再包VStack，toolbar只由页面根声明一次。
  return <TabView selection={selection} preferredColorScheme={prefs.theme === "system" ? undefined : prefs.theme} font={14} foregroundStyle={MAIN_FG}>
    <Tab key="home" title="主页" systemImage="house.fill" value="home">
      <NavigationStack key="home-stack">
        {tab === "home" ? <OverviewPage key={`home:${active?.id ?? "empty"}`} active={active} version={version} onSwitch={bump} onClose={dismiss} /> : null}
      </NavigationStack>
    </Tab>
    <Tab key="proxies" title="代理" systemImage="point.3.connected.trianglepath.dotted" value="proxies">
      <NavigationStack key="proxies-stack">
        {tab === "proxies" ? <ProxiesPage onClose={dismiss} key={`proxies:${active?.id ?? "empty"}`} active={active} version={version} /> : null}
      </NavigationStack>
    </Tab>
    <Tab key="rules" title="规则" systemImage="list.bullet.rectangle" value="rules">
      <NavigationStack key="rules-stack">
        {tab === "rules" ? <RulesPage onClose={dismiss} key={`rules:${active?.id ?? "empty"}`} active={active} version={version} /> : null}
      </NavigationStack>
    </Tab>
    <Tab key="connections" title="连接" systemImage="arrow.up.arrow.down" value="connections">
      <NavigationStack key="connections-stack">
        {tab === "connections" ? <ConnectionsPage onClose={dismiss} key={`connections:${active?.id ?? "empty"}`} active={active} version={version} /> : null}
      </NavigationStack>
    </Tab>
    <Tab key="more" title="更多" systemImage="ellipsis.circle" value="more">
      <NavigationStack key="more-stack">
        {tab === "more" ? <MorePage onClose={dismiss} key={`more:${active?.id ?? "empty"}`} active={active} onChanged={bump} /> : null}
      </NavigationStack>
    </Tab>
  </TabView>
}

async function run() {
  recordEvent("start", true)
  await Navigation.present({ element: <Root />, modalPresentationStyle: "fullScreen" })
  Script.exit()
}
run()
