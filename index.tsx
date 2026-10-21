import { rootToolbar } from "./root-toolbar"
import { ProxiesPage, ConnectionsPage, RulesPage, GroupSection, MorePage as DashboardMorePage } from "./dashboard-pages"
import {
  AppEvents, Animation, Transition, Button, ForEach, Form, HStack, Label, Navigation, NavigationLink, NavigationStack, Picker, Script, Section, SecureField, Spacer,
  Image, Menu, RoundedRectangle, Circle, ScrollView, SVG, Text, ZStack, modifiers, TextField, Toggle, VStack, TabView, Tab, useObservable, useEffect, useState, useMemo,
} from "scripting"
import {
  VERSION, Controller, Group, Conn, Rule, Overview, Plugin, PLUGINS, listControllers, saveController, removeController, getActive, setActive, getSecret, getClashSecret,
  loadOverview, loadClashOverview, loadWrtInterfaces, loadWrtLeases, WrtIface, WrtLease, loadGroups, selectProxy, testGroup, loadConnections, loadConnectionHosts, closeConnection,
  closeAllConnections, loadRules, DockerContainer, FrpInfo, FrpProxy, DockerSettings, loadDiskUsage, loadInstalledPkgs, loadAvailablePkgs, upgradablePkgs, filterPkgs, pkgUpdateLists, pkgInstall, pkgRemove, pkgUpgrade, Pkg, loadDockerContainers, loadContainerDetail, dockerContainerOp, DockerContainerDetail, loadDockerImages, dockerImageRemove, DockerImage, loadDockerOverview, DockerOverview, dockerAction, loadFrp, frpAction, saveFrpCommon, saveFrpProxy, deleteFrpProxy, loadDockerSettings, saveDockerSettings, loadContainerPolicy, saveContainerPolicy, fmtBytes, fmtSpeed, fmtParts, fmtUptime, fmtDuration, delayColor,
} from "./api"

import { confirmed } from "./dashboard-model"
import { DOCKER_PNG_BASE64 } from "./docker-icon"
import { useSmoothPlot } from "./chart-ui"
import { CHART_HISTORY } from "./chart"
import { GlobalConfigPage, LogsPage, KernelConfigPage, usePreferences } from "./settings-ui"
import { getPreferences, controllerHealth, cachedIcon, feedback, recordEvent } from "./preferences"

const msg = (e: any) => String(e?.message ?? e ?? "未知错误")

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
    const span = Math.max(300, Math.min(2500, at - track.at)); track.at = at
    const t = setInterval(() => {
      const p = Math.min(1, (Date.now() - at) / span)
      const next = (start + (end - start) * (p * p * (3 - 2 * p))).toFixed(decimals)
      if (track.value !== next) { track.value = next; setShown(next) }
      if (p === 1) clearInterval(t)
    }, 16)
    return () => clearInterval(t)
  }, [target, unit])

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

function useForeground() {
  const [foreground, setForeground] = useState(true)
  useEffect(() => {
    let alive = true
    const changed = (phase: "active" | "inactive" | "background") => {
      if (alive) setForeground(phase === "active")
    }
    AppEvents.scenePhase.addListener(changed)
    return () => { alive = false; AppEvents.scenePhase.removeListener(changed) }
  }, [])
  return foreground
}

function OverviewPage({ active, version, onSwitch, onClose, selected = true }: { active: Controller | null; version: number; onSwitch: () => void; onClose?: () => void; selected?: boolean }) {
  const prefs = usePreferences(["connectionBackground"])
  const [hosts, setHosts] = useState<string[]>([])
  const [ov, setOv] = useState<Overview | null>(null)
  const [err, setErr] = useState("")
  const [dn, setDn] = useState<number[]>([])
  const [upH, setUpH] = useState<number[]>([])
  const all = listControllers()
  // Retain the navigation owner while pausing work behind pushed settings pages.
  const [visible, setVisible] = useState(true)
  const foreground = useForeground()
  const showCharts = foreground && selected && visible
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
  const statusText = err ? "连接失败" : ov ? "运行正常" : "连接中", statusColor = err ? "systemRed" : "systemGreen"
  const toolbar = useMemo(() => ({ ...rootToolbar("home", onClose, <NavigationLink destination={<SettingsPage active={active} onChanged={onSwitch} />}><Image systemName="ellipsis.circle" /></NavigationLink>),
    principal: <VStack spacing={1}>
      <Text font={17} fontWeight="semibold">OpenWrt 状态</Text>
      <HStack spacing={4}><Circle fill={statusColor} frame={{ width: 5, height: 5 }} /><Text font={11} foregroundStyle={statusColor}>{statusText}</Text></HStack>
    </VStack> }), [active, onSwitch, onClose, statusText, statusColor])
  if (!active) return <Form navigationTitle="dashboard" navigationBarTitleDisplayMode="inline" toolbar={toolbar} onAppear={() => setVisible(true)} onDisappear={() => setVisible(false)}><NoController /></Form>
  return <VStack spacing={0} navigationTitle="OpenWrt 状态" navigationBarTitleDisplayMode="inline" toolbar={toolbar} onAppear={() => setVisible(true)} onDisappear={() => setVisible(false)}>
    <ScrollView>
    <VStack spacing={12} padding={{ horizontal: 14, top: 0, bottom: 8 }}>
      {all.length > 1 ? <Card>
        <Picker title="当前路由器" pickerStyle="menu" value={active.id} onChanged={(v: string) => { setActive(v); onSwitch() }}>
          {all.map(c => <Text key={c.id} tag={c.id}>{c.name}</Text>)}
        </Picker>
      </Card> : null}

      <Card>
        <InfoItem icon="cpu" color="#10B981" title="目标平台" value={w?.target || "-"} />
        <InfoItem icon="shippingbox" color="#A855F7" title="内核版本" value={w?.kernel || "-"} />
        <InfoItem icon="gauge.medium" color="#EF4444" title="CPU 使用率" value={w?.cpu !== undefined ? `${w.cpu.toFixed(0)}%` : "-"} />
        <InfoItem icon="waveform.path.ecg" color="#F59E0B" title="系统负载" value={w ? w.load.map(v => v.toFixed(2)).join(" ") : "-"} />
        <InfoItem icon="clock" color="#3B82F6" title="运行时间" value={w ? fmtUptime(w.uptime, true) : "-"} />
      </Card>

      <HStack spacing={12}>
        <StatCard enabled={showCharts} icon="icloud.and.arrow.down.fill" color="#3B82F6" title="下载总量" droplets parts={ov ? fmtParts(ov.downTotal) : null} />
        <StatCard enabled={showCharts} icon="icloud.and.arrow.up.fill" color="#34C759" title="上传总量" droplets parts={ov ? fmtParts(ov.upTotal) : null} />
      </HStack>
      <HStack spacing={12}>
        <StatCard enabled={showCharts} icon="link" color="#A855F7" title="活动连接" connectionHosts={hosts} parts={ov ? [String(ov.connCount), ""] : null} />
        <StatCard enabled={showCharts} icon="square.stack.3d.up.fill" color="#F59E0B" title="内存使用" parts={w ? fmtParts(memUsed, false, 1) : null} />
      </HStack>

      <RateChart down={dn} up={upH} enabled={showCharts} />

    </VStack>
    </ScrollView>
  </VStack>
}

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

let dockerImage: any
function DockerLogo({ size = 24, mono = false }: { size?: number; mono?: boolean }) {
  dockerImage = dockerImage ?? UIImage.fromBase64String(DOCKER_PNG_BASE64)
  return dockerImage ? <Image image={dockerImage} resizable scaleToFit renderingMode={mono ? "template" : "original"} foregroundStyle={mono ? MAIN_FG : undefined} frame={{ width: size, height: size }} /> : <Image systemName="shippingbox" frame={{ width: size, height: size }} />
}
async function guarded(setBusy: (v: boolean) => void, fn: () => Promise<any>) {
  setBusy(true)
  try { await fn() } catch (e: any) { await Dialog.alert({ title: "操作未完成", message: String(e?.message || "路由器未响应或权限不足。").slice(0, 120) }) } finally { setBusy(false) }
}
function Field({ title, value, onChanged, keyboard }: { title: string; value: string; onChanged: (v: string) => void; keyboard?: string }) {
  return <HStack><Text>{title}</Text><Spacer /><TextField title="" value={value} onChanged={onChanged} multilineTextAlignment="trailing" autocorrectionDisabled textInputAutocapitalization="never" /></HStack>
}

const gi = (n: number) => (n / 1073741824).toFixed(2) + " Gi"
function DockerPage({ active }: { active: Controller }) {
  const [ov, setOv] = useState<DockerOverview | null>(null)
  const [list, setList] = useState<DockerContainer[]>([]), [images, setImages] = useState<DockerImage[]>([])
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false), [tick, setTick] = useState(0)
  useEffect(() => { let alive = true; loadDockerImages(active).then(x => { if (alive) setImages(x) }).catch(() => {}); return () => { alive = false } }, [active.id, tick])
  useEffect(() => { let alive = true; loadDockerContainers(active).then(x => { if (alive) { setList(x); setErr("") } }).catch(() => { if (alive) setErr("Docker 读取不可用：路由器未启用 Docker 或账号权限不足。") }); return () => { alive = false } }, [active.id, tick])
  useEffect(() => { let alive = true; loadDockerOverview(active).then(x => { if (alive) setOv(x) }).catch(() => {}); return () => { alive = false } }, [active.id, tick])
  const act = (x: DockerContainer, action: "start" | "stop" | "restart", label: string) => {
    if (busy) return
    void guarded(setBusy, async () => { await confirmed(`${active.name} · ${x.name}`, `${label}容器；会影响该容器承载的服务。`, () => dockerAction(active, x.id, action)); setTick(t => t + 1) })
  }
  return <Form navigationTitle="Docker 管理" navigationBarTitleDisplayMode="inline">
    {err ? <Section><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
    {ov ? <Section header={<Text>概览</Text>}>
      <HStack spacing={14}>
        <DockerLogo size={52} />
        <VStack alignment="leading" spacing={4}>
          <Text>{`容器 总计 ${ov.containers} · 运行中 ${ov.running}`}</Text>
          <Text foregroundStyle="secondaryLabel">{`镜像 总计 ${ov.images}`}</Text>
        </VStack>
      </HStack>
      <HStack><Text>Docker 版本</Text><Spacer /><Text foregroundStyle="secondaryLabel">{ov.version || "-"}</Text></HStack>
      <HStack><Text>API 版本</Text><Spacer /><Text foregroundStyle="secondaryLabel">{ov.api || "-"}</Text></HStack>
      <HStack><Text>线程数量</Text><Spacer /><Text foregroundStyle="secondaryLabel">{String(ov.threads)}</Text></HStack>
      <HStack><Text>总内存</Text><Spacer /><Text foregroundStyle="secondaryLabel">{gi(ov.memTotal)}</Text></HStack>
      <HStack><Text>Docker 根目录</Text><Spacer /><Text foregroundStyle="secondaryLabel">{ov.root || "-"}</Text></HStack>
      <HStack><Text>索引服务器地址</Text><Spacer /><Text font={13} foregroundStyle="secondaryLabel">{ov.index || "-"}</Text></HStack>
      <VStack alignment="leading" spacing={4}><Text>Registry 镜像</Text>{ov.mirrors.length ? ov.mirrors.map(m => <Text key={m} font={13} foregroundStyle="secondaryLabel">{m}</Text>) : <Text font={13} foregroundStyle="secondaryLabel">无</Text>}</VStack>
    </Section> : null}
    <Section><NavigationLink destination={<DockerSettingsPage active={active} />}><Label title="Docker 参数" systemImage="slider.horizontal.3" /></NavigationLink></Section>
    <Section header={<Text>容器</Text>}>
      {list.map(x => <NavigationLink key={x.id} destination={<ContainerPage active={active} x={x} />}
          trailingSwipeActions={{ allowsFullSwipe: false, actions: [
            x.state === "running" ? <Button title="停止" tint="systemRed" action={() => act(x, "stop", "停止")} /> : <Button title="启动" tint="systemGreen" action={() => act(x, "start", "启动")} />,
            <Button title="重启" tint="systemBlue" action={() => act(x, "restart", "重启")} />,
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
    <Section header={<Text>镜像</Text>}>
      {images.map(x => <NavigationLink key={x.id} destination={<ImagePage active={active} x={x} onDone={() => setTick(t => t + 1)} />}>
        <HStack spacing={10}>
          <DockerLogo size={26} />
          <VStack alignment="leading" spacing={3}>
            <Text fontWeight="semibold">{x.tags[0] ?? x.id.replace("sha256:", "").slice(0, 12)}</Text>
            <Text font={12} foregroundStyle="secondaryLabel">{`${mib(x.size)} · ${x.containers.length ? x.containers.join(", ") : "未使用"}`}</Text>
          </VStack>
        </HStack>
      </NavigationLink>)}
    </Section>
  </Form>
}

const mib = (n: number) => n >= 1073741824 ? (n / 1073741824).toFixed(2) + " GiB" : (n / 1048576).toFixed(2) + " MiB"
const when = (ms: number) => { if (!ms) return "-"; const d = new Date(ms), p = (v: number) => String(v).padStart(2, "0"); return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` }
function Row({ title, value }: { title: string; value: string }) { return <VStack alignment="leading" spacing={2}><Text font={12} foregroundStyle="secondaryLabel">{title}</Text><Text>{value || "-"}</Text></VStack> }

function ImagePage({ active, x, onDone }: { active: Controller; x: DockerImage; onDone: () => void }) {
  const dismiss = Navigation.useDismiss(), [busy, setBusy] = useState(false)
  const del = (force: boolean) => guarded(setBusy, async () => { if (await confirmed(`${active.name} · ${x.tags[0] ?? x.id.slice(7, 19)}`, `${force ? "强制" : ""}删除镜像；${x.containers.length ? "仍有容器使用它，" : ""}不可恢复。`, () => dockerImageRemove(active, x.id, force))) { onDone(); dismiss() } })
  return <Form navigationTitle="镜像" navigationBarTitleDisplayMode="inline">
    <Section header={<Text>镜像文件概览</Text>}>
      <Row title="标签" value={x.tags.join("\n")} />
      <Row title="容器" value={x.containers.join(", ")} />
      <Row title="大小" value={mib(x.size)} />
      <Row title="创建时间" value={when(x.created)} />
      <Row title="ID" value={x.id.replace("sha256:", "").slice(0, 12)} />
    </Section>
    <Section>
      <Button title="删除" tint="systemRed" disabled={busy} action={() => del(false)} />
      <Button title="强制删除" tint="systemRed" disabled={busy} action={() => del(true)} />
    </Section>
  </Form>
}

function ContainerPage({ active, x }: { active: Controller; x: DockerContainer }) {
  const dismiss = Navigation.useDismiss()
  const [d, setD] = useState<DockerContainerDetail | null>(null), [policy, setPolicy] = useState(""), [orig, setOrig] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [tick, setTick] = useState(0)
  useEffect(() => { let alive = true; loadContainerDetail(active, x.id).then(v => { if (alive) { setD(v); setPolicy(v.policy); setOrig(v.policy); setErr("") } }).catch(() => { if (alive) setErr("读取容器信息失败") }); return () => { alive = false } }, [x.id, tick])
  const op = (label: string, effect: string, fn: () => Promise<any>, leave = false) => guarded(setBusy, async () => { if (await confirmed(`${active.name} · ${x.name}`, effect, fn)) { if (leave) dismiss(); else setTimeout(() => setTick(t => t + 1), 800) } })
  const save = () => guarded(setBusy, async () => { await confirmed(`${active.name} · ${x.name}`, `将重启策略改为 ${policy}，不重启容器。`, () => saveContainerPolicy(active, x.id, policy)); setOrig(policy) })
  return <Form navigationTitle={x.name} navigationBarTitleDisplayMode="inline">
    {err ? <Section><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
    {d ? <Section header={<Text>容器概览</Text>}>
      <Row title="容器" value={d.name} />
      <Row title="状态" value={d.paused ? "paused" : d.state} />
      <Row title="ID" value={d.id.slice(0, 12)} />
      <Row title="映像" value={d.image} />
      <Row title="网络" value={d.network} />
      <Row title="端口" value={d.ports} />
      <Row title="命令" value={d.command} />
      <Row title="创建时间" value={when(d.created)} />
    </Section> : null}
    {d ? <Section>
      <Button title={d.paused ? "恢复" : "暂停"} disabled={busy} action={() => op("", `${d.paused ? "恢复" : "暂停"}容器。`, () => dockerContainerOp(active, x.id, d.paused ? "unpause" : "pause"))} />
      <Button title="重启" disabled={busy} action={() => op("", "重启容器；服务会短暂中断。", () => dockerAction(active, x.id, "restart"))} />
      <Button title="停止" disabled={busy} action={() => op("", "停止容器；服务会中断。", () => dockerAction(active, x.id, "stop"))} />
      <Button title="强制结束" tint="systemRed" disabled={busy} action={() => op("", "向容器发送 KILL 信号，立即终止进程。", () => dockerContainerOp(active, x.id, "kill"))} />
      <Button title="删除" tint="systemRed" disabled={busy} action={() => op("", "删除容器（需先停止）；不可恢复。", () => dockerContainerOp(active, x.id, "remove"), true)} />
      <Button title="强制删除" tint="systemRed" disabled={busy} action={() => op("", "强制删除容器，即使正在运行；不可恢复。", () => dockerContainerOp(active, x.id, "force-remove"), true)} />
    </Section> : null}
    {policy ? <Section header={<Text>参数</Text>} footer={<Text>仅修改重启策略；端口、挂载、环境变量需重建容器，这里不提供。</Text>}>
      <Picker title="重启策略" pickerStyle="menu" value={policy} onChanged={setPolicy}>
        <Text tag="no">不自动重启</Text><Text tag="always">总是重启</Text><Text tag="unless-stopped">除非手动停止</Text><Text tag="on-failure">失败时重启</Text>
      </Picker>
      <Button title="保存" disabled={busy || policy === orig} action={save} />
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
    {s ? <Section><Button title="保存" disabled={busy} action={save} /></Section> : null}
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
  return <Form navigationTitle="FRP 管理" navigationBarTitleDisplayMode="inline">
    {err ? <Section><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
    {info ? <Section header={<Text>服务</Text>}>
      <HStack><Text>状态</Text><Spacer /><HStack spacing={6}><Circle fill={info.running ? "systemGreen" : "systemRed"} frame={{ width: 7, height: 7 }} /><Text foregroundStyle="secondaryLabel">{info.running ? "运行中" : "已停止"}</Text></HStack></HStack>
      <HStack><Text>开机启动</Text><Spacer /><Text foregroundStyle="secondaryLabel">{info.enabled ? "已启用" : "未启用"}</Text></HStack>
      <NavigationLink destination={<FrpCommonPage active={active} info={info} onDone={reload} />}><HStack><Text>服务端参数</Text><Spacer /><Text foregroundStyle="secondaryLabel">{maskUrl(info.server)}</Text></HStack></NavigationLink>
      <Button title={info.running ? "停止" : "启动"} systemImage={info.running ? "stop.fill" : "play.fill"} disabled={busy} action={() => act(info.running ? "stop" : "start", info.running ? "停止" : "启动")} />
      <Button title="重启" systemImage="arrow.clockwise" disabled={busy} action={() => act("restart", "重启")} />
    </Section> : null}
    {info ? <Section header={<Text>穿透规则</Text>}>
      {info.proxies.map(x => <NavigationLink key={x.id} destination={<FrpProxyPage active={active} initial={x} onDone={reload} />}
          trailingSwipeActions={{ allowsFullSwipe: false, actions: [<Button title="删除" tint="systemRed" action={() => { void guarded(setBusy, async () => { await confirmed(`${active.name} · ${x.name}`, "删除该穿透规则并重启 frpc。", () => deleteFrpProxy(active, x.id)); reload() }) }} />] }}>
        <VStack alignment="leading" spacing={2}>
          <Text fontWeight="semibold">{x.name}</Text>
          <Text font={12} foregroundStyle="secondaryLabel">{`${x.type.toUpperCase()} · ${x.local} → ${x.remote}`}</Text>
        </VStack>
      </NavigationLink>)}
      <NavigationLink destination={<FrpProxyPage active={active} onDone={reload} />}><Label title="添加规则" systemImage="plus" /></NavigationLink>
    </Section> : null}
  </Form>
}

const maskUrl = (u: string) => u.replace(/(\d{1,3}\.\d{1,3}\.)\d{1,3}\.\d{1,3}(?=[:/]|$)/, "$1*.*")
function FrpCommonPage({ active, info, onDone }: { active: Controller; info: FrpInfo; onDone: () => void }) {
  const dismiss = Navigation.useDismiss()
  const [addr, setAddr] = useState(info.common.addr), [port, setPort] = useState(info.common.port), [tls, setTls] = useState(info.common.tls), [token, setToken] = useState(info.common.token), [busy, setBusy] = useState(false)
  const save = () => guarded(setBusy, async () => { if (await confirmed(`${active.name} · frpc`, "保存服务端参数并重启 frpc；穿透会短暂中断，参数错误会导致断连。", () => saveFrpCommon(active, { addr: addr.trim(), port: port.trim(), tls, token: token.trim() }))) { onDone(); dismiss() } })
  return <Form navigationTitle="服务端参数" navigationBarTitleDisplayMode="inline">
    <Section>
      <Field title="服务器地址" value={addr} onChanged={setAddr} />
      <Field title="服务器端口" value={port} onChanged={setPort} />
      <Toggle title="启用 TLS" value={tls} onChanged={setTls} />
      <Field title="Token" value={token} onChanged={setToken} />

    </Section>
    <Section><Button title="保存" disabled={busy} action={save} /></Section>
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
    <Section><Button title="保存" disabled={busy} action={save} /></Section>
  </Form>
}

function PkgRow({ p, actions }: { p: Pkg; actions: any[] }) {
  return <VStack alignment="leading" spacing={3} frame={{ maxWidth: "infinity", alignment: "leading" as any }} trailingSwipeActions={{ allowsFullSwipe: false, actions }}>
    <HStack><Text fontWeight="semibold">{p.name}</Text><Spacer /><Text font={12} foregroundStyle="secondaryLabel">{p.upgradeTo ? `${p.version} → ${p.upgradeTo}` : p.version}</Text></HStack>
    <Text font={12} foregroundStyle="secondaryLabel" lineLimit={2}>{p.desc || "无描述"}</Text>
    <Text font={11} foregroundStyle="tertiaryLabel">{`${p.installed ? "已安装 · " : ""}${p.size ? mib(p.size) : ""}`}</Text>
  </VStack>
}

function SoftwarePage({ active }: { active: Controller }) {
  const [tab, setTab] = useState<"available" | "installed" | "updates">("installed")
  const [installed, setInstalled] = useState<Pkg[]>([]), [available, setAvailable] = useState<Pkg[] | null>(null)
  const [q, setQ] = useState(""), [url, setUrl] = useState(""), [limit, setLimit] = useState(100), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [log, setLog] = useState(""), [tick, setTick] = useState(0)
  const [disk, setDisk] = useState("")
  useEffect(() => { let alive = true; loadInstalledPkgs(active).then(x => { if (alive) { setInstalled(x); setErr("") } }).catch(() => { if (alive) setErr("软件列表读取不可用：路由器未使用 apk/opkg 或账号权限不足。") }); return () => { alive = false } }, [active.id, tick])
  useEffect(() => { let alive = true; loadDiskUsage(active).then(d => { if (alive && d) setDisk(`${Math.round(d.used / d.size * 100)}% 已用（${mib(d.used)} / ${mib(d.size)}，剩余 ${mib(d.avail)}）`) }).catch(() => {}); return () => { alive = false } }, [active.id, tick])
  useEffect(() => { if (tab === "available" || tab === "updates") { let alive = true; if (!available) loadAvailablePkgs(active).then(x => { if (alive) setAvailable(x) }).catch(() => { if (alive) setErr("可用软件包读取失败，请先点“更新列表”") }); return () => { alive = false } } }, [tab, active.id, available === null])
  const updates = available ? upgradablePkgs(installed, available) : []
  const source = tab === "installed" ? installed : tab === "updates" ? updates : (available ?? [])
  const shown = filterPkgs(source, q, limit)
  const run = (title: string, effect: string, fn: () => Promise<{ code: number; out: string }>) => guarded(setBusy, async () => {
    if (!await confirmed(`${active.name} · ${title}`, effect, async () => { const r = await fn(); setLog(`${r.code === 0 ? "成功" : "失败（代码 " + r.code + "）"}\n${r.out}`) })) return
    setAvailable(null); setTick(t => t + 1)
  })

  const swipeFor = (p: Pkg): any[] => p.installed
    ? [...(p.upgradeTo ? [<Button title="升级" tint="systemBlue" action={() => run(p.name, `升级到 ${p.upgradeTo}；可能重启相关服务。`, () => pkgUpgrade(active, [p.name]))} />] : []),
       <Button title="卸载" tint="systemRed" action={() => run(p.name, "卸载软件包及其不再需要的依赖；可能导致依赖它的功能失效。", () => pkgRemove(active, [p.name]))} />]
    : [<Button title="安装" tint="systemBlue" action={() => run(p.name, "下载并安装；会改动系统。", () => pkgInstall(active, [p.name]))} />]
  return <Form navigationTitle="软件管理" navigationBarTitleDisplayMode="inline">
    {err ? <Section><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
    <Section header={<Text>磁盘空间</Text>} footer={<Text>软件包操作可能破坏系统，请谨慎。</Text>}><Text foregroundStyle="secondaryLabel">{disk || "-"}</Text></Section>
    <Section header={<Text>过滤器</Text>}><TextField title="输入关键字过滤" value={q} onChanged={(v: string) => { setQ(v); setLimit(100) }} autocorrectionDisabled textInputAutocapitalization="never" /></Section>
    <Section header={<Text>下载并安装</Text>}>
      <TextField title="软件包名称" value={url} onChanged={setUrl} autocorrectionDisabled textInputAutocapitalization="never" />
      <Button title="安装" disabled={busy || !url.trim()} action={() => run(url.trim(), "下载并安装；会改动系统。", () => pkgInstall(active, [url.trim()]))} />
    </Section>
    <Section header={<Text>操作</Text>}>
      <Button title="更新列表" disabled={busy} action={() => run("软件源", "刷新软件源索引，需联网，不安装任何软件。", () => pkgUpdateLists(active))} />
      {updates.length ? <Button title="升级全部" tint="systemRed" disabled={busy} action={() => run(`${updates.length} 个软件包`, "升级全部可更新的软件包；可能重启服务，系统核心包升级有风险。", () => pkgUpgrade(active, updates.map(p => p.name)))} /> : null}
    </Section>
    <Section>
      <Picker title="" pickerStyle="segmented" value={tab} onChanged={(v: any) => { setTab(v); setLimit(100) }}><Text tag="available">可用</Text><Text tag="installed">已安装</Text><Text tag="updates">更新</Text></Picker>
    </Section>
    <Section footer={<Text>{tab !== "installed" && !available ? "正在读取软件源（首次约十几秒）…" : shown.total > shown.items.length ? `显示 ${shown.items.length} / ${shown.total}，输入关键字缩小范围` : `共 ${shown.total} 项`}</Text>}>
      {shown.items.map(p => { const q = tab === "available" && installed.some(i => i.name === p.name) ? { ...p, installed: true, upgradeTo: updates.find(u => u.name === p.name)?.upgradeTo } : p; return <PkgRow key={p.name + p.version} p={q} actions={swipeFor(q)} /> })}
      {shown.total > shown.items.length ? <Button title="显示更多" action={() => setLimit(limit + 100)} /> : null}
    </Section>
    {log ? <Section header={<Text>操作输出</Text>}><Text font={11} foregroundStyle="secondaryLabel">{log}</Text></Section> : null}
  </Form>
}

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
  const [prefs, setPrefs] = useState(getPreferences())
  const [revealed, setRevealed] = useState<string[]>([])
  const [list, setList] = useState(listControllers())
  const reload = () => { setList(listControllers()); onChanged() }

  function remove(id: string) {
    removeController(id)
    setList(listControllers())
    setTimeout(onChanged, 500)
  }
  return <Form navigationTitle="面板设置" navigationBarTitleDisplayMode="inline" onAppear={() => setPrefs(prev => { const next = getPreferences(); return prev.foldOffline === next.foldOffline ? prev : next })}>
    <Section header={<HStack><Text>OpenWrt</Text><Spacer /><Text font={12} foregroundStyle="secondaryLabel">{`v${VERSION}`}</Text></HStack>}>
      {list.map(c => <NavigationLink key={c.id} destination={<EditController initial={c} onDone={reload} />}
          trailingSwipeActions={{ allowsFullSwipe: false, actions: [<Button title="删除" tint="systemRed" action={() => remove(c.id)} />] }}>
          <VStack alignment="leading" onLongPressGesture={() => setRevealed([...revealed, c.id])}><Text>{c.name}</Text>{prefs.foldOffline && controllerHealth[c.id] === false && !revealed.includes(c.id)
            ? <Text font={12} foregroundStyle="secondaryLabel">连接失败 · 长按展开地址</Text>
            : <Text font={12} foregroundStyle="secondaryLabel">{maskUrl(c.url)}</Text>}</VStack>
        </NavigationLink>)}
      <NavigationLink destination={<EditController onDone={reload} />}><Label title="添加 OpenWrt" systemImage="plus" /></NavigationLink>
    </Section>
    {!active ? <Section header={<Text>路由器详情</Text>}>
      <NavigationLink destination={<GlobalConfigPage active={null} />}><Label title="全局配置" systemImage="slider.horizontal.3" /></NavigationLink>
      <NavigationLink destination={<LogsPage />}><Label title="运行日志" systemImage="doc.text" /></NavigationLink>
    </Section> : null}
    {active ? <Section header={<Text>路由器详情</Text>}>
      <NavigationLink destination={<GlobalConfigPage active={active} />}><Label title="全局配置" systemImage="slider.horizontal.3" /></NavigationLink>
      <NavigationLink destination={<WrtInterfacesPage active={active} version={0} />}><Label title="网络接口" systemImage="network" /></NavigationLink>
      <NavigationLink destination={<WrtLeasesPage active={active} version={0} />}><Label title="在线设备" systemImage="laptopcomputer.and.iphone" /></NavigationLink>
      <NavigationLink destination={<DockerPage active={active} />}><HStack spacing={10}><DockerLogo size={22} mono /><Text>Docker 管理</Text></HStack></NavigationLink>
      <NavigationLink destination={<FrpPage active={active} />}><Label title="FRP 管理" systemImage="arrow.left.arrow.right" /></NavigationLink>
      <NavigationLink destination={<SoftwarePage active={active} />}><Label title="软件管理" systemImage="shippingbox" /></NavigationLink>
      <NavigationLink destination={<LogsPage />}><Label title="运行日志" systemImage="doc.text" /></NavigationLink>
    </Section> : null}
  </Form>
}

type RootTab = "home" | "proxies" | "rules" | "connections" | "more"
function MorePage({ active, onChanged, onClose, selected = true }: { active: Controller | null; onChanged: () => void; onClose?: () => void; selected?: boolean }) {
  return <DashboardMorePage selected={selected} active={active} onChanged={onChanged} onClose={onClose} settings={<Card>
    <NavigationLink destination={<GlobalConfigPage active={active} />}><Label title="全局配置" systemImage="slider.horizontal.3" /></NavigationLink>
    <NavigationLink destination={<SettingsPage active={active} onChanged={onChanged} />}><Label title="设置（控制器管理）" systemImage="gearshape" /></NavigationLink>
  </Card>} />
}
function Root() {
  const dismiss = Navigation.useDismiss()
  const [version, setVersion] = useState(0)
  const selection = useObservable<RootTab>(() => { const p = getPreferences().defaultPage; return p === "overview" ? "home" : p })
  // Native TabView updates the binding without necessarily rebuilding this
  // already-retained JS owner. Explicitly invalidate derived selected props.
  const [, refreshSelection] = useState(0)
  useEffect(() => {
    const changed = () => refreshSelection(n => n + 1)
    selection.subscribe(changed)
    return () => selection.unsubscribe(changed)
  }, [selection])
  const tab = selection.value
  const active = getActive(), bump = () => { setVersion(v => v + 1) }

  return <TabView selection={selection} symbolVariant="none" font={14} foregroundStyle={MAIN_FG}>
    <Tab key="home" title="主页" systemImage="square.stack.fill" value="home">
      <NavigationStack key="home-stack">
        <OverviewPage selected={tab === "home"} key={`home:${active?.id ?? "empty"}`} active={active} version={version} onSwitch={bump} onClose={dismiss} />
      </NavigationStack>
    </Tab>
    <Tab key="proxies" title="代理" systemImage="network" value="proxies">
      <NavigationStack key="proxies-stack">
        {tab === "proxies" ? <ProxiesPage selected onClose={dismiss} key={`proxies:${active?.id ?? "empty"}`} active={active} version={version} /> : null}
      </NavigationStack>
    </Tab>
    <Tab key="rules" title="规则" systemImage="swatchpalette" value="rules">
      <NavigationStack key="rules-stack">
        {tab === "rules" ? <RulesPage selected onClose={dismiss} key={`rules:${active?.id ?? "empty"}`} active={active} version={version} /> : null}
      </NavigationStack>
    </Tab>
    <Tab key="connections" title="连接" systemImage="arrow.left.arrow.right" value="connections">
      <NavigationStack key="connections-stack">
        {tab === "connections" ? <ConnectionsPage selected onClose={dismiss} key={`connections:${active?.id ?? "empty"}`} active={active} version={version} /> : null}
      </NavigationStack>
    </Tab>
    <Tab key="more" title="更多" systemImage="ellipsis" value="more">
      <NavigationStack key="more-stack">
        <MorePage selected={tab === "more"} onClose={dismiss} key={`more:${active?.id ?? "empty"}`} active={active} onChanged={bump} />
      </NavigationStack>
    </Tab>
  </TabView>
}

// Keep navigation content identity stable when the appearance shell updates.
function AppearanceRoot() {
  const prefs = usePreferences(["theme"])
  const [content] = useState(() => <Root />)
  return <ZStack preferredColorScheme={prefs.theme === "system" ? undefined : prefs.theme} frame={{ maxWidth: "infinity", maxHeight: "infinity" }}>{content}</ZStack>
}

async function run() {
  recordEvent("start", true)
  await Navigation.present({ element: <AppearanceRoot />, modalPresentationStyle: "fullScreen" })
  Script.exit()
}
run()
