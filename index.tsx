import {
  Button, ForEach, Form, HStack, Label, Navigation, NavigationLink, NavigationStack, Picker, Script, Section, SecureField, Spacer,
  Image, Menu, RoundedRectangle, Circle, ScrollView, SVG, Text, ZStack, modifiers, TextField, Toggle, VStack, useEffect, useState,
} from "scripting"
import {
  VERSION, Controller, Group, Conn, Rule, Overview, Plugin, PLUGINS, listControllers, saveController, removeController, getActive, setActive, getSecret, getClashSecret,
  loadOverview, loadClashOverview, loadWrtInterfaces, loadWrtLeases, WrtIface, WrtLease, loadGroups, selectProxy, testGroup, loadConnections, closeConnection,
  closeAllConnections, loadRules, loadConfig, patchConfig, setMode, CLASH_MODES, fmtBytes, fmtSpeed, fmtParts, fmtUptime, fmtDuration, delayColor, LOG_LEVELS,
} from "./api"

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
const HIST = 60
function Spark({ data, color, floor = 1024 }: { data: number[]; color: string; floor?: number }) {
  const W = 100, H = 40
  if (data.length < 2) return <SVG code='<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>' frame={{ maxWidth: "infinity", height: 48 }} />
  const max = Math.max(floor, ...data)
  const pts = data.map((v, i) => `${((i + (HIST - data.length)) / (HIST - 1) * W).toFixed(1)},${(H - 2 - v / max * (H - 4)).toFixed(1)}`)
  const firstX = ((HIST - data.length) / (HIST - 1) * W).toFixed(1)
  const area = `${firstX},${H} ${pts.join(" ")} ${W},${H}`
  const code = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polygon points="${area}" fill="${color}" fill-opacity="0.18"/><polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-opacity="0.65" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg>`
  return <SVG code={code} resizable frame={{ maxWidth: "infinity", height: 48 }} />
}
function StatCard({ icon, color, title, parts, spark, floor }: { icon: string; color: string; title: string; parts: [string, string] | null; spark?: number[]; floor?: number }) {
  return <ZStack alignment="bottom" frame={{ maxWidth: "infinity", height: 116 }}
    clipShape={{ type: "rect", cornerRadius: 22 }}>
    <RoundedRectangle cornerRadius={22} fill={CARD_BG} />
    {spark ? <Spark data={spark} color={color} floor={floor} /> : null}
    <VStack alignment="leading" spacing={10} foregroundStyle={MAIN_FG}
      modifiers={modifiers().frame({ maxWidth: "infinity", height: 88, alignment: "topLeading" }).padding({ horizontal: 16, vertical: 14 })}>
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
function RateChart({ down, up }: { down: number[]; up: number[] }) {
  const W = 300, H = 120
  const max = Math.max(1024, ...down, ...up) * 1.0
  const pts = (arr: number[]) => arr.map((v, i) => `${((i + (HIST - arr.length)) / (HIST - 1) * W).toFixed(1)},${(H - v / max * H).toFixed(1)}`).join(" ")
  const line = (arr: number[], color: string) => arr.length > 1 ? `<polyline points="${pts(arr)}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : ""
  const code = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${line(down, "#3B82F6")}${line(up, "#34C759")}</svg>`
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
  const [ov, setOv] = useState<Overview | null>(null)
  const [cv, setCv] = useState<Overview | null>(null)
  const [err, setErr] = useState("")
  const [cerr, setCerr] = useState("")
  const [busy, setBusy] = useState(false)
  const [dn, setDn] = useState<number[]>([])
  const [upH, setUpH] = useState<number[]>([])
  const [connH, setConnH] = useState<number[]>([])
  const [memH, setMemH] = useState<number[]>([])
  const [st] = useState({ refreshing: false })
  const all = listControllers()
  const dismiss = Navigation.useDismiss()
  const [page, setPage] = useState<"" | "interfaces" | "leases" | "settings">("")
  async function refresh() {
    if (!active || st.refreshing) return
    st.refreshing = true
    try {
      const o = await loadOverview(active)
      setOv(o); setErr("")
      setDn(h => [...h, o.traffic.down].slice(-HIST))
      setUpH(h => [...h, o.traffic.up].slice(-HIST))
      setConnH(h => [...h, o.connCount].slice(-HIST))
      if (o.wrt) setMemH(h => [...h, Math.max(0, o.wrt!.memTotal - o.wrt!.memFree)].slice(-HIST))
    } catch (e) { setErr(msg(e)) }
    finally { st.refreshing = false }
  }
  useEffect(() => { setDn([]); setUpH([]); setOv(null); setCv(null); setConnH([]); setMemH([]) }, [active?.id])
  // 代理状态只供下面的运行模式控制，不参与 OpenWrt 概览。
  useEffect(() => {
    if (!active) return
    let alive = true
    loadClashOverview(active).then(o => { if (alive) { setCv(o); setCerr("") } }).catch(e => { if (alive) setCerr(msg(e)) })
    return () => { alive = false }
  }, [active?.id, version])
  useInterval(refresh, 1000, [active?.id, version])
  async function changeMode(m: string) {
    if (!active || busy) return
    setBusy(true)
    try { await setMode(active, m); setCv(await loadClashOverview(active)) } catch (e) { setCerr(msg(e)) } finally { setBusy(false) }
  }
  const src = ov                 // OpenWrt 概览只使用路由器数据
  const rate = ov?.traffic ?? null
  const w = ov?.wrt
  const memUsed = w ? Math.max(0, w.memTotal - w.memFree) : 0
  const toolbar = {
    topBarLeading: <Button title="" systemImage="xmark" action={dismiss} />,
    topBarTrailing: <Menu label={<Image systemName="ellipsis.circle" />}>
      <Button title="网络接口" systemImage="network" action={() => setPage("interfaces")} />
      <Button title="在线设备" systemImage="laptopcomputer.and.iphone" action={() => setPage("leases")} />
      <Button title="设置" systemImage="gearshape" action={() => setPage("settings")} />
    </Menu>,
  }
  const destination = {
    isPresented: page !== "",
    onChanged: (v: boolean) => { if (!v) setPage("") },
    content: page === "interfaces" && active ? <WrtInterfacesPage active={active} version={version} />
      : page === "leases" && active ? <WrtLeasesPage active={active} version={version} />
      : page === "settings" ? <SettingsPage active={active} onChanged={onSwitch} /> : <Text>-</Text>,
  }
  if (!active) return <Form navigationTitle="dashboard" navigationBarTitleDisplayMode="inline" toolbar={toolbar} navigationDestination={destination}><NoController /></Form>
  return <ScrollView navigationTitle={active.name} navigationBarTitleDisplayMode="inline" toolbar={toolbar} navigationDestination={destination}>
    <VStack spacing={12} padding={{ horizontal: 14, vertical: 8 }}>
      {all.length > 1 ? <Card>
        <Picker title="当前路由器" pickerStyle="menu" value={active.id} onChanged={(v: string) => { setActive(v); onSwitch() }}>
          {all.map(c => <Text key={c.id} tag={c.id}>{c.name}</Text>)}
        </Picker>
      </Card> : null}
      {err ? <Text font={13} foregroundStyle="systemRed">{err}</Text> : null}
      {cerr ? <Text font={13} foregroundStyle="systemRed">{`代理：${cerr}`}</Text> : null}

      <Card>
        <HStack>
          <Badge icon="laptopcomputer" color="#6366F1" />
          <Text fontWeight="semibold" font={15}>OpenWrt 状态</Text>
          <Spacer />
          <HStack spacing={4}><Circle fill={err ? "systemRed" : "systemGreen"} frame={{ width: 5, height: 5 }} /><Text font={12} foregroundStyle={err ? "systemRed" : "systemGreen"}>{err ? "连接失败" : ov ? "运行正常" : "连接中"}</Text></HStack>
        </HStack>
        <InfoItem icon="clock" color="#3B82F6" title="运行时间" value={w ? fmtUptime(w.uptime) : "-"} />
        <InfoItem icon="waveform.path.ecg" color="#F59E0B" title="系统负载" value={w ? w.load.map(v => v.toFixed(2)).join(" ") : "-"} />
      </Card>

      <HStack spacing={12}>
        <StatCard icon="arrow.down.circle.fill" color="#3B82F6" title="下载速率" parts={rate ? fmtParts(rate.down, true) : null} spark={dn} />
        <StatCard icon="arrow.up.circle.fill" color="#34C759" title="上传速率" parts={rate ? fmtParts(rate.up, true) : null} spark={upH} />
      </HStack>
      <HStack spacing={12}>
        <StatCard icon="icloud.and.arrow.down.fill" color="#3B82F6" title="下载总量" parts={ov ? fmtParts(ov.downTotal) : null} />
        <StatCard icon="icloud.and.arrow.up.fill" color="#34C759" title="上传总量" parts={ov ? fmtParts(ov.upTotal) : null} />
      </HStack>
      <HStack spacing={12}>
        <StatCard icon="link" color="#A855F7" title="活动连接" parts={ov ? [String(ov.connCount), ""] : null} spark={connH} floor={10} />
        <StatCard icon="square.stack.3d.up.fill" color="#F59E0B" title="内存使用" parts={w ? fmtParts(memUsed) : null} spark={memH} floor={1024 * 1024} />
      </HStack>

      <RateChart down={dn} up={upH} />

      {cv ? <Card>
        <Text fontWeight="semibold">{`运行模式${cv.version ? " · " + cv.version : ""}`}</Text>
        <Picker title="模式" pickerStyle="segmented" value={cv.mode} onChanged={changeMode} disabled={busy}>
          {CLASH_MODES.map(([v, l]) => <Text key={v} tag={v}>{l}</Text>)}
        </Picker>
      </Card> : null}

      <Card>
        <NavigationLink destination={<ProxiesPage active={active} version={version} />}><Label title="策略组" systemImage="point.3.connected.trianglepath.dotted" /></NavigationLink>
        <NavigationLink destination={<ConnectionsPage active={active} version={version} />}><Label title="连接" systemImage="arrow.up.arrow.down" /></NavigationLink>
        <NavigationLink destination={<RulesPage active={active} version={version} />}><Label title="规则" systemImage="list.bullet.rectangle" /></NavigationLink>
      </Card>
    </VStack>
  </ScrollView>
}

// ---------- 策略组 ----------
function GroupSection({ c, g, onChanged }: { c: Controller; g: Group; onChanged: () => void }) {
  const [delays, setDelays] = useState<Record<string, number>>(g.delays)
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
  return <Section header={<HStack><Text>{g.name}</Text><Spacer /><Text>{g.type}</Text></HStack>}
    footer={<Text>{`当前：${g.now || "-"}`}</Text>}>
    <HStack>
      <Button title={open ? "收起节点" : `展开节点（${g.all.length}）`} action={() => setOpen(!open)} />
      <Spacer />
      <Button title={testing ? "测速中…" : "测速"} systemImage="bolt.fill" disabled={testing} action={test} />
    </HStack>
    {open ? g.all.map(n => <Button key={n} action={() => pick(n)}>
      <HStack>
        <Text foregroundStyle={n === g.now ? "systemBlue" : "label"}>{`${n === g.now ? "✓ " : ""}${n}`}</Text>
        <Spacer />
        {delays[n] !== undefined ? <Text font={13} foregroundStyle={delayColor(delays[n]) as any}>{delays[n] > 0 ? `${delays[n]} ms` : "超时"}</Text> : null}
      </HStack>
    </Button>) : null}
  </Section>
}
function ProxiesPage({ active, version }: { active: Controller | null; version: number }) {
  const [groups, setGroups] = useState<Group[]>([])
  const [err, setErr] = useState("")
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    let alive = true
    loadGroups(active).then(g => { if (alive) { setGroups(g); setErr("") } }).catch(e => { if (alive) setErr(msg(e)) })
    return () => { alive = false }
  }, [active?.id, version, tick])
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
      <Section footer={conns.length > shown.length ? <Text>仅显示最新 200 条；点击条目可断开</Text> : <Text>点击条目可断开</Text>}>
        {shown.map(x => <Button key={x.id} action={() => close(x)}>
          <VStack alignment="leading" spacing={2}>
            <Text font={15}>{x.host}</Text>
            <Text font={12} foregroundStyle="secondaryLabel">{`${x.network} ${x.src} → ${x.dst}`}</Text>
            <Text font={12} foregroundStyle="secondaryLabel">{`${x.chain || "-"} | ${x.rule || "-"}`}</Text>
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

function ClashConfigSection({ c }: { c: Controller }) {
  const [cfg, setCfg] = useState<any>(null)
  const [err, setErr] = useState("")
  useEffect(() => { loadConfig(c).then(setCfg).catch(e => setErr(msg(e))) }, [c.id])
  async function patch(p: any) {
    try { await patchConfig(c, p); setCfg({ ...cfg, ...p }); setErr("") } catch (e) { setErr(msg(e)) }
  }
  const [ports, setPorts] = useState<Record<string, string>>({})
  const portField = (key: string, label: string) => <TextField key={key} title={label} value={ports[key] ?? String(cfg?.[key] ?? 0)}
    onChanged={(v: string) => setPorts({ ...ports, [key]: v })}
    onSubmit={{ triggers: "text", action: () => { const n = Number(ports[key]); if (Number.isInteger(n) && n >= 0 && n < 65536) patch({ [key]: n }) } } as any} />
  if (err && !cfg) return <Section header={<Text>内核配置</Text>}><Text foregroundStyle="systemRed">{err}</Text></Section>
  if (!cfg) return null
  return <Section header={<Text>内核配置（{c.name}）</Text>} footer={<Text>端口修改后按键盘“完成”提交。{err}</Text>}>
    <Picker title="日志级别" pickerStyle="menu" value={String(cfg["log-level"] ?? "info")} onChanged={(v: string) => patch({ "log-level": v })}>
      {LOG_LEVELS.map(l => <Text key={l} tag={l}>{l}</Text>)}
    </Picker>
    <Toggle title="允许局域网连接" value={!!cfg["allow-lan"]} onChanged={(v: boolean) => patch({ "allow-lan": v })} />
    {portField("port", "HTTP 端口")}
    {portField("socks-port", "SOCKS 端口")}
    {portField("mixed-port", "混合端口")}
  </Section>
}

function SettingsPage({ active, onChanged }: { active: Controller | null; onChanged: () => void }) {
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
          <VStack alignment="leading"><Text>{list[i].name}</Text><Text font={12} foregroundStyle="secondaryLabel">{list[i].url}</Text></VStack>
        </NavigationLink>}
        onDelete={onDelete} />
      <NavigationLink destination={<EditController onDone={reload} />}><Label title="添加 OpenWrt" systemImage="plus" /></NavigationLink>
    </Section>
    {active ? <ClashConfigSection c={active} /> : null}
    <Section footer={<Text>密码和密钥保存在 Keychain，不会上传或写入脚本文件。</Text>}>
      <Text foregroundStyle="secondaryLabel">{`dashboard v${VERSION}（非官方实现）`}</Text>
    </Section>
  </Form>
}

// ---------- 根：单一 NavigationStack，子页面左右推入，系统返回按钮 ----------
function Root() {
  const [version, setVersion] = useState(0)
  const [active, setActiveState] = useState<Controller | null>(getActive())
  const bump = () => { setActiveState(getActive()); setVersion(v => v + 1) }
  return <NavigationStack font={14} foregroundStyle={MAIN_FG}>
    <OverviewPage active={active} version={version} onSwitch={bump} />
  </NavigationStack>
}

async function run() {
  await Navigation.present({ element: <Root />, modalPresentationStyle: "fullScreen" })
  Script.exit()
}
run()
