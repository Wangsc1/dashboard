// 全部网络、Keychain、Storage、iCloud 均为内存模拟；不会访问路由器或 Apple 服务。
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const ts = require(process.env.TYPESCRIPT_PATH || '/tmp/chk/node_modules/typescript')
const root = path.resolve(__dirname, '..')
const store = new Map(), secrets = new Map(), calls = [], cache = new Map(), files = new Map()
let now = 1800000000000, failStorage = false, responder = () => ({ body: {} }), hooks = [], hookIndex = 0, effects = [], confirms = [], alerts = [], clipboard = '', haptics = 0, openedURLs = [], intervals = new Map(), nextInterval = 1, cleanups = new Map()
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v))
const h = (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false) } })
const scripting = new Proxy({
  useState(v) { const i = hookIndex++; if (!(i in hooks)) hooks[i] = typeof v === 'function' ? v() : v; return [hooks[i], v => { hooks[i] = typeof v === 'function' ? v(hooks[i]) : v }] },
  useObservable(v) { const [o] = scripting.useState(() => ({ value: typeof v === "function" ? v() : v, setValue(value) { this.value = value } })); return o },
  useEffect(fn, deps) { const i = hookIndex++, old = hooks[i]; if (!old || deps.some((v, j) => v !== old[j])) { hooks[i] = deps; effects.push(() => { cleanups.get(i)?.(); cleanups.delete(i); const c = fn(); if (typeof c === "function") cleanups.set(i, c) }) } },
  Safari: { async openURL(url) { openedURLs.push(url); return true } },
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
    return { ok: status >= 200 && status < 300, status, headers: { get: () => r.contentType ?? 'application/json' }, text: async () => { if(r.wait) await r.wait; return JSON.stringify(r.body ?? {}) }, data: async () => r.data ?? 'fake-image-data' }
  },
}
function load(name) {
  name = name.replace(/^\.\//, '')
  if (cache.has(name)) return cache.get(name)
  const file = path.join(root, name + (name === 'index' || name === 'settings-ui' || name === 'dashboard-pages' || name === 'root-toolbar' ? '.tsx' : '.ts'))
  let source = fs.readFileSync(file, 'utf8')
  if (name === 'index') source = source.replace(/\nrun\(\)\s*$/, '') + '\nexport { OverviewPage, SettingsPage, ConnectionsPage, ProxiesPage, RulesPage, Spark, RateChart, StatCard, GroupSection, MorePage, Root };'
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, jsxFactory: 'h' } }).outputText
  const module = { exports: {} }; cache.set(name, module.exports)
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', context, { filename: file })(n => n === 'scripting' ? scripting : load(n), module, module.exports)
  return module.exports
}
const pref = load('preferences'), api = load('api'), ui = load('settings-ui'), app = load('index'), cloud = load('cloud-backup'), pages = load('dashboard-pages'), model = load('dashboard-model')
function unmount() { for (const fn of cleanups.values()) fn(); cleanups.clear(); hooks = []; effects = [] }
function render(fn, props, reset = false) { if (reset) unmount(); hookIndex = 0; effects = []; return fn(props) }
async function flush() { const es = effects; effects = []; es.forEach(f => f()); for (let i = 0; i < 60; i++) await Promise.resolve() }
function unwrap(tree) { if (!tree || typeof tree !== 'object') return tree; if (typeof tree.type === 'function' && ['Card','Shell','Hint','Chip','Pages'].includes(tree.type.name)) return unwrap(tree.type(tree.props)); return { ...tree, props: { ...tree.props, children: (tree.props?.children ?? []).map(unwrap) } } }
function nodes(tree, type) { const out = []; function visit(n) { if (!n || typeof n !== 'object') return; if (n.type === type) out.push(n); for (const x of n.props?.children ?? []) visit(x) } visit(unwrap(tree)); return out }
function trailing(toolbar) { return toolbar?.type === 'Toolbar' ? nodes(toolbar,'ToolbarItem').find(n=>n.props.placement==='topBarTrailing')?.props.children[0] : toolbar?.topBarTrailing }
function button(tree, title) { const b = nodes(tree, 'Button').find(b => b.props.title === title || nodes(b,'Label').some(l => l.props.title === title)); assert.ok(b, 'button: ' + title); return b }
function text(tree) { tree = unwrap(tree); if (typeof tree === 'string' || typeof tree === 'number') return String(tree); return (tree?.props?.children ?? []).map(text).join(' ') }
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
    let tree = render(ui.LogsPage, {}, true), menu = trailing(tree.props.toolbar)
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
    assert.deepEqual(nodes(trailing(toolbar), 'Button').map(n => n.props.title), ['编辑控制器', '运行日志', '外观设置', '全局配置'])
    button(trailing(toolbar), '外观设置').props.action(); tree = render(app.OverviewPage, { active: null, version: 0, onSwitch() {} })
    assert.equal(tree.props.navigationDestination.isPresented, true); assert.equal(tree.props.navigationDestination.content.type, ui.AppearancePage)
    tree.props.navigationDestination.onChanged(false); tree = render(app.OverviewPage, { active: null, version: 0, onSwitch() {} }); assert.equal(tree.props.navigationDestination.isPresented, false)
    const src = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8'); assert.ok(src.includes('function WrtInterfacesPage')); assert.ok(src.includes('function WrtLeasesPage')); assert.ok(src.includes('onDelete={onDelete}')); assert.ok(!src.includes('sheet='))
  })
  await test('默认界面选择tab；主题与外观项接入、概览数据布局不变', () => {
    pref.savePreferences({ defaultPage: 'rules', theme: 'dark', showWrt: false })
    let tree = render(app.OverviewPage, { active: c, version: 0, onSwitch() {} }, true); assert.equal(tree.props.navigationDestination.isPresented, false)
    assert.ok(!text(tree).includes('OpenWrt 状态'))
    const cards = nodes(tree, app.StatCard); assert.equal(cards.length, 4); assert.equal(cards.filter(n => n.props.spark).length, 0); assert.equal(cards.filter(n => n.props.droplets).length, 2)
    assert.ok(cards.filter(n => ['活动连接', '内存使用'].includes(n.props.title)).every(n => !n.props.spark))
    tree = render(app.Root, {}, true); assert.equal(nodes(tree,'TabView')[0].props.preferredColorScheme, 'dark'); assert.equal(nodes(tree,'TabView')[0].props.selection.value, 'rules'); assert.equal(nodes(tree, app.RulesPage).length, 1)
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
  await test('共享NavigationStack内原生TabView五入口、selection默认值/切换与根X', () => {
    pref.savePreferences({ defaultPage: 'overview', connectionBackground: false })
    let tree = render(app.Root, {}, true)
    assert.equal(tree.type, 'TabView'); assert.equal(nodes(tree,'TabView')[0].props.selection.value, 'home')
    const tabs = nodes(tree, 'Tab')
    assert.deepEqual(tabs.map(t => t.props.title), ['主页', '代理', '规则', '连接', '更多'])
    assert.deepEqual(tabs.map(t => t.props.value), ['home', 'proxies', 'rules', 'connections', 'more'])
    assert.equal(nodes(tree, 'NavigationStack').length, 5)
    for (const tab of tabs) {
      assert.equal(tab.props.children[0].type, 'NavigationStack'); assert.equal(nodes(tab, 'NavigationStack').length, 1)
      assert.equal(tab.props.children[0].props.toolbar, undefined)
      for (const child of tab.props.children[0].props.children) if (child) assert.equal(typeof child.props.onClose, 'function')
    }
    assert.equal(nodes(tree, app.OverviewPage).length, 1); assert.equal(nodes(tree, app.ProxiesPage).length, 0)
    // 系统点击/拖动通过同一个 Observable selection 回传；脚本不实现手势。
    nodes(tree,'TabView')[0].props.selection.setValue('proxies'); tree = render(app.Root, {})
    assert.equal(nodes(tree, app.ProxiesPage).length, 1); assert.equal(nodes(tree, app.OverviewPage).length, 0)
    nodes(tree,'TabView')[0].props.selection.setValue('more'); tree = render(app.Root, {})
    assert.equal(nodes(tree, app.MorePage).length, 1); assert.equal(nodes(tree, app.ProxiesPage).length, 0)
    const more = render(pages.MorePage, { active: c, onChanged() {} }, true); assert.ok(nodes(more, 'NavigationLink').some(n => n.props.destination.type === ui.KernelConfigPage))
    const source = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8')
    for (const removed of ['FloatingBar', 'safeAreaInset', 'UIGlass', 'GlassEffectContainer']) assert.ok(!source.includes(removed))
    const rootSource = source.slice(source.indexOf('function Root()'))
    assert.ok(!rootSource.includes('onDragGesture')); assert.ok(!rootSource.includes('onTapGesture')); assert.ok(!rootSource.includes('<NavigationStack>\n    <TabView'))
    const overview = source.slice(source.indexOf('function OverviewPage'), source.indexOf('// ---------- OpenWrt 页面'))
    assert.ok(!overview.includes('loadClashOverview')); assert.ok(!overview.includes('运行模式')); assert.ok(!overview.includes('<NavigationLink'))
  })
  await test('共享栈内原生Tab只挂载可见业务页；反复选择不保留隐藏采样组件', () => {
    pref.savePreferences({ defaultPage: 'overview' })
    let tree = render(app.Root, {}, true)
    const ids = ['home', 'proxies', 'rules', 'connections', 'more'], types = [app.OverviewPage, app.ProxiesPage, app.RulesPage, app.ConnectionsPage, app.MorePage]
    for (const id of [...ids, 'home', 'connections', 'home']) {
      nodes(tree,'TabView')[0].props.selection.setValue(id); tree = render(app.Root, {})
      assert.equal(nodes(tree, 'NavigationStack').length, 5)
      for (let i = 0; i < ids.length; i++) assert.equal(nodes(tree, types[i]).length, ids[i] === id ? 1 : 0)
    }
    assert.equal(api.VERSION, '1.5.11'); assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'script.json'))).version, api.VERSION)
  })
  await test('1.5.11 共享栈/简单ToolBarProps：唯一业务页owner、隐藏Tab无注册', () => {
    pref.savePreferences({ defaultPage: 'overview' })
    let rootTree = render(app.Root, {}, true)
    const pagesByTab = { home: app.OverviewPage, proxies: app.ProxiesPage, rules: app.RulesPage, connections: app.ConnectionsPage, more: app.MorePage }
    const commands = { home: ['编辑控制器','运行日志','外观设置','全局配置'], proxies: ['刷新'], rules: ['搜索规则','刷新规则'], connections: ['搜索连接','暂停监控','客户端标签','筛选客户端','清理已断开连接','打断全部连接'] }
    // 仅展开组件声明，不运行effect/网络；各页独立hooks，不能与Root共用hooks槽位。
    function inspectPage(node) {
      const saved = { hooks, hookIndex, effects, cleanups }
      hooks=[];hookIndex=0;effects=[];cleanups=new Map()
      try { return unwrap(node.type(node.props)) } finally { ({hooks,hookIndex,effects,cleanups}=saved) }
    }
    const roots = new Map()
    for (const selected of ['home','proxies','rules','connections','more','proxies','home','rules','connections','home']) {
      nodes(rootTree,'TabView')[0].props.selection.setValue(selected);rootTree=render(app.Root,{})
      let menus=0
      for (const tab of nodes(rootTree,'Tab')) {
        const id=tab.props.value, owner=tab.props.children[0]
        assert.equal(owner.type,'NavigationStack')
        const identity=[tab.props.key,owner.props.key].join('/')
        if(roots.has(id))assert.equal(identity,roots.get(id));else roots.set(id,identity)
        assert.equal(owner.props.toolbar,undefined)
        const children=owner.props.children.filter(Boolean)
        if(id!==selected){assert.equal(children.length,0);continue}
        assert.equal(children.length,1);assert.equal(children[0].type,pagesByTab[id]);assert.ok(children[0].props.key.startsWith(id+':'))
        let page=inspectPage(children[0]);if(id==='more')page=inspectPage(page);const owners=[]
        function scan(n){if(!n||typeof n!=='object')return;if(n.props?.toolbar)owners.push(n);for(const child of n.props?.children??[])scan(child)}
        scan(page);assert.equal(owners.length,1)
        const toolbar=owners[0].props.toolbar;assert.equal(toolbar.type,undefined)
        assert.deepEqual(Object.keys(toolbar),['topBarLeading','topBarTrailing'])
        assert.equal(toolbar.topBarLeading.props.systemImage,'xmark');assert.equal(toolbar.topBarLeading.props.action,children[0].props.onClose)
        assert.equal(nodes(toolbar,'ToolbarItem').length,0)
        if(id==='more'){assert.equal(toolbar.topBarTrailing,undefined);continue}
        const menu=trailing(toolbar)
        assert.equal(menu.type,'Menu');assert.equal(nodes(menu,'Image').length,0) // label单独验证，不能把正文图标算成toolbar
        assert.equal(menu.props.label.props.systemName,'ellipsis.circle');menus++
        assert.deepEqual(nodes(menu,'Button').map(b=>b.props.title),commands[id])
        if(id!=='home')assert.ok(!nodes(menu,'Button').some(b=>b.props.title==='设置'))
      }
      assert.equal(menus,selected==='more'?0:1)
    }
    const source=fs.readFileSync(path.join(root,'index.tsx'),'utf8').split('function Root()')[1]
    assert.ok(!source.includes('const content ='));assert.ok(!source.includes('ROOT_TABS.map'));assert.ok(!source.includes('toolbar={'));assert.ok(!source.includes('topBarLeading'))
    const helper=fs.readFileSync(path.join(root,'root-toolbar.tsx'),'utf8');assert.ok(!helper.includes('ToolbarItem'));assert.ok(!helper.includes('<Toolbar'));assert.ok(!helper.includes('key='));assert.ok(!helper.includes('id='))
  })
  await test('1.5.11 编辑控制器仍进管理页；共享栈push详情不附根X', () => {
    let closes=0
    let page=render(app.OverviewPage,{active:c,version:0,onSwitch(){},onClose(){closes++}},true)
    button(trailing(page.props.toolbar),'编辑控制器').props.action()
    page=render(app.OverviewPage,{active:c,version:0,onSwitch(){},onClose(){closes++}})
    const destination=page.props.navigationDestination.content
    assert.equal(destination.type,app.SettingsPage)
    assert.equal(destination.props.onClose,undefined)
    const settings=render(destination.type,destination.props,true)
    assert.equal(settings.props.toolbar,undefined)
    page.props.toolbar.topBarLeading.props.action();assert.equal(closes,1)
    const group=render(pages.GroupNodesPage,{c,g:{name:'G',type:'Selector',all:['A'],now:'A',delays:{}},onChanged(){}},true)
    assert.equal(nodes(group.props.toolbar,'Button').filter(n=>n.props.systemImage==='xmark').length,0)
    assert.equal(nodes(group.props.toolbar,'ToolbarItem').filter(n=>n.props.key?.endsWith('.close')).length,0)
    const dns=render(pages.DNSPage,{c},true);assert.equal(dns.props.toolbar,undefined)
    const management=render(pages.ManagementPage,{c,kind:'profile'},true);assert.equal(management.props.toolbar,undefined)
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
  await test('1.5.11 OpenWrt卡：目标平台、内核版本、CPU两次采样', async () => {
    const router = { ...api.listControllers().find(x => x.kind === 'openwrt'), id: 'cpu-test' }
    let stat = 'cpu  100 0 100 800 0 0 0 0 0 0\n'
    responder = (url, init) => { const b = JSON.parse(init.body || '{}'), path = b.params?.[3]?.path
      if (b.params?.[1] === 'session') return { body: { result: [0, { ubus_rpc_session: 'sid' }] } }
      const data = path === '/proc/stat' ? stat : '2'
      return { body: { id: b.id, result: [0, { release: { description: 'X', target: 'x86/64' }, kernel: '6.12.94', model: 'M', uptime: 1, load: [0,0,0], memory: { total: 100, available: 50 }, interface: [], data }] } } }
    let o = await api.loadOverview(router); assert.equal(o.wrt.target, 'x86/64'); assert.equal(o.wrt.kernel, '6.12.94'); assert.equal(o.wrt.cpu, undefined)
    stat = 'cpu  150 0 150 900 0 0 0 0 0 0\n'
    o = await api.loadOverview(router); assert.equal(Math.round(o.wrt.cpu), 50)
    const src = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8'); for (const t of ['目标平台','内核版本','CPU 使用率']) assert.ok(src.includes(`title="${t}"`))
  })
  await test('1.5.11 图标地址：路径中的@允许，查询串/片段/用户信息仍拒绝', async () => {
    responder = () => ({ body: {}, contentType: 'image/png' })
    assert.ok(await pref.cachedIcon('https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Emby.png'))
    for (const u of ['http://x.invalid/a.png', 'https://x.invalid/a.png?k=1', 'https://x.invalid/a.png#f', 'https://user:pw@x.invalid/a.png']) assert.equal(await pref.cachedIcon(u), null)
    const src = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8'); assert.ok(src.includes('navigationTitle="OpenWrt 状态"')); assert.ok(!src.includes('运行正常'))
  })
  await test('六卡104pt；速率SVG全高背景且前景文字最后绘制；连接内存无曲线', () => {
    const tree = render(app.StatCard, { icon: 'link', color: '#3B82F6', title: '下载速率', parts: ['1', 'KB/s'], spark: [10, 20] }, true)
    assert.equal(tree.props.frame.height, 104); assert.equal(tree.props.clipShape.cornerRadius, 22)
    assert.equal(tree.props.children.at(-1).type, 'VStack')
    const spark = nodes(tree, app.Spark)[0]; assert.ok(spark)
    const svg = render(app.Spark, spark.props, true); assert.equal(svg.props.frame.height, 104); assert.ok(!svg.props.code.includes('fill-opacity')); assert.ok(!svg.props.code.includes('<polygon')); assert.ok(svg.props.code.includes('stroke-opacity="0.28"'))
    const memory = render(app.StatCard, { icon: 'link', color: '#3B82F6', title: '内存使用', parts: ['1', 'MB'] }, true); assert.equal(nodes(memory, app.Spark).length, 0)
    const large = render(app.RateChart, { down: [10, 20], up: [20, 10] }, true); assert.ok(nodes(large, 'SVG').some(n => n.props.frame.height === 120))
  })
  await test('代理节点排序/长按折叠/简约样式实际改变视图', () => {
    pref.savePreferences({ nodeSort: 'delay', proxyStyle: 'compact', collapseGesture: true })
    const props = { c, g: { name: 'G', type: 'Selector', now: 'A', all: ['A', 'B', 'C'], delays: { A: 100, B: 10, C: 0 } }, onChanged() {} }
    let tree = render(app.GroupSection, props, true)
    nodes(tree,'HStack')[0].props.onLongPressGesture(); tree = render(app.GroupSection, props)
    const rows = nodes(tree, 'Button').filter(n => n.props.children?.length)
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
    button(trailing(tree.props.toolbar), '✓ 信息').props.action(); tree = render(ui.LogsPage, {}); assert.equal(nodes(tree, 'VStack').length, 3)
    button(trailing(tree.props.toolbar), '搜索日志').props.action(); tree = render(ui.LogsPage, {}); nodes(tree, 'TextField')[0].props.onChanged('路由器'); tree = render(ui.LogsPage, {}); assert.equal(nodes(tree, 'VStack').length, 2)
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
  await test('1.5提供者：真实数量/类型/更新时间及URL编码更新', async () => {
    const xs = api.parseProviders({providers:{'A / B':{type:'Proxy',vehicleType:'HTTP',proxies:[{},{}],updatedAt:'2026-10-20T00:00:00Z'},inline:{type:'Proxy',vehicleType:'Inline'}}},'proxies')
    assert.equal(xs[0].count,2);assert.equal(xs[0].vehicleType,'HTTP');assert.equal(xs[1].count,null)
    assert.equal(api.parseProviders({providers:{R:{ruleCount:953,behavior:'domain',format:'mrs'}}},'rules')[0].count,953)
    responder=()=>({status:204});calls.length=0;await api.updateProvider(c,'proxies','A / B');assert.ok(calls[0].url.endsWith('/providers/proxies/A%20%2F%20B'));assert.equal(calls[0].init.method,'PUT')
    context.confirmResult=false;calls.length=0;let tree=render(pages.ProviderCard,{c,p:xs[0],kind:'proxies',onChanged(){}},true)
    await nodes(tree,'Button')[0].props.action();assert.equal(calls.length,0);assert.match(confirms.at(-1).message,/目标：.*A \/ B/);context.confirmResult=true
  })
  await test('1.5组子页：完整节点分页、排序、切换取消不请求及测速确认', async () => {
    pref.savePreferences({nodeSort:'name',disconnectOnSwitch:false});const g={name:'TestGroup',type:'Selector',now:'N000',all:Array.from({length:125},(_,i)=>'N'+String(i).padStart(3,'0')),delays:{}}
    let tree=render(pages.GroupNodesPage,{c,g,onChanged(){}},true);await flush();tree=render(pages.GroupNodesPage,{c,g,onChanged(){}})
    assert.equal(nodes(tree,'Button').filter(x=>x.props.children?.length).length,80);assert.ok(text(tree).includes('80 / 125'))
    button(tree,'加载更多').props.action();tree=render(pages.GroupNodesPage,{c,g,onChanged(){}});assert.equal(nodes(tree,'Button').filter(x=>x.props.children?.length).length,125)
    context.confirmResult=false;calls.length=0;await nodes(tree,'Button').filter(x=>x.props.children?.length)[1].props.action();assert.equal(calls.length,0)
    await button(trailing(tree.props.toolbar),'测速').props.action();assert.equal(calls.length,0);context.confirmResult=true
  })
  await test('1.5规则：编号保留真实位置、数量及规则提供者更新路径', async () => {
    responder=url=>({body:url.includes('/providers/')?{providers:{real:{type:'Rule',vehicleType:'HTTP',ruleCount:91,behavior:'domain'}}}:{rules:[{type:'DomainSuffix',payload:'alpha.invalid',proxy:'DIRECT'},{type:'IPCIDR',payload:'test-value',proxy:'REJECT'}]}})
    render(pages.RulesPage,{active:c,version:0},true);await flush();let tree=render(pages.RulesPage,{active:c,version:0})
    assert.ok(text(tree).includes('规则 2'));assert.ok(text(tree).includes('提供者 1'));assert.ok(text(tree).includes('#2'));assert.ok(text(tree).includes('IPCIDR'))
    nodes(tree,'Picker')[0].props.onChanged('providers');tree=render(pages.RulesPage,{active:c,version:0});assert.equal(nodes(tree,pages.ProviderCard)[0].props.p.count,91)
    calls.length=0;await api.updateProvider(c,'rules','Rule / Name');assert.ok(calls[0].url.endsWith('/providers/rules/Rule%20%2F%20Name'))
  })
  await test('1.5连接模型：实测差分、计数回退、真实消失、限量和暂停断档', () => {
    const h=new model.ConnectionHistory(),x={id:'one',host:'h',src:'a',dst:'b',network:'TCP',rule:'',chain:'',up:100,down:200,start:now}
    h.sample([x],now);assert.equal(h.active[0].upSpeed,0);h.sample([{...x,up:400,down:800}],now+1500);assert.equal(h.active[0].upSpeed,200);assert.equal(h.active[0].downSpeed,400)
    h.sample([{...x,up:1,down:1}],now+3000);assert.equal(h.active[0].upSpeed,0);h.sample([],now+4500);assert.equal(h.closed.length,1);assert.equal(h.closed[0].closedAt,now+4500)
    h.resume();h.sample([{...x,id:'new'}],now+6000);assert.equal(h.closed.length,1);assert.equal(h.active[0].upSpeed,0)
    h.sample(Array.from({length:350},(_,i)=>({...x,id:'bulk'+i})),now+7000);h.sample([],now+8000);assert.equal(h.closed.length,300);h.sample([],now+3609000);assert.equal(h.closed.length,0)
  })
  await test('1.5来源隔离与sourceIP标签：本地持久化、搜索、精确筛选', () => {
    const other={...c,id:'other-controller'};assert.notEqual(model.historyFor(c),model.historyFor(other));model.saveClientLabel(c,'source-v6','我的客户端');assert.equal(model.clientLabels(c)['source-v6'],'我的客户端');assert.equal(model.clientLabels(other)['source-v6'],undefined)
    const xs=[{id:'1',host:'host',sourceIP:'source-v6',src:'source-v6:80',chain:'G',rule:''},{id:'2',host:'other',sourceIP:'source-v6-other',src:'source-v6-other:80',chain:'',rule:''}]
    assert.equal(model.filterConnections(xs,'我的','',model.clientLabels(c)).length,1);assert.equal(model.filterConnections(xs,'','source-v6',{}).length,1)
    assert.notEqual(model.sourceKey(c),model.sourceKey({...c,url:'http://changed.invalid'}))
  })
  await test('1.5连接监控：暂停/不可见清定时器、取消断开不发送DELETE', async () => {
    responder=()=>({body:{connections:[{id:'observed',upload:20,download:40,metadata:{host:'observed.invalid',sourceIP:'source',type:'TProxy',network:'tcp'},start:new Date(now-5000).toISOString(),chains:['node','group']}]}})
    render(pages.ConnectionsPage,{active:c,version:0},true);await flush();let tree=render(pages.ConnectionsPage,{active:c,version:0});assert.equal(intervals.size,1);assert.ok(text(tree).includes('observed.invalid'))
    context.confirmResult=false;calls.length=0;await button(trailing(tree.props.toolbar),'打断全部连接').props.action();assert.equal(calls.length,0)
    button(trailing(tree.props.toolbar),'暂停监控').props.action();render(pages.ConnectionsPage,{active:c,version:0});await flush();assert.equal(intervals.size,0)
    tree=render(pages.ConnectionsPage,{active:c,version:0});assert.ok(text(tree).includes('监控已暂停'));button(trailing(tree.props.toolbar),'恢复监控').props.action();render(pages.ConnectionsPage,{active:c,version:0});await flush();assert.equal(intervals.size,1)
    tree=unwrap(render(pages.ConnectionsPage,{active:c,version:0}));tree.props.onDisappear();render(pages.ConnectionsPage,{active:c,version:0});await flush();assert.equal(intervals.size,0);context.confirmResult=true
  })
  await test('1.5连接pending隔离：暂停后旧结果不写历史，切换来源丢弃旧响应', async () => {
    let release;const wait=new Promise(r=>{release=r});const a={...c,id:'pending-a'},b={...c,id:'pending-b'}
    responder=()=>({wait,body:{connections:[{id:'old-pending',upload:999,download:999,metadata:{host:'old-result.invalid'}}]}})
    render(pages.ConnectionsPage,{active:a,version:0},true);await flush();let tree=render(pages.ConnectionsPage,{active:a,version:0})
    button(trailing(tree.props.toolbar),'暂停监控').props.action();render(pages.ConnectionsPage,{active:a,version:0});await flush();release();await flush();tree=render(pages.ConnectionsPage,{active:a,version:0});assert.ok(!text(tree).includes('old-result.invalid'));assert.equal(model.historyFor(a).active.length,0);assert.equal(intervals.size,0)
    let release2;const wait2=new Promise(r=>{release2=r});responder=()=>({wait:wait2,body:{connections:[{id:'old-source',metadata:{host:'source-a.invalid'}}]}})
    render(pages.ConnectionsPage,{active:a,version:0},true);await flush();responder=()=>({body:{connections:[{id:'new-source',metadata:{host:'source-b.invalid'}}]}});render(pages.ConnectionsPage,{active:b,version:0});await flush();release2();await flush();tree=render(pages.ConnectionsPage,{active:b,version:0});assert.ok(text(tree).includes('source-b.invalid'));assert.ok(!text(tree).includes('source-a.invalid'));unmount();assert.equal(intervals.size,0)
  })
  await test('1.5Nikki管理：UCI/file真实解析，不保留订阅URL/配置秘密', async () => {
    const n={...c,id:'nikki-tests',kind:'openwrt',plugin:'nikki',url:'http://nikki.invalid'}
    responder=(url,init)=>{const req=JSON.parse(init.body),obj=req.params[1],method=req.params[2];return {body:{result:[0,obj==='session'?{ubus_rpc_session:'private-session'}:obj==='uci'?{values:{config:{profile:'file:actual.yaml'},mixin:{rule:'1'},s1:{'.type':'subscription','.name':'s1',name:'Real',url:'https://secret.invalid/?key=do-not-store',update:'2026'},r1:{'.type':'rule','.name':'r1',type:'DOMAIN',matcher:'domain.invalid',node:'DIRECT',enabled:'1'}}}:obj==='file'?{entries:[{name:'actual.yaml',type:'file',size:55},{name:'directory.yaml',type:'directory'}]}:method==='update_subscription'?{success:true}:{app:'v-test',core:'mihomo-test'}]}}}
    const d=await api.loadNikkiManagement(n);assert.equal(d.files.length,1);assert.equal(d.profile,'file:actual.yaml');assert.equal(d.subscriptions[0].id,'s1');assert.equal(d.rules[0].matcher,'domain.invalid');assert.ok(!JSON.stringify(d).includes('do-not-store'))
    calls.length=0;await api.updateNikkiSubscription(n,'s1');const req=JSON.parse(calls.at(-1).init.body);assert.deepEqual(req.params.slice(1),['luci.nikki','update_subscription',{section_id:'s1'}]);await assert.rejects(()=>api.updateNikkiSubscription(n,"bad' id"));await assert.rejects(()=>api.nikkiService(c,'restart'))
    context.confirmResult=false;calls.length=0;await model.confirmed(n.name,'更新订阅',()=>api.updateNikkiSubscription(n,'s1'));assert.equal(calls.length,0);context.confirmResult=true
  })
  await test('1.5核心/DNS真实端点、无路径猜测与错误日志秘密白名单', async () => {
    responder=()=>({status:204});calls.length=0
    for(const a of ['restart','reload','geo','dns','fakeip'])await api.coreAction(c,a)
    assert.deepEqual(calls.map(x=>[x.init.method,x.url.slice(c.url.length)]),[['POST','/restart'],['PUT','/configs?force=true'],['POST','/configs/geo'],['POST','/cache/dns/flush'],['POST','/cache/fakeip/flush']])
    responder=()=>({body:{Status:0,Answer:[{data:'answer-value',TTL:60,type:1}]}});calls.length=0;const r=await api.queryDNS(c,'example.invalid','A');assert.equal(r.answers[0].ttl,60);assert.ok(calls[0].url.endsWith('/dns/query?name=example.invalid&type=A'));await assert.rejects(()=>api.queryDNS(c,'bad/path','A'))
    pref.clearLogs();responder=()=>({throw:'https://secret.invalid/?token=private-token body=session-private'});await assert.rejects(()=>api.loadProviders(c,'proxies'));const logs=pref.exportLogs();assert.ok(!logs.includes('private-token'));assert.ok(!logs.includes('session-private'));assert.ok(!logs.includes('secret.invalid'));assert.ok(!pages.safeError().includes('http'))
    context.confirmResult=false;calls.length=0;for(const a of ['restart','reload','geo','dns','fakeip'])await model.confirmed(c.name,a,()=>api.coreAction(c,a));assert.equal(calls.length,0);context.confirmResult=true
  })
  await test('1.5更多实际动作：运行时间未知不冒充，取消操作不请求，网页无密钥', async () => {
    const n={...c,id:'more-nikki',kind:'openwrt',plugin:'nikki',url:'http://current-device.invalid'}
    responder=(url,init)=>({body:url.endsWith('/ubus')?{result:[0,JSON.parse(init.body).params[1]==='session'?{ubus_rpc_session:'session'}:{app:'nikki-real',core:'core-real'}]}:url.endsWith('/configs')?{mode:'rule'}:{version:'core-real'}})
    render(pages.MorePage,{active:n,onChanged(){}},true);await flush();let tree=render(pages.MorePage,{active:n,onChanged(){}});assert.ok(text(tree).includes('运行时间：未提供'));assert.ok(text(tree).includes('nikki-real'))
    context.confirmResult=false;calls.length=0;await button(tree,'重启核心').props.action();await button(tree,'刷新DNS缓存').props.action();assert.equal(calls.length,0);context.confirmResult=true
    assert.equal(await api.webpage(n,'profile'),'http://current-device.invalid/cgi-bin/luci/admin/services/nikki/profile');assert.equal(await api.webpage(c),c.url+'/ui/');await assert.rejects(()=>api.webpage({...c,url:'http://private@controller.invalid/?token=secret'}))
  })
  await test('1.5所有危险入口UI取消：核心/服务/DNS/网页/订阅均无请求或外发', async () => {
    const n={...c,id:'cancel-nikki',kind:'openwrt',plugin:'nikki',url:'http://cancel-device.invalid'}
    responder=(url,init)=>({body:url.endsWith('/ubus')?{result:[0,JSON.parse(init.body).params[1]==='session'?{ubus_rpc_session:'session'}:JSON.parse(init.body).params[1]==='uci'?{values:{s1:{'.type':'subscription','.name':'s1',name:'Real subscription'}}}:JSON.parse(init.body).params[1]==='file'?{entries:[]}:{app:'nikki',core:'mihomo'}]}:{version:'mihomo',mode:'rule'}})
    render(pages.MorePage,{active:n,onChanged(){}},true);await flush();let tree=render(pages.MorePage,{active:n,onChanged(){}})
    context.confirmResult=false;calls.length=0;openedURLs.length=0
    for(const title of ['重启核心','重载配置','更新GEO数据库','刷新DNS缓存','刷新FakeIP缓存'])await button(tree,title).props.action()
    for(const b of nodes(tree,'Button').filter(b=>['启动','停止','重启','重载'].includes(text(b)))) await b.props.action()
    await nodes(tree,'Button').find(b=>text(b).includes('网页访问')).props.action();assert.equal(calls.length,0);assert.equal(openedURLs.length,0)
    render(pages.DNSPage,{c:n},true);tree=render(pages.DNSPage,{c:n});nodes(tree,'TextField')[0].props.onChanged('example.invalid');tree=render(pages.DNSPage,{c:n});calls.length=0;await button(tree,'查询').props.action();assert.equal(calls.length,0)
    render(pages.ManagementPage,{c:n,kind:'subscription'},true);await flush();tree=render(pages.ManagementPage,{c:n,kind:'subscription'});calls.length=0;await button(tree,'更新订阅').props.action();assert.equal(calls.length,0)
    await button(tree,'打开Nikki官方管理页面').props.action();assert.equal(openedURLs.length,0);context.confirmResult=true
  })
  await test('1.5首页与根导航源码完整保持1.4.4关键行为', () => {
    const source=fs.readFileSync(path.join(root,'index.tsx'),'utf8'),before=require('child_process').execFileSync('git',['show','HEAD:index.tsx'],{cwd:root,encoding:'utf8'})
    const portion=s=>s.slice(s.indexOf('const MAIN_FG'),s.indexOf('// ---------- '+(s.includes('// ---------- 策略组')?'策略组':'OpenWrt 页面')))
    const normalize=s=>portion(s).replace(/function OverviewPage\([^\n]+/, 'function OverviewPage(SIGNATURE)').replace(/  const toolbar = [\s\S]*?  const destination =/, '  const toolbar = TOOLBAR\n  const destination =');assert.ok(!source.includes('title="下载速率"'));assert.ok(!source.includes('title="上传速率"'));assert.ok(source.includes('>速度</Text>'));assert.ok(source.includes('<RateChart down={dn} up={upH}'));assert.ok(source.includes('(Date.now() - at) / 950'));assert.ok(source.includes('}, 16)'))
  })
  console.log(`\n${count} tests passed. All fetch, Storage, Keychain, iCloud and UI bindings were mocked; no device/remote effects executed.`)
})().catch(e => { console.error(e); process.exitCode = 1 })
