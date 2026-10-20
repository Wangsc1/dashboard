// 全部网络、Keychain、Storage、iCloud 均为内存模拟；不会访问路由器或 Apple 服务。
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const ts = require(process.env.TYPESCRIPT_PATH || '/tmp/chk/node_modules/typescript')
const root = path.resolve(__dirname, '..')
const store = new Map(), secrets = new Map(), calls = [], cache = new Map(), files = new Map()
let now = 1800000000000, failStorage = false, responder = () => ({ body: {} }), hooks = [], hookIndex = 0, effects = [], confirms = [], alerts = [], clipboard = '', haptics = 0, intervals = new Map(), nextInterval = 1, cleanups = new Map()
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v))
const h = (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false) } })
const scripting = new Proxy({
  useState(v) { const i = hookIndex++; if (!(i in hooks)) hooks[i] = typeof v === 'function' ? v() : v; return [hooks[i], v => { hooks[i] = typeof v === 'function' ? v(hooks[i]) : v }] },
  useEffect(fn, deps) { const i = hookIndex++, old = hooks[i]; if (!old || deps.some((v, j) => v !== old[j])) { hooks[i] = deps; effects.push(() => { cleanups.get(i)?.(); cleanups.delete(i); const c = fn(); if (typeof c === "function") cleanups.set(i, c) }) } },
  Navigation: { useDismiss: () => () => {} },
  Animation: { easeOut: () => ({}) }, Transition: { opacity: () => ({ combined: () => ({}) }), scale: () => ({}) },
  modifiers: () => new Proxy({}, { get: () => () => scripting.modifiers() }),
}, { get: (o, k) => k in o ? o[k] : k })
const context = {
  h, React: { Fragment: 'Fragment' }, console, Date: class extends Date { static now() { return now } },
  Storage: { get: k => clone(store.get(k) ?? null), set: (k, v) => { if (failStorage) return false; store.set(k, clone(v)); return true }, remove: k => store.delete(k), getData: k => store.get(k), setData: (k, v) => store.set(k, v) },
  Keychain: { get: k => secrets.get(k) ?? null, set: (k, v) => { secrets.set(k, v); return true }, remove: k => secrets.delete(k) },
  HapticFeedback: { selection() { haptics++ } }, Pasteboard: { async setString(s) { clipboard = s } },
  UIImage: { fromData: d => d ? { image: true } : null },
  FileManager: { isiCloudEnabled: true, iCloudDocumentsDirectory: '/fake-cloud', async downloadFileFromiCloud() { return true }, async readAsString(p) { if (!files.has(p)) throw Error('missing'); return files.get(p) }, async writeAsString(p, s) { files.set(p, s) } },
  Dialog: { async confirm(opts) { confirms.push(opts); return context.confirmResult }, async alert(opts) { alerts.push(opts) } }, confirmResult: true,
  setInterval: (fn, ms) => { const id = nextInterval++; intervals.set(id, { fn, ms }); return id }, clearInterval(id) { intervals.delete(id) }, setTimeout: f => f(), clearTimeout() {},
  async fetch(url, init = {}) {
    calls.push({ url, init: clone(init) }); const r = responder(url, init)
    if (r.throw) throw Error(r.throw)
    const status = r.status ?? 200
    return { ok: status >= 200 && status < 300, status, headers: { get: () => r.contentType ?? 'application/json' }, text: async () => JSON.stringify(r.body ?? {}), data: async () => r.data ?? 'fake-image-data' }
  },
}
function load(name) {
  name = name.replace(/^\.\//, '')
  if (cache.has(name)) return cache.get(name)
  const file = path.join(root, name + (name === 'index' || name === 'settings-ui' ? '.tsx' : '.ts'))
  let source = fs.readFileSync(file, 'utf8')
  if (name === 'index') source = source.replace(/\nrun\(\)\s*$/, '') + '\nexport { OverviewPage, SettingsPage, ConnectionsPage, ProxiesPage, RulesPage, Spark, RateChart, StatCard, GroupSection, FloatingBar, MorePage, Root };'
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, jsxFactory: 'h' } }).outputText
  const module = { exports: {} }; cache.set(name, module.exports)
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', context, { filename: file })(n => n === 'scripting' ? scripting : load(n), module, module.exports)
  return module.exports
}
const pref = load('preferences'), api = load('api'), ui = load('settings-ui'), app = load('index'), cloud = load('cloud-backup')
function unmount() { for (const fn of cleanups.values()) fn(); cleanups.clear(); hooks = []; effects = [] }
function render(fn, props, reset = false) { if (reset) unmount(); hookIndex = 0; effects = []; return fn(props) }
async function flush() { const es = effects; effects = []; es.forEach(f => f()); for (let i = 0; i < 12; i++) await Promise.resolve() }
function nodes(tree, type) { const out = []; function visit(n) { if (!n || typeof n !== 'object') return; if (n.type === type) out.push(n); for (const x of n.props?.children ?? []) visit(x) } visit(tree); return out }
function button(tree, title) { const b = nodes(tree, 'Button').find(b => b.props.title === title); assert.ok(b, 'button: ' + title); return b }
function text(tree) { if (typeof tree === 'string' || typeof tree === 'number') return String(tree); return (tree?.props?.children ?? []).map(text).join(' ') }
let count = 0
async function test(title, fn) { await fn(); count++; console.log('PASS', title) }
;(async () => {
  await test('偏好默认、持久化、规范化、订阅与保存失败', () => {
    assert.equal(pref.getPreferences().theme, 'system'); let notified = 0
    const unsub = pref.subscribePreferences(() => notified++)
    pref.savePreferences({ theme: 'dark', requestTimeout: 2 }); assert.equal(pref.getPreferences().theme, 'dark'); assert.equal(notified, 1)
    pref.savePreferences({ theme: 'bad', logLimit: 0, delayGreen: 999, delayRed: 1, unknownSecret: 'NOPE' })
    assert.equal(pref.getPreferences().theme, 'system'); assert.equal(pref.getPreferences().logLimit, 500); assert.equal(pref.getPreferences().delayGreen, 240)
    assert.ok(!JSON.stringify(store.get('dashboard_preferences_v140')).includes('NOPE'))
    failStorage = true; assert.throws(() => pref.savePreferences({ theme: 'light' })); failStorage = false; unsub()
  })
  await test('请求头 Keychain 保存与认证/传输覆盖、CRLF拒绝', () => {
    pref.saveHeaders('{"X-Client":"private-header-value"}')
    assert.equal(pref.customHeaders()['X-Client'], 'private-header-value')
    assert.ok(!JSON.stringify([...store]).includes('private-header-value'))
    for (const h of [{ Authorization: 'x' }, { cookie: 'x' }, { 'Host': 'evil' }, { 'X-A': 'x\r\nBad: yes' }, { 'Bad Header': 'x' }]) assert.throws(() => pref.parseHeaders(JSON.stringify(h)))
  })
  await test('日志白名单：URL、异常、账号凭据原文不进入存储/导出', () => {
    pref.clearLogs(); pref.recordEvent('api', false, { operation: 'password-top-secret', route: 'https://host/?token=top-secret', status: 401, error: 'session=top-secret' })
    const all = JSON.stringify(pref.getLogs()) + pref.exportLogs()
    assert.ok(!all.includes('top-secret')); assert.ok(!all.includes('https://')); assert.ok(all.includes('HTTP 401'))
    pref.recordEvent('start', true); assert.equal(pref.getLogs().at(-1).level, 'info')
    assert.match(pref.logTime(now), /^\d{2}:\d{2}:\d{2}\.\d{3}$/)
  })
  await test('日志成功轮询抑制、详细模式一分钟聚合和最大条数即时裁剪', () => {
    pref.clearLogs(); pref.savePreferences({ detailedAPI: false, logLimit: 2000 })
    for (let i = 0; i < 600; i++) pref.recordEvent('api', true, { operation: 'GET', route: 'connections' })
    assert.equal(pref.getLogs().length, 0)
    pref.savePreferences({ detailedAPI: true })
    for (let i = 0; i < 600; i++) pref.recordEvent('api', true, { operation: 'GET', route: 'connections', duration: i })
    assert.equal(pref.getLogs().length, 1); assert.equal(pref.getLogs()[0].count, 600)
    for (let i = 0; i < 2010; i++) { now += 61000; pref.recordEvent('login', false) }
    assert.equal(pref.getLogs().length, 2000)
    pref.savePreferences({ logLimit: 100 }); assert.equal(pref.getLogs().length, 100)
  })
  const c = { id: 'fake', name: 'mock', kind: 'clash', url: 'http://mock.invalid:9090' }
  secrets.set('neko_secret_fake', 'API-secret-value')
  await test('loadConfig只读、PATCH白名单/局部字段、请求头与网络超时', async () => {
    calls.length = 0; responder = () => ({ body: { mode: 'rule', 'mixed-port': 7890, 'allow-lan': false } })
    const cfg = await api.loadConfig(c); assert.equal(cfg.port, undefined); assert.equal(calls.length, 1); assert.equal(calls[0].init.method, 'GET')
    pref.savePreferences({ requestTimeout: 2 })
    await api.patchConfig(c, { 'mixed-port': 7891 })
    assert.deepEqual(JSON.parse(calls[1].init.body), { 'mixed-port': 7891 }); assert.equal(calls[1].init.timeout, 2)
    assert.equal(calls[1].init.headers.Authorization, 'Bearer API-secret-value'); assert.equal(calls[1].init.headers['X-Client'], 'private-header-value')
    for (const bad of [{}, { port: undefined }, { port: -1 }, { port: 65536 }, { port: '' }, { mode: 'fake' }, { secret: 'NO' }]) await assert.rejects(() => api.patchConfig(c, bad))
    assert.equal(calls.length, 2)
    responder = () => ({ status: 403 }); await assert.rejects(() => api.patchConfig(c, { port: 0 })); assert.ok(pref.getLogs().some(x => x.title === '内核配置更新失败'))
    assert.ok(!pref.exportLogs().includes('API-secret-value'))
  })
  await test('全局排序相关数据：隐藏组/Global、嵌套真实延迟、循环保护', async () => {
    responder = () => ({ body: { proxies: { GLOBAL: { all: ['A', 'H'], now: 'A' }, A: { all: ['B', 'cycle'], now: 'B' }, H: { all: ['node'], hidden: true }, B: { all: ['node'], now: 'node', history: [{ delay: 99 }] }, node: { history: [{ delay: 15 }] }, cycle: { all: ['cycle'], now: 'cycle' } } } })
    pref.savePreferences({ showHidden: false, showGlobal: false, nestedDelay: false })
    let gs = await api.loadGroups(c); assert.ok(!gs.some(g => g.name === 'GLOBAL')); assert.ok(!gs.some(g => g.name === 'H')); assert.equal(gs.find(g => g.name === 'A').delays.B, 99)
    pref.savePreferences({ showHidden: true, showGlobal: true, nestedDelay: true })
    gs = await api.loadGroups(c); assert.ok(gs.some(g => g.name === 'H')); assert.ok(gs.some(g => g.name === 'GLOBAL')); assert.equal(gs.find(g => g.name === 'A').delays.B, 15); assert.equal(gs.find(g => g.name === 'A').delays.cycle, undefined)
  })
  await test('切换后断开只在成功PUT后发生；断开失败提示部分成功', async () => {
    calls.length = 0; responder = () => ({}); pref.savePreferences({ disconnectOnSwitch: false })
    await api.selectProxy(c, 'group', 'node'); assert.deepEqual(calls.map(x => x.init.method), ['PUT'])
    calls.length = 0; pref.savePreferences({ disconnectOnSwitch: true }); await api.selectProxy(c, 'group', 'node'); assert.deepEqual(calls.map(x => x.init.method), ['PUT', 'DELETE'])
    calls.length = 0; responder = () => ({ status: 500 }); await assert.rejects(() => api.selectProxy(c, 'g', 'n')); assert.equal(calls.length, 1)
    responder = (u, i) => ({ status: i.method === 'DELETE' ? 500 : 200 }); await assert.rejects(() => api.selectProxy(c, 'g', 'n'), /代理已切换/)
  })
  await test('测速设置实际进入请求；回退逐节点测速与警告日志', async () => {
    pref.savePreferences({ testURL: 'https://test.invalid/probe', testTimeout: 3200 }); calls.length = 0
    responder = u => u.includes('/group/') ? { status: 404 } : { body: { delay: 23 } }
    const result = await api.testGroup(c, { name: 'G', all: ['A', 'B'] })
    assert.equal(result.A, 23); assert.equal(result.B, 23)
    assert.ok(calls.every(x => x.url.includes('timeout=3200') && x.url.includes(encodeURIComponent('https://test.invalid/probe')))); assert.ok(pref.getLogs().some(x => x.level === 'warning'))
  })
  await test('真实模拟登录/自动发现：敏感响应、错误原文均不进应用日志', async () => {
    const wrt = api.saveController({ name: 'router', host: 'mock.invalid', port: 80, https: false, username: 'root', plugin: 'nikki', auto: true, cport: 9090 }, 'password-sensitive', '')
    responder = (u, i) => { const b = JSON.parse(i.body); const method = b.params[2]; return { body: { result: [0, method === 'login' ? { ubus_rpc_session: 'session-sensitive' } : { values: { api_listen: '0.0.0.0:9090', api_secret: 'discovered-sensitive' } }] } } }
    const resolved = await api.resolveClash(wrt); assert.equal(resolved.kind, 'clash')
    const logs = pref.exportLogs(); for (const s of ['password-sensitive', 'session-sensitive', 'discovered-sensitive']) assert.ok(!logs.includes(s))
    assert.ok(logs.includes('路由器登录成功')); assert.ok(logs.includes('自动获取代理配置成功'))
    const bad = api.saveController({ name: 'bad', host: 'fail.invalid', port: 80, https: false, username: 'root', plugin: 'nikki', auto: true, cport: 9090 }, 'password-other', '')
    responder = () => ({ throw: 'https://bad/?token=error-sensitive' }); await assert.rejects(() => api.resolveClash(bad)); assert.ok(!pref.exportLogs().includes('error-sensitive'))
  })
  await test('图片缓存仅删脚本图片，凭据、控制器、偏好和日志均保留', async () => {
    responder = () => ({ contentType: 'image/png', data: 'image-data' }); calls.length = 0
    await pref.cachedIcon('https://icons.invalid/a.png'); await pref.cachedIcon('https://icons.invalid/a.png'); assert.equal(calls.length, 1)
    assert.ok(!calls[0].init.headers); const before = api.listControllers().length, secret = secrets.get('neko_secret_fake')
    pref.clearImageCache(); assert.equal(api.listControllers().length, before); assert.equal(secrets.get('neko_secret_fake'), secret); assert.ok(pref.getPreferences()); assert.ok(pref.getLogs().length)
    assert.equal(store.has('dashboard_image_v140_' + encodeURIComponent('https://icons.invalid/a.png')), false)
  })
  await test('延迟阈值边界与触感开关', () => {
    pref.savePreferences({ delayGreen: 240, delayRed: 500, haptics: true }); pref.feedback(); assert.equal(haptics > 0, true)
    assert.equal(api.delayColor(239), 'systemGreen'); assert.equal(api.delayColor(240), 'systemYellow'); assert.equal(api.delayColor(500), 'systemYellow'); assert.equal(api.delayColor(501), 'systemRed'); assert.equal(api.delayColor(0), 'systemRed')
  })
  await test('iCloud备份白名单/校验：无秘密；恢复合并不删本地且保留密码', () => {
    const backup = cloud.makeBackup(), txt = JSON.stringify(backup)
    for (const s of ['password-sensitive', 'session-sensitive', 'discovered-sensitive', 'private-header-value']) assert.ok(!txt.includes(s))
    const before = api.listControllers().length, id = backup.controllers[0].id, password = api.getSecret(id)
    cloud.restoreBackup(backup); assert.equal(api.listControllers().length, before); assert.equal(api.getSecret(id), password)
    const invalid = clone(backup); invalid.controllers[0].port = 70000
    assert.throws(() => cloud.restoreBackup(invalid)); assert.equal(api.listControllers().length, before)
  })
  await test('内核配置UI：打开只GET，空端口不写；保存只PATCH脏字段且需确认', async () => {
    responder = () => ({ body: { mode: 'rule', 'mixed-port': 7890, 'allow-lan': false } }); calls.length = 0; context.confirmResult = true
    render(ui.KernelConfigPage, { c }, true); await flush(); let tree = render(ui.KernelConfigPage, { c })
    assert.equal(calls.length, 1); assert.equal(calls[0].init.method, 'GET')
    const missing = nodes(tree, 'TextField').find(n => n.props.title.startsWith('HTTP')); assert.equal(missing.props.value, ''); assert.equal(missing.props.disabled, true)
    let mixed = nodes(tree, 'TextField').find(n => n.props.title === '混合端口'); mixed.props.onChanged('')
    tree = render(ui.KernelConfigPage, { c }); await button(tree, '保存修改字段').props.action(); assert.equal(calls.length, 1)
    mixed = nodes(tree, 'TextField').find(n => n.props.title === '混合端口'); mixed.props.onChanged('7892')
    tree = render(ui.KernelConfigPage, { c }); context.confirmResult = false; await button(tree, '保存修改字段').props.action(); assert.equal(calls.length, 1)
    context.confirmResult = true; await button(tree, '保存修改字段').props.action(); assert.equal(calls.length, 2); assert.deepEqual(JSON.parse(calls[1].init.body), { 'mixed-port': 7892 }); assert.match(confirms.at(-1).message, /仅 PATCH/)
  })
  await test('运行日志UI：四级过滤、搜索、刷新、复制全部与清空确认', async () => {
    pref.clearLogs(); pref.recordEvent('start', true); pref.recordEvent('login', false)
    let tree = render(ui.LogsPage, {}, true), menu = tree.props.toolbar.topBarTrailing
    assert.equal(nodes(menu, 'Button').length, 8)
    await button(menu, '复制全部').props.action(); assert.ok(clipboard.includes('路由器登录失败'))
    context.confirmResult = false; await button(menu, '清空日志').props.action(); assert.equal(pref.getLogs().length, 2)
    context.confirmResult = true; await button(menu, '清空日志').props.action(); assert.equal(pref.getLogs().length, 0)
    button(menu, '搜索日志').props.action(); tree = render(ui.LogsPage, {}); assert.equal(nodes(tree, 'TextField').length, 1)
  })
  await test('菜单只有四入口；系统push目的地；根X；原页面保留且无弹层', () => {
    pref.savePreferences({ defaultPage: 'overview' })
    let tree = render(app.OverviewPage, { active: null, version: 0, onSwitch() {} }, true)
    const toolbar = tree.props.toolbar
    assert.deepEqual(nodes(toolbar.topBarTrailing, 'Button').map(n => n.props.title), ['设置', '运行日志', '外观设置', '全局配置'])
    button(toolbar.topBarTrailing, '外观设置').props.action(); tree = render(app.OverviewPage, { active: null, version: 0, onSwitch() {} })
    assert.equal(tree.props.navigationDestination.isPresented, true); assert.equal(tree.props.navigationDestination.content.type, ui.AppearancePage)
    tree.props.navigationDestination.onChanged(false); tree = render(app.OverviewPage, { active: null, version: 0, onSwitch() {} }); assert.equal(tree.props.navigationDestination.isPresented, false)
    const src = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8'); assert.ok(src.includes('function WrtInterfacesPage')); assert.ok(src.includes('function WrtLeasesPage')); assert.ok(src.includes('onDelete={onDelete}')); assert.ok(!src.includes('sheet='))
  })
  await test('默认界面选择tab；主题与外观项接入、概览数据布局不变', () => {
    pref.savePreferences({ defaultPage: 'rules', theme: 'dark', showWrt: false })
    let tree = render(app.OverviewPage, { active: c, version: 0, onSwitch() {} }, true); assert.equal(tree.props.navigationDestination.isPresented, false)
    assert.ok(!text(tree).includes('OpenWrt 状态'))
    const cards = nodes(tree, app.StatCard); assert.equal(cards.filter(n => n.props.spark).length, 2); assert.equal(cards.filter(n => n.props.droplets).length, 2)
    assert.ok(cards.filter(n => ['活动连接', '内存使用'].includes(n.props.title)).every(n => !n.props.spark))
    tree = render(app.Root, {}, true); assert.equal(tree.props.preferredColorScheme, 'dark'); assert.equal(tree.props.children[0].props.children[0].type, app.RulesPage)
    tree = render(ui.AppearancePage, {}, true); assert.ok(!text(tree).includes('应用图标')); assert.equal(nodes(tree, 'Toggle').length, 8)
  })
  await test('曲线几何：真实历史不变、横向连续滚动、末端视觉插值和无过冲路径', () => {
    const chart = load('chart'), previous = [100, 300], current = [100, 300, 900]
    const before = clone(previous), next = clone(current), p0 = chart.scrollPoints(previous, current, 0, 100), mid = chart.scrollPoints(previous, current, 0.5, 100), end = chart.scrollPoints(previous, current, 1, 100)
    assert.equal(p0.at(-1).value, 300); assert.equal(mid.at(-1).value, 600); assert.equal(end.at(-1).value, 900)
    assert.ok(mid[0].x < p0[0].x && mid[0].x > end[0].x); assert.equal(mid[0].value, 100)
    assert.deepEqual(previous, before); assert.deepEqual(current, next)
    assert.match(chart.smoothPath(mid, 40, 1024), /^M .* C /)
    assert.equal(chart.plotScale([[100]], [[2100]], 0.5, 1024), 1562)
  })
  await test('曲线调度：三个图表共享50ms/20fps计时器，结束或取消即释放', () => {
    unmount(); const chart = load('chart'), base = intervals.size; let ticks = 0
    const a = chart.animateChart(() => { ticks++; return true }), b = chart.animateChart(() => { ticks++; return true }), c = chart.animateChart(() => { ticks++; return true })
    assert.equal(intervals.size, base + 1)
    const timer = [...intervals.values()].find(x => x.ms === 50); assert.ok(timer); timer.fn(); assert.equal(ticks, 3)
    a(); b(); c(); assert.equal(intervals.size, base)
    chart.animateChart(() => false); [...intervals.values()].find(x => x.ms === 50).fn(); assert.equal(intervals.size, base)
  })
  await test('曲线hook：采样之间逐帧更新，隐藏/卸载时释放订阅', async () => {
    unmount(); const chartUI = load('chart-ui'); let data = [100, 300], enabled = true
    const renderPlot = () => chartUI.useSmoothPlot(data, undefined, enabled, 100, 40)
    render(renderPlot, {}, true); await flush(); const base = intervals.size
    now += 1000; data = [100, 300, 900]; render(renderPlot, {}); await flush()
    assert.equal(intervals.size, base + 1); now += 500; [...intervals.values()].find(x => x.ms === 50).fn()
    const frame = render(renderPlot, {}); assert.equal(frame.points[0].at(-1).value, 600)
    enabled = false; render(renderPlot, {}); await flush(); assert.equal(intervals.size, base)
    unmount(); assert.equal(intervals.size, base)
  })
  await test('悬浮五入口、默认tab、根X、代理来源隔离；切换不保留首页组件', () => {
    pref.savePreferences({ defaultPage: 'overview', connectionBackground: false })
    let tree = render(app.Root, {}, true), container = tree.props.children[0], content = container.props.children[0]
    assert.equal(container.props.toolbar.topBarLeading.props.systemImage, 'xmark'); assert.equal(content.type, app.OverviewPage)
    let bar = container.props.safeAreaInset.bottom.content.props.children[0]
    const buttons = nodes(app.FloatingBar(bar.props), 'Button')
    assert.deepEqual(buttons.map(b => b.props.accessibilityLabel), ['主页', '代理', '规则', '连接', '更多'])
    buttons[1].props.action(); tree = render(app.Root, {}); assert.equal(tree.props.children[0].props.children[0].type, app.ProxiesPage)
    bar = tree.props.children[0].props.safeAreaInset.bottom.content.props.children[0]
    nodes(app.FloatingBar(bar.props), 'Button')[4].props.action(); tree = render(app.Root, {}); assert.equal(tree.props.children[0].props.children[0].type, app.MorePage)
    assert.equal(nodes(tree, app.OverviewPage).length, 0)
    const more = app.MorePage({ active: c, onChanged() {} }); assert.ok(nodes(more, 'NavigationLink').some(n => n.props.destination.type === ui.KernelConfigPage))
    const source = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8'); const overview = source.slice(source.indexOf('function OverviewPage'), source.indexOf('// ---------- 策略组'))
    assert.ok(!overview.includes('loadClashOverview')); assert.ok(!overview.includes('运行模式')); assert.ok(!overview.includes('<NavigationLink'))
  })
  await test('首页实际模拟请求仅ubus；不可见停止新采样且清理计时器', async () => {
    pref.savePreferences({ connectionBackground: false })
    const router = api.listControllers().find(x => x.kind === 'openwrt'); calls.length = 0
    responder = () => ({ body: { result: [0, { uptime: 1, load: [0,0,0], memory: { total: 100, free: 50 }, interface: [], data: '2' }] } })
    render(app.OverviewPage, { active: router, version: 0, onSwitch() {} }, true); await flush()
    assert.ok(calls.length > 0); assert.ok(calls.every(x => x.url.endsWith('/ubus')))
    let tree = render(app.OverviewPage, { active: router, version: 0, onSwitch() {} }); tree.props.onDisappear(); render(app.OverviewPage, { active: router, version: 0, onSwitch() {} }); await flush()
    assert.ok(![...intervals.values()].some(x => x.ms === 1000)); unmount(); assert.equal(intervals.size, 0)
  })
  await test('六卡104pt；速率SVG全高背景且前景文字最后绘制；连接内存无曲线', () => {
    const tree = render(app.StatCard, { icon: 'link', color: '#3B82F6', title: '下载速率', parts: ['1', 'KB/s'], spark: [10, 20] }, true)
    assert.equal(tree.props.frame.height, 104); assert.equal(tree.props.clipShape.cornerRadius, 22)
    assert.equal(tree.props.children.at(-1).type, 'VStack')
    const spark = nodes(tree, app.Spark)[0]; assert.ok(spark)
    const svg = render(app.Spark, spark.props, true); assert.equal(svg.props.frame.height, 104); assert.ok(svg.props.code.includes('fill-opacity="0.10"')); assert.ok(svg.props.code.includes('stroke-opacity="0.28"'))
    const memory = render(app.StatCard, { icon: 'link', color: '#3B82F6', title: '内存使用', parts: ['1', 'MB'] }, true); assert.equal(nodes(memory, app.Spark).length, 0)
    const large = render(app.RateChart, { down: [10, 20], up: [20, 10] }, true); assert.ok(nodes(large, 'SVG').some(n => n.props.frame.height === 120))
  })
  await test('代理节点排序/长按折叠/简约样式实际改变视图', () => {
    pref.savePreferences({ nodeSort: 'delay', proxyStyle: 'compact', collapseGesture: true })
    const props = { c, g: { name: 'G', type: 'Selector', now: 'A', all: ['A', 'B', 'C'], delays: { A: 100, B: 10, C: 0 } }, onChanged() {} }
    let tree = render(app.GroupSection, props, true); assert.equal(tree.props.footer, undefined)
    tree.props.header.props.onLongPressGesture(); tree = render(app.GroupSection, props)
    const rows = nodes(tree, 'Button').filter(n => !n.props.title)
    assert.equal(rows.length, 3); assert.ok(text(rows[0]).includes('B')); assert.ok(text(rows[2]).includes('C'))
    assert.ok(nodes(rows[0], 'Text').some(t => t.props.font === 12))
  })
  await test('连接标准/简约真实切换信息行；日志级别与搜索实际过滤', async () => {
    pref.savePreferences({ connectionStyle: 'compact' })
    responder = () => ({ body: { connections: [{ id: '1', start: new Date(now).toISOString(), metadata: { host: 'sample.invalid', sourceIP: 'source-address', destinationIP: 'destination-address' }, rule: 'sample-rule', chains: ['sample-chain'], upload: 10, download: 20 }] } })
    render(app.ConnectionsPage, { active: c, version: 0 }, true); await flush(); let tree = render(app.ConnectionsPage, { active: c, version: 0 })
    assert.ok(text(tree).includes('sample.invalid')); assert.ok(!text(tree).includes('source-address')); assert.ok(!text(tree).includes('sample-rule'))
    unmount(); pref.clearLogs(); pref.recordEvent('start', true); pref.recordEvent('login', true); pref.recordEvent('login', false); pref.recordEvent('fallback', false, { warning: true })
    tree = render(ui.LogsPage, {}, true); assert.equal(nodes(tree, 'VStack').length, 4)
    button(tree.props.toolbar.topBarTrailing, '✓ 信息').props.action(); tree = render(ui.LogsPage, {}); assert.equal(nodes(tree, 'VStack').length, 3)
    button(tree.props.toolbar.topBarTrailing, '搜索日志').props.action(); tree = render(ui.LogsPage, {}); nodes(tree, 'TextField')[0].props.onChanged('路由器'); tree = render(ui.LogsPage, {}); assert.equal(nodes(tree, 'VStack').length, 2)
  })
  await test('控制器左滑删除回调保持原实现', () => {
    const source = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8')
    const body = source.match(/function onDelete\(indices: number\[\]\) \{([\s\S]*?)\n  \}/)[1].trim()
    assert.equal(body, `const ids = indices.map(i => list[i]?.id).filter(Boolean) as string[]
    for (const id of ids) removeController(id)
    setList(listControllers())
    setTimeout(onChanged, 500)`)
    assert.ok(source.includes('onDelete={onDelete}'))
  })
  console.log(`\n${count} tests passed. All fetch, Storage, Keychain, iCloud and UI bindings were mocked; no device/remote effects executed.`)
})().catch(e => { console.error(e); process.exitCode = 1 })
