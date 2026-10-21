// 全部网络、Keychain、Storage、iCloud 均为内存模拟；不会访问路由器或 Apple 服务。
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const ts = require(process.env.TYPESCRIPT_PATH || '/tmp/chk/node_modules/typescript')
const root = path.resolve(__dirname, '..')
const store = new Map(), secrets = new Map(), calls = [], cache = new Map(), files = new Map()
let now = 1800000000000, failNextState = false, failStorage = false, responder = () => ({ body: {} }), hooks = [], hookIndex = 0, effects = [], confirms = [], alerts = [], clipboard = '', haptics = 0, openedURLs = [], intervals = new Map(), nextInterval = 1, cleanups = new Map()
const sceneListeners = new Set()
const emitScene = phase => { for (const fn of [...sceneListeners]) fn(phase) }
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v))
const h = (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false) } })
const scripting = new Proxy({
  gradient: (kind, spec) => ({ kind, ...spec }),
  AppEvents: { scenePhase: { addListener: fn => sceneListeners.add(fn), removeListener: fn => sceneListeners.delete(fn) } },
  useMemo(fn, deps) { const i = hookIndex++, old = hooks[i]; if (!old || deps.some((v, j) => v !== old.deps[j])) hooks[i] = { deps, value: fn() }; return hooks[i].value },
  useState(v) { const i = hookIndex++; if (!(i in hooks)) hooks[i] = typeof v === 'function' ? v() : v; return [hooks[i], v => { if (failNextState) { failNextState = false; throw Error("mock native setter failed") }; hooks[i] = typeof v === 'function' ? v(hooks[i]) : v }] },
  useObservable(v) { const [o] = scripting.useState(() => {
    const listeners = new Set()
    return { value: typeof v === "function" ? v() : v,
      setValue(value) { const old = this.value; this.value = value; if(value !== old) for(const fn of [...listeners]) fn(value, old) },
      subscribe(fn) { listeners.add(fn) }, unsubscribe(fn) { listeners.delete(fn) }, listenerCount() { return listeners.size }
    }
  }); return o },
  useEffect(fn, deps) { const i = hookIndex++, old = hooks[i]; if (!old || deps.some((v, j) => v !== old[j])) { hooks[i] = deps; effects.push(() => { cleanups.get(i)?.(); cleanups.delete(i); const c = fn(); if (typeof c === "function") cleanups.set(i, c) }) } },
  Safari: { async openURL(url) { openedURLs.push(url); return true } },
  Navigation: { useDismiss: () => () => {} },
  Animation: { easeOut: () => ({}) }, withAnimation: (_a, body) => { (body || _a)(); return Promise.resolve() }, Transition: { opacity: () => ({ combined: () => ({}) }), scale: () => ({}), move: () => ({}) },
  modifiers: () => new Proxy({}, { get: () => () => scripting.modifiers() }),
}, { get: (o, k) => k in o ? o[k] : k })
const context = {
  h, React: { Fragment: 'Fragment' }, console, Date: class extends Date { static now() { return now } },
  Storage: { get: k => clone(store.get(k) ?? null), set: (k, v) => { if (failStorage) return false; store.set(k, clone(v)); return true }, remove: k => store.delete(k), getData: k => store.get(k), setData: (k, v) => store.set(k, v) },
  Keychain: { get: k => secrets.get(k) ?? null, set: (k, v) => { secrets.set(k, v); return true }, remove: k => secrets.delete(k) },
  HapticFeedback: { selection() { haptics++ } }, Pasteboard: { async setString(s) { clipboard = s } },
  UIImage: { fromData: d => d ? { image: true } : null, fromBase64String: s => s ? { image: true } : null },
  FileManager: { isiCloudEnabled: true, iCloudDocumentsDirectory: '/fake-cloud', async downloadFileFromiCloud() { return true }, async readAsString(p) { if (!files.has(p)) throw Error('missing'); return files.get(p) }, async writeAsString(p, s) { files.set(p, s) } },
  Dialog: { async confirm(opts) { confirms.push(opts); return context.confirmResult }, async alert(opts) { alerts.push(opts) } }, confirmResult: true,
  setInterval: (fn, ms) => { const id = nextInterval++; intervals.set(id, { fn, ms }); return id }, clearInterval(id) { intervals.delete(id) }, setTimeout: f => f(), clearTimeout() {},
  async fetch(url, init = {}) {
    calls.push({ url, init: clone(init) })
    let r
    const parsed = (() => { try { return JSON.parse(init.body) } catch { return null } })()
    if (Array.isArray(parsed)) { // ubus批量：逐项交给同一个responder，再合并为数组
      const items = parsed.map(it => { const x = responder(url, { ...init, body: JSON.stringify(it) }); return x.body ?? {} })
      r = { body: items.map((b, i) => ({ ...b, id: parsed[i].id })) }
    } else r = responder(url, init)
    if (r.throw) throw Error(r.throw)
    const status = r.status ?? 200
    return { ok: status >= 200 && status < 300, status, headers: { get: () => r.contentType ?? 'application/json' }, text: async () => { if(r.wait) await r.wait; return JSON.stringify(r.body ?? {}) }, data: async () => { if (r.imageWait) await r.imageWait; return r.data ?? 'fake-image-data' } }
  },
}
function load(name) {
  name = name.replace(/^\.\//, '')
  if (cache.has(name)) return cache.get(name)
  const file = path.join(root, name + (name === 'index' || name === 'settings-ui' || name === 'dashboard-pages' || name === 'root-toolbar' ? '.tsx' : '.ts'))
  let source = fs.readFileSync(file, 'utf8')
  if (name === 'index') source = source.replace(/\nrun\(\)\s*$/, '') + '\nexport { OverviewPage, InfoItem, SettingsPage, ConnectionsPage, ProxiesPage, RulesPage, Spark, RateChart, StatCard, GroupSection, MorePage, Root, AppearanceRoot };'
  if (name === 'settings-ui') source += '\nexport { Choice, Range, TestURLField };'
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
  await test('偏好异步落盘期间往返设置不反弹，连续修改不覆盖且重启可读', async () => {
    const key = 'dashboard_preferences_v140', originalSet = context.Storage.set
    pref.savePreferences({ customIcons: true, showHidden: false })
    const pending = []
    context.Storage.set = (k, v) => k === key ? (pending.push([k, clone(v)]), true) : originalSet(k, v)
    try {
      let tree = render(ui.GlobalConfigPage, { active: null }, true); await flush()
      nodes(tree, 'Toggle').find(n => n.props.key === 'customIcons').props.onChanged(false)
      assert.equal(store.get(key).customIcons, true)
      assert.equal(pref.getPreferences().customIcons, false)
      unmount(); tree = render(ui.GlobalConfigPage, { active: null }, true); await flush()
      assert.equal(nodes(tree, 'Toggle').find(n => n.props.key === 'customIcons').props.value, false)
      nodes(tree, 'Toggle').find(n => n.props.key === 'showHidden').props.onChanged(true)
      assert.equal(pref.getPreferences().customIcons, false); assert.equal(pref.getPreferences().showHidden, true)
      assert.equal(pending.at(-1)[1].customIcons, false)
      for (const [k,v] of pending) originalSet(k, v)
      const savedModule = cache.get('preferences'); cache.delete('preferences')
      try { const restarted = load('preferences'); assert.equal(restarted.getPreferences().customIcons, false); assert.equal(restarted.getPreferences().showHidden, true) }
      finally { cache.set('preferences', savedModule) }
    } finally { context.Storage.set = originalSet; unmount(); pref.savePreferences({ customIcons: true, showHidden: false }) }
    let notified = 0; const unsub = pref.subscribePreferences(() => notified++)
    failStorage = true
    try { assert.throws(() => pref.savePreferences({ customIcons: false })); assert.equal(pref.getPreferences().customIcons, true); assert.equal(notified, 0) }
    finally { failStorage = false; unsub() }
  })
  await test('通知异常不截断已保存设置的后续订阅；日志裁剪失败不阻断通知', async () => {
    unmount(); const seen = [], messages = [], originalConsole = context.console, originalGet = context.Storage.get
    context.console = { ...console, log: message => messages.push(message) }
    const bad = pref.subscribePreferences(() => { throw Error('secret-not-for-logs') })
    const good = pref.subscribePreferences(() => seen.push(pref.getPreferences().customIcons))
    try {
      assert.doesNotThrow(() => pref.savePreferences({ customIcons: false })); assert.deepEqual(seen, [false])
      context.Storage.get = k => { if (k === 'dashboard_logs_v140') throw Error('secret-log-error'); return originalGet(k) }
      assert.doesNotThrow(() => pref.savePreferences({ customIcons: true })); assert.deepEqual(seen, [false, true])
      assert.ok(messages.some(x => x.includes('listener-failed'))); assert.ok(messages.some(x => x.includes('log-trim-failed')))
      assert.ok(!messages.join(' ').includes('secret-'))
    } finally { bad(); good(); context.console = originalConsole; context.Storage.get = originalGet }
    pref.savePreferences({ customIcons: true })
    const Probe = () => ui.usePreferences(['customIcons'])
    render(Probe, {}, true); await flush()
    failNextState = true; pref.savePreferences({ customIcons: false })
    assert.equal(render(Probe, {}).customIcons, true)
    pref.savePreferences({ customIcons: false }); assert.equal(render(Probe, {}).customIcons, false)
    unmount(); pref.savePreferences({ customIcons: true })
  })
  await test('全局设置同一页面连续改变开关、主题和滑块，保存及当前页状态一致', async () => {
    const props = { active: null }; let tree = render(ui.GlobalConfigPage, props, true); await flush()
    for (const value of [false, true, false, true, false]) {
      nodes(tree, 'Toggle').find(n => n.props.key === 'customIcons').props.onChanged(value)
      tree = render(ui.GlobalConfigPage, props); await flush()
      assert.equal(nodes(tree, 'Toggle').find(n => n.props.key === 'customIcons').props.value, value)
      assert.equal(pref.getPreferences().customIcons, value)
    }
    for (const theme of ['dark','light','system','dark']) {
      nodes(tree, ui.Choice).find(n => n.props.title === '外观模式').props.onChanged(theme)
      tree = render(ui.GlobalConfigPage, props); await flush()
      assert.equal(nodes(tree, ui.Choice).find(n => n.props.title === '外观模式').props.value, theme)
      assert.equal(pref.getPreferences().theme, theme)
    }
    for (const timeout of [2, 8, 15, 3]) {
      nodes(tree, ui.Range).find(n => n.props.title === '连接超时时间').props.onChanged(timeout)
      tree = render(ui.GlobalConfigPage, props); await flush()
      assert.equal(nodes(tree, ui.Range).find(n => n.props.title === '连接超时时间').props.value, timeout)
      assert.equal(pref.getPreferences().requestTimeout, timeout)
    }
    const src = fs.readFileSync(path.join(root, 'settings-ui.tsx'), 'utf8'); assert.ok(!src.includes('traceIconPreference("global-render"'))
    unmount(); pref.savePreferences({ customIcons: true, theme: 'system', requestTimeout: 8 })
  })
  await test('阈值双滑块：固定滑轨与稳定回调、不能交叉、结束保存及失败回滚', async () => {
    pref.savePreferences({ delayGreen: 240, delayRed: 500 })
    function track(tree) { return nodes(tree, 'GeometryReader')[0].props.children[0]({ size: { width: 744 } }) }
    const event = (start, x, y = 0) => ({ startLocation: { x: start, y: 28 }, translation: { width: x, height: y } })
    let tree = render(ui.ThresholdRange, {}, true); await flush()
    const initial = track(tree), gesture = initial.props.onDragGesture
    assert.equal(nodes(initial, 'ZStack').filter(x => x.props.onDragGesture).length, 1)
    assert.equal(nodes(initial, 'Circle').filter(x => x.props.onDragGesture).length, 0)
    assert.equal(nodes(initial, 'RoundedRectangle')[0].props.fill.colors.join(','), 'systemGreen,systemYellow,systemOrange,systemRed')
    gesture.onChanged(event(162, 100)); tree = render(ui.ThresholdRange, {}); await flush()
    assert.ok(text(tree).includes('340–500 ms')); assert.equal(pref.getPreferences().delayGreen, 240)
    assert.equal(track(tree).props.onDragGesture, gesture)
    assert.equal(track(tree).props.offset, undefined)
    gesture.onEnded(event(162, 100)); assert.equal(pref.getPreferences().delayGreen, 340)
    tree = render(ui.ThresholdRange, {}); await flush()
    gesture.onChanged(event(422, 500)); tree = render(ui.ThresholdRange, {}); await flush()
    gesture.onEnded(event(422, 500)); assert.equal(pref.getPreferences().delayRed, 800)
    tree = render(ui.ThresholdRange, {}); await flush()
    gesture.onEnded(event(262, 0, 100)); assert.equal(pref.getPreferences().delayGreen, 340)
    failStorage = true; gesture.onChanged(event(262, -400)); gesture.onEnded(event(262, -400)); failStorage = false
    tree = render(ui.ThresholdRange, {}); await flush(); assert.ok(text(tree).includes('340–800 ms')); assert.equal(pref.getPreferences().delayGreen, 340)
    for (const which of ['green','red']) for (const v of [-10000,100,240,500,800,10000]) {
      const pair = ui.thresholdPair(240, 500, which, v)
      assert.ok(pair.delayGreen >= 100 && pair.delayGreen < pair.delayRed && pair.delayRed <= 800)
    }
    unmount(); pref.savePreferences({ delayGreen: 240, delayRed: 500 })
    const global = render(ui.GlobalConfigPage, { active: null }, true)
    assert.equal(nodes(global, ui.ThresholdRange).length, 1)
    assert.ok(!nodes(global, 'NavigationLink').some(x => text(x).includes('延迟阈值'))); unmount()
  })
  await test('高频拖动合并绘制、不写存储，最后位置精确落盘', async () => {
    pref.savePreferences({ delayGreen: 240, delayRed: 500 })
    const original = scripting.useState; let paints = 0
    scripting.useState = (...args) => { const [v, setter] = original(...args); return [v, n => { paints++; setter(n) }] }
    try {
      let tree = render(ui.ThresholdRange, {}, true); await flush(); paints = 0
      const gesture = nodes(tree, 'GeometryReader')[0].props.children[0]({ size: { width: 744 } }).props.onDragGesture
      for (let i = 1; i <= 100; i++) {
        now += 1
        gesture.onChanged({ startLocation: { x: 162, y: 28 }, translation: { width: i, height: 0 } })
      }
      assert.ok(paints <= 4, String(paints)); assert.equal(pref.getPreferences().delayGreen, 240)
      gesture.onEnded({ startLocation: { x: 162, y: 28 }, translation: { width: 100, height: 0 } })
      assert.equal(pref.getPreferences().delayGreen, 340)
      tree = render(ui.ThresholdRange, {}); await flush(); assert.ok(text(tree).includes('340–500 ms'))
    } finally { unmount(); scripting.useState = original; pref.savePreferences({ delayGreen: 240, delayRed: 500 }) }
  })
  await test('普通滑块自绘：无原生Slider刻度，拖动只更新局部草稿，结束才按原步长保存', async () => {
    const track = tree => nodes(tree, 'GeometryReader')[0].props.children[0]({ size: { width: 328 } })
    for (const [title,min,max,step,value,dx,want] of [['连接超时时间',1,30,1,8,87,16],['超时时间',1000,10000,100,5000,150,9500],['最大记录条数',100,2000,100,500,100,1100]]) {
      const saved = [], props = { title, min, max, step, value, onChanged: n => saved.push(n) }
      let tree = render(ui.Range, props, true); await flush()
      assert.notEqual(tree.props.listRowSeparator, 'hidden'); assert.equal(nodes(tree, 'Slider').length, 0); assert.equal(nodes(tree, 'Image').length, 0)
      const gesture = track(tree).props.onDragGesture, ev = { translation: { width: dx, height: 0 } }
      gesture.onChanged(ev); tree = render(ui.Range, props); await flush()
      assert.ok(text(tree).includes(String(want))); assert.equal(saved.length, 0)
      gesture.onEnded(ev); assert.equal(saved.join(','), String(want)); unmount()
    }
  })
  await test('全局配置：仅连接超时标题与滑块之间有分割线；设置行不隐藏系统分隔线；无图标', () => {
    const tree = render(ui.GlobalConfigPage, { active: null }, true)
    const ranges = nodes(tree, ui.Range)
    assert.equal(ranges.length, 3)
    assert.deepEqual(ranges.map(n => !!n.props.divider), [true, false, false])
    const rendered = ranges.map(n => render(ui.Range, n.props))
    assert.equal(nodes(rendered[0], 'RoundedRectangle').filter(x => x.props.frame?.height === 0.5).length, 1)
    assert.equal(nodes(rendered[1], 'RoundedRectangle').filter(x => x.props.frame?.height === 0.5).length, 0)
    assert.ok(rendered.every(t => t.props.listRowSeparator !== 'hidden'))
    unmount()
  })
  await test('全局配置分组顺序：启动紧随主题，阈值紧邻网络请求之前', () => {
    const tree = render(ui.GlobalConfigPage, { active: null }, true)
    const headers = nodes(tree, 'Section').map(n => text(n.props.header))
    assert.equal(headers.join('|'), '主题|启动设置|代理组|缓存管理|控制器管理|切换代理设置|交互体验|延迟阈值设置|网络请求|连接超时|测速设置|运行日志')
    unmount()
  })
  await test('删除保存测速链接按钮；输入结束自动保存、拒绝无效值并显示失败', async () => {
    const global = render(ui.GlobalConfigPage, { active: null }, true)
    assert.ok(!nodes(global, 'Button').some(x => x.props.title === '保存测速链接')); assert.equal(nodes(global, ui.TestURLField).length, 1)
    const before = pref.getPreferences().testURL
    let tree = render(ui.TestURLField, {}, true); await flush()
    let field = nodes(tree, 'TextField')[0]; field.props.onFocus(); field.props.onChanged('https://example.invalid/test')
    assert.equal(pref.getPreferences().testURL, before)
    // Native may still dispatch the previous render's blur callback.
    field.props.onBlur(); assert.equal(pref.getPreferences().testURL, 'https://example.invalid/test')
    tree = render(ui.TestURLField, {}); await flush()
    field = nodes(tree, 'TextField')[0]; field.props.onChanged('invalid'); field.props.onSubmit()
    tree = render(ui.TestURLField, {}); await flush(); assert.ok(text(tree).includes('HTTP(S)')); assert.equal(pref.getPreferences().testURL, 'https://example.invalid/test')
    field = nodes(tree, 'TextField')[0]; failStorage = true; field.props.onChanged('https://example.invalid/new'); field.props.onBlur(); failStorage = false
    tree = render(ui.TestURLField, {}); await flush(); assert.ok(text(tree).includes('保存失败')); assert.equal(pref.getPreferences().testURL, 'https://example.invalid/test')
    unmount(); pref.savePreferences({ testURL: before })
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
  await test('主页原生导航链接打开设置，不依赖isPresented/返回回调', () => {
    const tree = render(app.OverviewPage, { active: null, version: 0, onSwitch() {} }, true)
    const trail = trailing(tree.props.toolbar)
    assert.equal(trail.type, 'NavigationLink'); assert.equal(trail.props.destination.type, app.SettingsPage)
    assert.equal(nodes(trail, 'Image')[0].props.systemName, 'ellipsis.circle')
    assert.equal(tree.props.navigationDestination, undefined)
    const src = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8'); assert.ok(src.includes('function WrtInterfacesPage')); assert.ok(src.includes('function WrtLeasesPage')); assert.ok(!src.includes('sheet='))
  })
  await test('默认界面选择tab；主题与外观项接入、概览数据布局不变', () => {
    pref.savePreferences({ defaultPage: 'rules', theme: 'dark', showWrt: false })
    let tree = render(app.OverviewPage, { active: c, version: 0, onSwitch() {} }, true); assert.equal(tree.props.navigationDestination, undefined)
    assert.ok(nodes(tree, app.InfoItem).some(n => n.props.title === '目标平台')); assert.ok(!fs.readFileSync(path.join(root, 'index.tsx'), 'utf8').includes('prefs.showWrt'))
    const cards = nodes(tree, app.StatCard); assert.equal(cards.length, 4); assert.equal(cards.filter(n => n.props.spark).length, 0); assert.equal(cards.filter(n => n.props.droplets).length, 2)
    assert.ok(cards.filter(n => ['活动连接', '内存使用'].includes(n.props.title)).every(n => !n.props.spark))
    const appearance = render(app.AppearanceRoot, {}, true); assert.equal(appearance.props.preferredColorScheme, 'dark'); tree = render(app.Root, {}, true); assert.equal(nodes(tree,'TabView')[0].props.selection.value, 'rules'); assert.equal(nodes(tree, app.RulesPage).length, 1)
    tree = render(ui.GlobalConfigPage, { active: null }, true); assert.ok(!text(tree).includes('应用图标')); assert.ok(nodes(tree, 'Toggle').some(n => n.props.title === '自定义代理组图标'))
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
    const ruleStack=nodes(tree,'NavigationStack').find(n=>n.props.tag==='rules');assert.ok(ruleStack);assert.equal(nodes(ruleStack.props.tabItem,'Image')[0].props.symbolVariant,'none');assert.equal(nodes(ruleStack.props.tabItem,'Image')[0].props.systemName,'swatchpalette')
    const tabs = tree.props.children.map(t=>t.props.tag==='rules'?{type:'Tab',props:{title:'规则',systemImage:'swatchpalette',value:'rules',children:[t]}}:t)
    assert.deepEqual(tabs.map(t => t.props.title), ['主页', '代理', '规则', '连接', '更多'])
    assert.deepEqual(tabs.map(t=>t.props.systemImage),['square.stack.fill','network','swatchpalette','arrow.left.arrow.right','ellipsis'])
    assert.equal(tree.props.symbolVariant,'none')
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
    assert.equal(nodes(tree, app.ProxiesPage).length, 1); assert.equal(nodes(tree, app.OverviewPage).length, 1); assert.equal(nodes(tree, app.OverviewPage)[0].props.selected, false)
    nodes(tree,'TabView')[0].props.selection.setValue('more'); tree = render(app.Root, {})
    assert.equal(nodes(tree, app.MorePage).length, 1); assert.equal(nodes(tree, app.ProxiesPage).length, 0); assert.equal(nodes(tree, app.MorePage)[0].props.selected, true)
    const more = render(pages.MorePage, { active: c, onChanged() {} }, true); assert.ok(nodes(more, 'NavigationLink').some(n => n.props.destination.type === ui.KernelConfigPage))
    const source = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8')
    for (const removed of ['FloatingBar', 'safeAreaInset', 'UIGlass', 'GlassEffectContainer']) assert.ok(!source.includes(removed))
    const rootSource = source.slice(source.indexOf('function Root()'))
    assert.ok(!rootSource.includes('onDragGesture')); assert.ok(!rootSource.includes('onTapGesture')); assert.ok(!rootSource.includes('<NavigationStack>\n    <TabView'))
    const overview = source.slice(source.indexOf('function OverviewPage'), source.indexOf('function WrtInterfacesPage'))
    assert.ok(!overview.includes('loadClashOverview')); assert.ok(!overview.includes('运行模式')); assert.equal((overview.match(/<NavigationLink/g) || []).length, 1); assert.ok(overview.includes('destination={<SettingsPage'))
  })
  await test('原生Tab保留所有导航owner；反复切换只改变selected不清空子树', () => {
    pref.savePreferences({ defaultPage: 'overview' })
    let tree = render(app.Root, {}, true)
    const ids = ['home', 'proxies', 'rules', 'connections', 'more'], types = [app.OverviewPage, app.ProxiesPage, app.RulesPage, app.ConnectionsPage, app.MorePage]
    for (const id of [...ids, 'home', 'connections', 'home']) {
      nodes(tree,'TabView')[0].props.selection.setValue(id); tree = render(app.Root, {})
      assert.equal(nodes(tree, 'NavigationStack').length, 5)
      for (let i = 0; i < ids.length; i++) { const lazy = ['proxies','rules','connections'].includes(ids[i]) && ids[i] !== id; assert.equal(nodes(tree, types[i]).length, lazy ? 0 : 1); if (!lazy) assert.equal(nodes(tree, types[i])[0].props.selected, ids[i] === id) }
    }
    assert.equal(api.VERSION, '1.5.117'); assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'script.json'))).version, api.VERSION)
  })
  await test('独立导航栈保留业务owner和身份，只有选中页提供可见工具栏', () => {
    pref.savePreferences({ defaultPage: 'overview' })
    let rootTree = render(app.Root, {}, true)
    const pagesByTab = { home: app.OverviewPage, proxies: app.ProxiesPage, rules: app.RulesPage, connections: app.ConnectionsPage, more: app.MorePage }
    const commands = { home: ['面板管理','外观设置','全局配置'], proxies: ['全部更新'], rules: ['搜索规则','刷新规则','全部更新'], connections: ['搜索连接','暂停监控','客户端标签','清理已断开连接','打断全部连接'] }
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
      for (const tab of rootTree.props.children.map(t=>t.props.tag==='rules'?{props:{key:'rules',value:'rules',children:[t]}}:t)) {
        const id=tab.props.value, owner=tab.props.children[0]
        assert.equal(owner.type,'NavigationStack')
        const identity=[tab.props.key,owner.props.key].join('/')
        if(roots.has(id))assert.equal(identity,roots.get(id));else roots.set(id,identity)
        assert.equal(owner.props.toolbar,undefined)
        const children=owner.props.children.filter(Boolean)
        const lazy=['proxies','rules','connections'].includes(id); if(lazy&&id!==selected){assert.equal(children.length,0);continue}
        assert.equal(children.length,1); assert.equal(children[0].props.selected, id === selected)
        if(id!==selected) continue
        assert.equal(children.length,1);assert.equal(children[0].type,pagesByTab[id]);assert.ok(children[0].props.key.startsWith(id+':'))
        let page=inspectPage(children[0]);if(id==='more')page=inspectPage(page);const owners=[]
        function scan(n){if(!n||typeof n!=='object')return;if(n.props?.toolbar)owners.push(n);for(const child of n.props?.children??[])scan(child)}
        scan(page);assert.equal(owners.length,1)
        const toolbar=owners[0].props.toolbar;assert.equal(toolbar.type,undefined)
        assert.deepEqual(Object.keys(toolbar),id==='home'?['topBarLeading','topBarTrailing','principal']:['topBarLeading','topBarTrailing'])
        if(id==='home'){assert.ok(text(toolbar.principal).includes('OpenWrt 状态'));assert.ok(/运行正常|连接中|连接失败/.test(text(toolbar.principal)));assert.ok(!/运行正常|连接中|连接失败/.test(text(page.props.children)))}
        assert.equal(toolbar.topBarLeading.props.systemImage,'xmark');assert.equal(toolbar.topBarLeading.props.action,children[0].props.onClose)
        assert.equal(nodes(toolbar,'ToolbarItem').length,0)
        if(id==='more'){assert.equal(toolbar.topBarTrailing,undefined);continue}
        const menu=trailing(toolbar)
        if(id==='home'){assert.equal(menu.type,'NavigationLink');assert.equal(nodes(menu,'Image')[0].props.systemName,'ellipsis.circle');menus++;continue}
        assert.equal(menu.type,'Menu');assert.equal(nodes(menu,'Image').length,0) // label单独验证，不能把正文图标算成toolbar
        assert.equal(menu.props.label.props.systemName,'ellipsis.circle');menus++
        assert.deepEqual(nodes(menu,'Button').map(b=>b.props.title),commands[id])
        assert.ok(!nodes(menu,'Button').some(b=>b.props.title==='设置'))
      }
      assert.equal(menus,selected==='more'?0:1)
    }
    const source=fs.readFileSync(path.join(root,'index.tsx'),'utf8').split('function Root()')[1]
    assert.ok(!source.includes('const content ='));assert.ok(!source.includes('ROOT_TABS.map'));assert.ok(!source.includes('toolbar={'));assert.ok(!source.includes('topBarLeading'))
    const helper=fs.readFileSync(path.join(root,'root-toolbar.tsx'),'utf8');assert.ok(!helper.includes('ToolbarItem'));assert.ok(!helper.includes('<Toolbar'));assert.ok(!helper.includes('key='));assert.ok(!helper.includes('id='))
  })
  await test('1.5.46 编辑控制器仍进管理页；共享栈push详情不附根X', () => {
    let closes=0
    let page=render(app.OverviewPage,{active:c,version:0,onSwitch(){},onClose(){closes++}},true)
    const destination=trailing(page.props.toolbar).props.destination
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
  await test('主页设置覆盖时暂停采样，返回恢复且不重复轮询', async () => {
    pref.savePreferences({ connectionBackground: false })
    const router = api.listControllers().find(x => x.kind === 'openwrt')
    let uptime = 1
    responder = (_url, init) => {
      const body = JSON.parse(init.body)
      if (body.params?.[1] === 'session') return { body: { id: body.id, result: [0, { ubus_rpc_session: 'poll-test' }] } }
      return { body: { id: body.id, result: [0, { uptime: uptime++, load: [0,0,0], memory: { total: 100, free: 50 }, interface: [], data: '2' }] } }
    }
    const props = { active: router, version: 0, onSwitch() {} }
    const polling = () => [...intervals.values()].filter(x => x.ms === 1000)
    calls.length = 0
    render(app.OverviewPage, props, true); await flush()
    assert.ok(calls.length > 0); assert.ok(calls.every(x => x.url.endsWith('/ubus')))
    for (let i = 0; i < 3; i++) {
      const tree = render(app.OverviewPage, props); await flush()
      assert.equal(trailing(tree.props.toolbar).props.destination.type, app.SettingsPage)
      assert.equal(typeof tree.props.onDisappear, 'function'); assert.equal(typeof tree.props.onAppear, 'function')
      tree.props.onDisappear(); render(app.OverviewPage, props); await flush(); assert.equal(polling().length, 0)
      const quiet = calls.length; render(app.OverviewPage, props); await flush(); assert.equal(calls.length, quiet)
      tree.props.onAppear(); render(app.OverviewPage, props); await flush()
      assert.equal(polling().length, 1)
      const before = calls.length, beforeParts = nodes(tree, app.StatCard).find(n => n.props.title === '内存使用').props.parts
      const beforeUptime = nodes(tree, app.InfoItem).find(n => n.props.title === '运行时间').props.value
      await polling()[0].fn(); await flush(); assert.ok(calls.length > before)
      const updated = render(app.OverviewPage, props)
      assert.ok(nodes(updated, app.StatCard).find(n => n.props.title === '内存使用').props.parts)
      assert.notEqual(nodes(updated, app.InfoItem).find(n => n.props.title === '运行时间').props.value, beforeUptime)
      assert.ok(beforeParts)
    }
    unmount(); assert.equal(intervals.size, 0)
    render(app.OverviewPage, props, true); await flush(); assert.equal(polling().length, 1)
    unmount(); assert.equal(intervals.size, 0)
    const tree = render(ui.GlobalConfigPage, { active: null }, true); assert.ok(!text(tree).includes('碎片化移除特效')); unmount()
  })
  await test('后台暂停前台恢复且导航入口身份不变；卸载移除前后台监听', async () => {
    pref.savePreferences({ connectionBackground: false })
    const router = api.listControllers().find(x => x.kind === 'openwrt')
    responder = (_url, init) => { const b = JSON.parse(init.body); return { body: { id: b.id, result: [0, b.params?.[1] === 'session' ? { ubus_rpc_session: 'scene-test' } : { uptime: 100, memory: { total: 100, free: 50 }, interface: [], data: '2' }] } } }
    const props = { active: router, version: 0, onSwitch() {} }
    render(app.OverviewPage, props, true); await flush()
    const tree = render(app.OverviewPage, props), toolbar = tree.props.toolbar
    const link = trailing(toolbar), destination = link.props.destination
    assert.equal(sceneListeners.size, 1)
    for (let i = 0; i < 3; i++) {
      for (const phase of ['inactive','background','active']) {
        const before = calls.length
        emitScene(phase); let current = render(app.OverviewPage, props); await flush()
        assert.equal(current.props.toolbar, toolbar); assert.equal(trailing(current.props.toolbar), link); assert.equal(trailing(current.props.toolbar).props.destination, destination)
        const poll = [...intervals.values()].filter(x => x.ms === 1000)
        assert.equal(poll.length, phase === 'active' ? 1 : 0)
        if (phase === 'active') { assert.ok(calls.length > before); await poll[0].fn(); await flush() }
        else assert.equal(calls.length, before)
      }
    }
    unmount(); assert.equal(intervals.size, 0); assert.equal(sceneListeners.size, 0)
    emitScene('active'); assert.equal(intervals.size, 0)
  })
  await test('设置恢复时偏好未变不重建子页；离线折叠改变仍同步', () => {
    pref.savePreferences({ foldOffline: false })
    render(app.SettingsPage, { active: c, onChanged() {} }, true)
    const state = hooks[0]
    let tree = render(app.SettingsPage, { active: c, onChanged() {} }); tree.props.onAppear(); assert.equal(hooks[0], state)
    pref.savePreferences({ foldOffline: true }); tree.props.onAppear(); assert.notEqual(hooks[0], state); assert.equal(hooks[0].foldOffline, true)
    unmount(); pref.savePreferences({ foldOffline: false })
  })
  await test('外观壳响应浅深色与跟随系统，主题更新保持根导航元素身份', async () => {
    pref.savePreferences({ theme: 'system' })
    let tree = render(app.AppearanceRoot, {}, true); await flush()
    const content = tree.props.children[0]
    assert.equal(content.type, app.Root); assert.equal(tree.props.preferredColorScheme, undefined)
    for (const theme of ['dark', 'light', 'system', 'dark']) {
      pref.savePreferences({ theme })
      tree = render(app.AppearanceRoot, {}); await flush()
      assert.equal(tree.props.preferredColorScheme, theme === 'system' ? undefined : theme)
      assert.equal(tree.props.children[0], content)
    }
    pref.savePreferences({ headersEnabled: false }); tree = render(app.AppearanceRoot, {}); assert.equal(tree.props.children[0], content)
    unmount(); pref.savePreferences({ theme: 'system', headersEnabled: true })
  })
  await test('1.5.46 OpenWrt卡：目标平台、内核版本、CPU两次采样', async () => {
    const router = { ...api.listControllers().find(x => x.kind === 'openwrt'), id: 'cpu-test' }
    let stat = 'cpu  100 0 100 800 0 0 0 0 0 0\n'
    responder = (url, init) => { const b = JSON.parse(init.body || '{}'), path = b.params?.[3]?.path
      if (b.params?.[1] === 'session') return { body: { result: [0, { ubus_rpc_session: 'sid' }] } }
      const data = path === '/proc/stat' ? stat : '2'
      return { body: { id: b.id, result: [0, { release: { description: 'X', target: 'x86/64' }, kernel: '6.12.94', model: 'M', uptime: 1, load: [0,0,0], memory: { total: 100, available: 50 }, interface: [], data }] } } }
    let o = await api.loadOverview(router); assert.equal(o.wrt.target, 'x86/64'); assert.equal(o.wrt.kernel, '6.12.94'); assert.equal(o.wrt.cpu, undefined)
    stat = 'cpu  150 0 150 900 0 0 0 0 0 0\n'
    o = await api.loadOverview(router); assert.equal(Math.round(o.wrt.cpu), 50)
    const src = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8'); for (const t of ['目标平台','内核版本','CPU 使用率']) assert.ok(src.includes(`title="${t}"`)); assert.ok(src.indexOf('title="CPU 使用率"') < src.indexOf('title="系统负载"') && src.indexOf('title="系统负载"') < src.indexOf('title="运行时间"'))
  })
  await test('1.5.46 图标地址：路径中的@允许，查询串/片段/用户信息仍拒绝', async () => {
    responder = () => ({ body: {}, contentType: 'image/png' })
    assert.ok(await pref.cachedIcon('https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Emby.png'))
    for (const u of ['http://x.invalid/a.png', 'https://x.invalid/a.png?k=1', 'https://x.invalid/a.png#f', 'https://user:pw@x.invalid/a.png']) assert.equal(await pref.cachedIcon(u), null)
    const src = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8'); assert.ok(src.includes('navigationTitle="OpenWrt 状态"')); assert.ok(src.includes('运行正常')); assert.ok(src.indexOf('运行正常') < src.indexOf('title="目标平台"'))
  })
  await test('1.5.46 Docker/FRP管理：解析、敏感字段不外露、操作参数校验', async () => {
    const router = { ...api.listControllers().find(x => x.kind === 'openwrt'), id: 'dock-test' }
    const calls2 = []
    responder = (url, init) => { const b = JSON.parse(init.body || '{}'), [, obj, method, args] = b.params || []
      if (obj === 'session') return { body: { result: [0, { ubus_rpc_session: 'sid' }] } }
      calls2.push({ obj, method, args })
      if (obj === 'docker.container' && method === 'list') return { body: { result: [0, { code: 200, body: [{ Id: 'f01e8c0c992d37147ed051e6', Names: ['/miaospeed'], Image: 'airportr/miaospeed:latest', State: 'running', Status: 'Up 9 days', Command: '/opt/miaospeed -token SECRET' }] }] } }
      if (obj === 'docker.container') return { body: { result: [0, { code: 204 }] } }
      if (obj === 'rc' && method === 'list') return { body: { result: [0, { frpc: { running: true, enabled: true } }] } }
      if (obj === 'uci') return { body: { result: [0, { values: { common: { '.type': 'conf', server_addr: '1.2.3.4', server_port: '8055', token: 'SECRET' }, a: { '.type': 'conf', name: 'ssh', type: 'tcp', local_ip: '10.0.0.1', local_port: '22', remote_port: '8022' } } }] } }
      return { body: { result: [0, {}] } } }
    const ds = await api.loadDockerContainers(router); assert.equal(ds.length, 1); assert.equal(ds[0].name, 'miaospeed'); assert.ok(!JSON.stringify(ds).includes('SECRET'))
    await api.dockerAction(router, ds[0].id, 'restart'); assert.ok(calls2.some(x => x.obj === 'docker.container' && x.method === 'restart'))
    await assert.rejects(() => api.dockerAction(router, '../x', 'stop'))
    const f = await api.loadFrp(router); assert.equal(f.running, true); assert.equal(f.server, '1.2.3.4:8055'); assert.equal(f.proxies.length, 1); assert.equal(f.proxies[0].remote, '8022');
    await api.frpAction(router, 'restart'); assert.ok(calls2.some(x => x.obj === 'rc' && x.method === 'init' && x.args.name === 'frpc' && x.args.action === 'restart'))
    const src = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8')
    for (const t of ['面板设置', 'Docker 管理', 'FRP 管理']) assert.ok(src.includes(t))
    assert.ok(!src.includes('title="代理内核配置"')); assert.ok(!src.includes('title="编辑控制器"'))
  })
  await test('1.5.46 Docker/FRP参数编辑：校验、uci提交+重启、失败回滚、token可见可改', async () => {
    const router = { ...api.listControllers().find(x => x.kind === 'openwrt'), id: 'edit-test' }
    const seen = []; let failSet = false
    responder = (url, init) => { const b = JSON.parse(init.body || '{}'), [, obj, method, args] = b.params || []
      if (obj === 'session') return { body: { result: [0, { ubus_rpc_session: 'sid' }] } }
      seen.push({ obj, method, args })
      if (obj === 'uci' && method === 'set' && failSet) return { body: { result: [2] } }
      if (obj === 'uci' && method === 'get') return { body: { result: [0, { values: { common: { '.type': 'conf', server_addr: '1.2.3.4', server_port: '8055', token: 'SECRET' }, c1: { '.type': 'conf', '.name': 'c1', name: 'ssh', type: 'tcp', local_ip: '10.0.0.1', local_port: '22', remote_port: '8022' }, globals: { log_level: 'warn', data_root: '/opt/docker/' }, proxies: { http_proxy: 'http://127.0.0.1:8080' } } }] } }
      if (obj === 'docker.container' && method === 'inspect') return { body: { result: [0, { code: 200, body: { HostConfig: { RestartPolicy: { Name: 'always' } } } }] } }
      if (obj === 'docker') return { body: { result: [0, { code: 200, body: method === 'info' ? { Containers: 1, ContainersRunning: 1, Images: 1, NGoroutines: 57, MemTotal: 16666660864, DockerRootDir: '/opt/docker', IndexServerAddress: 'https://index.docker.io/v1/', RegistryConfig: { Mirrors: [] } } : { Version: '29.6.1', ApiVersion: '1.55' } }] } }
      if (obj === 'docker.image') return { body: { result: [0, { code: 200, body: [{}] }] } }
      if (obj === 'docker.container') return { body: { result: [0, { code: 200 }] } }
      return { body: { result: [0, {}] } } }
    const f = await api.loadFrp(router); assert.equal(f.proxies[0].id, 'c1'); assert.equal(f.common.token, 'SECRET')
    await api.saveFrpCommon(router, { addr: 'a.example.com', port: '8055', tls: false })
    assert.ok(seen.some(x => x.obj === 'uci' && x.method === 'commit')); assert.ok(seen.some(x => x.obj === 'rc' && x.method === 'init' && x.args.action === 'restart')); assert.ok(!seen.some(x => x.method === 'set' && x.args?.values?.token))
    seen.length = 0; await api.saveFrpCommon(router, { addr: 'a.example.com', port: '8055', tls: true, token: 'NEWTOKEN' }); assert.ok(seen.some(x => x.method === 'set' && x.args?.values?.token === 'NEWTOKEN')); await assert.rejects(() => api.saveFrpCommon(router, { addr: 'a.example.com', port: '8055', tls: true, token: 'bad token' }))
    await assert.rejects(() => api.saveFrpCommon(router, { addr: 'bad host', port: '8055', tls: false })); await assert.rejects(() => api.saveFrpCommon(router, { addr: 'a.com', port: '70000', tls: false }))
    await assert.rejects(() => api.saveFrpProxy(router, { name: 'a b', type: 'tcp', local_ip: '10.0.0.1', local_port: '1', remote_port: '2' })); await assert.rejects(() => api.saveFrpProxy(router, { name: 'x', type: 'http', local_ip: '10.0.0.1', local_port: '1', remote_port: '2' }))
    seen.length = 0; await api.saveFrpProxy(router, { name: 'new', type: 'tcp', local_ip: '10.0.0.1', local_port: '80', remote_port: '8008' }); assert.ok(seen.some(x => x.obj === 'uci' && x.method === 'add'))
    seen.length = 0; await api.deleteFrpProxy(router, 'c1'); assert.ok(seen.some(x => x.method === 'delete' && x.args.section === 'c1'))
    seen.length = 0; failSet = true; await assert.rejects(() => api.saveFrpProxy(router, { id: 'c1', name: 'x', type: 'tcp', local_ip: '10.0.0.1', local_port: '1', remote_port: '2' })); assert.ok(seen.some(x => x.method === 'revert')); assert.ok(!seen.some(x => x.method === 'commit')); assert.ok(!seen.some(x => x.obj === 'rc')); failSet = false
    const d = await api.loadDockerSettings(router); assert.equal(d.logLevel, 'warn'); assert.equal(d.dataRoot, '/opt/docker/')
    await assert.rejects(() => api.saveDockerSettings(router, { logLevel: 'warn', httpProxy: 'http://a;rm -rf', httpsProxy: '', noProxy: '' })); await assert.rejects(() => api.saveDockerSettings(router, { logLevel: 'x', httpProxy: '', httpsProxy: '', noProxy: '' }))
    seen.length = 0; await api.saveDockerSettings(router, { logLevel: 'info', httpProxy: '', httpsProxy: '', noProxy: '' }); assert.ok(seen.some(x => x.method === 'commit' && x.args.config === 'dockerd')); assert.ok(seen.some(x => x.obj === 'rc' && x.args.name === 'dockerd'))
    assert.equal(await api.loadContainerPolicy(router, 'f01e8c0c992d37147ed051e6'), 'always'); await assert.rejects(() => api.saveContainerPolicy(router, 'f01e8c0c992d37147ed051e6', 'bad'))
    await api.saveContainerPolicy(router, 'f01e8c0c992d37147ed051e6', 'unless-stopped'); assert.ok(seen.some(x => x.obj === 'docker.container' && x.method === 'update'))
    const src = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8'); assert.ok(fs.readFileSync(path.join(root, 'docker-icon.ts'), 'utf8').includes('DOCKER_PNG_BASE64')); assert.ok(src.includes('UIImage.fromBase64String')); assert.ok(src.includes('<DockerLogo')); assert.ok(src.includes('title="保存"')); assert.ok(!src.includes('保存并重启')); assert.ok(!src.includes('title="保持"')); assert.ok(!src.includes('点进可编辑')); assert.ok(src.includes('<DockerLogo size={22} mono />')); assert.ok(!src.includes('SecureField title="Token')); assert.ok(!src.includes('title="Docker 管理" systemImage="shippingbox"')); assert.ok(!src.includes('title="刷新" systemImage="arrow.clockwise" action={() => setTick'))
    const ov = await api.loadDockerOverview(router); assert.equal(ov.version, '29.6.1'); assert.equal(ov.api, '1.55'); assert.equal(ov.root, '/opt/docker')
  })
  await test('1.5.46 Docker容器详情/操作与镜像列表/删除', async () => {
    const router = { ...api.listControllers().find(x => x.kind === 'openwrt'), id: 'img-test' }, seen = []
    responder = (url, init) => { const b = JSON.parse(init.body || '{}'), [, obj, method, args] = b.params || []
      if (obj === 'session') return { body: { result: [0, { ubus_rpc_session: 'sid' }] } }
      seen.push({ obj, method, args })
      if (obj === 'docker.container' && method === 'inspect') return { body: { result: [0, { code: 200, body: { Id: 'f01e8c0c992d37147ed051e6', Name: '/miaospeed', State: { Status: 'running', Paused: false }, Config: { Image: 'airportr/miaospeed:latest' }, HostConfig: { NetworkMode: 'host', RestartPolicy: { Name: 'always' } }, NetworkSettings: { Ports: {} }, Path: '/opt/miaospeed', Args: ['server'], Created: '2026-10-11T13:26:44Z' } }] } }
      if (obj === 'docker.container' && method === 'list') return { body: { result: [0, { code: 200, body: [{ Id: 'f01e8c0c992d37147ed051e6', ImageID: 'sha256:' + 'a'.repeat(64), Names: ['/miaospeed'] }] }] } }
      if (obj === 'docker.image' && method === 'list') return { body: { result: [0, { code: 200, body: [{ Id: 'sha256:' + 'a'.repeat(64), RepoTags: ['airportr/miaospeed:latest'], Size: 155629568, Created: 1791601047 }] }] } }
      return { body: { result: [0, { code: 200 }] } } }
    const d = await api.loadContainerDetail(router, 'f01e8c0c992d37147ed051e6'); assert.equal(d.name, 'miaospeed'); assert.equal(d.network, 'host'); assert.equal(d.command, '/opt/miaospeed server'); assert.equal(d.paused, false)
    await api.dockerContainerOp(router, 'f01e8c0c992d37147ed051e6', 'force-remove'); assert.ok(seen.some(x => x.method === 'remove' && x.args.query.force === 'true'))
    await api.dockerContainerOp(router, 'f01e8c0c992d37147ed051e6', 'pause'); assert.ok(seen.some(x => x.method === 'pause'))
    await assert.rejects(() => api.dockerContainerOp(router, '../x', 'kill'))
    const im = await api.loadDockerImages(router); assert.equal(im.length, 1); assert.equal(JSON.stringify(im[0].containers), '["miaospeed"]'); assert.equal(im[0].tags[0], 'airportr/miaospeed:latest')
    await api.dockerImageRemove(router, im[0].id, true); assert.ok(seen.some(x => x.obj === 'docker.image' && x.method === 'remove' && x.args.query.force === 'true')); await assert.rejects(() => api.dockerImageRemove(router, 'bad/id', false))
    const src = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8'); assert.ok(src.includes('<Section header={<Text>镜像</Text>}>')); assert.ok(src.includes('<Section header={<Text>容器</Text>}>')); assert.ok(src.includes('<Section header={<Text>穿透规则</Text>}>')); assert.ok(!src.includes('`容器 ${list.length}`')); assert.ok(!src.includes('穿透规则 ${'))
  })
  await test('1.5.46 软件管理：cgi-exec、列表解析、更新对比、过滤分页、操作参数校验、磁盘字节', async () => {
    const router = { ...api.listControllers().find(x => x.kind === 'openwrt'), id: 'pkg-test' }, reqs = []
    const inst = [{ name: 'nikki', version: '2026.04.08-r1', description: 'Transparent Proxy', 'installed-size': 278528 }, { name: 'htop', version: '3.4-r1', description: 'viewer', 'installed-size': 1048576 }]
    const avail = [{ name: 'nikki', version: '2026.10.10-r1', description: 'Transparent Proxy', 'file-size': 100000 }, { name: 'htop', version: '3.4-r1', description: 'viewer', 'file-size': 90000 }, { name: '3proxy', version: '0.9.5-r5', description: 'tiny proxy', 'file-size': 103946 }]
    responder = (url, init) => {
      if (url.endsWith('/ubus')) { const b = JSON.parse(init.body || '{}'), [, obj] = b.params || []
        if (obj === 'session') return { body: { result: [0, { ubus_rpc_session: 'sid' }] } }
        return { body: { result: [0, { result: [{ mount: '/overlay', size: 20957446144, avail: 19443449856 }] }] } } }
      reqs.push({ url, body: String(init.body) }); const cmd = decodeURIComponent((String(init.body).match(/command=([^&]*)/) || [])[1] || '').replace(/\+/g, ' ')
      if (cmd.endsWith('list-installed')) return { body: inst }
      if (cmd.endsWith('list-available')) return { body: avail }
      return { body: { code: 0, stdout: 'OK', stderr: '' } } }
    const i = await api.loadInstalledPkgs(router); assert.equal(i[0].name, 'htop'); assert.equal(i[1].size, 278528)
    const a = await api.loadAvailablePkgs(router); assert.equal(a.length, 3); await api.loadAvailablePkgs(router); assert.equal(reqs.filter(x => x.body.includes('list-available')).length, 1)
    const up = api.upgradablePkgs(i, a); assert.equal(up.length, 1); assert.equal(up[0].name, 'nikki'); assert.equal(up[0].upgradeTo, '2026.10.10-r1')
    const f = api.filterPkgs(a, 'proxy', 1); assert.equal(f.total, 2); assert.equal(f.items.length, 1)
    assert.ok(reqs[0].url.endsWith('/cgi-bin/cgi-exec')); assert.ok(reqs[0].body.includes('sessionid=sid')); assert.ok(reqs[0].body.includes('stderr=1'))
    const r = await api.pkgInstall(router, ['htop']); assert.equal(r.code, 0); assert.ok(reqs.some(x => decodeURIComponent(x.body).includes('package-manager-call install htop')))
    await api.pkgRemove(router, ['htop']); await api.pkgUpgrade(router, ['nikki']); await api.pkgUpdateLists(router)
    for (const bad of [['a b'], ['../x'], ['x;rm'], ['-f'], []]) { await assert.rejects(() => api.pkgInstall(router, bad)); await assert.rejects(() => api.pkgRemove(router, bad)) }
    const d = await api.loadDiskUsage(router); assert.equal(d.size, 20957446144); assert.equal(d.avail, 19443449856); assert.equal(d.used, 20957446144 - 19443449856)
    const src = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8'); assert.ok(src.includes('title="软件管理"')); assert.ok(src.includes('function SoftwarePage')); assert.ok(src.includes('<NavigationLink destination={<LogsPage />}><Label title="运行日志"')); assert.ok(src.indexOf('title="软件管理"') < src.indexOf('title="运行日志"', src.indexOf('title="软件管理"'))); assert.ok(!src.includes('setPage("logs")')); assert.ok(src.includes('<Button title="安装" tint="systemBlue"')); assert.ok(src.includes('<Button title="卸载" tint="systemRed"')); assert.ok(src.includes('<Button title="升级" tint="systemBlue"')); assert.ok(!src.includes('Dialog.actionSheet')); assert.ok(!src.includes('title="安装" systemImage')); assert.ok(!/(停止|启动|删除|卸载|升级|安装)" systemImage/.test(src)); assert.ok(!/title="重启" systemImage="arrow.clockwise" tint=/.test(src)) // 左滑按钮纯文字
  })
  await test('1.5.46 面板管理地址打码；FRP页Token完整显示可编辑', () => {
    const src = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8')
    const strip = s => s.replace(/\((\w+): string\)/g, '($1)'), maskUrl = new Function('return ' + strip(src.match(/const maskUrl = (.*)/)[1]))()
    assert.equal(maskUrl('http://43.153.184.66:8008'), 'http://43.153.*.*:8008'); assert.equal(maskUrl('https://10.0.0.1'), 'https://10.0.*.*'); assert.equal(maskUrl('http://router.example.com:80'), 'http://router.example.com:80')
    assert.ok(src.includes('{maskUrl(c.url)}')); assert.ok(src.includes('{maskUrl(info.server)}')); assert.equal(maskUrl('43.153.184.66:8055'), '43.153.*.*:8055'); assert.ok(!src.includes('maskToken')); assert.ok(src.includes('<Field title="Token" value={token}')); assert.ok(src.includes('token: token.trim()')); assert.ok(src.includes('useState(info.common.token)'))
  })
  await test('1.5.46 面板设置页布局：外观设置在添加OpenWrt下；全局配置在路由器详情最上；运行日志在软件管理后', () => {
    const src = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8'), body = src.slice(src.indexOf('function SettingsPage'), src.indexOf('function MorePage'))
    const at = s => body.indexOf(s)
    assert.ok(at('title="添加 OpenWrt"') < at('<Text>路由器详情</Text>')); assert.ok(!src.includes('AppearancePage'))
    assert.ok(body.indexOf('title="全局配置"') < body.indexOf('title="网络接口"')); assert.ok(body.indexOf('title="软件管理"') < body.indexOf('title="运行日志"', body.indexOf('title="软件管理"')))
    assert.ok(!src.includes('page === "appearance"') && !src.includes('page === "global"') && !src.includes('setPage("appearance")') && !src.includes('setPage("global")'))
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
    const rows = nodes(tree, 'Button').filter(n => n.props.children?.length && n.props.frame?.maxWidth === 'infinity' && !n.props.frame.alignment)
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
  await test('1.5.46 控制器左滑删除按钮（trailingSwipeActions）与右对齐版本', () => {
    const source = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8')
    const body = source.match(/function remove\(id: string\) \{([\s\S]*?)\n  \}/)[1].trim()
    assert.equal(body, `removeController(id)
    setList(listControllers())
    setTimeout(onChanged, 500)`)
    assert.ok(source.includes('trailingSwipeActions={{ allowsFullSwipe: false')); assert.ok(source.includes('title="删除" tint="systemRed" action={() => remove(c.id)}')); assert.ok(!source.includes('onDelete={onDelete}'))
    assert.ok(source.includes('<Spacer /><Text font={12} foregroundStyle="secondaryLabel">{`v${VERSION}`}</Text>')); assert.ok(!source.includes('非官方实现'))
  })
  await test('1.5提供者：真实数量/类型/更新时间及URL编码更新', async () => {
    const xs = api.parseProviders({providers:{'A / B':{type:'Proxy',vehicleType:'HTTP',proxies:[{},{}],updatedAt:'2026-10-20T00:00:00Z'},inline:{type:'Proxy',vehicleType:'Inline'}}},'proxies')
    assert.equal(xs[0].count,2);assert.equal(xs[0].vehicleType,'HTTP');assert.equal(xs[1].count,null)
    assert.equal(api.parseProviders({providers:{R:{ruleCount:953,behavior:'domain',format:'mrs'}}},'rules')[0].count,953)
    responder=()=>({status:204});calls.length=0;await api.updateProvider(c,'proxies','A / B');assert.ok(calls[0].url.endsWith('/providers/proxies/A%20%2F%20B'));assert.equal(calls[0].init.method,'PUT')
    const before=confirms.length;calls.length=0;let changed=0;let tree=render(pages.ProviderCard,{c,p:xs[0],kind:'proxies',onChanged(){changed++}},true)
    await nodes(tree,'Button')[0].props.action();assert.equal(confirms.length,before);assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith('/providers/proxies/A%20%2F%20B'));assert.equal(calls[0].init.method,'PUT');assert.equal(changed,1)
    {let t2=render(pages.ProviderCard,{c,p:xs[0],kind:'proxies',onChanged(){}},true);let release;responder=()=>({wait:new Promise(r=>{release=r}),status:204});const pending=nodes(t2,'Button')[0].props.action();await flush();t2=render(pages.ProviderCard,{c,p:xs[0],kind:'proxies',onChanged(){}});assert.equal(nodes(t2,'ProgressView').length,1);assert.equal(nodes(t2,'ProgressView')[0].props.progressViewStyle,'circular');release();await pending;await flush();t2=render(pages.ProviderCard,{c,p:xs[0],kind:'proxies',onChanged(){}});assert.equal(nodes(t2,'ProgressView').length,0);unmount();responder=()=>({status:204})}
  })
  await test('1.5组子页：完整节点分页、排序、切换取消不请求及测速确认', async () => {
    pref.savePreferences({nodeSort:'name',disconnectOnSwitch:false});const g={name:'TestGroup',type:'Selector',now:'N000',all:Array.from({length:125},(_,i)=>'N'+String(i).padStart(3,'0')),delays:{}}
    let tree=render(pages.GroupNodesPage,{c,g,onChanged(){}},true);await flush();tree=render(pages.GroupNodesPage,{c,g,onChanged(){}})
    assert.equal(nodes(tree,'Button').filter(x=>x.props.children?.length).length,80);assert.ok(text(tree).includes('80 / 125'))
    button(tree,'加载更多').props.action();tree=render(pages.GroupNodesPage,{c,g,onChanged(){}});assert.equal(nodes(tree,'Button').filter(x=>x.props.children?.length).length,125)
    const before=confirms.length;calls.length=0;await nodes(tree,'Button').filter(x=>x.props.children?.length)[1].props.action();assert.equal(confirms.length,before);assert.equal(calls.length,1);assert.equal(calls[0].init.method,'PUT')
    context.confirmResult=false;calls.length=0;await button(trailing(tree.props.toolbar),'测速').props.action();assert.equal(calls.length,0);context.confirmResult=true
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
    tree=render(pages.ConnectionsPage,{active:c,version:0});assert.ok(!text(tree).includes('Nikki / Mihomo'));assert.ok(!text(tree).includes('按实际采样间隔'));button(trailing(tree.props.toolbar),'恢复监控').props.action();render(pages.ConnectionsPage,{active:c,version:0});await flush();assert.equal(intervals.size,1)
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
  await test('默认打开界面与底部五个入口名称顺序一致，更多可保存并启动', () => {
    const src = fs.readFileSync(path.join(root, 'settings-ui.tsx'), 'utf8')
    assert.ok(src.includes('[["overview", "主页"], ["proxies", "代理"], ["rules", "规则"], ["connections", "连接"], ["more", "更多"]]'))
    for (const [stored, tab] of [['overview','home'],['proxies','proxies'],['rules','rules'],['connections','connections'],['more','more']]) {
      pref.savePreferences({ defaultPage: stored }); assert.equal(pref.getPreferences().defaultPage, stored)
      const tree = render(app.Root, {}, true); assert.equal(nodes(tree, 'TabView')[0].props.selection.value, tab); unmount()
    }
  })
  await test('自定义请求头开关保留Keychain，关闭不发送，重开恢复', () => {
    const before = pref.getHeaderText()
    pref.saveHeaders('{"X-Is-Me":"YES"}')
    pref.savePreferences({ headersEnabled: false }); assert.equal(JSON.stringify(pref.customHeaders()), '{}'); assert.ok(pref.getHeaderText().includes('YES'))
    pref.savePreferences({ headersEnabled: true }); assert.equal(pref.customHeaders()['X-Is-Me'], 'YES')
    pref.saveHeaders(before)
    const src = fs.readFileSync(path.join(root, 'settings-ui.tsx'), 'utf8')
    assert.ok(!src.includes('HeadersPage')); assert.ok(src.includes('<HeaderFields />')); assert.ok(src.includes('title="例如 X-Is-Me"')); assert.ok(src.includes('title="例如 YES"')); assert.ok(src.includes('<Toggle title="自定义请求头"')); assert.ok(src.includes('rows.flatMap')); assert.ok(!src.includes('<Label title="自定义请求头"'))
  })
  await test('设置订阅隔离：请求头开关不刷新上层导航，主题修改仍通知', async () => {
    pref.savePreferences({ headersEnabled: true, theme: 'system' })
    const Probe = () => ui.usePreferences(['theme'])
    const first = render(Probe, {}, true); await flush()
    pref.savePreferences({ headersEnabled: false }); assert.equal(render(Probe, {}), first)
    pref.savePreferences({ theme: 'dark' }); assert.notEqual(render(Probe, {}), first); assert.equal(render(Probe, {}).theme, 'dark')
    unmount(); pref.savePreferences({ headersEnabled: true, theme: 'system' })
    const src = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8')
    assert.ok(src.includes('function AppearanceRoot()')); assert.ok(src.includes('usePreferences(["connectionBackground"])'));  assert.ok(src.includes('prev.foldOffline === next.foldOffline ? prev : next'))
  })
  await test('五种节点排序：升降序、超时未测速最后、原始顺序不变', () => {
    const g = { all: ['C','B','A','D','E'], delays: { A: 10, B: 20, C: 0, E: 20 } }
    const expected = { default: ['C','B','A','D','E'], name: ['A','B','C','D','E'], nameDesc: ['E','D','C','B','A'], delay: ['A','B','E','C','D'], delayDesc: ['B','E','A','C','D'] }
    for (const [key, values] of Object.entries(expected)) {
      pref.savePreferences({ nodeSort: key }); assert.equal(pref.getPreferences().nodeSort, key); assert.equal(JSON.stringify(model.sortedNodes(g)), JSON.stringify(values))
    }
    assert.equal(JSON.stringify(g.all), '["C","B","A","D","E"]'); pref.savePreferences({ nodeSort: 'default' })
    assert.equal(pref.NODE_SORT_OPTIONS.length, 5)
  })
  await test('全局配置移除iCloud同步与代理内核区块，其他内核页面保留', () => {
    const src = fs.readFileSync(path.join(root, 'settings-ui.tsx'), 'utf8'), body = src.slice(src.indexOf('export function GlobalConfigPage'), src.indexOf('function CloudSettingsPage'))
    assert.ok(!body.includes('iCloud 同步')); assert.ok(!body.includes('代理内核')); assert.ok(!body.includes('CloudSettingsPage')); assert.ok(!body.includes('KernelConfigPage')); assert.ok(src.includes('export function KernelConfigPage'))
  })
  await test('外观选项移入全局配置，概览选项不移动', () => {
    const src = fs.readFileSync(path.join(root, 'settings-ui.tsx'), 'utf8'), body = src.slice(src.indexOf('export function GlobalConfigPage'), src.indexOf('function CloudSettingsPage'))
    assert.ok(!body.includes('（本地替代）')); assert.ok(!body.includes('（长按组标题）')); assert.ok(!body.includes('（淡出替代）'))
    for (const k of ['theme','ThresholdRange','showHidden','customIcons','clearImageCache']) assert.ok(body.includes(k))
  })
  await test('设置子页打开时暂停主页偏好刷新，返回补齐；外观去掉编辑组图标', async () => {
    pref.savePreferences({ showWrt: true })
    const Probe = ({ enabled }) => ui.usePreferences(['showWrt'], enabled)
    const first = render(Probe, { enabled: true }, true); await flush()
    render(Probe, { enabled: false }); await flush()
    pref.savePreferences({ showWrt: false }); assert.equal(render(Probe, { enabled: false }), first)
    render(Probe, { enabled: true }); await flush(); assert.equal(render(Probe, { enabled: true }).showWrt, false)
    unmount(); pref.savePreferences({ showWrt: true })
    const src = fs.readFileSync(path.join(root, 'settings-ui.tsx'), 'utf8'), body = src.slice(src.indexOf('export function GlobalConfigPage'), src.indexOf('function CloudSettingsPage'))
    assert.ok(!body.includes('编辑组图标')); assert.ok(!body.includes('IconsPage')); assert.ok(body.includes('自定义代理组图标'))
  })
  await test('全局配置包含迁移项且无概览组，两个外观入口都删除', async () => {
    pref.savePreferences({ theme: 'dark', customIcons: true, showWrt: false })
    let tree = render(ui.GlobalConfigPage, { active: null }, true)
    assert.ok(!text(tree).includes('概览页面'))
    for (const key of ['showWrt','droplets','connectionBackground','ripple']) assert.ok(!nodes(tree, 'Toggle').some(n => n.props.key === key))
    for (const title of ['外观模式']) assert.ok(nodes(tree, ui.Choice).some(n => n.props.title === title))
    const icons = nodes(tree, 'Toggle').find(n => n.props.title === '自定义代理组图标'); assert.equal(icons.props.value, true)
    icons.props.onChanged(false); assert.equal(pref.getPreferences().customIcons, false)
    assert.ok(button(tree, '清除图片缓存'))
    assert.equal(pref.getPreferences().theme, 'dark')
    const src = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8'); assert.ok(!src.includes('AppearancePage')); assert.ok(!src.includes('prefs.showWrt'))
    pref.savePreferences({ theme: 'system', showWrt: true }); unmount()
  })
  await test('全局配置移除列表与动画整组和显示Global开关，其余设置保留', () => {
    const tree = render(ui.GlobalConfigPage, { active: null }, true)
    assert.ok(!text(tree).includes('列表与动画'))
    for (const title of ['连接列表样式','代理卡片样式']) assert.ok(!nodes(tree, ui.Choice).some(n => n.props.title === title))
    for (const key of ['collapseGesture','showGlobal']) assert.ok(!nodes(tree, 'Toggle').some(n => n.props.key === key))
    for (const key of ['showHidden','customIcons','nestedDelay','haptics']) assert.ok(nodes(tree, 'Toggle').some(n => n.props.key === key))
    assert.ok(nodes(tree, ui.Choice).some(n => n.props.title === '外观模式')); assert.ok(button(tree, '清除图片缓存'))
    unmount()
  })
  await test('关闭自定义图标隐藏默认、映射及网络图标，迟到下载不恢复图标', async () => {
    const g = { name: 'icon-toggle', type: 'Selector', all: [], now: '', delays: {}, icon: 'https://icons.invalid/toggle.png' }
    pref.savePreferences({ customIcons: false, groupIcons: {} }); calls.length = 0
    let tree = render(pages.GroupIcon, { g }, true); await flush(); assert.equal(tree, null); assert.equal(calls.length, 0)
    pref.savePreferences({ customIcons: true, groupIcons: { [g.name]: 'globe' } })
    tree = render(pages.GroupIcon, { g }); await flush(); assert.equal(tree.props.systemName, 'globe')
    pref.savePreferences({ customIcons: false }); assert.equal(render(pages.GroupIcon, { g }), null); await flush()
    let release; const imageWait = new Promise(resolve => { release = resolve })
    responder = () => ({ contentType: 'image/png', data: 'downloaded-icon', imageWait })
    pref.savePreferences({ customIcons: true, groupIcons: {} }); render(pages.GroupIcon, { g }); await flush()
    pref.savePreferences({ customIcons: false }); assert.equal(render(pages.GroupIcon, { g }), null); await flush()
    release(); await flush(); assert.equal(render(pages.GroupIcon, { g }), null)
    pref.savePreferences({ customIcons: true }); render(pages.GroupIcon, { g }); await flush()
    tree = render(pages.GroupIcon, { g }); assert.ok(tree.props.image)
    pref.savePreferences({ customIcons: false }); assert.equal(render(pages.GroupIcon, { g }), null); await flush()
    unmount(); pref.savePreferences({ customIcons: true, groupIcons: {} })
  })
  await test('关闭图标在策略组父布局卸载组件，保留文字、节点入口和测速按钮', async () => {
    responder = () => ({ contentType: 'image/png', data: 'cached-group-image' })
    const icon = 'https://icons.invalid/parent-toggle.png'; await pref.cachedIcon(icon)
    for (const name of ['PROXY','EMBY','AI','STEAM']) {
      pref.savePreferences({ customIcons: true })
      const props = { c, g: { name, icon, type: 'Selector', all: ['A'], now: 'A', delays: {} }, onChanged() {} }
      let tree = render(pages.GroupSection, props, true); await flush()
      assert.equal(nodes(tree, pages.GroupIcon).length, 1)
      pref.savePreferences({ customIcons: false }); tree = render(pages.GroupSection, props); await flush()
      assert.equal(nodes(tree, pages.GroupIcon).length, 0)
      assert.equal(nodes(tree, 'NavigationLink').length, 0)
      const head = nodes(tree, 'Button').find(n => n.props.frame?.alignment === 'leading')
      assert.ok(head); assert.ok(text(head).includes(name)); assert.ok(text(head).includes('A'))
      assert.ok(nodes(tree, 'Image').some(n => n.props.systemName === 'chevron.right'))
      head.props.action(); tree = render(pages.GroupSection, props); await flush()
      assert.ok(nodes(tree, 'Image').some(n => n.props.systemName === 'chevron.down'))
      nodes(tree, 'Button').find(n => n.props.frame?.alignment === 'leading').props.action(); tree = render(pages.GroupSection, props); await flush()
      assert.equal(nodes(tree, 'Button').filter(n => n.props.systemImage === 'bolt.fill').length, 1)
      unmount(); tree = render(pages.GroupSection, props, true); assert.equal(nodes(tree, pages.GroupIcon).length, 0); await flush()
      pref.savePreferences({ customIcons: true }); tree = render(pages.GroupSection, props); assert.equal(nodes(tree, pages.GroupIcon).length, 1)
      unmount()
    }
  })
  await test('策略组小闪电直接测速，不弹确认', async () => {
    const g = { name: 'BoltGroup', type: 'Selector', all: ['A'], now: 'A', delays: {} }
    let tree = render(pages.GroupSection, { c, g, onChanged() {} }, true); await flush()
    const before = confirms.length; calls.length = 0
    await nodes(tree, 'Button').find(n => n.props.systemImage === 'bolt.fill').props.action(); await flush()
    assert.equal(confirms.length, before); assert.ok(calls.length > 0); unmount()
  })
  await test('策略组：切换立即更新选中、失败回滚；测速期间节点按钮不禁用；选中节点圆点保持延迟颜色', async () => {
    pref.savePreferences({ nodeSort: 'default' })
    const g = { name: 'SwitchGroup', type: 'Selector', all: ['A', 'B'], now: 'A', delays: { A: 30, B: 400 } }
    const open = async () => { let t = render(pages.GroupSection, { c, g, onChanged() {} }, true); await flush(); nodes(t, 'Button').find(n => n.props.frame?.alignment === 'leading').props.action(); t = render(pages.GroupSection, { c, g, onChanged() {} }); await flush(); return t }
    const cards = t => nodes(t, 'Button').filter(n => n.props.children?.length && n.props.frame?.maxWidth === 'infinity' && !n.props.frame.alignment)
    let tree = await open()
    assert.ok(cards(tree).every(n => !n.props.disabled)); assert.ok(!nodes(tree, 'Button').find(n => n.props.systemImage === 'bolt.fill').props.disabled)
    const selDot = nodes(cards(tree)[0], 'Circle')[0]; assert.equal(selDot.props.fill, api.delayColor(30))
    let release; responder = () => ({ wait: new Promise(r => { release = r }), status: 204 })
    const pending = cards(tree)[1].props.action(); tree = render(pages.GroupSection, { c, g, onChanged() {} })
    assert.ok(text(cards(tree)[1]).includes('B')); assert.equal(nodes(cards(tree)[1], 'Image').length, 1)
    assert.equal(nodes(cards(tree)[0], 'Image').length, 0)
    await flush(); release(); await pending; await flush(); unmount()
    tree = await open(); responder = () => ({ status: 500 }); context.confirmResult = true
    await cards(tree)[1].props.action(); await flush(); tree = render(pages.GroupSection, { c, g, onChanged() {} })
    assert.equal(nodes(cards(tree)[0], 'Image').length, 1); assert.equal(nodes(cards(tree)[1], 'Image').length, 0)
    responder = () => ({ status: 204 }); unmount()
  })
  await test('策略组：点标题和点箭头都能展开/收拢；节点卡片显示协议；重新进入保留最近一次测速延迟', async () => {
    pref.savePreferences({ nodeSort: 'default', collapseGesture: false })
    const g = { name: 'ExpandGroup', type: 'Selector', all: ['A', 'B'], now: 'A', delays: {}, types: { A: 'Shadowsocks', B: 'Snell' } }
    const props = { c, g, onChanged() {} }
    const cards = t => nodes(t, 'Button').filter(n => n.props.children?.length && n.props.frame?.maxWidth === 'infinity' && !n.props.frame.alignment)
    let tree = render(pages.GroupSection, props, true); await flush()
    assert.equal(cards(tree).length, 0)
    nodes(tree, 'Button').find(n => n.props.frame?.alignment === 'leading').props.action(); tree = render(pages.GroupSection, props); await flush()
    assert.equal(cards(tree).length, 2); assert.ok(text(tree).includes('Shadowsocks')); assert.ok(text(tree).includes('Snell'))
    const arrow = t => nodes(t, 'Button').find(n => !n.props.frame && n.props.buttonStyle === 'plain' && nodes(n, 'Image').some(i => i.props.systemName.startsWith('chevron.')))
    arrow(tree).props.action(); tree = render(pages.GroupSection, props); await flush(); assert.equal(cards(tree).length, 0)
    arrow(tree).props.action(); tree = render(pages.GroupSection, props); await flush(); assert.equal(cards(tree).length, 2)
    responder = () => ({ body: { A: 51, B: 62 } })
    await nodes(tree, 'Button').find(n => n.props.systemImage === 'bolt.fill').props.action(); await flush(); tree = render(pages.GroupSection, props)
    assert.ok(text(tree).includes('51ms'))
    for (const n of cards(tree)) { const dot = nodes(n, 'Circle').find(x => x.props.frame?.width === 6), label = nodes(n, 'Text').find(x => /ms$/.test(String(x.props.children))); assert.equal(label.props.foregroundStyle, dot.props.fill); assert.notEqual(label.props.foregroundStyle, 'white') }
    unmount()
    tree = render(pages.GroupSection, props, true); await flush()
    nodes(tree, 'Button').find(n => n.props.frame?.alignment === 'leading').props.action(); tree = render(pages.GroupSection, props); await flush()
    assert.ok(text(tree).includes('51ms')); assert.ok(text(tree).includes('62ms')); unmount(); responder = () => ({ status: 204 })
  })
  await test('loadGroups 读出每个节点的协议类型，并经代理页传到节点卡片', async () => {
    responder = url => ({ body: url.includes('/providers/') ? { providers: {} } : { proxies: {
      GLOBAL: { type: 'Selector', all: ['PROXY'], now: 'PROXY' },
      PROXY: { type: 'Selector', now: 'N1', all: ['N1', 'N2'] },
      N1: { type: 'Shadowsocks', history: [{ delay: 40 }] }, N2: { type: 'Snell' } } } })
    const gs = await api.loadGroups(c); const grp = gs.find(x => x.name === 'PROXY')
    assert.equal(grp.types.N1, 'Shadowsocks'); assert.equal(grp.types.N2, 'Snell')
    unmount(); render(pages.ProxiesPage, { active: c, version: 0 }, true); await flush()
    let tree = render(pages.ProxiesPage, { active: c, version: 0 })
    const sec = nodes(tree, pages.GroupSection)[0]; assert.equal(sec.props.g.types.N2, 'Snell')
    unmount(); responder = () => ({ status: 204 })
  })
  await test('节点类型缺失时从代理提供者接口补全协议', async () => {
    responder = url => ({ body: url.includes('/providers/proxies') ? { providers: { self: { proxies: [{ name: 'P1', type: 'AnyTLS' }, { name: 'P2', type: 'Snell' }] } } } : { proxies: {
      GLOBAL: { type: 'Selector', all: ['G1'], now: 'G1' }, G1: { type: 'Selector', now: 'P1', all: ['P1', 'P2', 'L1'] }, P1: { history: [{ delay: 30 }] }, L1: { type: 'Shadowsocks' } } } })
    const grp = (await api.loadGroups(c)).find(x => x.name === 'G1')
    assert.equal(grp.types.P1, 'AnyTLS'); assert.equal(grp.types.P2, 'Snell'); assert.equal(grp.types.L1, 'Shadowsocks'); unmount(); responder = () => ({ status: 204 })
  })
  await test('节点是嵌套策略组时，协议取其当前选中的真实节点', async () => {
    responder = () => ({ body: { proxies: {
      GLOBAL: { type: 'Selector', all: ['TOP'], now: 'TOP' },
      TOP: { type: 'Selector', now: 'SUB', all: ['SUB', 'REAL', 'LOOP'] },
      SUB: { type: 'Selector', now: 'DEEP', all: ['DEEP'] }, DEEP: { type: 'Snell' }, REAL: { type: 'AnyTLS' },
      LOOP: { type: 'Selector', now: 'LOOP', all: ['LOOP'] } } } })
    const t = (await api.loadGroups(c)).find(x => x.name === 'TOP').types
    assert.equal(t.SUB, 'Snell'); assert.equal(t.REAL, 'AnyTLS'); assert.equal(t.LOOP, 'Selector'); unmount(); responder = () => ({ status: 204 })
  })
  await test('同一节点在多个策略组中共享最近一次测速延迟', async () => {
    const g1 = { name: 'ShareA', type: 'Selector', all: ['N1', 'N2'], now: 'N1', delays: { N1: 30 } }, g2 = { name: 'ShareB', type: 'Selector', all: ['N1', 'N2'], now: 'N1', delays: {} }
    const cards = t => nodes(t, 'Button').filter(n => n.props.children?.length && n.props.frame?.maxWidth === 'infinity' && !n.props.frame.alignment)
    const open = async g => { let t = render(pages.GroupSection, { c, g, onChanged() {} }, true); await flush(); nodes(t, 'Button').find(n => n.props.frame?.alignment === 'leading').props.action(); return render(pages.GroupSection, { c, g, onChanged() {} }) }
    responder = url => ({ body: url.includes('/group/') ? { N1: 31, N2: 77 } : { delay: 77 } })
    let tree = await open(g1); await nodes(tree, 'Button').find(n => n.props.systemImage === 'bolt.fill').props.action(); await flush(); unmount()
    tree = await open(g2); assert.ok(text(tree).includes('77ms')); assert.ok(!text(tree).includes('未测速')); unmount(); responder = () => ({ status: 204 })
  })
  await test('展开策略组时只对没有延迟的节点自动补测，已有延迟的不重复测', async () => {
    const g = { name: 'ProbeGroup', type: 'Selector', all: ['HAS', 'NOPE'], now: 'HAS', delays: { HAS: 20 } }
    responder = url => ({ body: url.includes('/proxies/NOPE/delay') ? { delay: 123 } : { delay: 1 } })
    calls.length = 0
    let t = render(pages.GroupSection, { c, g, onChanged() {} }, true); await flush()
    assert.equal(calls.filter(x => x.url.includes('/delay')).length, 0)
    nodes(t, 'Button').find(n => n.props.frame?.alignment === 'leading').props.action(); t = render(pages.GroupSection, { c, g, onChanged() {} }); await flush(); await flush()
    const probes = calls.filter(x => x.url.includes('/delay')); assert.equal(probes.length, 1); assert.ok(probes[0].url.includes('/proxies/NOPE/delay'))
    t = render(pages.GroupSection, { c, g, onChanged() {} }); assert.ok(text(t).includes('123ms')); assert.ok(!text(t).includes('未测速')); unmount(); responder = () => ({ status: 204 })
  })
  await test('自动补测：单节点测速失败时用整组测速兜底；超时不写入共享缓存', async () => {
    const g = { name: 'FallbackGroup', type: 'Selector', all: ['OK', 'ONLYGROUP', 'DEAD'], now: 'OK', delays: { OK: 20 } }
    responder = url => url.includes('/group/') ? { body: { ONLYGROUP: 196, DEAD: 0 } } : { body: { delay: 0 }, status: 504 }
    calls.length = 0
    let t = render(pages.GroupSection, { c, g, onChanged() {} }, true); await flush()
    nodes(t, 'Button').find(n => n.props.frame?.alignment === 'leading').props.action(); t = render(pages.GroupSection, { c, g, onChanged() {} }); await flush(); await flush(); await flush()
    t = render(pages.GroupSection, { c, g, onChanged() {} })
    assert.ok(calls.some(x => x.url.includes('/group/FallbackGroup/delay'))); assert.ok(text(t).includes('196ms'))
    const dead = nodes(t, 'Button').find(n => text(n).includes('DEAD')); assert.ok(text(dead).includes('超时')); assert.ok(!text(dead).includes('未测速'))
    unmount()
    calls.length = 0; responder = url => url.includes('/group/') ? { body: { DEAD: 0 } } : { status: 504 }
    let t2 = render(pages.GroupSection, { c, g, onChanged() {} }, true); await flush()
    nodes(t2, 'Button').find(n => n.props.frame?.alignment === 'leading').props.action(); render(pages.GroupSection, { c, g, onChanged() {} }); await flush(); await flush(); await flush()
    assert.ok(calls.some(x => x.url.includes('/proxies/DEAD/delay'))); unmount(); responder = () => ({ status: 204 })
  })
  await test('节点history为空时回退读取extra中各测速地址的最近延迟', async () => {
    responder = () => ({ body: { proxies: {
      GLOBAL: { type: 'Selector', all: ['AIG'], now: 'AIG' },
      AIG: { type: 'Selector', now: 'A', all: ['A', 'B', 'C', 'D'] },
      A: { type: 'Shadowsocks', history: [{ time: '2026-10-21T06:00:00Z', delay: 167 }] },
      B: { type: 'Shadowsocks', history: [], extra: { 'https://x.invalid/a': { alive: true, history: [{ time: '2026-10-21T05:00:00Z', delay: 300 }] }, 'https://x.invalid/b': { alive: true, history: [{ time: '2026-10-21T06:30:00Z', delay: 196 }] } } },
      C: { type: 'Shadowsocks', history: [{ time: '2026-10-21T06:00:00Z', delay: 0 }], extra: { 'https://x.invalid/a': { alive: true, history: [{ time: '2026-10-21T06:10:00Z', delay: 88 }] } } },
      D: { type: 'Shadowsocks', history: [] } } } })
    const d = (await api.loadGroups(c)).find(x => x.name === 'AIG').delays
    assert.equal(d.A, 167); assert.equal(d.B, 196); assert.equal(d.C, 88); assert.equal(d.D, undefined); unmount(); responder = () => ({ status: 204 })
  })
  await test('规则页：刷新/更新提供者重新读取时保留已显示的规则和提供者，不先清空；不显示“已展示”', async () => {
    responder = url => ({ body: url.includes('/providers/') ? { providers: { RP: { type: 'Rule', vehicleType: 'HTTP', ruleCount: 5, behavior: 'domain' } } } : { rules: [{ type: 'DomainSuffix', payload: 'keep.invalid', proxy: 'DIRECT' }] } })
    render(pages.RulesPage, { active: c, version: 0 }, true); await flush()
    let tree = render(pages.RulesPage, { active: c, version: 0 }); assert.ok(text(tree).includes('keep.invalid')); assert.ok(!text(tree).includes('已展示'))
    let release; responder = () => ({ wait: new Promise(r => { release = r }), body: { rules: [], providers: {} } })
    const refresh = nodes(trailing(tree.props.toolbar), 'Button').find(n => n.props.title === '刷新规则'); refresh.props.action(); await flush()
    tree = render(pages.RulesPage, { active: c, version: 0 }); assert.ok(text(tree).includes('keep.invalid'))
    nodes(tree, 'Picker')[0].props.onChanged('providers'); tree = render(pages.RulesPage, { active: c, version: 0 }); assert.equal(nodes(tree, pages.ProviderCard).length, 1)
    if (release) release(); await flush(); unmount(); responder = () => ({ status: 204 })
  })
  await test('规则页：条数超过上限时只有“加载更多”，没有“已展示”文字', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ type: 'Domain', payload: 'r' + i + '.invalid', proxy: 'DIRECT' }))
    responder = url => ({ body: url.includes('/providers/') ? { providers: {} } : { rules: many } })
    render(pages.RulesPage, { active: c, version: 0 }, true); await flush()
    const tree = render(pages.RulesPage, { active: c, version: 0 })
    assert.ok(!text(tree).includes('已展示')); assert.ok(button(tree, '加载更多')); unmount(); responder = () => ({ status: 204 })
  })
  await test('规则页与代理页菜单“全部更新”：只更新可更新的提供者，不弹确认，完成后刷新', async () => {
    const prov = { providers: { A: { type: 'Rule', vehicleType: 'HTTP', ruleCount: 1, proxies: [] }, B: { type: 'Rule', vehicleType: 'HTTP', ruleCount: 2, proxies: [] }, L: { type: 'Rule', vehicleType: 'Inline', ruleCount: 3, proxies: [] } } }
    responder = url => ({ body: url.includes('/providers/') ? prov : url.endsWith('/rules') ? { rules: [] } : { proxies: {} } })
    for (const [Page, kind, title] of [[pages.RulesPage, 'rules', '全部更新'], [pages.ProxiesPage, 'proxies', '全部更新']]) {
      render(Page, { active: c, version: 0 }, true); await flush()
      const tree = render(Page, { active: c, version: 0 })
      const before = confirms.length; calls.length = 0
      await nodes(trailing(tree.props.toolbar), 'Button').find(n => n.props.title === title).props.action(); await flush(); await flush()
      const puts = calls.filter(x => x.init?.method === 'PUT' && x.url.includes('/providers/' + kind + '/')).map(x => x.url.split('/').pop()).sort()
      assert.deepEqual(puts, ['A', 'B']); assert.equal(confirms.length, before); unmount()
    }
    responder = () => ({ status: 204 })
  })
  await test('连接页：新连接淡入逻辑不抛错且最终恢复不透明（测试环境 setTimeout 同步执行，不验证中间帧）', async () => {
    const mk = ids => ({ body: { connections: ids.map(id => ({ id, start: new Date(now).toISOString(), metadata: { host: id + '.invalid', destinationPort: '443', sourceIP: '10.0.0.2' }, chains: ['G', 'N'], upload: 1, download: 2 })) } })
    const seen = []
    const origSet = context.setTimeout
    responder = () => mk(['a'])
    render(pages.ConnectionsPage, { active: c, version: 0 }, true); await flush()
    let tree = render(pages.ConnectionsPage, { active: c, version: 0 })
    const op = id => nodes(tree, pages.ConnectionsPage).length, cards = () => nodes(tree, 'VStack').filter(n => n.props.opacity !== undefined)
    assert.ok(cards().every(n => n.props.opacity === 1))
    responder = () => mk(['a', 'b'])
    const refresh = [...intervals.values()].find(x => x.ms === 1500); refresh.fn(); await flush()
    tree = render(pages.ConnectionsPage, { active: c, version: 0 })
    assert.ok(text(tree).includes('b.invalid')); assert.ok(cards().every(n => n.props.opacity === 1))
    assert.equal(nodes(tree, 'Transition').length, 0); unmount(); responder = () => ({ status: 204 })
  })
  await test('连接页顶部：活动中/已关闭分段带数量，可切换；搜索按钮展开搜索框；排序菜单可改变顺序', async () => {
    const mk = list => ({ body: { connections: list.map(([id, host, up, down]) => ({ id, start: new Date(now - 1000).toISOString(), metadata: { host, destinationPort: '443', sourceIP: '10.0.0.2' }, chains: ['G', 'N'], upload: up, download: down })) } })
    responder = () => mk([['a', 'small.invalid', 1, 1], ['b', 'big.invalid', 500, 900]])
    render(pages.ConnectionsPage, { active: c, version: 0 }, true); await flush()
    let tree = render(pages.ConnectionsPage, { active: c, version: 0 })
    assert.ok(text(tree).includes('活动中')); assert.ok(text(tree).includes('已关闭')); assert.ok(text(tree).includes('2'))
    assert.equal(nodes(tree, 'TextField').length, 0)
    const searchBtn = nodes(tree, 'Button').find(n => nodes(n, 'Image').some(i => i.props.systemName === 'magnifyingglass')); searchBtn.props.action()
    tree = render(pages.ConnectionsPage, { active: c, version: 0 }); assert.equal(nodes(tree, 'TextField').length, 1)
    nodes(tree, 'TextField')[0].props.onChanged('big'); tree = render(pages.ConnectionsPage, { active: c, version: 0 })
    assert.ok(text(tree).includes('big.invalid')); assert.ok(!text(tree).includes('small.invalid')); nodes(tree, 'TextField')[0].props.onChanged('')
    tree = render(pages.ConnectionsPage, { active: c, version: 0 })
    const order = t => text(t).indexOf('big.invalid') - text(t).indexOf('small.invalid')
    nodes(tree, 'Button').find(n => n.props.title === '累计流量').props.action(); tree = render(pages.ConnectionsPage, { active: c, version: 0 })
    assert.ok(order(tree) < 0)
    const closedBtn = nodes(tree, 'Button').find(n => text(n).includes('已关闭')); closedBtn.props.action(); tree = render(pages.ConnectionsPage, { active: c, version: 0 })
    assert.ok(!text(tree).includes('big.invalid')); unmount(); responder = () => ({ status: 204 })
  })
  await test('连接卡片长按菜单、详情入口及直接排序选项', async () => {
    responder = () => ({ body: { connections: [{ id:'detail-test', start:new Date(now-20000).toISOString(), metadata:{host:'detail.invalid',sourceIP:'10.0.0.8',sourcePort:1234,destinationIP:'192.0.2.8',destinationPort:443,network:'tcp',type:'TProxy'}, chains:['N','G'],rule:'Match',upload:48,download:96 }] } })
    render(pages.ConnectionsPage,{active:c,version:0},true);await flush()
    let tree=render(pages.ConnectionsPage,{active:c,version:0})
    const card=nodes(tree,'VStack').find(n=>n.props.contextMenu)
    assert.equal(card.props.contextMenu.preview,undefined);assert.equal(card.props.frame.maxWidth,'infinity');assert.ok(text(card).includes('detail.invalid'))
    const items=nodes(card.props.contextMenu.menuItems,'Button')
    assert.deepEqual(items.map(n=>n.props.title),['关闭连接','筛选同源连接','筛选同域名连接','复制连接信息'])
    await items[3].props.action();assert.ok(clipboard.includes('detail.invalid:443'));assert.ok(clipboard.includes('10.0.0.8:1234'))
    const link=nodes(tree,'NavigationLink').find(n=>n.props.destination.type===pages.ConnectionDetailPage);assert.ok(link)
    const x=link.props.destination.props.x
    unmount();tree=render(pages.ConnectionDetailPage,{x,onDisconnect(){}},true)
    assert.deepEqual(nodes(tree,'Section').map(n=>text(n.props.header)),['周期','目标地址','流量','源信息','规则','标识'])
    assert.equal(tree.props.toolbar.topBarTrailing.props.title,'断开');unmount()
    tree=render(pages.ConnectionDetailPage,{x:{...x,closedAt:now},onDisconnect(){}},true);assert.equal(tree.props.toolbar,undefined);unmount()
    responder=()=>({status:204})
  })
  await test('连接页后台停止轮询并忽略旧请求失败，前台重新读取', async () => {
    let release;responder=()=>({wait:new Promise((r,reject)=>{release=()=>reject(Error('interrupted'))}),status:200})
    render(pages.ConnectionsPage,{active:c,version:0},true);await flush()
    for(const fn of [...sceneListeners])fn('background')
    render(pages.ConnectionsPage,{active:c,version:0});await flush()
    assert.ok(![...intervals.values()].some(x=>x.ms===1500))
    release();await flush();let tree=render(pages.ConnectionsPage,{active:c,version:0});assert.ok(!text(tree).includes('请求未完成'))
    responder=()=>({body:{connections:[]}})
    for(const fn of [...sceneListeners])fn('active')
    render(pages.ConnectionsPage,{active:c,version:0});await flush();tree=render(pages.ConnectionsPage,{active:c,version:0})
    assert.ok([...intervals.values()].some(x=>x.ms===1500));assert.ok(!text(tree).includes('请求未完成'));unmount();responder=()=>({status:204})
  })
  await test('新连接分批插入：旧卡片始终保留，不改变透明度或整页动画', async () => {
    const mk=ids=>({body:{connections:ids.map((id,i)=>({id,start:new Date(now+i).toISOString(),metadata:{host:id+'.invalid'},upload:0,download:0}))}})
    responder=()=>mk(['waterA']);render(pages.ConnectionsPage,{active:c,version:0},true);await flush()
    const timers=[],original=context.setTimeout;context.setTimeout=(fn,ms)=>{timers.push({fn,ms});return timers.length}
    try {
      responder=()=>mk(['waterA','waterB','waterC']);[...intervals.values()].find(x=>x.ms===1500).fn();await flush()
      let tree=render(pages.ConnectionsPage,{active:c,version:0});assert.ok(text(tree).includes('waterA.invalid'));assert.ok(!text(tree).includes('waterB.invalid'));assert.equal(tree.props.animation,undefined)
      assert.equal(timers.length,2);assert.equal(timers[0].ms,60);assert.equal(timers[1].ms,120)
      timers[0].fn();tree=render(pages.ConnectionsPage,{active:c,version:0});assert.ok(text(tree).includes('waterB.invalid'));assert.ok(!text(tree).includes('waterC.invalid'))
      timers[1].fn();tree=render(pages.ConnectionsPage,{active:c,version:0});assert.ok(text(tree).includes('waterC.invalid'));assert.ok(nodes(tree,'VStack').filter(n=>n.props.opacity!==undefined).every(n=>n.props.opacity===1))
    } finally {context.setTimeout=original;unmount();responder=()=>({status:204})}
  })
  await test('代理页缓存：重新进入立即显示上次策略组，读取完成前不提示空', async () => {
    responder = url => ({ body: url.includes('/providers/') ? { providers: {} } : { proxies: { CacheGroup: { type: 'Selector', now: 'X', all: ['X'] }, X: { type: 'Shadowsocks' } } } })
    render(pages.ProxiesPage, { active: c, version: 0 }, true); await flush(); unmount()
    responder = () => ({ wait: new Promise(() => {}), status: 200, body: {} })
    const tree = render(pages.ProxiesPage, { active: c, version: 0 }, true)
    assert.equal(nodes(tree, pages.GroupSection).length, 1); assert.equal(nodes(tree, pages.GroupSection)[0].props.g.name, 'CacheGroup'); assert.ok(!text(tree).includes('未读取到策略组')); unmount()
    responder = () => ({ status: 204 })
  })
  await test('图标诊断区分事件、保存、页面值及存储，不输出私人内容', async () => {
    const originalConsole = context.console, logs = []
    context.console = { ...console, log: message => logs.push(message) }
    try {
      pref.savePreferences({ customIcons: true, testURL: 'https://private.invalid/secret-value' })
      let tree = render(ui.GlobalConfigPage, { active: null }, true); await flush()
      nodes(tree, 'Toggle').find(n => n.props.key === 'customIcons').props.onChanged(false)
      tree = render(ui.GlobalConfigPage, { active: null }); await flush(); unmount()
      render(pages.ProxiesPage, { active: null, version: 0 }, true); await flush(); unmount()
      render(pages.GroupSection, { c, g: { name: 'private-group-name', type: 'Selector', all: ['A'], now: 'A', delays: {}, icon: 'https://private.invalid/secret-image' }, onChanged() {} }, true); await flush(); unmount()
      const diagnostic = logs.filter(x => x.startsWith('[preferences-icon]'))
      for (const stage of ['change','accepted','proxies-render','group-render']) assert.ok(diagnostic.some(x => x.includes('stage=' + stage) && x.includes('enabled=false')))
      assert.ok(diagnostic.every(x => !x.includes('private.invalid') && !x.includes('private-group-name') && !x.includes('secret-')))
      assert.ok(diagnostic.every(x => x.includes('build=1.5.117') && /instance=[a-z0-9]+/.test(x)))
      assert.equal(new Set(diagnostic.map(x => x.match(/instance=([^ ]+)/)[1])).size, 1)
    } finally { context.console = originalConsole; unmount(); pref.savePreferences({ customIcons: true, testURL: 'https://www.gstatic.com/generate_204' }) }
  })
  await test('图标显示状态改变导航标签身份，不丢失卡片展开与测速数据', async () => {
    pref.savePreferences({ customIcons: true, collapseGesture: true })
    const props = { c, g: { name: 'label-identity', type: 'Selector', all: ['A'], now: 'A', delays: { A: 42 } }, onChanged() {} }
    let tree = render(pages.GroupSection, props, true); await flush()
    const head = t => nodes(t, 'Button').find(n => n.props.frame?.alignment === 'leading')
    head(tree).props.action(); tree = render(pages.GroupSection, props); await flush()
    assert.equal(nodes(tree, pages.GroupIcon).length, 1)
    pref.savePreferences({ customIcons: false }); tree = render(pages.GroupSection, props); await flush()
    assert.equal(nodes(tree, pages.GroupIcon).length, 0)
    assert.ok(nodes(tree, 'Image').some(n => n.props.systemName === 'chevron.down')); assert.ok(text(tree).includes('42ms'))
    pref.savePreferences({ customIcons: true }); tree = render(pages.GroupSection, props); await flush()
    assert.equal(nodes(tree, pages.GroupIcon).length, 1); assert.ok(nodes(tree, 'Image').some(n => n.props.systemName === 'chevron.down'))
    unmount(); pref.savePreferences({ collapseGesture: false })
  })
  await test('隐藏标签不请求不采样；更多selected透传到业务页', async () => {
    for (const fn of [app.OverviewPage, pages.ProxiesPage, pages.RulesPage, pages.ConnectionsPage, pages.MorePage]) {
      calls.length = 0
      render(fn, { active: c, version: 0, selected: false, onChanged() {}, onSwitch() {} }, true); await flush()
      assert.equal(calls.length, 0, fn.name); assert.equal(intervals.size, 0, fn.name); unmount()
    }
    const more = render(app.MorePage, { active: c, selected: false, onChanged() {} }, true)
    assert.equal(more.props.selected, false); unmount()
  })
  await test('代理页隐藏不删除策略组导航入口，重现时保留到请求完成', async () => {
    responder = url => ({ body: url.endsWith('/proxies') ? { proxies: { G: { type: 'Selector', all: ['A'], now: 'A' } } } : { providers: {} } })
    const props = { active: c, version: 0, selected: true }
    render(pages.ProxiesPage, props, true); await flush()
    let tree = render(pages.ProxiesPage, props); assert.equal(nodes(tree, pages.GroupSection).length, 1)
    tree.props.onDisappear(); tree = render(pages.ProxiesPage, { ...props, selected: false }); await flush()
    assert.equal(nodes(tree, pages.GroupSection).length, 1)
    const key = nodes(tree, pages.GroupSection)[0].props.key
    const before = calls.length
    tree = render(pages.ProxiesPage, { ...props, selected: false }); await flush(); assert.equal(calls.length, before)
    tree.props.onAppear(); tree = render(pages.ProxiesPage, props); await flush()
    assert.equal(nodes(tree, pages.GroupSection)[0].props.key, key)
    tree = render(pages.ProxiesPage, props); assert.equal(nodes(tree, pages.GroupSection).length, 1); unmount()
  })
  await test('主页隐藏停止轮询，重现只恢复一个轮询且保留设置入口', async () => {
    const router = api.listControllers().find(x => x.kind === 'openwrt')
    const props = { active: router, version: 0, selected: true, onSwitch() {} }
    responder = (_url, init) => { const b = JSON.parse(init.body); return { body: { id: b.id, result: [0, b.params?.[1] === 'session' ? { ubus_rpc_session: 'retained' } : { uptime: 1, load: [], memory: { total: 100, free: 50 }, interface: [], data: '1' }] } } }
    render(app.OverviewPage, props, true); await flush()
    let tree = render(app.OverviewPage, props), link = trailing(tree.props.toolbar)
    assert.equal([...intervals.values()].filter(x => x.ms === 1000).length, 1)
    render(app.OverviewPage, { ...props, selected: false }); await flush()
    assert.equal([...intervals.values()].filter(x => x.ms === 1000).length, 0)
    tree = render(app.OverviewPage, props); await flush()
    assert.equal(trailing(tree.props.toolbar), link)
    assert.equal([...intervals.values()].filter(x => x.ms === 1000).length, 1)
    unmount(); assert.equal(intervals.size, 0)
  })
  await test('主页内存固定一位小数，流量默认精度不变', () => {
    assert.deepEqual(Array.from(api.fmtParts(128.56 * 1048576, false, 1)), ['128.6', 'MB'])
    assert.deepEqual(Array.from(api.fmtParts(128 * 1048576, false, 1)), ['128.0', 'MB'])
    assert.deepEqual(Array.from(api.fmtParts(1.25 * 1073741824, false, 1)), ['1.3', 'GB'])
    assert.deepEqual(Array.from(api.fmtParts(128 * 1048576)), ['128.00', 'MB'])
    assert.ok(fs.readFileSync(path.join(root, 'index.tsx'), 'utf8').includes('title="内存使用" parts={w ? fmtParts(memUsed, false, 1) : null}'))
  })
  await test('首页关键行为（速度图表、数字动画）', () => {
    const source=fs.readFileSync(path.join(root,'index.tsx'),'utf8')
    assert.ok(!source.includes('title="下载速率"'));assert.ok(!source.includes('title="上传速率"'));assert.ok(source.includes('>速度</Text>'));assert.ok(source.includes('<RateChart down={dn} up={upH}'));assert.ok(source.includes('(Date.now() - at) / span'));assert.ok(source.includes('}, 16)'))
  })
  console.log(`\n${count} tests passed. All fetch, Storage, Keychain, iCloud and UI bindings were mocked; no device/remote effects executed.`)
})().catch(e => { console.error(e); process.exitCode = 1 })
