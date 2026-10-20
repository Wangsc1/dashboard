import {
  Button, Form, HStack, Label, Navigation, NavigationLink, NavigationStack, Picker, Script, Section, SecureField, Spacer,
  Text, TextField, Toggle, VStack, Widget, useEffect, useState, Dialog,
} from "scripting"
import {
  VERSION, Controller, Group, Conn, Rule, Overview, Kind, listControllers, saveController, removeController, getActive, setActive, getSecret,
  loadOverview, loadGroups, selectProxy, testGroup, loadConnections, closeConnection, closeAllConnections, loadRules, loadConfig, patchConfig,
  setMode, modesOf, fmtBytes, fmtSpeed, fmtDuration, delayColor, getRefreshMinutes, saveRefreshMinutes, REFRESH_OPTIONS, LOG_LEVELS, saveCache,
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
  return <Section><Text foregroundStyle="secondaryLabel">尚未添加控制器，请到“设置”页添加 Clash / Surge 控制器。</Text></Section>
}

// ---------- 概览 ----------
function OverviewPage({ active, version, onSwitch }: { active: Controller | null; version: number; onSwitch: () => void }) {
  const [ov, setOv] = useState<Overview | null>(null)
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState(false)
  const all = listControllers()
  async function refresh() {
    if (!active) return
    try { const o = await loadOverview(active); setOv(o); setErr(""); saveCache(active.id, o) } catch (e) { setErr(msg(e)) }
  }
  useInterval(refresh, 3000, [active?.id, version])
  async function changeMode(m: string) {
    if (!active || busy) return
    setBusy(true)
    try { await setMode(active, m); await refresh() } catch (e) { setErr(msg(e)) } finally { setBusy(false) }
  }
  return <Form navigationTitle="dashboard" navigationBarTitleDisplayMode="inline">
      {!active ? <NoController /> : <>
        {all.length > 1 ? <Section header={<Text>控制器</Text>}>
          <Picker title="当前" pickerStyle="menu" value={active.id} onChanged={(v: string) => { setActive(v); setOv(null); onSwitch() }}>
            {all.map(c => <Text key={c.id} tag={c.id}>{`${c.name} (${c.kind === "clash" ? "Clash" : "Surge"})`}</Text>)}
          </Picker>
        </Section> : null}
        {err ? <Section><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
        <Section header={<Text>{`${active.name}${ov?.version ? " · " + ov.version : ""}`}</Text>}>
          <HStack><Text>↑ 上传</Text><Spacer /><Text>{ov ? fmtSpeed(ov.traffic.up) : "-"}</Text></HStack>
          <HStack><Text>↓ 下载</Text><Spacer /><Text>{ov ? fmtSpeed(ov.traffic.down) : "-"}</Text></HStack>
          <HStack><Text>累计上传</Text><Spacer /><Text>{ov ? fmtBytes(ov.upTotal) : "-"}</Text></HStack>
          <HStack><Text>累计下载</Text><Spacer /><Text>{ov ? fmtBytes(ov.downTotal) : "-"}</Text></HStack>
          <HStack><Text>活动连接</Text><Spacer /><Text>{ov ? String(ov.connCount) : "-"}</Text></HStack>
        </Section>
        <Section header={<Text>运行模式</Text>}>
          <Picker title="模式" pickerStyle="segmented" value={ov?.mode ?? ""} onChanged={changeMode} disabled={busy || !ov}>
            {modesOf(active.kind).map(([v, l]) => <Text key={v} tag={v}>{l}</Text>)}
          </Picker>
        </Section>
      </>}
      <Section header={<Text>功能</Text>}>
        <NavigationLink destination={<ProxiesPage active={active} version={version} />}><Label title="策略组" systemImage="point.3.connected.trianglepath.dotted" /></NavigationLink>
        <NavigationLink destination={<ConnectionsPage active={active} version={version} />}><Label title="连接" systemImage="arrow.up.arrow.down" /></NavigationLink>
        <NavigationLink destination={<RulesPage active={active} version={version} />}><Label title="规则" systemImage="list.bullet.rectangle" /></NavigationLink>
        <NavigationLink destination={<SettingsPage active={active} onChanged={onSwitch} />}><Label title="设置" systemImage="gearshape" /></NavigationLink>
      </Section>
    </Form>
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

// ---------- 设置 ----------
function EditController({ initial, onDone }: { initial?: Controller; onDone: () => void }) {
  const dismiss = Navigation.useDismiss()
  const [name, setName] = useState(initial?.name ?? "")
  const [kind, setKind] = useState<Kind>(initial?.kind ?? "clash")
  const [url, setUrl] = useState(initial?.url ?? "")
  const [secret, setSecret] = useState(initial ? getSecret(initial.id) : "")
  const [err, setErr] = useState("")
  async function save() {
    try {
      const c = saveController({ id: initial?.id, name, kind, url }, secret)
      // 保存即测试连接，失败只提示，不阻止保存
      try { await loadOverview(c) } catch (e) { await Dialog.alert({ title: "已保存，但连接测试失败", message: msg(e) }) }
      onDone(); dismiss()
    } catch (e) { setErr(msg(e)) }
  }
  return <Form navigationTitle={initial ? "编辑控制器" : "添加控制器"} navigationBarTitleDisplayMode="inline">
    <Section header={<Text>类型</Text>}>
      <Picker title="类型" pickerStyle="segmented" value={kind} onChanged={(v: string) => setKind(v as Kind)}>
        <Text tag="clash">Clash / OpenWrt</Text><Text tag="surge">Surge</Text>
      </Picker>
    </Section>
    <Section header={<Text>连接信息</Text>}
      footer={<Text>{kind === "clash" ? "填写 external-controller 地址，如 http://192.168.1.1:9090；OpenClash/Mihomo 同理。" : "填写 Surge http-api 地址，如 http://192.168.1.2:6171；密钥填 http-api 中的 key。"}</Text>}>
      <TextField title="名称" value={name} onChanged={setName} prompt="可留空" />
      <TextField title="地址" value={url} onChanged={setUrl} prompt="http://主机:端口" />
      <SecureField title="密钥" value={secret} onChanged={setSecret} prompt="Secret（无则留空）" />
    </Section>
    {err ? <Section><Text foregroundStyle="systemRed">{err}</Text></Section> : null}
    <Section><Button title="保存并测试" action={save} /></Section>
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
  const [refreshMin, setRefreshMin] = useState(String(getRefreshMinutes()))
  const reload = () => { setList(listControllers()); onChanged() }
  async function del(c: Controller) {
    if (await Dialog.confirm({ title: "删除控制器", message: c.name, confirmLabel: "删除" })) { removeController(c.id); reload() }
  }
  return <Form navigationTitle="设置" navigationBarTitleDisplayMode="inline">
    <Section header={<Text>控制器</Text>}>
      {list.map(c => <HStack key={c.id}>
        <Button action={() => Navigation.present({ element: <NavigationStack><EditController initial={c} onDone={reload} /></NavigationStack> })}>
          <VStack alignment="leading"><Text>{c.name}</Text><Text font={12} foregroundStyle="secondaryLabel">{`${c.kind === "clash" ? "Clash" : "Surge"} · ${c.url}`}</Text></VStack>
        </Button>
        <Spacer />
        <Button title="删除" role="destructive" action={() => del(c)} />
      </HStack>)}
      <NavigationLink destination={<EditController onDone={reload} />}><Label title="添加控制器" systemImage="plus" /></NavigationLink>
    </Section>
    {active?.kind === "clash" ? <ClashConfigSection c={active} /> : null}
    <Section header={<Text>小组件</Text>} footer={<Text>小组件显示当前所选控制器的实时速度与连接数；实际刷新间隔由 iOS 决定。</Text>}>
      <Picker title="刷新间隔" value={refreshMin} onChanged={async (v: string) => { setRefreshMin(v); saveRefreshMinutes(Number(v)); await Widget.reloadAll() }}>
        {REFRESH_OPTIONS.map(m => <Text key={m} tag={String(m)}>{m}分钟</Text>)}
      </Picker>
      <Button title="预览小组件" action={() => Widget.preview({ family: "systemSmall" })} />
    </Section>
    <Section footer={<Text>密钥保存在 Keychain，不会上传或写入脚本文件。</Text>}>
      <Text foregroundStyle="secondaryLabel">{`dashboard v${VERSION}（非官方实现）`}</Text>
    </Section>
  </Form>
}

// ---------- 根：单一 NavigationStack，子页面左右推入，系统返回按钮 ----------
function Root() {
  const [version, setVersion] = useState(0)
  const [active, setActiveState] = useState<Controller | null>(getActive())
  const bump = () => { setActiveState(getActive()); setVersion(v => v + 1); void Widget.reloadAll() }
  return <NavigationStack>
    <OverviewPage active={active} version={version} onSwitch={bump} />
  </NavigationStack>
}

async function run() {
  await Navigation.present({ element: <Root />, modalPresentationStyle: "fullScreen" })
  Script.exit()
}
run()
