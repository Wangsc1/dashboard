import { detailReads, useDetailPage, useRouterDetail, peekDetail, prefetchRouterDetails, detailWrite, observeDetailsPhase, selectDetailsSource } from "./router-details"
import { HOME_BG, HomeDashboard, CpuDetails, LiveCpuDetails, createCpuDetailFeed } from "./home-ui"
import { newHistory, appendHistory, OverviewHistory } from "./openwrt-metrics"
import { rootToolbar } from "./root-toolbar"
import { prefetchMoreVersions, prefetchProxies, prefetchRules, prefetchConnections, ProxiesPage, ConnectionsPage, RulesPage, GroupSection, MorePage as DashboardMorePage } from "./dashboard-pages"
import {
  AppEvents, Animation, Transition, Button, ForEach, Form, HStack, Label, Navigation, NavigationLink, NavigationStack, Picker, Script, Section, SecureField, Spacer,
  Image, Menu, RoundedRectangle, Circle, ScrollView, SVG, Text, ZStack, modifiers, TextField, Toggle, VStack, TabView, Tab, useObservable, useEffect, useState, useMemo,
} from "scripting"
import {
  VERSION, Controller, Group, Conn, Rule, Overview, Plugin, PLUGINS, listControllers, saveController, removeController, getActive, setActive, getSecret, getClashSecret,
  loadOverview, overviewSource, resetOverviewSampling, loadClashOverview, loadWrtInterfaces, loadWrtLeases, WrtIface, WrtLease, loadGroups, selectProxy, testGroup, loadConnections, loadConnectionHosts, closeConnection,
  closeAllConnections, loadRules, DockerContainer, FrpInfo, FrpProxy, DockerSettings, loadDiskUsage, loadInstalledPkgs, loadAvailablePkgs, upgradablePkgs, filterPkgs, pkgUpdateLists, pkgInstall, pkgRemove, pkgUpgrade, Pkg, loadDockerContainers, loadContainerDetail, dockerContainerOp, DockerContainerDetail, loadDockerImages, dockerImageRemove, DockerImage, loadDockerOverview, DockerOverview, dockerAction, loadFrp, frpAction, saveFrpCommon, saveFrpProxy, deleteFrpProxy, loadDockerSettings, saveDockerSettings, loadContainerPolicy, saveContainerPolicy, fmtBytes, fmtSpeed, fmtParts, fmtUptime, fmtDuration, delayColor,
} from "./api"

import { confirmed, sourceKey, SceneVisibility } from "./dashboard-model"
import { DOCKER_PNG_BASE64 } from "./docker-icon"
import { useSmoothPlot } from "./chart-ui"
import { requestPlotKick } from "./plot-view"
import { CHART_HISTORY } from "./chart"
import { panelRowBackground, PanelSettingsSections, LogsPage, KernelConfigPage, usePageColorScheme, usePreferences } from "./settings-ui"
import { getPreferences, controllerHealth, cachedIcon, feedback, recordEvent } from "./preferences"

const msg = (e: any) => String(e?.message ?? e ?? "未知错误")

function useInterval(fn: (current: () => boolean) => Promise<void>, ms: number, deps: any[]) {
  useEffect(() => {
    let alive = true, busy = false
    const current = () => alive
    async function refresh() {
      if (!alive || busy) return
      busy = true
      try { await fn(current) } finally { busy = false }
    }
    void refresh()
    const t = setInterval(refresh, ms)
    return () => { alive = false; clearInterval(t) }
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

// Root collects real foreground history before a lazy native home tab mounts.
interface OverviewFrame { overview: Overview; histories: OverviewHistory }
// Process-local display snapshots survive lazy native tab unmounts. Source keys
// include authentication identity; neither samples nor history are persisted.
const overviewPrime = new Map<string, OverviewFrame>()
const overviewErrors = new Map<string,string>()
const overviewPrimeListeners = new Set<(source:string,frame?:OverviewFrame,error?:string)=>void>()
function saveOverviewFrame(source: string, o: Overview, baseline: boolean): OverviewFrame {
  const previous = overviewPrime.get(source), old = previous?.overview.wrt
  const reboot = !!(old && o.wrt && o.wrt.uptime < old.uptime)
  const h = !reboot && previous ? previous.histories : newHistory()
  const cpus = o.wrt?.cpus ?? []
  const sameBoot = !!(old && o.wrt && !reboot)
  const keepCpu = baseline && sameBoot && cpus.length > 0 && cpus.length === old!.cpus?.length && cpus.every((c,i)=>c.usage===undefined && c.id===old!.cpus?.[i]?.id)
  const keepTraffic = baseline && sameBoot
  const overview = keepTraffic || keepCpu ? {...o,
    ...(keepTraffic ? {traffic:previous!.overview.traffic} : {}),
    ...(keepCpu ? {wrt:{...o.wrt!,cpu:old!.cpu,cpus:old!.cpus}} : {}),
  } : o
  const histories = appendHistory(h,o.traffic.down,o.traffic.up,cpus)
  // A rebase measures counters, not CPU/rates. Retain the old drawing without
  // adding held values or artificial zero points; real new samples append later.
  if (baseline) { histories.up=h.up; histories.down=h.down }
  if (keepCpu) histories.cpu=h.cpu
  const frame = {overview,histories}
  overviewPrime.set(source,frame)
  return frame
}
// One foreground sampling owner, independent of the selected native tab.
// A request must finish before another starts; delayed responses never create a
// catch-up burst or a near-zero CPU delta. Pauses invalidate unfinished samples.
function startOverviewSampling(active: Controller, foreground: boolean): () => void {
  const source = overviewSource(active)
  let disposed = false, running = false, busy = false, baseline = true
  let eligibleAt = -Infinity, timer: ReturnType<typeof setInterval> | undefined
  let generation = 0
  const publish = (frame?: OverviewFrame, error?: string) => {
    for (const fn of overviewPrimeListeners) fn(source, frame, error)
  }
  const refresh = async () => {
    if (disposed || !running || busy || Date.now() < eligibleAt || overviewSource(active) !== source) return
    busy = true
    const epoch = generation, startedAt=Date.now(), wasBaseline=baseline
    try {
      const o = await loadOverview(active)
      if (disposed || !running || epoch !== generation || overviewSource(active) !== source) return
      const frame = saveOverviewFrame(source, o, baseline)
      baseline = false
      overviewErrors.delete(source)
      publish(frame, "")
    } catch (e) {
      if (!disposed && running && epoch === generation && overviewSource(active) === source) {
        const error = msg(e)
        overviewErrors.set(source, error)
        publish(undefined, error)
      }
    } finally {
      busy = false
      // Subtract read time instead of adding a full second to every request.
      // Baselines (including pause/rebase) keep one full measurement interval;
      // steady samples retain >=500ms after completion, never catch-up bursts.
      const delay=wasBaseline||epoch!==generation?1000:Math.max(500,1000-(Date.now()-startedAt))
      eligibleAt=Date.now()+delay
      if (!disposed && running) {
        if (timer !== undefined) clearInterval(timer)
        timer = setInterval(refresh, delay)
      }
    }
  }
  const pause = () => {
    running = false; generation++; baseline = true;
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
    resetOverviewSampling(active, source)
  }
  const resume = () => {
    if (disposed || running) return
    running = true; eligibleAt = -Infinity;
    void refresh()
    timer = setInterval(refresh, 1000)
  }
  const phaseChanged = (phase: "active" | "inactive" | "background") => {
    if (phase === "active") resume(); else pause()
  }
  AppEvents.scenePhase.addListener(phaseChanged)
  resetOverviewSampling(active, source)
  if (foreground) resume()
  return () => { disposed = true; pause(); AppEvents.scenePhase.removeListener(phaseChanged) }
}
function OverviewPage({ active, version, onSwitch, onClose, selected = true }: { active: Controller | null; version: number; onSwitch: () => void; onClose?: () => void; selected?: boolean }) {
  const prefs = usePreferences(["connectionBackground"])
  const [hosts, setHosts] = useState<string[]>([])
  const [ov, setOv] = useState<Overview | null>(() => (active ? overviewPrime.get(overviewSource(active))?.overview ?? null : null))
  const [err, setErr] = useState("")
  const [histories, setHistories] = useState(() => (active ? overviewPrime.get(overviewSource(active))?.histories : undefined) ?? newHistory())
  const [sampleSource,setSampleSource]=useState(() => (active ? overviewSource(active) : ""))
  const [cpuOpen,setCpuOpen]=useState(false)
  const source=active?overviewSource(active):""
  const all = listControllers()
  // Retain the navigation owner while pausing work behind pushed settings pages.
  const [visible, setVisible] = useState(true)
  const [sceneVisibility] = useState(() => ({ model: new SceneVisibility(), selected }))
  sceneVisibility.selected = selected
  useEffect(() => {
    // Lock/background can deliver onDisappear without a return onAppear. Restore
    // only such scene-caused hides; pushed pages/tab changes keep their gates.
    const changed = (phase: "active" | "inactive" | "background") => { if (sceneVisibility.model.scene(phase === "active", Date.now()) && sceneVisibility.selected) setVisible(true) }
    AppEvents.scenePhase.addListener(changed)
    return () => AppEvents.scenePhase.removeListener(changed)
  }, [])
  const hideHome = () => { if (sceneVisibility.model.disappear(Date.now())) setVisible(false) }
  const showHome = () => { sceneVisibility.model.appear(); setVisible(true); requestPlotKick("appear") }
  const foreground = useForeground()
  const showCharts = foreground && selected && (visible || cpuOpen)
  useEffect(() => { const frame=overviewPrime.get(source);setHistories(frame?.histories??newHistory());setOv(frame?.overview??null);setSampleSource(source);setCpuOpen(false) }, [source])
  // Hidden tabs keep no live UI subscription. On return consume the latest full
  // snapshot, including real samples collected while another tab was selected.
  useEffect(()=>{
    if (!showCharts) return
    const receive=(key:string,frame?:OverviewFrame,error?:string)=>{
      if(key!==source)return
      if(frame){setOv(frame.overview);setHistories(frame.histories);setSampleSource(key)}
      setErr(error??"")
    }
    overviewPrimeListeners.add(receive)
    receive(source,overviewPrime.get(source),overviewErrors.get(source))
    return()=>{overviewPrimeListeners.delete(receive)}
  },[source,showCharts])
  useEffect(()=>{if(selected){setVisible(true);requestPlotKick("selected")}else setCpuOpen(false)},[selected])
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
  }, [source, prefs.connectionBackground, showCharts])
  const currentFrame=showCharts?overviewPrime.get(source):undefined
  const shownOv=currentFrame?.overview??(sampleSource===source?ov:null)
  const shownHistory=currentFrame?.histories??(sampleSource===source?histories:newHistory())
  // Keep sheet.content stable across sample updates; publish only the live frame.
  const [detailFeed]=useState(()=>createCpuDetailFeed({overview:null,histories:newHistory(),running:false}))
  const detailContent=useMemo(()=><LiveCpuDetails feed={detailFeed}/>,[detailFeed])
  useEffect(()=>{detailFeed.setValue({overview:shownOv,histories:shownHistory,running:showCharts&&cpuOpen})},[shownOv,shownHistory,showCharts,cpuOpen,detailFeed])
  // Freeze the obscured home chart subtree while the sheet consumes live samples.
  const [homeFrame]=useState(()=>({source:"",overview:null as Overview|null,histories:newHistory()}))
  if(!cpuOpen||homeFrame.source!==source){homeFrame.source=source;homeFrame.overview=shownOv;homeFrame.histories=shownHistory}
  const openCpu=useMemo(()=>()=>setCpuOpen(true),[])
  const homeContent=useMemo(()=><HomeDashboard overview={homeFrame.overview} histories={homeFrame.histories} running={showCharts&&visible&&!cpuOpen} onCpu={openCpu}/>,[homeFrame.overview,homeFrame.histories,showCharts&&visible&&!cpuOpen,openCpu])
  const shownError = active && active.kind !== "openwrt" ? "主页仅支持 OpenWrt 路由器数据，请在设置添加 OpenWrt" : err
  const statusText = shownError ? "连接失败" : ov ? "运行正常" : "连接中", statusColor = err ? "systemRed" : "systemGreen"
  const toolbar = useMemo(() => ({ ...rootToolbar("home", onClose, <NavigationLink destination={<SettingsPage active={active} onChanged={onSwitch} />}><Image systemName="ellipsis.circle" /></NavigationLink>),
    // Status is an overlay: only the single title participates in toolbar layout,
    // so adding the subtitle does not lift the title above other tabs' baseline.
    principal: <Text font={17} fontWeight="semibold" overlay={{alignment:"bottom",content:
      <HStack spacing={4} offset={{x:0,y:14}}><Circle fill={statusColor} frame={{ width: 5, height: 5 }} /><Text font={11} foregroundStyle={statusColor}>{statusText}</Text></HStack>
    }}>{active?.name||"OpenWrt 状态"}</Text> }), [active, onSwitch, onClose, statusText, statusColor])
  if (!active) return <Form navigationTitle="dashboard" navigationBarTitleDisplayMode="inline" toolbar={toolbar} onAppear={showHome} onDisappear={hideHome}><NoController /></Form>
  const closeCpu=(value:boolean)=>{setCpuOpen(value);if(!value)setVisible(true)}
  return <VStack spacing={0} navigationTitle={active.name} navigationBarTitleDisplayMode="inline" toolbar={toolbar} onAppear={showHome} onDisappear={hideHome}
    sheet={{isPresented:cpuOpen,onChanged:closeCpu,content:detailContent}}>
    <ScrollView background={HOME_BG}>
      <VStack spacing={16} padding={{horizontal:16,top:12,bottom:24}}>
        {all.length>1?<Card><Picker title="当前路由器" pickerStyle="menu" value={active.id} onChanged={(v:string)=>{setActive(v);onSwitch()}}>{all.map(c=><Text key={c.id} tag={c.id}>{c.name}</Text>)}</Picker></Card>:null}
        {shownError?<Text font={12} foregroundStyle="systemRed">{shownError}</Text>:null}
        {homeContent}
        <Card><HStack><Badge icon="link" color="#A855F7"/><Text font={13}>活动连接</Text><Spacer/><Text font={13}>{shownOv?String(shownOv.connCount):"--"}</Text></HStack>{hosts.length?<Text font={10} foregroundStyle="secondaryLabel" lineLimit={1}>{hosts.join(" · ")}</Text>:null}</Card>
      </VStack>
    </ScrollView>
  </VStack>
}

function WrtInterfacesPage({ active, version }: { active: Controller; version: number }) {
  const page=useDetailPage()
  const {value:list,error:err}=useRouterDetail(active,"interfaces",()=>detailReads.interfaces(active),version,5000,page)

  const pageScheme = usePageColorScheme(page)
  return <Form preferredColorScheme={pageScheme} onAppear={page.onAppear} onDisappear={page.onDisappear} background="systemBackground" scrollContentBackground="hidden" navigationTitle="网络接口" navigationBarTitleDisplayMode="inline">
    {!list&&!err?<Text>正在读取…</Text>:null}
    {err ? <Section listRowBackground={panelRowBackground()}><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
    <Section listRowBackground={panelRowBackground()}>
      {list?.map(i => <VStack key={i.name} alignment="leading" spacing={2}>
        <HStack><Text>{i.name}</Text><Spacer /><Text font={13} foregroundStyle={i.up ? "systemGreen" : "systemRed"}>{i.up ? "已连接" : "未连接"}</Text></HStack>
        <Text font={12} foregroundStyle="secondaryLabel">{`${i.proto || "-"} · ${i.device || "-"} · ${i.ip || "无 IPv4"}${i.up ? " · " + fmtUptime(i.uptime) : ""}`}</Text>
      </VStack>)}
    </Section>
  </Form>
}
function WrtLeasesPage({ active, version }: { active: Controller; version: number }) {
  const page=useDetailPage()
  const {value:list,error:err}=useRouterDetail(active,"leases",()=>detailReads.leases(active),version,10000,page)

  const pageScheme = usePageColorScheme(page)
  return <Form preferredColorScheme={pageScheme} onAppear={page.onAppear} onDisappear={page.onDisappear} background="systemBackground" scrollContentBackground="hidden" navigationTitle={list ? `在线设备 (${list.length})` : "在线设备"} navigationBarTitleDisplayMode="inline">
    {!list&&!err?<Text>正在读取…</Text>:null}
    {err ? <Section listRowBackground={panelRowBackground()}><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
    <Section listRowBackground={panelRowBackground()} footer={<Text>来自 DHCP 租约，不含静态地址设备。</Text>}>
      {list?.map(l => <VStack key={l.mac + l.ip} alignment="leading" spacing={2}>
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

const gi = (n: number) => (n / 1073741824).toFixed(2) + " GiB"
function DockerPage({ active }: { active: Controller }) {
  const page=useDetailPage()
  const [busy,setBusy]=useState(false),[tick,setTick]=useState(0)
  const {value:ov,error:overviewError}=useRouterDetail(active,"docker",()=>detailReads.docker(active),tick,0,page)
  const {value:list,error:err}=useRouterDetail(active,"containers",()=>detailReads.containers(active),tick,0,page)
  const {value:images,error:imageError}=useRouterDetail(active,"images",()=>detailReads.images(active),tick,0,page)
  const act = (x: DockerContainer, action: "start" | "stop" | "restart", label: string) => {
    if (busy) return
    void guarded(setBusy, async () => { await confirmed(`${active.name} · ${x.name}`, `${label}容器；会影响该容器承载的服务。`, () => detailWrite(active,"docker",() => dockerAction(active, x.id, action))); setTick(t => t + 1) })
  }

  const pageScheme = usePageColorScheme(page)
  return <Form preferredColorScheme={pageScheme} onAppear={page.onAppear} onDisappear={page.onDisappear} background="systemBackground" scrollContentBackground="hidden" navigationTitle="Docker 管理" navigationBarTitleDisplayMode="inline">
    {!ov&&!overviewError?<Text>正在读取 Docker 概览…</Text>:null}
    {overviewError?<Text foregroundStyle="systemRed">{overviewError}</Text>:null}
    {!list&&!err?<Text>正在读取容器…</Text>:null}
    {!images&&!imageError?<Text>正在读取镜像…</Text>:null}
    {imageError?<Text foregroundStyle="systemRed">{imageError}</Text>:null}
    {err ? <Section listRowBackground={panelRowBackground()}><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
    {ov ? <Section listRowBackground={panelRowBackground()} header={<Text>概览</Text>}>
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
    <Section listRowBackground={panelRowBackground()}><NavigationLink destination={<DockerSettingsPage active={active} />}><Label title="Docker 参数" systemImage="slider.horizontal.3" /></NavigationLink></Section>
    <Section listRowBackground={panelRowBackground()} header={<Text>容器</Text>}>
      {list?.map(x => <NavigationLink key={x.id} destination={<ContainerPage active={active} x={x} />}
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
    <Section listRowBackground={panelRowBackground()} header={<Text>镜像</Text>}>
      {images?.map(x => <NavigationLink key={x.id} destination={<ImagePage active={active} x={x} onDone={() => setTick(t => t + 1)} />}>
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
  const del = (force: boolean) => guarded(setBusy, async () => { if (await confirmed(`${active.name} · ${x.tags[0] ?? x.id.slice(7, 19)}`, `${force ? "强制" : ""}删除镜像；${x.containers.length ? "仍有容器使用它，" : ""}不可恢复。`, () => detailWrite(active,"docker",() => dockerImageRemove(active, x.id, force)))) { onDone(); dismiss() } })

  const page=useDetailPage()
  const pageScheme = usePageColorScheme(page)
  return <Form onAppear={page.onAppear} onDisappear={page.onDisappear} preferredColorScheme={pageScheme} background="systemBackground" scrollContentBackground="hidden" navigationTitle="镜像" navigationBarTitleDisplayMode="inline">
    <Section listRowBackground={panelRowBackground()} header={<Text>镜像文件概览</Text>}>
      <Row title="标签" value={x.tags.join("\n")} />
      <Row title="容器" value={x.containers.join(", ")} />
      <Row title="大小" value={mib(x.size)} />
      <Row title="创建时间" value={when(x.created)} />
      <Row title="ID" value={x.id.replace("sha256:", "").slice(0, 12)} />
    </Section>
    <Section listRowBackground={panelRowBackground()}>
      <Button title="删除" tint="systemRed" disabled={busy} action={() => del(false)} />
      <Button title="强制删除" tint="systemRed" disabled={busy} action={() => del(true)} />
    </Section>
  </Form>
}

function ContainerPage({ active, x }: { active: Controller; x: DockerContainer }) {
  const page=useDetailPage()
  const dismiss = Navigation.useDismiss()
  const [tick,setTick]=useState(0)
  const {value:d,error:err}=useRouterDetail(active,`container:${x.id}`,()=>loadContainerDetail(active,x.id),tick,0,page)
  const [policy,setPolicy]=useState(()=>peekDetail<DockerContainerDetail>(active,`container:${x.id}`)?.policy??""),[orig,setOrig]=useState(policy),[busy,setBusy]=useState(false)
  useEffect(()=>{if(d&&policy===orig){setPolicy(d.policy);setOrig(d.policy)}},[d])
  const op = (label: string, effect: string, fn: () => Promise<any>, leave = false) => guarded(setBusy, async () => { if (await confirmed(`${active.name} · ${x.name}`, effect, fn)) { if (leave) dismiss(); else setTimeout(() => setTick(t => t + 1), 800) } })
  const save = () => guarded(setBusy, async () => { await confirmed(`${active.name} · ${x.name}`, `将重启策略改为 ${policy}，不重启容器。`, () => detailWrite(active,"docker",() => saveContainerPolicy(active, x.id, policy))); setOrig(policy) })

  const pageScheme = usePageColorScheme(page)
  return <Form preferredColorScheme={pageScheme} onAppear={page.onAppear} onDisappear={page.onDisappear} background="systemBackground" scrollContentBackground="hidden" navigationTitle={x.name} navigationBarTitleDisplayMode="inline">
    {!d&&!err?<Text>正在读取…</Text>:null}
    {err ? <Section listRowBackground={panelRowBackground()}><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
    {d ? <Section listRowBackground={panelRowBackground()} header={<Text>容器概览</Text>}>
      <Row title="容器" value={d.name} />
      <Row title="状态" value={d.paused ? "paused" : d.state} />
      <Row title="ID" value={d.id.slice(0, 12)} />
      <Row title="映像" value={d.image} />
      <Row title="网络" value={d.network} />
      <Row title="端口" value={d.ports} />
      <Row title="命令" value={d.command} />
      <Row title="创建时间" value={when(d.created)} />
    </Section> : null}
    {d ? <Section listRowBackground={panelRowBackground()}>
      <Button title={d.paused ? "恢复" : "暂停"} disabled={busy} action={() => op("", `${d.paused ? "恢复" : "暂停"}容器。`, () => detailWrite(active,"docker",() => dockerContainerOp(active, x.id, d.paused ? "unpause" : "pause")))} />
      <Button title="重启" disabled={busy} action={() => op("", "重启容器；服务会短暂中断。", () => detailWrite(active,"docker",() => dockerAction(active, x.id, "restart")))} />
      <Button title="停止" disabled={busy} action={() => op("", "停止容器；服务会中断。", () => detailWrite(active,"docker",() => dockerAction(active, x.id, "stop")))} />
      <Button title="强制结束" tint="systemRed" disabled={busy} action={() => op("", "向容器发送 KILL 信号，立即终止进程。", () => detailWrite(active,"docker",() => dockerContainerOp(active, x.id, "kill")))} />
      <Button title="删除" tint="systemRed" disabled={busy} action={() => op("", "删除容器（需先停止）；不可恢复。", () => detailWrite(active,"docker",() => dockerContainerOp(active, x.id, "remove")), true)} />
      <Button title="强制删除" tint="systemRed" disabled={busy} action={() => op("", "强制删除容器，即使正在运行；不可恢复。", () => detailWrite(active,"docker",() => dockerContainerOp(active, x.id, "force-remove")), true)} />
    </Section> : null}
    {policy ? <Section listRowBackground={panelRowBackground()} header={<Text>参数</Text>} footer={<Text>仅修改重启策略；端口、挂载、环境变量需重建容器，这里不提供。</Text>}>
      <Picker title="重启策略" pickerStyle="menu" value={policy} onChanged={setPolicy}>
        <Text tag="no">不自动重启</Text><Text tag="always">总是重启</Text><Text tag="unless-stopped">除非手动停止</Text><Text tag="on-failure">失败时重启</Text>
      </Picker>
      <Button title="保存" disabled={busy || policy === orig} action={save} />
    </Section> : null}
  </Form>
}

function DockerSettingsPage({ active }: { active: Controller }) {
  const page=useDetailPage()
  const {value:remote,error:err}=useRouterDetail(active,"dockerSettings",()=>detailReads.dockerSettings(active),0,0,page)
  const source=overviewSource(active)
  const [edit,setEdit]=useState(()=>({source,value:peekDetail<DockerSettings>(active,"dockerSettings")??null})),[busy,setBusy]=useState(false)
  const [dirtySource,setDirtySource]=useState("")
  const s=edit.source===source?edit.value:peekDetail<DockerSettings>(active,"dockerSettings")??null
  const setS=(value:DockerSettings|((old:DockerSettings|null)=>DockerSettings|null))=>setEdit(old=>({source,value:typeof value==="function"?value(old.source===source?old.value:null):value}))
  useEffect(()=>{if(remote&&dirtySource!==source)setS(remote)},[remote,source])
  const set = (k: keyof DockerSettings, v: string) => {setDirtySource(source);setS(o => o ? { ...o, [k]: v } : o)}
  const save = () => s && guarded(setBusy, async () => { await confirmed(`${active.name} · dockerd`, "保存后将重启 Docker 服务，所有容器会短暂中断。", () => detailWrite(active,"docker",() => saveDockerSettings(active, s))) })

  const pageScheme = usePageColorScheme(page)
  return <Form preferredColorScheme={pageScheme} onAppear={page.onAppear} onDisappear={page.onDisappear} background="systemBackground" scrollContentBackground="hidden" navigationTitle="Docker 参数" navigationBarTitleDisplayMode="inline">
    {!s&&!err?<Text>正在读取…</Text>:null}
    {err ? <Section listRowBackground={panelRowBackground()}><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
    {s ? <Section listRowBackground={panelRowBackground()} header={<Text>常规</Text>} footer={<Text>数据目录为只读（改动会让现有容器消失）。保存会重启 Docker。</Text>}>
      <HStack><Text>数据目录</Text><Spacer /><Text foregroundStyle="secondaryLabel">{s.dataRoot}</Text></HStack>
      <Picker title="日志级别" pickerStyle="menu" value={s.logLevel} onChanged={(v: string) => set("logLevel", v)}>
        {["debug", "info", "warn", "error", "fatal"].map(l => <Text key={l} tag={l}>{l}</Text>)}
      </Picker>
    </Section> : null}
    {s ? <Section listRowBackground={panelRowBackground()} header={<Text>代理</Text>} footer={<Text>留空表示不使用。地址需以 http:// 或 https:// 开头。</Text>}>
      <Field title="HTTP" value={s.httpProxy} onChanged={v => set("httpProxy", v)} />
      <Field title="HTTPS" value={s.httpsProxy} onChanged={v => set("httpsProxy", v)} />
      <Field title="不代理" value={s.noProxy} onChanged={v => set("noProxy", v)} />
    </Section> : null}
    {s ? <Section listRowBackground={panelRowBackground()}><Button title="保存" disabled={busy} action={save} /></Section> : null}
  </Form>
}

function FrpPage({ active }: { active: Controller }) {
  const page=useDetailPage()
  const [busy,setBusy]=useState(false),[tick,setTick]=useState(0)
  const {value:info,error:err}=useRouterDetail(active,"frp",()=>detailReads.frp(active),tick,0,page)
  const act = (action: "start" | "stop" | "restart", label: string) => {
    if (busy) return
    void guarded(setBusy, async () => { await confirmed(`${active.name} · frpc`, `${label} frp 客户端；穿透服务会短暂中断。`, () => detailWrite(active,"frp",() => frpAction(active, action))); setTimeout(() => setTick(t => t + 1), 1500) })
  }
  const reload = () => setTimeout(() => setTick(t => t + 1), 1500)

  const pageScheme = usePageColorScheme(page)
  return <Form preferredColorScheme={pageScheme} onAppear={page.onAppear} onDisappear={page.onDisappear} background="systemBackground" scrollContentBackground="hidden" navigationTitle="FRP 管理" navigationBarTitleDisplayMode="inline">
    {!info&&!err?<Text>正在读取…</Text>:null}
    {err ? <Section listRowBackground={panelRowBackground()}><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
    {info ? <Section listRowBackground={panelRowBackground()} header={<Text>服务</Text>}>
      <HStack><Text>状态</Text><Spacer /><HStack spacing={6}><Circle fill={info.running ? "systemGreen" : "systemRed"} frame={{ width: 7, height: 7 }} /><Text foregroundStyle="secondaryLabel">{info.running ? "运行中" : "已停止"}</Text></HStack></HStack>
      <HStack><Text>开机启动</Text><Spacer /><Text foregroundStyle="secondaryLabel">{info.enabled ? "已启用" : "未启用"}</Text></HStack>
      <NavigationLink destination={<FrpCommonPage active={active} info={info} onDone={reload} />}><HStack><Text>服务端参数</Text><Spacer /><Text foregroundStyle="secondaryLabel">{maskUrl(info.server)}</Text></HStack></NavigationLink>
      <Button title={info.running ? "停止" : "启动"} systemImage={info.running ? "stop.fill" : "play.fill"} disabled={busy} action={() => act(info.running ? "stop" : "start", info.running ? "停止" : "启动")} />
      <Button title="重启" systemImage="arrow.clockwise" disabled={busy} action={() => act("restart", "重启")} />
    </Section> : null}
    {info ? <Section listRowBackground={panelRowBackground()} header={<Text>穿透规则</Text>}>
      {info.proxies.map(x => <NavigationLink key={x.id} destination={<FrpProxyPage active={active} initial={x} onDone={reload} />}
          trailingSwipeActions={{ allowsFullSwipe: false, actions: [<Button title="删除" tint="systemRed" action={() => { void guarded(setBusy, async () => { await confirmed(`${active.name} · ${x.name}`, "删除该穿透规则并重启 frpc。", () => detailWrite(active,"frp",() => deleteFrpProxy(active, x.id))); reload() }) }} />] }}>
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
  const save = () => guarded(setBusy, async () => { if (await confirmed(`${active.name} · frpc`, "保存服务端参数并重启 frpc；穿透会短暂中断，参数错误会导致断连。", () => detailWrite(active,"frp",() => saveFrpCommon(active, { addr: addr.trim(), port: port.trim(), tls, token: token.trim() })))) { onDone(); dismiss() } })

  const page=useDetailPage()
  const pageScheme = usePageColorScheme(page)
  return <Form onAppear={page.onAppear} onDisappear={page.onDisappear} preferredColorScheme={pageScheme} background="systemBackground" scrollContentBackground="hidden" navigationTitle="服务端参数" navigationBarTitleDisplayMode="inline">
    <Section listRowBackground={panelRowBackground()}>
      <Field title="服务器地址" value={addr} onChanged={setAddr} />
      <Field title="服务器端口" value={port} onChanged={setPort} />
      <Toggle title="启用 TLS" value={tls} onChanged={setTls} />
      <Field title="Token" value={token} onChanged={setToken} />

    </Section>
    <Section listRowBackground={panelRowBackground()}><Button title="保存" disabled={busy} action={save} /></Section>
  </Form>
}

function FrpProxyPage({ active, initial, onDone }: { active: Controller; initial?: FrpProxy; onDone: () => void }) {
  const dismiss = Navigation.useDismiss()
  const [rawLocal] = [initial?.local ?? ":"], idx = rawLocal.lastIndexOf(":")
  const [name, setName] = useState(initial?.name ?? ""), [type, setType] = useState(initial?.type ?? "tcp")
  const [lip, setLip] = useState(initial ? rawLocal.slice(0, idx) : "10.0.0.1"), [lport, setLport] = useState(initial ? rawLocal.slice(idx + 1) : "")
  const [rport, setRport] = useState(initial?.remote ?? ""), [busy, setBusy] = useState(false)
  const save = () => guarded(setBusy, async () => { if (await confirmed(`${active.name} · ${name || "新规则"}`, `${initial ? "修改" : "添加"}穿透规则并重启 frpc。`, () => detailWrite(active,"frp",() => saveFrpProxy(active, { id: initial?.id, name: name.trim(), type, local_ip: lip.trim(), local_port: lport.trim(), remote_port: rport.trim() })))) { onDone(); dismiss() } })

  const page=useDetailPage()
  const pageScheme = usePageColorScheme(page)
  return <Form onAppear={page.onAppear} onDisappear={page.onDisappear} preferredColorScheme={pageScheme} background="systemBackground" scrollContentBackground="hidden" navigationTitle={initial ? initial.name : "添加规则"} navigationBarTitleDisplayMode="inline">
    <Section listRowBackground={panelRowBackground()}>
      <Field title="名称" value={name} onChanged={setName} />
      <Picker title="类型" pickerStyle="menu" value={type} onChanged={setType}><Text tag="tcp">TCP</Text><Text tag="udp">UDP</Text></Picker>
      <Field title="本地 IP" value={lip} onChanged={setLip} />
      <Field title="本地端口" value={lport} onChanged={setLport} />
      <Field title="远程端口" value={rport} onChanged={setRport} />
    </Section>
    <Section listRowBackground={panelRowBackground()}><Button title="保存" disabled={busy} action={save} /></Section>
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
  const page=useDetailPage()
  const [tab, setTab] = useState<"available" | "installed" | "updates">("installed")
  const [q, setQ] = useState(""), [url, setUrl] = useState(""), [limit, setLimit] = useState(100), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [log, setLog] = useState(""), [tick, setTick] = useState(0)
  const {value:installedData,error:installedError}=useRouterDetail(active,"installed",()=>detailReads.installed(active),tick,0,page)
  const {value:available,error:availableError}=useRouterDetail(active,"available",()=>detailReads.available(active),tick,0,page)
  const {value:diskData}=useRouterDetail(active,"disk",()=>detailReads.disk(active),tick,0,page)
  const installed=installedData??[]
  const disk=diskData?`${Math.round(diskData.used/diskData.size*100)}% 已用（${mib(diskData.used)} / ${mib(diskData.size)}，剩余 ${mib(diskData.avail)}）`:""
  const updates = available ? upgradablePkgs(installed, available) : []
  const installedNames = new Set<string>(), updatesByName = new Map<string, Pkg>()
  if (tab === "available") {
    for (const p of installed) installedNames.add(p.name)
    // Array.find used the first duplicate, not the last Map entry.
    for (const p of updates) if (!updatesByName.has(p.name)) updatesByName.set(p.name, p)
  }
  const source = tab === "installed" ? installed : tab === "updates" ? updates : (available ?? [])
  const shown = filterPkgs(source, q, limit)
  const run = (title: string, effect: string, fn: () => Promise<{ code: number; out: string }>) => guarded(setBusy, async () => {
    if (!await confirmed(`${active.name} · ${title}`, effect, async () => { const r = await fn(); setLog(`${r.code === 0 ? "成功" : "失败（代码 " + r.code + "）"}\n${r.out}`) })) return
    setTick(t => t + 1)
  })

  const swipeFor = (p: Pkg): any[] => p.installed
    ? [...(p.upgradeTo ? [<Button title="升级" tint="systemBlue" action={() => run(p.name, `升级到 ${p.upgradeTo}；可能重启相关服务。`, () => detailWrite(active,"software",() => pkgUpgrade(active, [p.name])))} />] : []),
       <Button title="卸载" tint="systemRed" action={() => run(p.name, "卸载软件包及其不再需要的依赖；可能导致依赖它的功能失效。", () => detailWrite(active,"software",() => pkgRemove(active, [p.name])))} />]
    : [<Button title="安装" tint="systemBlue" action={() => run(p.name, "下载并安装；会改动系统。", () => detailWrite(active,"software",() => pkgInstall(active, [p.name])))} />]

  const pageScheme = usePageColorScheme(page)
  return <Form preferredColorScheme={pageScheme} onAppear={page.onAppear} onDisappear={page.onDisappear} background="systemBackground" scrollContentBackground="hidden" navigationTitle="软件管理" navigationBarTitleDisplayMode="inline">
    {installedError||availableError?<Text foregroundStyle="systemRed">{installedError||availableError}</Text>:null}
    {err ? <Section listRowBackground={panelRowBackground()}><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
    <Section listRowBackground={panelRowBackground()} header={<Text>磁盘空间</Text>} footer={<Text>软件包操作可能破坏系统，请谨慎。</Text>}><Text foregroundStyle="secondaryLabel">{disk || (diskData===undefined?"正在读取…":"-")}</Text></Section>
    <Section listRowBackground={panelRowBackground()} header={<Text>过滤器</Text>}><TextField title="输入关键字过滤" value={q} onChanged={(v: string) => { setQ(v); setLimit(100) }} autocorrectionDisabled textInputAutocapitalization="never" /></Section>
    <Section listRowBackground={panelRowBackground()} header={<Text>下载并安装</Text>}>
      <TextField title="软件包名称" value={url} onChanged={setUrl} autocorrectionDisabled textInputAutocapitalization="never" />
      <Button title="安装" disabled={busy || !url.trim()} action={() => run(url.trim(), "下载并安装；会改动系统。", () => detailWrite(active,"software",() => pkgInstall(active, [url.trim()])))} />
    </Section>
    <Section listRowBackground={panelRowBackground()} header={<Text>操作</Text>}>
      <Button title="更新列表" disabled={busy} action={() => run("软件源", "刷新软件源索引，需联网，不安装任何软件。", () => detailWrite(active,"software",() => pkgUpdateLists(active)))} />
      {updates.length ? <Button title="升级全部" tint="systemRed" disabled={busy} action={() => run(`${updates.length} 个软件包`, "升级全部可更新的软件包；可能重启服务，系统核心包升级有风险。", () => detailWrite(active,"software",() => pkgUpgrade(active, updates.map(p => p.name))))} /> : null}
    </Section>
    <Section listRowBackground="clear">
      <HStack spacing={0} padding={4} frame={{height:44}} listRowInsets={0} glassEffect={{type:"rect",cornerRadius:22}}>{([["available","可用"],["installed","已安装"],["updates","更新"]] as const).map(([value,title])=><Button key={value} buttonStyle="plain" action={()=>{setTab(value);setLimit(100)}}><Text fontWeight={tab===value?"semibold":"regular"} foregroundStyle={tab===value?"systemBlue":"label"} frame={{maxWidth:"infinity",height:36}} glassEffect={tab===value?{type:"rect",cornerRadius:18}:false}>{title}</Text></Button>)}</HStack>
    </Section>
    <Section listRowBackground={panelRowBackground()} footer={<Text>{tab !== "installed" && !available ? "正在读取软件源（首次约十几秒）…" : shown.total > shown.items.length ? `显示 ${shown.items.length} / ${shown.total}，输入关键字缩小范围` : !installedData ? "正在读取…" : `共 ${shown.total} 项`}</Text>}>
      {shown.items.map(p => { const q = tab === "available" && installedNames.has(p.name) ? { ...p, installed: true, upgradeTo: updatesByName.get(p.name)?.upgradeTo } : p; return <PkgRow key={p.name + p.version} p={q} actions={swipeFor(q)} /> })}
      {shown.total > shown.items.length ? <Button title="显示更多" action={() => setLimit(limit + 100)} /> : null}
    </Section>
    {log ? <Section listRowBackground={panelRowBackground()} header={<Text>操作输出</Text>}><Text font={11} foregroundStyle="secondaryLabel">{log}</Text></Section> : null}
  </Form>
}

function HelpPage() {

  const pageScheme = usePageColorScheme()
  return <Form preferredColorScheme={pageScheme} background="systemBackground" scrollContentBackground="hidden" navigationTitle="使用说明" navigationBarTitleDisplayMode="inline">
    <Section listRowBackground={panelRowBackground()} header={<Text>OpenWrt</Text>}>
      <Text>地址填路由器 LuCI 后台的 IP，端口为 LuCI 的端口（默认 80；开启 HTTPS 时通常 443）。用户名、密码是登录 LuCI 的账号。</Text>
    </Section>
    <Section listRowBackground={panelRowBackground()} header={<Text>自动获取配置</Text>}>
      <Text>开启后，登录路由器读取所选插件（OpenClash / Nikki / MihomoTProxy）的配置，自动得到 Clash 控制器端口和密钥，无需手动填写。需要账号有读取配置的权限。</Text>
      <Text>关闭后可手动填写控制器端口和密钥。</Text>
    </Section>
    <Section listRowBackground={panelRowBackground()} header={<Text>注意</Text>}>
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
  // Keep the latest input synchronously: a return tap need not wait for another render.
  const [entry] = useState(() => ({ busy:false, finished:false, draft:{name,host,port,https,username,password,plugin,auto,cport,csecret} }))
  function change<K extends keyof typeof entry.draft>(key:K,set:(value:typeof entry.draft[K])=>void) {
    return (value:typeof entry.draft[K]) => { entry.draft[key]=value;set(value) }
  }
  function toggleHttps(v: boolean) {
    change("https",setHttps)(v)
    if (v && entry.draft.port === "80") change("port",setPort)("443")
    if (!v && entry.draft.port === "443") change("port",setPort)("80")
  }
  async function save(auto=false) {
    if (entry.busy || entry.finished) return
    entry.busy=true; setErr("")
    try {
      const d=entry.draft
      const c = saveController({ id: initial?.id, name:d.name, host:d.host, port:Number(d.port), https:d.https, username:d.username, plugin:d.plugin, auto:d.auto, cport:Number(d.cport)||9090 }, d.password, d.csecret)
      // Editing a stored connection is local-only. Persist before dismiss, never onDisappear.
      if(initial){entry.finished=true;onDone();if(!auto)dismiss();return}
      try { await loadOverview(c) } catch (e) { await Dialog.alert({ title: "已保存，但连接测试失败", message: msg(e) }); onDone(); if(!auto)dismiss(); return }
      try { await loadClashOverview(c) } catch (e) { await Dialog.alert({ title: "已保存，路由器已连接，但代理控制器获取失败", message: msg(e) }) }
      onDone(); if(!auto)dismiss()
    } catch (e) { setErr(msg(e)) } finally { entry.busy=false }
  }

  const pageScheme = usePageColorScheme()
  return <Form preferredColorScheme={pageScheme} background="systemBackground" scrollContentBackground="hidden" navigationTitle={initial ? "编辑 OpenWrt" : "添加 OpenWrt"} navigationBarTitleDisplayMode="inline"
    onDisappear={()=>save(true)}>
    <Section listRowBackground={panelRowBackground()} header={<Text>基本信息</Text>}>
      <TextField title="名称" value={name} onChanged={change("name",setName)} prompt="例如：家庭路由" />
      <TextField title="地址" value={host} onChanged={change("host",setHost)} prompt="IP 地址" />
      <TextField title="端口" value={port} onChanged={change("port",setPort)} prompt="80" />
      <Toggle title="启用 SSL (HTTPS)" value={https} onChanged={toggleHttps} />
    </Section>
    <Section listRowBackground={panelRowBackground()} header={<Text>认证</Text>}>
      <TextField title="用户名" value={username} onChanged={change("username",setUsername)} prompt="root" />
      <SecureField title="密码" value={password} onChanged={change("password",setPassword)} prompt="LuCI 登录密码" />
    </Section>
    <Section listRowBackground={panelRowBackground()} header={<Text>插件配置</Text>}>
      <Picker title="插件" pickerStyle="segmented" value={plugin} onChanged={(v: string) => change("plugin",setPlugin)(v as Plugin)}>
        {PLUGINS.map(([v, l]) => <Text key={v} tag={v}>{l}</Text>)}
      </Picker>
      <Toggle title="自动获取配置" value={auto} onChanged={change("auto",setAuto)} />
      {!auto ? <>
        <TextField title="控制器端口" value={cport} onChanged={change("cport",setCport)} prompt="9090" />
        <SecureField title="控制器密钥" value={csecret} onChanged={change("csecret",setCsecret)} prompt="Secret（无则留空）" />
      </> : null}
    </Section>
    {err ? <Section listRowBackground={panelRowBackground()}><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
    <Section listRowBackground={panelRowBackground()}>
      <NavigationLink destination={<HelpPage />}><Label title="使用说明" systemImage="questionmark.circle.fill" /></NavigationLink>
    </Section>
  </Form>
}

function SettingsPage({ active, onChanged }: { active: Controller | null; onChanged: () => void }) {
  useEffect(()=>active?prefetchRouterDetails(active):undefined,[active?overviewSource(active):""])
  const [revealed, setRevealed] = useState<string[]>([])
  const [list, setList] = useState(listControllers())
  const reload = () => { setList(listControllers()); onChanged() }

  function remove(id: string) {
    removeController(id)
    setList(listControllers())
    setTimeout(onChanged, 500)
  }

  const pageScheme = usePageColorScheme()
  return <Form preferredColorScheme={pageScheme} background="systemBackground" scrollContentBackground="hidden" navigationTitle="面板设置" navigationBarTitleDisplayMode="inline">
    <Section listRowBackground={panelRowBackground()} header={<HStack><Text>OpenWrt</Text><Spacer /><Text font={12} foregroundStyle="secondaryLabel">{`v${VERSION}`}</Text></HStack>}>
      {list.map(c => <NavigationLink key={c.id} destination={<EditController initial={c} onDone={reload} />}
          contextMenu={controllerHealth[c.id] === false && !revealed.includes(c.id) ? {menuItems:<Button title="展开地址" action={() => setRevealed(ids => ids.includes(c.id) ? ids : [...ids, c.id])} />} : undefined}
          trailingSwipeActions={{ allowsFullSwipe: false, actions: [<Button title="删除" tint="systemRed" action={() => remove(c.id)} />] }}>
          <VStack alignment="leading" frame={{maxWidth:"infinity",alignment:"leading"}}><Text>{c.name}</Text>{controllerHealth[c.id] === false && !revealed.includes(c.id)
            ? <Text font={12} foregroundStyle="secondaryLabel">连接失败 · 长按菜单展开地址</Text>
            : <Text font={12} foregroundStyle="secondaryLabel">{maskUrl(c.url)}</Text>}</VStack>
        </NavigationLink>)}
      <NavigationLink destination={<EditController onDone={reload} />}><Label title="添加 OpenWrt" systemImage="plus" /></NavigationLink>
    </Section>
    {!active ? <Section listRowBackground={panelRowBackground()} header={<Text>路由器详情</Text>}>
      <NavigationLink destination={<LogsPage />}><Label title="运行日志" systemImage="doc.text" /></NavigationLink>
    </Section> : null}
    {active ? <Section listRowBackground={panelRowBackground()} header={<Text>路由器详情</Text>}>
      <NavigationLink destination={<WrtInterfacesPage key={overviewSource(active)} active={active} version={0} />}><Label title="网络接口" systemImage="network" /></NavigationLink>
      <NavigationLink destination={<WrtLeasesPage key={overviewSource(active)} active={active} version={0} />}><Label title="在线设备" systemImage="laptopcomputer.and.iphone" /></NavigationLink>
      <NavigationLink destination={<DockerPage key={overviewSource(active)} active={active} />}><HStack spacing={10}><DockerLogo size={22} mono /><Text>Docker 管理</Text></HStack></NavigationLink>
      <NavigationLink destination={<FrpPage key={overviewSource(active)} active={active} />}><Label title="FRP 管理" systemImage="arrow.left.arrow.right" /></NavigationLink>
      <NavigationLink destination={<SoftwarePage key={overviewSource(active)} active={active} />}><Label title="软件管理" systemImage="shippingbox" /></NavigationLink>
      <NavigationLink destination={<LogsPage />}><Label title="运行日志" systemImage="doc.text" /></NavigationLink>
    </Section> : null}
    <PanelSettingsSections />
  </Form>
}

type RootTab = "home" | "proxies" | "rules" | "connections" | "more"
function MorePage({ active, onChanged, onClose, selected = true }: { active: Controller | null; onChanged: () => void; onClose?: () => void; selected?: boolean }) {
  return <DashboardMorePage selected={selected} active={active} onChanged={onChanged} onClose={onClose} />
}
function Root() {
  useEffect(observeDetailsPhase,[])
  const dismiss = Navigation.useDismiss()
  const [version, setVersion] = useState(0)
  const selection = useObservable<RootTab>(() => { const p = getPreferences().defaultPage; return p === "overview" ? "home" : p })
  // Native TabView updates the binding without necessarily rebuilding this
  // already-retained JS owner. Explicitly invalidate derived selected props.
  const [, refreshSelection] = useState(0)
  useEffect(() => {
    const changed = () => refreshSelection(n => n + 1)
    // Re-read the native binding on resume as well; a retained JS tree must not
    // keep the lazy NavigationStack empty after missed/coalesced invalidations.
    const phaseChanged = (phase: "active" | "inactive" | "background") => { if (phase === "active") changed() }
    selection.subscribe(changed)
    AppEvents.scenePhase.addListener(phaseChanged)
    return () => { selection.unsubscribe(changed); AppEvents.scenePhase.removeListener(phaseChanged) }
  }, [selection])
  const tab = selection.value
  const active = getActive(), bump = () => { setVersion(v => v + 1) }
  const homeSource = active ? overviewSource(active) : ""
  useEffect(()=>{selectDetailsSource(active)},[homeSource])
  const foreground = useForeground()
  useEffect(() => {
    if (!active || active.kind !== "openwrt") return
    return startOverviewSampling(active, foreground)
  }, [homeSource])
  useEffect(() => { prefetchProxies(active); prefetchRules(active); prefetchConnections(active); prefetchMoreVersions(active) }, [active?.id, version])

  return <TabView selection={selection} symbolVariant="none" font={14} foregroundStyle={MAIN_FG}>
    <Tab key="home" title="主页" systemImage="apple.homekit" value="home">
      <NavigationStack key="home-stack">
        <OverviewPage selected={tab === "home"} key={`home:${active?.id ?? "empty"}`} active={active} version={version} onSwitch={bump} onClose={dismiss} />
      </NavigationStack>
    </Tab>
    <Tab key="proxies" title="代理" systemImage="network" value="proxies">
      <NavigationStack key="proxies-stack">
        {tab === "proxies" ? <ProxiesPage selected onClose={dismiss} key={`proxies:${active?.id ?? "empty"}`} active={active} version={version} /> : null}
      </NavigationStack>
    </Tab>
    <Tab key="rules" title="规则" systemImage="shuffle" value="rules">
      <NavigationStack key="rules-stack">
        {tab === "rules" ? <RulesPage selected onClose={dismiss} key={`rules:${active?.id ?? "empty"}`} active={active} version={version} /> : null}
      </NavigationStack>
    </Tab>
    <Tab key="connections" title="连接" systemImage="arrowshape.zigzag.forward" value="connections">
      <NavigationStack key="connections-stack">
        {/* Native selection can reveal this stack before Root's JS update.
            Keep its shell/content present; selected/visibility own polling, not mounting.
            Full source identity prevents a retained first frame from showing another endpoint. */}
        <ConnectionsPage selected={tab === "connections"} onClose={dismiss} key={`connections:${active ? sourceKey(active) : "empty"}`} active={active} version={version} />
      </NavigationStack>
    </Tab>
    <Tab key="more" title="更多" systemImage="square.split.2x2" value="more">
      <NavigationStack key="more-stack" background="systemBackground" scrollContentBackground="hidden">
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
  // Begin the proxy request before the first screen exists so a proxy launch page has data sooner.
  prefetchProxies(getActive())
  prefetchRules(getActive())
  prefetchConnections(getActive())
  prefetchMoreVersions(getActive())
  await Navigation.present({ element: <AppearanceRoot />, modalPresentationStyle: "fullScreen" })
  Script.exit()
}
run()
