// 全部网络、Keychain、Storage、iCloud 均为内存模拟；不会访问路由器或 Apple 服务。
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const ts = require(process.env.TYPESCRIPT_PATH || '/tmp/chk/node_modules/typescript')
const root = path.resolve(__dirname, '..')
const store = new Map(), secrets = new Map(), calls = [], cache = new Map(), files = new Map()
let now = 1800000000000, failNextState = false, failStorage = false, responder = () => ({ body: {} }), hooks = [], hookIndex = 0, effects = [], confirms = [], alerts = [], clipboard = '', haptics = 0, openedURLs = [], intervals = new Map(), nextInterval = 1, cleanups = new Map()
let mockColorScheme="light"
const sceneListeners = new Set()
const emitScene = phase => { for (const fn of [...sceneListeners]) fn(phase) }
const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v))
const h = (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false) } })
const scripting = new Proxy({
  useColorScheme:()=>mockColorScheme,
  Device:{screen:{width:393,height:852,scale:3}},
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
  Animation: { linear: () => ({}), easeOut: () => ({}) }, withAnimation: (_a, body) => { (body || _a)(); return Promise.resolve() }, Transition: { opacity: () => ({ combined: () => ({}) }), scale: () => ({}), move: () => ({}) },
  modifiers: () => { const steps=[];const chain=new Proxy({steps},{get:(o,k)=>k==='steps'?steps:(...args)=>{steps.push([k,...args]);return chain}});return chain },
}, { get: (o, k) => k in o ? o[k] : k })
const context = {
  AbortController:class {constructor(){this.signal={aborted:false}} abort(){this.signal.aborted=true}},
  Data:{fromUint8Array:bytes=>({toRawString:()=>{try{return new (require('node:util').TextDecoder)('utf-8',{fatal:true}).decode(bytes)}catch{return null}}})},
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
    const responseText=r.text!==undefined?r.text:JSON.stringify(r.body??{})
    const encoded=require('node:buffer').Buffer.from(responseText);let delivered=false
    return {body:{getReader:()=>({read:async()=>{if(r.wait)await r.wait;if(delivered)return {done:true};delivered=true;return {done:false,value:new Uint8Array(encoded)}},cancel:async()=>{},releaseLock(){}})}, ok: status >= 200 && status < 300, status, headers: { get: name => name.toLowerCase()==='content-length'?(r.contentLength??null):(r.contentType ?? 'application/json') }, text: async () => { if(r.wait) await r.wait; return r.text !== undefined ? r.text : JSON.stringify(r.body ?? {}) }, data: async () => { if (r.imageWait) await r.imageWait; return r.data ?? 'fake-image-data' } }
  },
}
context.WebViewController = require('./webview-mock.cjs').MockWebViewController
function load(name) {
  name = name.replace(/^\.\//, '')
  if (cache.has(name)) return cache.get(name)
  const file = path.join(root, name + (name === 'index' || name === 'settings-ui' || name === 'dashboard-pages' || name === 'root-toolbar' || name === 'home-ui' || name === 'plot-view' ? '.tsx' : '.ts'))
  let source = fs.readFileSync(file, 'utf8')
  if (name === 'index') source = source.replace(/\nrun\(\)\s*$/, '') + '\nexport { EditController, OverviewPage, InfoItem, SettingsPage, ConnectionsPage, ProxiesPage, RulesPage, Spark, RateChart, StatCard, GroupSection, MorePage, Root, AppearanceRoot };'
  if (name === 'settings-ui') source += '\nexport { Choice, Range, TestURLField };'
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.React, jsxFactory: 'h' } }).outputText
  const module = { exports: {} }; cache.set(name, module.exports)
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', context, { filename: file })(n => n === 'scripting' ? scripting : load(n), module, module.exports)
  return module.exports
}
const pref = load('preferences'), api = load('api'), ui = load('settings-ui'), app = load('index'), cloud = load('cloud-backup'), pages = load('dashboard-pages'), model = load('dashboard-model'), home = load('home-ui'), metrics = load('openwrt-metrics')
function unmount() { for (const fn of cleanups.values()) fn(); cleanups.clear(); hooks = []; effects = [] }
function render(fn, props, reset = false) { if (reset) unmount(); hookIndex = 0; effects = []; return fn(props) }
async function flush() { const es = effects; effects = []; es.forEach(f => f()); for (let i = 0; i < 60; i++) await Promise.resolve() }
function unwrap(tree) { if (!tree || typeof tree !== 'object') return tree; if (typeof tree.type === 'function' && ['Card','Shell','Hint','Chip','Pages','MorePanel','MoreHeading','MoreLine','MoreSeparator','MoreTile','Panel','Note','Badge','Status'].includes(tree.type.name)) return unwrap(tree.type(tree.props)); return { ...tree, props: { ...tree.props, children: (tree.props?.children ?? []).map(unwrap) } } }
function nodes(tree, type) { const out = []; function visit(n) { if (!n || typeof n !== 'object') return; if (n.type === type) out.push(n); for (const x of n.props?.children ?? []) visit(x) } visit(unwrap(tree)); return out }
function trailing(toolbar) { return toolbar?.type === 'Toolbar' ? nodes(toolbar,'ToolbarItem').find(n=>n.props.placement==='topBarTrailing')?.props.children[0] : toolbar?.topBarTrailing }
function button(tree, title) { const b = nodes(tree, 'Button').find(b => b.props.title === title || b.props.accessibilityLabel === title || nodes(b,'Label').some(l => l.props.title === title) || nodes(b,'Text').some(t=>text(t).replace(/ /g,'')===title.replace(/ /g,''))); assert.ok(b, 'button: ' + title); return b }
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
      let tree = render(pages.ProxiesPage, { active: null, version: 0 }, true); await flush()
      nodes(trailing(tree.props.toolbar), 'Toggle').find(n => n.props.title === '显示图标').props.onChanged(false)
      assert.equal(store.get(key).customIcons, true)
      assert.equal(pref.getPreferences().customIcons, false)
      unmount(); tree = render(pages.ProxiesPage, { active: null, version: 0 }, true); await flush()
      assert.equal(nodes(trailing(tree.props.toolbar), 'Toggle').find(n => n.props.title === '显示图标').props.value, false)
      nodes(trailing(tree.props.toolbar), 'Toggle').find(n => n.props.title === '显示隐藏组').props.onChanged(true)
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
  await test('全局配置开关/滑块及更多页主题连续修改，保存及当前页状态一致', async () => {
    const props = { active: null }; let tree = render(ui.GlobalConfigPage, props, true); await flush()
    for (const value of [false, true, false, true, false]) {
      nodes(tree, 'Toggle').find(n => n.props.key === 'haptics').props.onChanged(value)
      tree = render(ui.GlobalConfigPage, props); await flush()
      assert.equal(nodes(tree, 'Toggle').find(n => n.props.key === 'haptics').props.value, value)
      assert.equal(pref.getPreferences().haptics, value)
    }
    const moreProps = { active: null, onChanged() {} }
    tree = render(pages.MorePage, moreProps, true); await flush()
    for (const theme of ['dark','light','system','dark']) {
      nodes(tree, ui.Choice).find(n => n.props.title === '外观模式').props.onChanged(theme)
      tree = render(pages.MorePage, moreProps); await flush()
      assert.equal(nodes(tree, ui.Choice).find(n => n.props.title === '外观模式').props.value, theme)
      assert.equal(pref.getPreferences().theme, theme)
    }
    tree = render(ui.GlobalConfigPage, props, true); await flush()
    for (const timeout of [2, 8, 15, 3]) {
      nodes(tree, ui.Range).find(n => n.props.title === '连接超时时间').props.onChanged(timeout)
      tree = render(ui.GlobalConfigPage, props); await flush()
      assert.equal(nodes(tree, ui.Range).find(n => n.props.title === '连接超时时间').props.value, timeout)
      assert.equal(pref.getPreferences().requestTimeout, timeout)
    }
    const src = fs.readFileSync(path.join(root, 'settings-ui.tsx'), 'utf8'); assert.ok(!src.includes('traceIconPreference("global-render"'))
    unmount(); pref.savePreferences({ customIcons: true, haptics: false, theme: 'system', requestTimeout: 8 })
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
    assert.equal(ranges.length, 2)
    assert.deepEqual(ranges.map(n => !!n.props.divider), [true, false])
    const rendered = ranges.map(n => render(ui.Range, n.props))
    assert.equal(nodes(rendered[0], 'RoundedRectangle').filter(x => x.props.frame?.height === 0.5).length, 1)
    assert.equal(nodes(rendered[1], 'RoundedRectangle').filter(x => x.props.frame?.height === 0.5).length, 0)
    assert.ok(rendered.every(t => t.props.listRowSeparator !== 'hidden'))
    unmount()
  })
  await test('全局配置移除主题/启动设置后，剩余分组顺序保持', () => {
    const tree = render(ui.GlobalConfigPage, { active: null }, true)
    const headers = nodes(tree, 'Section').map(n => text(n.props.header))
    assert.equal(headers.join('|'), '缓存管理|控制器管理|交互体验|延迟阈值设置|连接超时|测速设置')
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
  await test('统一全局测速URL、节点超时最多2秒，逐个回报且失败不再整组重测', async () => {
    pref.savePreferences({ testURL: 'https://test.invalid/probe', testTimeout: 3200 }); calls.length = 0
    responder = u => u.includes('/group/') ? { body: { C: 41 } } : u.includes('/proxies/C/') ? { status: 504 } : { body: { delay: 23 } }
    const seen = []; const result = await api.testGroup(c, { name: 'G', all: ['A', 'B', 'C'] }, (n, d) => seen.push([n, d]))
    assert.equal(result.A, 23); assert.equal(result.B, 23); assert.equal(result.C, 0); assert.equal(seen.length, 3); assert.ok(seen.some(([n,d]) => n === 'C' && d === 0)); assert.equal(calls.filter(x => x.url.includes('/group/')).length, 0)
    assert.ok(calls.every(x => x.url.includes('timeout=2000') && x.url.includes(encodeURIComponent('https://test.invalid/probe'))));
  })
  await test('测速优先当前节点，最多5个并发；慢节点未完成时已回报快结果，完成后再次点击会重测', async () => {
    const all = Array.from({ length: 20 }, (_, i) => 'priority-' + i), current = all[19]
    const gates = new Map(all.map(n => { let resolve; const promise = new Promise(r => { resolve = r }); return [n, { promise, resolve }] }))
    calls.length = 0; responder = url => { const n = decodeURIComponent(url.split('/proxies/')[1].split('/')[0]); return { wait: gates.get(n).promise, body: { delay: 38 } } }
    let done = false; const seen = [], pending = api.testGroup(c, { name: 'PriorityGroup', now: current, all }, (n, d) => seen.push([n, d])).then(r => { done = true; return r })
    await flush(); assert.equal(calls.length, 5); assert.ok(calls[0].url.includes('/' + current + '/delay'))
    gates.get(current).resolve(); await flush(); assert.deepEqual(seen, [[current, 38]]); assert.equal(done, false); assert.equal(calls.length, 6)
    for (const gate of gates.values()) gate.resolve(); const result = await pending; assert.equal(Object.keys(result).length, 20); assert.equal(seen.length, 20)
    const before = calls.length; await api.testNodes(c, [current]); assert.equal(calls.length, before + 1)
  })
  await test('重叠测速共享在途请求但不跨来源、测速URL、超时或认证共享', async () => {
    let release; const wait = new Promise(r => { release = r }); calls.length = 0
    pref.savePreferences({ testTimeout: 1000 })
    responder = () => ({ wait, body: { delay: 54 } })
    const a = api.testGroup(c, { name: 'ConcurrentGroup', all: ['dedup-node'] }), b = api.testNodes(c, ['dedup-node', 'dedup-node'])
    await flush(); assert.equal(calls.length, 1)
    const source = api.testNodes({ ...c, url: 'http://other-delay-source.invalid' }, ['dedup-node'])
    const originalURL = pref.getPreferences().testURL; pref.savePreferences({ testURL: 'https://other-probe.invalid/204' })
    const url = api.testNodes(c, ['dedup-node'])
    await flush(); assert.equal(calls.length, 3); pref.savePreferences({ testURL: originalURL })
    const original = pref.getPreferences().testTimeout; pref.savePreferences({ testTimeout: original + 100 })
    const timeout = api.testNodes(c, ['dedup-node']); await flush(); assert.equal(calls.length, 4)
    pref.savePreferences({ testTimeout: original })
    const oldSecret = secrets.get('neko_secret_' + c.id); secrets.set('neko_secret_' + c.id, 'mock-delay-auth-change')
    const auth = api.testNodes(c, ['dedup-node']); await flush(); assert.equal(calls.length, 5)
    if (oldSecret === undefined) secrets.delete('neko_secret_' + c.id); else secrets.set('neko_secret_' + c.id, oldSecret)
    release(); for (const p of [a, b, source, url, timeout, auth]) assert.equal((await p)['dedup-node'], 54)
  })
  await test('策略组即使自带testUrl也使用全局测速URL；不修改原始testUrl', async () => {
    pref.savePreferences({ testURL: 'https://test.invalid/probe', testTimeout: 3200 }); calls.length = 0
    responder = () => ({ body: { delay: 23 } })
    await api.testGroup(c, { name: 'G', all: ['A'], testUrl: 'http://1.1.1.1/generate_204' })
    await api.testNodes(c, ['B'])
    assert.ok(calls.length === 2 && calls.every(x => x.url.includes(encodeURIComponent('https://test.invalid/probe')) && !x.url.includes('1.1.1.1')))
    responder = () => ({ body: { proxies: { GLOBAL: { type: 'Selector', all: ['G'], now: 'G' }, G: { type: 'Selector', all: ['A'], now: 'A', testUrl: 'http://1.1.1.1/generate_204' }, A: { type: 'Shadowsocks' } } } })
    assert.equal((await api.loadGroups(c)).find(x => x.name === 'G').testUrl, 'http://1.1.1.1/generate_204'); unmount(); responder = () => ({ status: 204 })
  })
  await test('提供者延迟历史合并、嵌套解析与专用测速接口；所有节点仍用同一个全局URL', async () => {
    pref.savePreferences({ nestedDelay: false, testURL: 'https://global-probe.invalid/204', testTimeout: 5000 })
    const global = { proxies: { GLOBAL: { all: ['Routing'] }, Routing: { name: 'Routing', type: 'Selector', all: ['Nested', 'Leaf / A', 'DIRECT', 'REJECT'], now: 'Nested', testUrl: 'https://group-probe.invalid/204' }, Nested: { type: 'Selector', all: ['Deep'], now: 'Deep', history: [{ delay: 99 }] }, Deep: { type: 'Selector', all: ['Leaf / A'], now: 'Leaf / A' }, DIRECT: { type: 'Direct', history: [{ delay: 10 }] }, REJECT: { type: 'Reject' } } }
    const provided = { providers: { 'Remote / One': { vehicleType: 'HTTP', proxies: [{ name: 'Leaf / A', type: 'Shadowsocks', history: [{ delay: 190 }] }] }, default: { vehicleType: 'Compatible', proxies: [{ name: 'DIRECT', type: 'Direct' }] } } }
    responder = url => ({ body: url.endsWith('/providers/proxies') ? provided : global }); calls.length = 0
    const groups = await api.loadGroups(c), g = groups.find(g => g.name === 'Routing')
    assert.equal(calls.length, 2); assert.equal(g.delays['Leaf / A'], 190); assert.equal(g.delays.Nested, 99)
    assert.equal(g.types.Nested, 'Shadowsocks'); assert.deepEqual(clone(g.testTargets.Nested), { name: 'Leaf / A', provider: 'Remote / One', type: 'Shadowsocks' })
    assert.equal(g.testTargets.DIRECT.provider, undefined); assert.ok(!groups.some(g => g.name === 'Leaf / A'))
    calls.length = 0; responder = () => ({ body: { delay: 35 } }); const seen = []
    const result = await api.testGroup(c, g, (n,d) => seen.push([n,d]))
    assert.equal(result.Nested, 35); assert.equal(result['Leaf / A'], 35); assert.equal(result.DIRECT, 35); assert.equal(result.REJECT, undefined)
    assert.equal(calls.length, 2); assert.ok(calls.some(x => x.url.includes('/providers/proxies/Remote%20%2F%20One/Leaf%20%2F%20A/healthcheck?')))
    assert.ok(calls.some(x => x.url.includes('/proxies/DIRECT/delay?'))); assert.ok(calls.every(x => x.url.includes(encodeURIComponent('https://global-probe.invalid/204')) && x.url.includes('timeout=2000')))
    assert.equal(seen.length, 3); assert.ok(!calls.some(x => x.url.includes('/group/') || x.url.includes('Nested') || x.url.includes('REJECT')))
    // Existing provider history must render without triggering automatic network tests.
    const props = { c: { ...c, id: 'provider-history-ui' }, g: { ...g, name: 'HistoryUI', all: ['Leaf / A'], now: 'Leaf / A' }, onChanged() {} }
    let tree = render(pages.GroupSection, props, true); await flush(); calls.length = 0
    nodes(tree, 'Button').find(n => n.props.frame?.alignment === 'leading').props.action(); render(pages.GroupSection, props); await flush()
    tree = render(pages.GroupSection, props); assert.ok(text(tree).includes('190ms')); assert.equal(calls.length, 0); unmount()
  })
  await test('多个策略组和来源共用5个测速并发，排队请求保留提交时认证且异常回调不会阻塞队列', async () => {
    let release; const wait = new Promise(r => { release = r }); const originalFetch = context.fetch, oldSecret = secrets.get('neko_secret_' + c.id)
    let activeRequests = 0, peak = 0
    context.fetch = async (...args) => { activeRequests++; peak = Math.max(peak, activeRequests); const r = await originalFetch(...args); return { ...r, text: async () => { try { return await r.text() } finally { activeRequests-- } } } }
    try {
      responder = () => ({ wait, body: { delay: 36 } }); calls.length = 0
      const a = api.testGroup(c, { name: 'QueueOne', all: Array.from({ length: 8 }, (_, i) => 'queue-a-' + i) }, () => { throw Error('mock callback') })
      const b = api.testGroup({ ...c, url: 'http://queue-other-source.invalid' }, { name: 'QueueTwo', all: Array.from({ length: 4 }, (_, i) => 'queue-b-' + i) })
      await flush(); assert.equal(calls.length, 5); assert.equal(peak, 5)
      secrets.set('neko_secret_' + c.id, 'mock-changed-while-queued'); release(); const results = await Promise.all([a,b])
      assert.equal(Object.keys(results[0]).length, 8); assert.equal(Object.keys(results[1]).length, 4); assert.equal(calls.length, 12); assert.equal(peak, 5); assert.equal(activeRequests, 0)
      assert.ok(calls.every(x => x.init.headers.Authorization === 'Bearer ' + oldSecret))
    } finally { context.fetch = originalFetch; if (oldSecret === undefined) secrets.delete('neko_secret_' + c.id); else secrets.set('neko_secret_' + c.id, oldSecret) }
  })
  await test('提供者目录不可用时保留普通节点测速；低于2秒的用户超时仍生效', async () => {
    pref.savePreferences({ testTimeout: 1200 })
    responder = url => url.endsWith('/providers/proxies') ? { status: 403 } : { body: { proxies: { G: { type: 'Selector', all: ['Local'], now: 'Local' }, Local: { type: 'Direct', history: [{ delay: 17 }] } } } }
    const g = (await api.loadGroups(c)).find(g => g.name === 'G'); assert.equal(g.delays.Local, 17)
    calls.length = 0; responder = () => ({ status: 504 }); const result = await api.testGroup(c, g)
    assert.equal(result.Local, 0); assert.equal(calls.length, 1); assert.ok(calls[0].url.includes('/proxies/Local/delay?')); assert.ok(calls[0].url.includes('timeout=1200'))
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
  await test('代理配置加载前后保留输入/勾选/开关和状态区尺寸，不靠动画隐藏重排', async () => {
    let release; const wait = new Promise(r => { release = r })
    calls.length = 0
    responder = () => ({ wait, body: { mode: 'rule', port: 80, 'socks-port': 1080, 'mixed-port': 7890, 'redir-port': 0, 'tproxy-port': 0, 'allow-lan': false, ipv6: true, 'bind-address': '*', tun: { enable: false }, 'log-level': 'info' } })
    const check = tree => {
      assert.ok(nodes(tree, 'TextField').every(n => n.props.frame.height === 22))
      assert.equal(nodes(tree, 'ZStack').filter(n => n.props.frame?.width === 20 && n.props.frame?.height === 20).length, 3)
      assert.equal(nodes(tree, 'VStack').filter(n => n.props.frame?.minHeight === 20).length, 1)
      const cards = nodes(tree, 'VStack').filter(n => n.props.background?.props?.cornerRadius === 16)
      assert.equal(cards.length, 5); assert.ok(cards.every(n => n.props.frame.maxWidth === 'infinity'))
    }
    let tree = render(ui.KernelConfigPage, { c }, true); check(tree)
    assert.equal(nodes(tree, 'Toggle').length, 0)
    assert.equal(nodes(tree, 'HStack').filter(n => n.props.frame?.minHeight === 31 && n.props.frame?.maxHeight === 31).length, 3)
    assert.ok(nodes(tree, 'TextField').every(n => n.props.disabled && n.props.value === ''))
    await flush(); check(render(ui.KernelConfigPage, { c })); release(); await flush()
    tree = render(ui.KernelConfigPage, { c }); check(tree)
    assert.equal(nodes(tree, 'Toggle').length, 3); assert.ok(nodes(tree, 'Toggle').every(n => n.props.frame.height === 31))
    assert.equal(nodes(tree, 'TextField')[0].props.value, '7890'); assert.equal(calls.length, 1)
    assert.equal(calls[0].init.method, 'GET'); unmount()
  })
  await test('代理配置输入完成才自动保存，不弹确认且移除底部三块', async () => {
    responder = () => ({ body: { mode: 'rule', 'mixed-port': 7890, 'allow-lan': false } }); calls.length = 0
    const before = confirms.length
    render(ui.KernelConfigPage, { c }, true); await flush(); let tree = render(ui.KernelConfigPage, { c })
    assert.equal(calls.length, 1); assert.equal(calls[0].init.method, 'GET')
    for(const note of ['规则：根据配置规则分流','端口范围 0–65535','TUN 模式可实现透明代理'])assert.ok(!text(tree).includes(note));
    assert.ok(!text(tree).includes('先读取')); assert.ok(!nodes(tree, 'Button').some(n => /保存修改字段|重新读取/.test(n.props.title ?? '')))
    let mixed = nodes(tree, 'TextField').find(n => n.props.title === '混合端口')
    mixed.props.onChanged('789'); mixed.props.onChanged('7892'); assert.equal(calls.length, 1)
    // The previous native render's callback must submit the latest draft.
    mixed.props.onBlur(); await flush(); tree = render(ui.KernelConfigPage, { c })
    assert.equal(calls.length, 2); assert.deepEqual(JSON.parse(calls[1].init.body), { 'mixed-port': 7892 })
    mixed = nodes(tree, 'TextField').find(n => n.props.title === '混合端口'); mixed.props.onSubmit(); await flush(); assert.equal(calls.length, 2)
    assert.equal(confirms.length, before); unmount()
  })
  await test('扩展配置API：五种端口边界、IPv6、绑定地址与仅tun.enable白名单', async () => {
    const valid = { 'redir-port': 0, 'tproxy-port': 65535, ipv6: false, 'bind-address': '::', tun: { enable: true } }
    responder = () => ({}); calls.length = 0
    await api.patchConfig(c, valid); assert.deepEqual(JSON.parse(calls[0].init.body), valid)
    for (const key of ['port', 'socks-port', 'mixed-port', 'redir-port', 'tproxy-port']) {
      for (const value of [0, 65535]) assert.equal(api.validateConfigPatch({ [key]: value })[key], value)
      for (const value of [-1, 65536, 1.5, '', '80', null, undefined]) assert.throws(() => api.validateConfigPatch({ [key]: value }))
    }
    for (const patch of [{ ipv6: 0 }, { ipv6: null }, { 'bind-address': '' }, { 'bind-address': ' ' }, { 'bind-address': 'bad address' }, { 'bind-address': 'http://host' }, { 'bind-address': 'a'.repeat(254) }, { tun: {} }, { tun: { enable: 1 } }, { tun: { enable: false, stack: 'system' } }, { tun: null }, { tun: [] }]) await assert.rejects(() => api.patchConfig(c, patch))
    assert.equal(calls.length, 1)
    for (const address of ['*', '0.0.0.0', '::', '127.0.0.1']) assert.equal(api.validateConfigPatch({ 'bind-address': address })['bind-address'], address)
  })
  await test('代理配置布局灰卡片、彩色线框与模式/网络/TUN/中文日志即时保存', async () => {
    const cfg = { mode: 'rule', port: 80, 'socks-port': 1080, 'mixed-port': 7890, 'redir-port': 0, 'tproxy-port': 65535, 'allow-lan': false, ipv6: true, 'bind-address': '*', tun: { enable: false, stack: 'mixed', mtu: 9000 }, 'log-level': 'info' }
    responder = () => ({ body: cfg }); calls.length = 0; const before = confirms.length
    render(ui.KernelConfigPage, { c }, true); await flush(); let tree = render(ui.KernelConfigPage, { c })
    assert.equal(tree.type, 'ScrollView'); assert.equal(tree.props.navigationTitle, '代理配置'); assert.equal(tree.props.background, 'systemBackground')
    assert.deepEqual(nodes(tree, 'TextField').map(n => n.props.title), ['混合端口', 'HTTP 端口', 'SOCKS5 端口', '透明代理端口', 'TProxy 端口', '绑定地址'])
    assert.deepEqual(nodes(tree, 'TextField').map(n => n.props.value), ['7890', '80', '1080', '0', '65535', '*'])
    assert.deepEqual(nodes(tree, 'Toggle').map(n => n.props.value), [false, true, false])
    for (const [name, color] of [['wifi','systemBlue'], ['number','systemPurple'], ['link','systemGreen'], ['shield','systemPurple'], ['doc.text','systemGray']]) {
      const icon = nodes(tree, 'Image').find(n => n.props.systemName === name); assert.equal(icon.props.foregroundStyle, color); assert.equal(icon.props.background, undefined)
    }
    assert.ok(nodes(tree, 'TextField').every(n => n.props.background.style.light === '#E5E5EA'))
    const cards = nodes(tree, 'VStack').filter(n => n.props.background?.props?.cornerRadius === 16)
    assert.equal(cards.length, 5); assert.ok(cards.every(n => n.props.background.props.fill.light === '#F2F2F7' && n.props.background.props.fill.dark === '#1C1C1E'))
    assert.equal(nodes(button(tree, '规则模式'), 'Image')[0].props.foregroundStyle, 'systemBlue')
    const actions = [
      [() => button(tree, '全局模式').props.action(), { mode: 'global' }],
      [() => nodes(tree, 'Toggle').find(n => n.props.title === 'IPv6').props.onChanged(false), { ipv6: false }],
      [() => nodes(tree, 'Toggle').find(n => n.props.title === '允许局域网连接').props.onChanged(true), { 'allow-lan': true }],
      [() => nodes(tree, 'Toggle').find(n => n.props.title === 'TUN 模式').props.onChanged(true), { tun: { enable: true } }],
      [() => button(nodes(tree, 'Menu')[0], '调试').props.action(), { 'log-level': 'debug' }],
    ]
    for (const [action, patch] of actions) { action(); await flush(); assert.deepEqual(JSON.parse(calls.at(-1).init.body), patch); tree = render(ui.KernelConfigPage, { c }) }
    assert.deepEqual(clone(hooks[0].current.cfg.tun), { enable: true, stack: 'mixed', mtu: 9000 })
    assert.equal(confirms.length, before); assert.equal(calls.length, 6); unmount()
  })
  await test('代理配置缺失字段无假默认：缺失开关显示未提供、输入禁用、不可写回', async () => {
    for (const cfg of [{}, { tun: { stack: 'system' } }]) {
      responder = () => ({ body: cfg }); calls.length = 0
      render(ui.KernelConfigPage, { c }, true); await flush(); let tree = render(ui.KernelConfigPage, { c })
      assert.equal(nodes(tree, 'Toggle').length, 0); assert.match(text(tree), /未提供/)
      assert.ok(nodes(tree, 'TextField').every(n => n.props.value === '' && n.props.disabled))
      for (const title of ['规则模式', '全局模式', '直连模式']) assert.equal(button(tree, title).props.disabled, true)
      assert.equal(nodes(tree, 'Menu')[0].props.disabled, true)
      assert.equal(nodes(tree, 'Image').filter(n => n.props.systemName === 'checkmark').length, 0)
      const field = nodes(tree, 'TextField')[0]; field.props.onChanged('1234'); field.props.onBlur(); button(tree, '规则模式').props.action(); button(nodes(tree, 'Menu')[0], '调试').props.action()
      await flush(); assert.equal(calls.length, 1)
    }
    unmount()
  })
  await test('代理配置五端口/绑定地址完成校验、无变化不写，失败留稿再次结束编辑重试', async () => {
    const cfg = { port: 80, 'socks-port': 1080, 'mixed-port': 7890, 'redir-port': 0, 'tproxy-port': 0, ipv6: false, 'bind-address': '*' }
    responder = () => ({ body: cfg }); calls.length = 0
    render(ui.KernelConfigPage, { c }, true); await flush(); let tree = render(ui.KernelConfigPage, { c })
    for (const title of ['混合端口', 'HTTP 端口', 'SOCKS5 端口', '透明代理端口', 'TProxy 端口']) {
      const field = nodes(tree, 'TextField').find(n => n.props.title === title), original = field.props.value
      for (const bad of ['', ' ', '-1', '65536', '1.5', 'abc']) {
        field.props.onChanged(bad); field.props.onBlur(); await flush(); tree = render(ui.KernelConfigPage, { c })
        assert.match(text(tree), /0–65535/); assert.equal(calls.length, 1); assert.equal(nodes(tree, 'TextField').find(n => n.props.title === title).props.value, bad)
      }
      field.props.onChanged(original); field.props.onSubmit(); await flush(); tree = render(ui.KernelConfigPage, { c }); assert.equal(calls.length, 1)
    }
    const address = nodes(tree, 'TextField').find(n => n.props.title === '绑定地址')
    for (const bad of ['', ' ', 'bad address']) {
      address.props.onChanged(bad); address.props.onSubmit(); await flush(); tree = render(ui.KernelConfigPage, { c }); assert.match(text(tree), /绑定地址无效/); assert.equal(calls.length, 1)
    }
    address.props.onChanged('*'); address.props.onBlur(); await flush(); assert.equal(calls.length, 1)
    const port = nodes(tree, 'TextField').find(n => n.props.title === 'HTTP 端口')
    responder = () => ({ status: 500 }); port.props.onChanged('0'); port.props.onBlur(); await flush(); tree = render(ui.KernelConfigPage, { c })
    assert.match(text(tree), /保存失败/); assert.equal(nodes(tree, 'TextField').find(n => n.props.title === 'HTTP 端口').props.value, '0')
    responder = () => ({}); port.props.onSubmit(); await flush(); assert.deepEqual(JSON.parse(calls.at(-1).init.body), { port: 0 })
    tree = render(ui.KernelConfigPage, { c }); assert.ok(!text(tree).includes('保存失败'))
    address.props.onChanged('::'); assert.equal(calls.length, 3); address.props.onBlur(); await flush(); assert.deepEqual(JSON.parse(calls.at(-1).init.body), { 'bind-address': '::' })
    const transparent = nodes(tree, 'TextField').find(n => n.props.title === '透明代理端口'); transparent.props.onChanged('65535'); transparent.props.onSubmit(); await flush(); assert.deepEqual(JSON.parse(calls.at(-1).init.body), { 'redir-port': 65535 }); unmount()
  })
  await test('代理配置连续修改串行合并不丢更新，在途响应不覆盖新输入草稿', async () => {
    let release; const wait = new Promise(resolve => { release = resolve }); let patches = 0
    responder = (_u, init) => init.method === 'PATCH' ? (++patches === 1 ? { wait } : {}) : { body: { mode: 'rule', ipv6: false, port: 80, tun: { enable: false, mtu: 9000 } } }
    calls.length = 0; render(ui.KernelConfigPage, { c }, true); await flush(); let tree = render(ui.KernelConfigPage, { c })
    button(tree, '全局模式').props.action(); button(tree, '直连模式').props.action(); button(tree, '规则模式').props.action()
    nodes(tree, 'Toggle').find(n => n.props.title === 'IPv6').props.onChanged(true)
    await flush(); assert.equal(calls.filter(n => n.init.method === 'PATCH').length, 1)
    tree = render(ui.KernelConfigPage, { c }); assert.equal(nodes(tree, 'Toggle')[0].props.disabled, false)
    release(); await flush(); tree = render(ui.KernelConfigPage, { c })
    const writes = calls.filter(n => n.init.method === 'PATCH').map(n => JSON.parse(n.init.body))
    assert.deepEqual(writes, [{ mode: 'global' }, { mode: 'rule', ipv6: true }]); assert.equal(hooks[0].current.cfg.mode, 'rule')
    const pending = new Promise(resolve => { release = resolve }); responder = () => ({ wait: pending })
    const port = nodes(tree, 'TextField').find(n => n.props.title === 'HTTP 端口')
    port.props.onChanged('81'); port.props.onBlur(); port.props.onChanged('82'); release(); await flush(); tree = render(ui.KernelConfigPage, { c })
    assert.equal(nodes(tree, 'TextField').find(n => n.props.title === 'HTTP 端口').props.value, '82'); assert.equal(hooks[0].current.cfg.port, 81)
    const before = calls.length; responder = () => ({}); port.props.onSubmit(); port.props.onBlur(); await flush()
    assert.equal(calls.length, before + 1); assert.equal(hooks[0].current.cfg.port, 82); unmount()
  })
  await test('代理配置即时控件失败仍留草稿、可重选重试且连续TUN切换只保留最新值', async () => {
    responder = (_u, init) => init.method === 'PATCH' ? { status: 500 } : { body: { mode: 'rule', tun: { enable: false, stack: 'system' } } }
    calls.length = 0; const before = confirms.length
    render(ui.KernelConfigPage, { c }, true); await flush(); let tree = render(ui.KernelConfigPage, { c })
    button(tree, '全局模式').props.action(); await flush(); tree = render(ui.KernelConfigPage, { c })
    assert.match(text(tree), /保存失败/); assert.equal(nodes(button(tree, '全局模式'), 'Image')[0].props.systemName, 'checkmark')
    responder = () => ({}); button(tree, '全局模式').props.action(); await flush(); tree = render(ui.KernelConfigPage, { c }); assert.ok(!text(tree).includes('保存失败'))
    let release; const wait = new Promise(resolve => { release = resolve }); let first = true
    responder = () => { if (first) { first = false; return { wait } } return {} }
    const toggle = nodes(tree, 'Toggle')[0]
    toggle.props.onChanged(true); toggle.props.onChanged(false); toggle.props.onChanged(true); await flush()
    const writes = calls.filter(n => n.init.method === 'PATCH').length
    release(); await flush(); assert.equal(calls.filter(n => n.init.method === 'PATCH').length, writes)
    assert.deepEqual(clone(hooks[0].current.cfg.tun), { enable: true, stack: 'system' }); assert.equal(confirms.length, before); unmount()
  })
  await test('代理配置来源切换/离页隔离旧GET、PATCH、排队操作及原生回调', async () => {
    let release; let waiting = new Promise(resolve => { release = resolve })
    const other = { ...c, url: 'http://other.invalid:9090' }
    responder = u => u.includes('other.invalid') ? { body: { mode: 'direct', port: 90 } } : { body: { mode: 'rule', port: 80 }, wait: waiting }
    calls.length = 0; render(ui.KernelConfigPage, { c }, true); await flush()
    render(ui.KernelConfigPage, { c: other }); await flush(); release(); await flush()
    let tree = render(ui.KernelConfigPage, { c: other }); assert.equal(nodes(tree, 'TextField').find(n => n.props.title === 'HTTP 端口').props.value, '90')
    waiting = new Promise(resolve => { release = resolve }); responder = (_u, init) => init.method === 'PATCH' ? { wait: waiting } : { body: { mode: 'rule', port: 80 } }
    render(ui.KernelConfigPage, { c }, true); await flush(); const old = render(ui.KernelConfigPage, { c })
    button(old, '全局模式').props.action(); button(old, '直连模式').props.action(); await flush()
    const count = calls.length; render(ui.KernelConfigPage, { c: other }); await flush()
    button(old, '规则模式').props.action(); const field = nodes(old, 'TextField').find(n => n.props.title === 'HTTP 端口'); field.props.onChanged('123'); field.props.onSubmit()
    release(); await flush(); assert.equal(calls.length, count + 1)
    assert.equal(hooks[0].current.cfg.mode, 'rule'); assert.equal(hooks[0].current.cfg.port, 80)
    const latest = render(ui.KernelConfigPage, { c: other }), before = calls.length; unmount(); button(latest, '全局模式').props.action(); await flush(); assert.equal(calls.length, before)
    responder = () => ({ status: 500 }); render(ui.KernelConfigPage, { c }, true); await flush(); tree = render(ui.KernelConfigPage, { c }); assert.match(text(tree), /读取内核配置失败/); assert.ok(nodes(tree, 'TextField').every(n => n.props.disabled)); unmount()
  })
  await test('设置子页Form统一原生白底，隐藏分组滚动背景且保留主题适配', () => {
    const src = fs.readFileSync(path.join(root, 'settings-ui.tsx'), 'utf8')
    const forms = src.match(/<Form\b[^>]*>/g)
    assert.equal(forms.length, 4)
    assert.ok(forms.every(form => form.includes('background="systemBackground"') && form.includes('scrollContentBackground="hidden"')))
  })
  await test('日志设置移到运行日志顶部，保留已存值及保存行为，全局配置不再重复', () => {
    const before = pref.getPreferences()
    pref.savePreferences({ logLimit: 700, detailedAPI: false })
    let tree = render(ui.GlobalConfigPage, { active: null }, true)
    assert.ok(!text(tree).includes('运行日志')); assert.ok(!nodes(tree, ui.Range).some(n => n.props.title === '最大记录条数'))
    tree = render(ui.LogsPage, {}, true)
    const first = nodes(tree, 'Section')[0]
    assert.equal(text(first.props.header), '运行日志设置')
    const range = nodes(first, ui.Range)[0], toggle = nodes(first, 'Toggle')[0]
    assert.equal(range.props.value, 700); assert.equal(range.props.min, 100); assert.equal(range.props.max, 2000); assert.equal(range.props.step, 100)
    assert.equal(toggle.props.title, '记录详细 API 请求'); assert.equal(toggle.props.value, false)
    range.props.onChanged(900); toggle.props.onChanged(true)
    assert.equal(pref.getPreferences().logLimit, 900); assert.equal(pref.getPreferences().detailedAPI, true)
    unmount(); pref.savePreferences(before)
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
    const src = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8'); assert.ok(src.includes('function WrtInterfacesPage')); assert.ok(src.includes('function WrtLeasesPage')); assert.ok(src.includes('sheet='))
  })
  await test('默认界面选择tab；主题与外观项接入、概览数据布局不变', () => {
    pref.savePreferences({ defaultPage: 'rules', theme: 'dark', showWrt: false })
    let tree = render(app.OverviewPage, { active: c, version: 0, onSwitch() {} }, true); assert.equal(tree.props.navigationDestination, undefined)
    assert.equal(nodes(tree,home.HomeDashboard).length,1);assert.equal(tree.props.sheet.isPresented,false)
    const dashboard=render(home.HomeDashboard,{overview:null,histories:metrics.newHistory(),running:false,onCpu(){}},true)
    assert.equal(nodes(dashboard,home.CpuCard).length,1);assert.equal(nodes(dashboard,home.TrafficCard).length,2);assert.equal(nodes(dashboard,home.RamCard).length,1);assert.equal(nodes(dashboard,home.LoadCard).length,1);assert.equal(nodes(dashboard,home.DiskCard).length,1)
    const appearance = render(app.AppearanceRoot, {}, true); assert.equal(appearance.props.preferredColorScheme, 'dark'); tree = render(app.Root, {}, true); assert.equal(nodes(tree,'TabView')[0].props.selection.value, 'rules'); assert.equal(nodes(tree, app.RulesPage).length, 1)
    tree = render(ui.GlobalConfigPage, { active: null }, true); assert.ok(!text(tree).includes('应用图标')); assert.ok(!nodes(tree, 'Toggle').some(n => n.props.title === '自定义代理组图标'))
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
    assert.equal(tree.props.children.length,5);assert.ok(tree.props.children.every(n=>n.type==='Tab'));assert.ok(nodes(tree,'NavigationStack').every(n=>n.props.tabItem===undefined))
    assert.deepEqual(tabs.map(t => t.props.title), ['主页', '代理', '规则', '连接', '更多'])
    assert.deepEqual(tabs.map(t=>t.props.systemImage),['apple.homekit','network','shuffle','arrowshape.zigzag.forward','square.split.2x2'])
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
    assert.equal(api.VERSION, '1.5.195'); assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'script.json'))).version, api.VERSION)
  })
  await test('独立导航栈保留业务owner和身份，只有选中页提供可见工具栏', () => {
    pref.savePreferences({ defaultPage: 'overview' })
    let rootTree = render(app.Root, {}, true)
    const pagesByTab = { home: app.OverviewPage, proxies: app.ProxiesPage, rules: app.RulesPage, connections: app.ConnectionsPage, more: app.MorePage }
    const commands = { home: ['面板管理','外观设置','全局配置'], proxies: [], rules: ['搜索规则','刷新规则','全部更新'], connections: ['搜索连接','暂停监控','客户端标签','清理已断开连接','打断全部连接'] }
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
        const lazy=['proxies','rules','connections'].includes(id); if(lazy&&id!==selected){assert.equal(children.length,0);continue}
        assert.equal(children.length,1); assert.equal(children[0].props.selected, id === selected)
        if(id!==selected) continue
        assert.equal(children.length,1);assert.equal(children[0].type,pagesByTab[id]);assert.ok(children[0].props.key.startsWith(id+':'))
        let page=inspectPage(children[0]);if(id==='more')page=inspectPage(page);const owners=[]
        function scan(n){if(!n||typeof n!=='object')return;if(n.props?.toolbar)owners.push(n);for(const child of n.props?.children??[])scan(child)}
        scan(page);assert.equal(owners.length,1)
        const toolbar=owners[0].props.toolbar;assert.equal(toolbar.type,undefined)
        assert.deepEqual(Object.keys(toolbar),id==='home'?['topBarLeading','topBarTrailing','principal']:['topBarLeading','topBarTrailing'])
        if(id==='home'){assert.ok(text(toolbar.principal).includes(children[0].props.active?.name||'OpenWrt 状态'));assert.ok(/运行正常|连接中|连接失败/.test(text(toolbar.principal)));assert.ok(!/运行正常|连接中|连接失败/.test(text(page.props.children)))}
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
    const management=render(pages.ManagementPage,{c,kind:'profile'},true);assert.equal(nodes(management.props.toolbar,'Button').filter(n=>n.props.systemImage==='xmark').length,0)
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
      const before = calls.length, beforeParts = nodes(tree, home.HomeDashboard)[0].props.overview?.wrt.memTotal
      const beforeUptime = nodes(tree, home.HomeDashboard)[0].props.overview?.wrt.uptime
      await polling()[0].fn(); await flush(); assert.ok(calls.length > before)
      const updated = render(app.OverviewPage, props)
      assert.ok(nodes(updated, home.HomeDashboard)[0].props.overview?.wrt.memTotal)
      assert.notEqual(nodes(updated, home.HomeDashboard)[0].props.overview?.wrt.uptime, beforeUptime)
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
    assert.equal(Array.isArray(o.wrt.cpus),true);assert.equal(o.wrt.cpus[0].system,25);assert.equal(o.wrt.cpus[0].user,25)

  })
  await test('1.5.46 图标地址：路径中的@允许，查询串/片段/用户信息仍拒绝', async () => {
    responder = () => ({ body: {}, contentType: 'image/png' })
    assert.ok(await pref.cachedIcon('https://fastly.jsdelivr.net/gh/Koolson/Qure@master/IconSet/Color/Emby.png'))
    for (const u of ['http://x.invalid/a.png', 'https://x.invalid/a.png?k=1', 'https://x.invalid/a.png#f', 'https://user:pw@x.invalid/a.png']) assert.equal(await pref.cachedIcon(u), null)
    const src = fs.readFileSync(path.join(root, 'index.tsx'), 'utf8'); assert.ok(src.includes('navigationTitle={active.name}')); assert.ok(src.includes('运行正常'))
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
  await test('Nikki管理：UCI/file真实解析，URL仅供界面使用、不持久化' , async () => {
    const n={...c,id:'nikki-tests',kind:'openwrt',plugin:'nikki',url:'http://nikki.invalid'}
    responder=(url,init)=>{const req=JSON.parse(init.body),obj=req.params[1],method=req.params[2];return {body:{result:[0,obj==='session'?{ubus_rpc_session:'private-session'}:obj==='uci'&&method==='changes'?{changes:[]}:obj==='uci'&&req.params[3].section?{values:{'.type':'subscription'}}:obj==='uci'?{values:{config:{profile:'file:actual.yaml'},mixin:{rule:'1'},s1:{'.type':'subscription','.name':'s1',name:'Real',url:'https://secret.invalid/?key=do-not-store',update:'2026'},r1:{'.type':'rule','.name':'r1',type:'DOMAIN',matcher:'domain.invalid',node:'DIRECT',enabled:'1'}}}:obj==='file'?{entries:[{name:'actual.yaml',type:'file',size:55},{name:'directory.yaml',type:'directory'}]}:method==='update_subscription'?{success:true}:{app:'v-test',core:'mihomo-test'}]}}}
    const d=await api.loadNikkiManagement(n);assert.equal(d.files.length,2);assert.equal(d.profile,'file:actual.yaml');assert.equal(d.subscriptions[0].id,'s1');assert.equal(d.rules[0].matcher,'domain.invalid');assert.equal(d.subscriptions[0].url,'https://secret.invalid/?key=do-not-store');assert.ok(!JSON.stringify([...store.values()]).includes('do-not-store'))
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
  await test('编辑OpenWrt返回自动保存最新本地草稿、凭证仍入Keychain且无连接测试', async () => {
    const initial=api.saveController({name:'Local edit',host:'old-edit.invalid',port:80,https:false,username:'root',plugin:'openclash',auto:false,cport:9090},'old-edit-password','old-edit-secret');let completed=0,dismissed=0;const originalDismiss=scripting.Navigation.useDismiss;scripting.Navigation.useDismiss=()=>()=>{dismissed++}
    try{const props={initial,onDone(){completed++;assert.equal(api.listControllers().find(c=>c.id===initial.id).host,'new-edit.invalid')}};let tree=render(app.EditController,props,true);assert.equal(tree.props.navigationBarBackButtonHidden,undefined);assert.equal(tree.props.toolbar,undefined);assert.ok(tree.props.onDisappear);const fields=nodes(tree,'TextField'),secure=nodes(tree,'SecureField');const field=title=>fields.find(f=>f.props.title===title);field('名称').props.onChanged('Edited without rerender');field('地址').props.onChanged('new-edit.invalid');field('用户名').props.onChanged('admin');field('控制器端口').props.onChanged('9191');nodes(tree,'Toggle').find(t=>t.props.title==='启用 SSL (HTTPS)').props.onChanged(true);nodes(tree,'Picker')[0].props.onChanged('nikki');secure[0].props.onChanged('return-password-only-keychain');secure[1].props.onChanged('return-secret-only-keychain');calls.length=0
      await tree.props.onDisappear();const saved=api.listControllers().find(c=>c.id===initial.id);assert.equal(saved.name,'Edited without rerender');assert.equal(saved.url,'https://new-edit.invalid');assert.equal(saved.username,'admin');assert.equal(saved.plugin,'nikki');assert.equal(saved.cport,9191);assert.equal(api.getSecret(initial.id),'return-password-only-keychain');assert.equal(api.getClashSecret(initial.id),'return-secret-only-keychain');assert.ok(!JSON.stringify([...store]).includes('return-password-only-keychain'));assert.ok(!JSON.stringify([...store]).includes('return-secret-only-keychain'));assert.equal(completed,1);assert.equal(dismissed,0);assert.equal(calls.length,0)
    }finally{scripting.Navigation.useDismiss=originalDismiss;unmount();api.removeController(initial.id)}
  })
  await test('编辑OpenWrt校验失败留在页面不覆盖旧设置；帮助/卸载/后台不触发保存', async () => {
    const initial=api.saveController({name:'Validation edit',host:'validation-edit.invalid',port:80,https:false,username:'root',plugin:'nikki',auto:true,cport:9090},'validation-old-password','validation-old-secret');let completed=0;const props={initial,onDone(){completed++}};let tree=render(app.EditController,props,true);const before=JSON.stringify([...store]),credentials=JSON.stringify([...secrets]);nodes(tree,'TextField').find(f=>f.props.title==='地址').props.onChanged('');calls.length=0;await tree.props.onDisappear();tree=render(app.EditController,props);assert.ok(text(tree).includes('请填写路由器地址'));assert.equal(completed,0);assert.equal(JSON.stringify([...store]),before);assert.equal(JSON.stringify([...secrets]),credentials);nodes(tree,'TextField').find(f=>f.props.title==='地址').props.onChanged('repaired-edit.invalid');nodes(tree,'TextField').find(f=>f.props.title==='端口').props.onChanged('99999');await tree.props.onDisappear();tree=render(app.EditController,props);assert.ok(text(tree).includes('端口无效'));assert.equal(JSON.stringify([...store]),before);nodes(tree,'TextField').find(f=>f.props.title==='端口').props.onChanged('8080');await tree.props.onDisappear();assert.equal(completed,1);assert.equal(api.listControllers().find(c=>c.id===initial.id).url,'http://repaired-edit.invalid:8080');assert.equal(calls.length,0)
    tree=render(app.EditController,props,true);nodes(tree,'TextField')[0].props.onChanged('Unsaved draft');const stable=JSON.stringify([...store]);assert.ok(tree.props.onDisappear);assert.equal(tree.props.onAppear,undefined);assert.ok(nodes(tree,'NavigationLink').some(l=>l.props.destination.type.name==='HelpPage'));unmount();assert.equal(JSON.stringify([...store]),stable);api.removeController(initial.id)
  })
  await test('添加OpenWrt同样返回自动保存，无右上保存按钮', () => {
    const tree=render(app.EditController,{onDone(){}},true);assert.equal(tree.props.navigationTitle,'添加 OpenWrt');assert.equal(tree.props.toolbar,undefined);assert.ok(tree.props.onDisappear);unmount()
  })
  await test('MorePanel函数组件边界不用padding业务prop，内部12pt链不变（结构检查，非宿主验收）', () => {
    for(const active of [c,{...c,kind:'openwrt',plugin:'nikki'}]){
      const tree=render(pages.MorePage,{active,selected:false,onChanged(){}},true),boundaries=[]
      // Deliberately do NOT call unwrap: it discards custom-component boundary props.
      function visit(node){if(!node||typeof node!=='object')return;if(typeof node.type==='function'&&node.type.name==='MorePanel')boundaries.push(node);for(const child of node.props?.children??[])visit(child)}
      visit(tree);assert.equal(boundaries.length,7);assert.ok(boundaries.every(n=>!Object.prototype.hasOwnProperty.call(n.props,'padding')));assert.deepEqual(boundaries.map(n=>n.props.contentInset),[16,undefined,undefined,12,12,undefined,undefined])
      for(const boundary of boundaries.filter(n=>n.props.contentInset===12)){const native=boundary.type(boundary.props);assert.equal(native.type,'VStack');assert.equal(native.props.alignment,'leading');assert.equal(native.props.padding,undefined);const steps=native.props.modifiers.steps;assert.deepEqual(steps.map(s=>s[0]),['padding','frame','background']);assert.equal(steps[0][1],12);assert.deepEqual(clone(steps[1][1]),{minWidth:0,maxWidth:'infinity',alignment:'leading'});assert.equal(steps[2][1].props.cornerRadius,14);assert.equal(steps[2][1].props.fill,'secondarySystemBackground')}
      unmount()
    }
  })
  await test('非主页四页标题使用基本信息名称，更多分组与图示入口完整', () => {
    for(const name of ['P320','另一个设备']) for(const Page of [pages.ProxiesPage,pages.RulesPage,pages.ConnectionsPage,pages.MorePage]) {
      const tree=render(Page,{active:{...c,name},version:0,selected:false,onChanged(){}},true)
      assert.equal(tree.props.navigationTitle,name)
    }
    const tree=render(pages.MorePage,{active:{...c,name:'P320'},selected:false,onChanged(){}},true)
    assert.equal(tree.props.background,'systemBackground')
    for(const title of ['运行信息','内核版本','插件版本','核心配置','代理配置','快捷管理','配置管理','订阅管理','附加规则','服务管理','核心操作','DNS 工具','域名查询'])assert.ok(text(tree).includes(title),title)
    const tiles=nodes(tree,'VStack').filter(n=>n.props.modifiers?.steps?.some(s=>s[0]==='background'&&s[1]?.props?.cornerRadius===9))
    assert.equal(tiles.length,3);assert.ok(tiles.every(n=>n.props.modifiers.steps[0][1].maxWidth==='infinity'))
    // Inspect explicit order, not just identical maxWidth props (which missed the 12pt inset).
    const allPanels=nodes(tree,'VStack').filter(n=>[n.props.background,...(n.props.modifiers?.steps??[]).filter(s=>s[0]==='background').map(s=>s[1])].some(bg=>bg?.props?.cornerRadius===14&&bg.props.fill==='secondarySystemBackground'))
    assert.equal(allPanels.length,7)
    const panels=allPanels.slice(1);assert.equal(panels.length,6)
    for(const panel of [panels[0],panels[1],panels[4],panels[5]]){assert.equal(panel.props.modifiers,undefined);assert.equal(panel.props.padding,undefined);assert.deepEqual(clone(panel.props.frame),{maxWidth:'infinity',alignment:'leading'})}
    // Scoped proposal/response derivation for ONLY these three modifiers; not a native renderer.
    // Pure model assumption: calls wrap inside -> outside. No host/component-boundary semantics are proved.
    function panelWidth(steps,proposal,intrinsic){let painted,contentProposal;function layout(i,width){if(i<0){contentProposal=width;return Math.min(width,intrinsic)}const [kind,value]=steps[i];if(kind==='padding')return layout(i-1,width-2*value)+2*value;if(kind==='frame'){assert.equal(value.minWidth,0);assert.equal(value.maxWidth,'infinity');layout(i-1,width);return width}if(kind==='background'){const reported=layout(i-1,width);painted=reported;return reported}throw Error('unexpected panel modifier: '+kind)}return {reported:layout(steps.length-1,proposal),painted,contentProposal}}
    for(const [index,panel] of [[2,panels[2]],[3,panels[3]]]){const steps=panel.props.modifiers.steps;assert.deepEqual(steps.map(s=>s[0]),['padding','frame','background']);assert.equal(steps[0][1],12);assert.deepEqual(clone(steps[1][1]),{minWidth:0,maxWidth:'infinity',alignment:'leading'});assert.equal(steps[2][1].props.cornerRadius,14);assert.equal(steps[2][1].props.fill,'secondarySystemBackground');assert.equal(panel.props.padding,undefined);assert.equal(panel.props.frame,undefined);assert.equal(panel.props.background,undefined);assert.equal(panel.props.spacing,index===2?0:8)
      for(const width of [320,374,430])for(const intrinsic of [100,width,1000]){const result=panelWidth(steps,width,intrinsic);assert.equal(result.reported,width);assert.equal(result.painted,width);assert.equal(result.contentProposal,width-24)}
      // Model-only counterexample: background inside padding paints 24pt narrower despite full outer frame.
      const wrong=[steps[1],steps[2],steps[0]],result=panelWidth(wrong,374,1000);assert.equal(result.reported,374);assert.equal(result.painted,350);assert.equal((374-result.painted)/2,12)
    }
    const quickLinks=nodes(panels[2],'NavigationLink');assert.equal(quickLinks.length,3);assert.ok(quickLinks.every(l=>l.props.frame.minWidth===0&&l.props.frame.maxWidth==='infinity'));assert.deepEqual(clone(tiles.map(t=>t.props.modifiers.steps[0][1])),Array(3).fill({minWidth:0,maxWidth:'infinity',minHeight:88,maxHeight:88,alignment:'center'}))
    for(const tile of tiles){assert.deepEqual(tile.props.modifiers.steps.map(s=>s[0]),['frame','background']);assert.equal(tile.props.modifiers.steps[1][1].props.fill,'tertiarySystemGroupedBackground');assert.equal(tile.props.padding,undefined);assert.equal(tile.props.alignment,'center');const image=nodes(tile,'Image')[0],label=nodes(tile,'Text')[0];assert.deepEqual(clone(image.props.frame),{width:28,height:28,alignment:'center'});assert.deepEqual(clone(label.props.frame),{height:18,alignment:'center'});assert.equal(label.props.lineLimit,1)}
    assert.deepEqual(tiles.map(t=>nodes(t,'Image')[0].props.systemName),['gearshape','icloud.and.arrow.down','list.bullet']);assert.deepEqual(tiles.map(t=>nodes(t,'Image')[0].props.foregroundStyle),['systemOrange','systemIndigo','systemPurple'])
    assert.deepEqual(tiles.map(t=>text(t).trim()),['配置管理','订阅管理','附加规则'])
    assert.ok(!text(tree).includes('网页访问'));assert.ok(!tiles.some(t=>text(t).includes('运行日志')))
    assert.ok(!nodes(tree,'NavigationLink').some(l=>l.props.destination?.type===pages.ManagementPage&&l.props.destination?.props.kind==='log'))
    assert.ok(!nodes(tree,'NavigationLink').some(l=>l.props.destination?.type===ui.LogsPage));for(const removed of ['全局配置','设置（控制器管理）','脚本安全日志'])assert.ok(!text(tree).includes(removed));const wrapper=render(app.MorePage,{active:c,selected:false,onChanged(){}},true);assert.equal(wrapper.props.settings,undefined)
    const service=nodes(tree,'Button').filter(b=>['启动','停止','重启','重载'].includes(text(b).trim()))
    assert.equal(service.length,4);assert.ok(service.every(b=>b.props.disabled));assert.ok(service.every(b=>nodes(b,'Image')[0].props.background.type==='Circle'))
    assert.ok(nodes(tree,'Divider').length>=5)
    const links=nodes(tree,'NavigationLink');assert.ok(links.some(l=>l.props.destination.type===ui.KernelConfigPage));assert.ok(links.some(l=>l.props.destination.type===pages.DNSPage))
    assert.equal(nodes(tree,'Tab').length,0);unmount()
  })
  await test('版本数据：真实接口结构、请求先后顺序、单路失败及Nikki兜底', async () => {
    unmount()
    const n={...c,id:'runtime-versions',kind:'openwrt',plugin:'nikki',host:'runtime.invalid',url:'http://runtime.invalid',auto:false,cport:9090}
    let direct={version:'live-core'},local={app:'1.26.2',core:'alpha-94b13ae'},directFailed=false,localFailed=false,waitFor='',release
    responder=(url,init)=>{
      if(url.endsWith('/ubus')){const p=JSON.parse(init.body).params;if(p[1]==='session')return {body:{result:[0,{ubus_rpc_session:'runtime-session'}]}};if(localFailed)return {status:500};return {body:{result:[0,local]},...(waitFor==='local'?{wait:new Promise(r=>{release=r})}:{})}}
      if(directFailed)return {status:500};return {body:direct,...(waitFor==='direct'?{wait:new Promise(r=>{release=r})}:{})}
    }
    for(const delayed of ['local','direct']){waitFor=delayed;const pending=api.loadRuntimeVersions(n);await flush();assert.equal(typeof release,'function');release();const v=await pending;assert.deepEqual(clone(v),{core:'live-core',app:'1.26.2',failed:false})}
    waitFor='';directFailed=true;assert.deepEqual(clone(await api.loadRuntimeVersions(n)),{core:'alpha-94b13ae',app:'1.26.2',failed:false})
    directFailed=false;local={};assert.deepEqual(clone(await api.loadRuntimeVersions(n)),{core:'live-core',app:'未提供',failed:true})
    localFailed=true;assert.equal((await api.loadRuntimeVersions(n)).core,'live-core')
    directFailed=true;assert.deepEqual(clone(await api.loadRuntimeVersions(n)),{core:'未提供',app:'未提供',failed:true})
    directFailed=false;localFailed=false;direct={version:'plain-core'};calls.length=0;assert.deepEqual(clone(await api.loadRuntimeVersions(c)),{core:'plain-core',app:'不适用',failed:false});assert.ok(calls.every(x=>!x.url.endsWith('/ubus')))
  })
  await test('更多版本行单独保留数值空间，白底及子页背景不使用分组灰底', async () => {
    const n={...c,id:'runtime-visible',kind:'openwrt',plugin:'nikki',host:'runtime-ui.invalid',url:'http://runtime-ui.invalid',auto:false,cport:9090}
    responder=(url,init)=>{if(url.endsWith('/ubus')){const p=JSON.parse(init.body).params;return {body:{result:[0,p[1]==='session'?{ubus_rpc_session:'runtime-ui-session'}:p[2]==='version'?{app:'1.26.2',core:'alpha-94b13ae'}:{}]}}}return {body:url.endsWith('/version')?{version:'alpha-94b13ae'}:{mode:'rule'}}}
    render(pages.MorePage,{active:n,onChanged(){}},true);await flush();let tree=render(pages.MorePage,{active:n,onChanged(){}})
    for(const value of ['1.26.2','alpha-94b13ae']){const t=nodes(tree,'Text').find(x=>text(x)===value);assert.ok(t);assert.equal(t.props.fixedSize.horizontal,true)}
    const versionRow=nodes(tree,'HStack').find(x=>text(x).includes('alpha-94b13ae')&&!text(x).includes('运行时间'));assert.ok(!text(versionRow).includes('运行时间'))
    assert.equal(tree.props.background,'systemBackground');unmount()
    for(const [Page,props] of [[pages.DNSPage,{c:n}],[pages.ManagementPage,{c:n,kind:'profile'}],[ui.KernelConfigPage,{c:n}],[ui.GlobalConfigPage,{active:n}],[ui.LogsPage,{}],[app.SettingsPage,{active:n,onChanged(){}}]]){
      tree=render(Page,props,true);assert.equal(tree.props.background,'systemBackground');if(tree.type==='Form')assert.equal(tree.props.scrollContentBackground,'hidden');unmount()
    }
    tree=render(app.Root,{},true);const stack=nodes(tree,'NavigationStack').find(x=>x.props.key==='more-stack');assert.equal(stack.props.scrollContentBackground,'hidden');assert.equal(stack.props.background,'systemBackground');unmount()
  })
  await test('真实进程时长：auxv时钟频率、32/64位大小端及proc启动时间校验', () => {
    for(const size of [4,8])for(const endian of ['LE','BE']){
      const b=Buffer.alloc(size*4),write=size===8?'writeBigUInt64'+endian:'writeUInt32'+endian
      b[write](size===8?17n:17,0);b[write](size===8?100n:100,size)
      assert.equal(api.linuxClockTicks(b.toString('base64')),100)
    }
    for(const b of ['', '!',Buffer.alloc(16).toString('base64')])assert.equal(api.linuxClockTicks(b),null)
    const stat='10883 (mihomo) S 1 1 1 0 -1 4194560 2188599 0 0 0 189179 108801 0 0 20 0 22 0 340950391 123 456 999 1000 2000 140723296616752'
    assert.equal(api.linuxProcessSeconds('4214450 0',stat,100,10883),804946)
    assert.equal(api.linuxProcessSeconds('4214450 0',stat.replace('(mihomo)','(mi)ho mo)'),100,10883),804946)
    assert.equal(api.linuxProcessSeconds('1 0',stat,100,10883),null);assert.equal(api.linuxProcessSeconds('4214450 0',stat,100,9),null);assert.equal(api.linuxProcessSeconds('bad',stat,100,10883),null)
  })
  await test('Nikki时间不读截断proc/stat：POSIX时区换算与未知/DST/未来时间拒绝',()=>{
    assert.equal(api.nikkiServiceSeconds(1792603092,4214450,'CST-8',1792549767),24525)
    assert.equal(api.nikkiServiceSeconds(1792574292,4214450,'UTC0',1792549767),24525)
    assert.equal(api.nikkiServiceSeconds(1792554492,4214450,'EST5:30',1792549767),24525)
    for(const zone of ['', 'Asia/Shanghai','EST5EDT,M3.2.0,M11.1.0','UTC25','UTC0:99'])assert.equal(api.nikkiServiceSeconds(1792603092,4214450,zone,1792549767),null)
    for(const stamp of [null,undefined,'1792549767',NaN,1792574293,1780000000])assert.equal(api.nikkiServiceSeconds(1792603092,4214450,'CST-8',stamp),null)
  })
  await test('Nikki进程时长只读RPC、真实PID路径、无权限/停服不伪造开机时长', async () => {
    const n={...c,id:'runtime-proc',kind:'openwrt',plugin:'nikki',host:'proc.invalid',url:'http://proc.invalid',auto:false,cport:9090}
    const aux=Buffer.alloc(32);aux.writeBigUInt64LE(17n,0);aux.writeBigUInt64LE(100n,8)
    const stat='10883 (mihomo) S 1 1 1 0 -1 4194560 2188599 0 0 0 189179 108801 0 0 20 0 22 0 340950391 123 456 999 1000 2000 140723296616752'
    let alive=true,denied=false
    responder=(url,init)=>{const p=JSON.parse(init.body).params;if(p[1]==='session')return {body:{result:[0,{ubus_rpc_session:'proc-session'}]}};if(denied)return {body:{result:[6]}};if(p[1]==='service')return {body:{result:[0,{nikki:{instances:alive?{nikki:{running:true,pid:10883}}:{}}}]}};if(p[1]==='system')return {body:{result:[0,{localtime:1792603092,uptime:4214450}]}};if(p[2]==='stat')return {body:{result:[0,{type:'file',mtime:1792549767}]}};return {body:{result:[0,{data:({'/proc/self/auxv':aux.toString('base64'),'/proc/10883/stat':stat,'/proc/uptime':'4214450 0','/proc/10883/comm':'mihomo','/etc/TZ':'CST-8'})[p[3].path]}]}}}
    calls.length=0;const rt=await api.loadNikkiRuntime(n);assert.equal(rt.coreSeconds,804946);assert.equal(rt.serviceSeconds,24525);assert.equal(rt.measuredAt,now)
    assert.ok(calls.length<=3);const rpcCalls=calls.flatMap(x=>{const j=JSON.parse(x.init.body);return Array.isArray(j)?j:[j]});assert.ok(rpcCalls.every(x=>x.params[2]!=='exec'));assert.deepEqual(rpcCalls.filter(x=>x.params[1]==='file').map(x=>x.params[3].path).sort(),['/proc/10883/comm','/proc/10883/stat','/proc/self/auxv','/proc/uptime','/etc/TZ','/var/run/nikki/started.flag'].sort())
    const full=responder
    responder=(url,init)=>JSON.parse(init.body).params[2]==='stat'?{body:{result:[6]}}:full(url,init)
    const flagDenied=await api.loadNikkiRuntime(n);assert.equal(flagDenied.coreSeconds,804946);assert.equal(flagDenied.serviceSeconds,null)
    responder=(url,init)=>JSON.parse(init.body).params[3]?.path==='/proc/self/auxv'?{body:{result:[6]}}:full(url,init)
    const coreDenied=await api.loadNikkiRuntime(n);assert.equal(coreDenied.coreSeconds,null);assert.equal(coreDenied.serviceSeconds,24525)
    responder=(url,init)=>url.endsWith('/version')?{body:{version:'restarted-core'}}:JSON.parse(init.body).params[3]?.path==='/proc/10883/stat'?{body:{result:[0,{data:stat.replace('140723296616752','140723296700000')}]}}:full(url,init)
    assert.equal((await api.verifyCoreRestart(n,rt)).verified,true)
    responder=(url,init)=>url.endsWith('/version')?{body:{version:'same-core'}}:full(url,init)
    assert.equal((await api.verifyCoreRestart(n,rt)).verified,false)
    let probes=0
    responder=(url,init)=>url.endsWith('/version')?(++probes===1?{throw:'restarting'}:{body:{version:'healthy'}}):full(url,init)
    assert.equal((await api.verifyCoreRestart(n,null)).verified,true)
    calls.length=0;assert.equal((await api.verifyCoreRestart(n,rt,()=>false)).verified,false);assert.equal(calls.length,0)
    responder=full
    alive=false;assert.equal((await api.loadNikkiRuntime(n)).coreSeconds,null);denied=true;await assert.rejects(()=>api.loadNikkiRuntime(n));calls.length=0;await assert.rejects(()=>api.loadNikkiRuntime(c));assert.equal(calls.length,0)
    denied=false;alive=true
    const read=responder;responder=(url,init)=>url.endsWith('/ubus')?read(url,init):{body:url.endsWith('/version')?{version:'core-live'}:{mode:'rule'}}
    render(pages.MorePage,{active:n,onChanged(){}},true);await flush();let tree=render(pages.MorePage,{active:n,onChanged(){}});await flush()
    assert.ok(text(tree).includes('9天 7时 35分 46秒'));assert.ok(text(tree).includes('Nikki 服务（运行时间：0天 6时 48分 45秒）'))
    for(const icon of ['desktopcomputer','shippingbox']){
      const row=nodes(tree,'HStack').find(x=>x.props.children?.some(y=>y?.type==='Image'&&y.props.systemName===icon))
      assert.ok(row);assert.equal(row.props.alignment,'center');assert.ok(row.props.children.some(y=>y?.type==='VStack'&&text(y).includes('运行时间')))
    }
    assert.ok(nodes(tree,'VStack').some(x=>x.props.background?.props?.fill==='secondarySystemBackground'))
    now+=5000;[...intervals.values()].find(x=>x.ms===1000).fn();tree=render(pages.MorePage,{active:n,onChanged(){}});assert.ok(text(tree).includes('9天 7时 35分 51秒'))
    tree.props.onDisappear();render(pages.MorePage,{active:n,onChanged(){}});await flush();assert.equal(intervals.size,0);unmount()
  })
  await test('版本先返回先显示，不等待慢核心API且最终仍优先真实核心版本',async()=>{
    const original=context.fetch;let release
    const gate=new Promise(r=>release=r),seen=[]
    const n={...c,id:'progressive-version',kind:'openwrt',plugin:'nikki',auto:false,cport:9090}
    responder=(url,init)=>({body:url.endsWith('/ubus')?{result:[0,JSON.parse(init.body).params[1]==='session'?{ubus_rpc_session:'version-session'}:{app:'fast-app',core:'fast-local'}]}:{version:'slow-direct'}})
    context.fetch=async(url,init)=>{if(url.endsWith('/version'))await gate;return original(url,init)}
    try{
      const pending=api.loadRuntimeVersions(n,x=>seen.push(clone(x)));await flush();assert.ok(seen.some(x=>x.app==='fast-app'&&x.core==='fast-local'))
      release();assert.equal((await pending).core,'slow-direct');assert.equal(seen.at(-1).core,'slow-direct')
    }finally{release();context.fetch=original}
  })
  await test('更多服务/核心弹窗文字、取消零请求、GEO免确认及成功横幅关闭/失败不报成功',async()=>{
    const timers=[],original=context.setTimeout;context.setTimeout=(fn,ms)=>{timers.push({fn,ms});return timers.length}
    const n={...c,id:'alerts-nikki',kind:'openwrt',plugin:'nikki',auto:false,cport:9090}
    const respond=(url,init)=>({body:url.endsWith('/ubus')?{result:[0,JSON.parse(init.body).params[1]==='session'?{ubus_rpc_session:'alert-session'}:{app:'app',core:'core'}]}:{version:'core',mode:'rule'}})
    responder=respond
    try{
      render(pages.MorePage,{active:n,onChanged(){}},true);await flush();let tree=render(pages.MorePage,{active:n,onChanged(){}})
      context.confirmResult=false
      for(const name of ['启动','停止','重启','重载']){
        calls.length=0;await button(tree,name).props.action();assert.equal(calls.length,0)
        assert.deepEqual(clone(confirms.at(-1)),{title:name+'服务',message:'确认要'+name+'相关服务吗？',confirmLabel:'确认'+name,cancelLabel:'取消'})
      }
      for(const [name,label] of [['重启核心','确认重启'],['重载配置','确认重载']]){
        calls.length=0;await button(tree,name).props.action();assert.equal(calls.length,0);assert.equal(confirms.at(-1).title,name);assert.equal(confirms.at(-1).confirmLabel,label)
      }
      const before=confirms.length
      calls.length=0;await button(tree,'更新GEO数据库').props.action();assert.equal(confirms.length,before);assert.ok(calls.some(x=>x.url.endsWith('/configs/geo')))
      tree=render(pages.MorePage,{active:n,onChanged(){}});assert.equal(tree.props.overlay.alignment,'top');assert.ok(text(tree.props.overlay.content).includes('GEO 数据库更新成功'));await flush()
      nodes(tree.props.overlay.content,'Button')[0].props.action();tree=render(pages.MorePage,{active:n,onChanged(){}});assert.equal(text(tree.props.overlay?.content),'')
      context.confirmResult=false
      for(const [name,msg] of [['刷新DNS缓存','DNS 缓存已清除'],['刷新FakeIP缓存','FakeIP 缓存已清除']]){
        const prev=alerts.length;await button(tree,name).props.action();tree=render(pages.MorePage,{active:n,onChanged(){}});assert.ok(text(tree.props.overlay.content).includes(msg));assert.equal(alerts.length,prev);assert.equal(confirms.length,before);assert.equal(tree.props.overlay.content.props.animation,undefined);assert.equal(nodes(tree.props.overlay.content,'HStack')[0].props.transition,undefined)
      }
      context.confirmResult=true
      const prev=alerts.length;await button(tree,'启动').props.action();tree=render(pages.MorePage,{active:n,onChanged(){}});assert.ok(text(tree.props.overlay.content).includes('启动服务请求已发送'));assert.equal(alerts.length,prev);await flush()
      timers.at(-1).fn();tree=render(pages.MorePage,{active:n,onChanged(){}});assert.equal(text(tree.props.overlay?.content),'')
      responder=(url,init)=>url.endsWith('/configs/geo')?{throw:'failed'}:respond(url,init)
      await button(tree,'更新GEO数据库').props.action();tree=render(pages.MorePage,{active:n,onChanged(){}});assert.equal(text(tree.props.overlay?.content),'');assert.equal(alerts.at(-1).title,'操作未完成')
      unmount()
    }finally{context.setTimeout=original;context.confirmResult=true;unmount()}
  })
  await test('核心重启：同PID执行替换后才显示成功，原始请求只发一次',async()=>{
    const n={...c,id:'restart-verified-ui',kind:'openwrt',plugin:'nikki',auto:false,cport:9090};let restarted=false,posts=0
    const aux=Buffer.alloc(32);aux.writeBigUInt64LE(17n,0);aux.writeBigUInt64LE(100n,8)
    responder=(url,init)=>{
      if(url.endsWith('/restart')){posts++;restarted=true;return {body:{status:'ok'}}}
      if(!url.endsWith('/ubus'))return {body:url.endsWith('/version')?{version:'core'}:{mode:'rule'}}
      const p=JSON.parse(init.body).params;let body={}
      if(p[1]==='session')body={ubus_rpc_session:'restart-ui-session'}
      else if(p[1]==='service')body={nikki:{instances:{nikki:{running:true,pid:10883}}}}
      else if(p[1]==='system')body={localtime:1792603092,uptime:4214450}
      else if(p[1]==='luci.nikki')body={core:'core',app:'app'}
      else if(p[2]==='stat')body={type:'file',mtime:1792549767}
      else body={data:({'/etc/TZ':'CST-8','/proc/self/auxv':aux.toString('base64'),'/proc/10883/comm':'mihomo','/proc/uptime':'4214450 0','/proc/10883/stat':'10883 (mihomo) S 1 1 1 0 -1 4194560 2188599 0 0 0 189179 108801 0 0 20 0 22 0 340950391 123 456 999 1000 2000 '+(restarted?'140723296700000':'140723296616752')})[p[3]?.path]}
      return {body:{result:[0,body]}}
    }
    const timers=[],original=context.setTimeout;context.setTimeout=(fn,ms)=>{if(ms===700)return fn();timers.push(fn);return timers.length}
    try{
      render(pages.MorePage,{active:n,onChanged(){}},true);await flush();let tree=render(pages.MorePage,{active:n,onChanged(){}})
      await button(tree,'重启核心').props.action();tree=render(pages.MorePage,{active:n,onChanged(){}})
      assert.equal(posts,1);assert.ok(text(tree.props.overlay.content).includes('核心重启成功'));assert.ok(!text(tree.props.overlay.content).includes('请求已发送'))
    }finally{context.setTimeout=original;unmount()}
  })
  await test('更多页不调用未验证原生动画工厂，未通知时不挂载空overlay',()=>{
    const oldAnimation=scripting.Animation,oldTransition=scripting.Transition
    scripting.Animation={easeOut(){throw Error('native animation unavailable')}};scripting.Transition={opacity(){throw Error('native transition unavailable')}}
    try{
      const tree=render(pages.MorePage,{active:c,onChanged(){}},true)
      assert.ok(text(tree).includes('运行信息'));assert.ok(text(tree).includes('代理配置'));assert.equal(tree.props.overlay,undefined)
    }finally{scripting.Animation=oldAnimation;scripting.Transition=oldTransition;unmount()}
  })
  await test('更多代理模式立即复用同来源真实读数，首次读取显示读取中，失败不伪造',async()=>{
    const n={...c,id:'mode-cache-fixture',url:'http://mode-cache.invalid'},other={...c,id:'mode-cache-other',url:'http://mode-cache-other.invalid'}
    responder=()=>({body:{mode:'global',version:'core'}})
    await api.loadConfig(n)
    const original=context.fetch;let release;const gate=new Promise(r=>release=r)
    context.fetch=async(url,init)=>{if(url.endsWith('/configs'))await gate;return original(url,init)}
    try{
      render(pages.MorePage,{active:n,onChanged(){}},true);await flush();let tree=render(pages.MorePage,{active:n,onChanged(){}});assert.ok(text(tree).includes('全局模式'))
      render(pages.MorePage,{active:other,onChanged(){}});await flush();tree=render(pages.MorePage,{active:other,onChanged(){}});assert.ok(!text(tree).includes('全局模式'));assert.ok(text(tree).includes('读取中…'))
      release();await flush();tree=render(pages.MorePage,{active:other,onChanged(){}});assert.ok(text(tree).includes('全局模式'))
    }finally{release();context.fetch=original;unmount()}
  })
  await test('连接活动与已关闭仅保留加载更多，不显示已展示和底部历史注释', async () => {
    const conns=Array.from({length:70},(_,i)=>({id:'footer-'+i,start:new Date(now-i*1000).toISOString(),metadata:{host:'footer-'+i+'.invalid'},upload:0,download:0}))
    responder=()=>({body:{connections:conns}});render(pages.ConnectionsPage,{active:c,version:0},true);await flush();let tree=render(pages.ConnectionsPage,{active:c,version:0})
    assert.ok(!text(tree).includes('已展示'));assert.ok(!text(tree).includes('连续监测'));button(tree,'加载更多')
    responder=()=>({body:{connections:[]}});[...intervals.values()].find(x=>x.ms===1500).fn();await flush();tree=render(pages.ConnectionsPage,{active:c,version:0});nodes(tree,'Button').find(x=>text(x).includes('已关闭')).props.action();tree=render(pages.ConnectionsPage,{active:c,version:0})
    assert.ok(!text(tree).includes('已展示'));assert.ok(!text(tree).includes('连续监测'));button(tree,'加载更多');unmount()
  })
  await test('1.5更多实际动作：运行时间未知不冒充，取消操作不请求，网页无密钥', async () => {
    const n={...c,id:'more-nikki',kind:'openwrt',plugin:'nikki',url:'http://current-device.invalid'}
    responder=(url,init)=>({body:url.endsWith('/ubus')?{result:[0,JSON.parse(init.body).params[1]==='session'?{ubus_rpc_session:'session'}:{app:'nikki-real',core:'core-real'}]}:url.endsWith('/configs')?{mode:'rule'}:{version:'core-real'}})
    render(pages.MorePage,{active:n,onChanged(){}},true);await flush();let tree=render(pages.MorePage,{active:n,onChanged(){}});assert.ok(text(tree).includes('运行时间：未提供'));assert.ok(text(tree).includes('nikki-real'))
    context.confirmResult=false;calls.length=0;await button(tree,'重启核心').props.action();assert.equal(calls.length,0);context.confirmResult=true
    assert.equal(await api.webpage(n,'profile'),'http://current-device.invalid/cgi-bin/luci/admin/services/nikki/profile');assert.equal(await api.webpage(c),c.url+'/ui/');await assert.rejects(()=>api.webpage({...c,url:'http://private@controller.invalid/?token=secret'}))
  })
  await test('1.5所有危险入口UI取消：核心/服务/DNS/网页/订阅均无请求或外发', async () => {
    const n={...c,id:'cancel-nikki',kind:'openwrt',plugin:'nikki',url:'http://cancel-device.invalid'}
    responder=(url,init)=>({body:url.endsWith('/ubus')?{result:[0,JSON.parse(init.body).params[1]==='session'?{ubus_rpc_session:'session'}:JSON.parse(init.body).params[1]==='uci'?{values:{s1:{'.type':'subscription','.name':'s1',name:'Real subscription'}}}:JSON.parse(init.body).params[1]==='file'?{entries:[]}:{app:'nikki',core:'mihomo'}]}:{version:'mihomo',mode:'rule'}})
    render(pages.MorePage,{active:n,onChanged(){}},true);await flush();let tree=render(pages.MorePage,{active:n,onChanged(){}})
    context.confirmResult=false;calls.length=0;openedURLs.length=0
    for(const title of ['重启核心','重载配置'])await button(tree,title).props.action()
    for(const b of nodes(tree,'Button').filter(b=>['启动','停止','重启','重载'].includes(text(b)))) await b.props.action()
    assert.ok(!nodes(tree,'Button').some(b=>text(b).includes('网页访问')));assert.equal(calls.length,0);assert.equal(openedURLs.length,0)
    render(pages.DNSPage,{c:n},true);tree=render(pages.DNSPage,{c:n});nodes(tree,'TextField')[0].props.onChanged('example.invalid');tree=render(pages.DNSPage,{c:n});calls.length=0;await button(tree,'查询').props.action();assert.equal(calls.length,0)
    render(pages.ManagementPage,{c:n,kind:'subscription'},true);await flush();tree=render(pages.ManagementPage,{c:n,kind:'subscription'});calls.length=0;await button(tree,'删除订阅').props.action();assert.equal(calls.length,0)
    assert.ok(!nodes(tree,'Button').some(b=>b.props.title==='打开Nikki官方管理页面'));assert.equal(openedURLs.length,0);context.confirmResult=true
  })
  await test('默认打开界面与底部五个入口名称顺序一致，更多可保存并启动', () => {
    const src = fs.readFileSync(path.join(root, 'dashboard-pages.tsx'), 'utf8')
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
    assert.ok(!src.includes('HeadersPage')); assert.ok(src.includes('<HeaderFields icon=')); assert.ok(src.includes('title="例如 X-Is-Me"')); assert.ok(src.includes('title="例如 YES"')); assert.ok(src.includes('<Toggle title="自定义请求头"')); assert.ok(src.includes('rows.flatMap')); assert.ok(!src.includes('<Label title="自定义请求头"'))
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
  await test('全局配置移除外观入口，保留阈值与缓存管理', () => {
    const src = fs.readFileSync(path.join(root, 'settings-ui.tsx'), 'utf8'), body = src.slice(src.indexOf('export function GlobalConfigPage'), src.indexOf('function CloudSettingsPage'))
    assert.ok(!body.includes('（本地替代）')); assert.ok(!body.includes('（长按组标题）')); assert.ok(!body.includes('（淡出替代）'))
    for (const k of ['ThresholdRange','clearImageCache']) assert.ok(body.includes(k))
    for (const k of ['theme','defaultPage','showHidden','customIcons']) assert.ok(!body.includes(k))
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
    assert.ok(!body.includes('编辑组图标')); assert.ok(!body.includes('IconsPage')); assert.ok(!body.includes('自定义代理组图标'))
  })
  await test('全局配置包含迁移项且无概览组，两个外观入口都删除', async () => {
    pref.savePreferences({ theme: 'dark', customIcons: true, showWrt: false })
    let tree = render(ui.GlobalConfigPage, { active: null }, true)
    assert.ok(!text(tree).includes('概览页面'))
    for (const key of ['showWrt','droplets','connectionBackground','ripple']) assert.ok(!nodes(tree, 'Toggle').some(n => n.props.key === key))
    for (const title of ['外观模式','默认打开界面']) assert.ok(!nodes(tree, ui.Choice).some(n => n.props.title === title))
    assert.ok(!nodes(tree, 'Toggle').some(n => n.props.key === 'customIcons')); assert.equal(pref.getPreferences().customIcons, true)
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
    for (const key of ['showHidden','customIcons','disconnectOnSwitch']) assert.ok(!nodes(tree, 'Toggle').some(n => n.props.key === key))
    assert.ok(!nodes(tree, 'Toggle').some(n => n.props.key === 'nestedDelay')); assert.ok(nodes(tree, 'Toggle').some(n => n.props.key === 'haptics'))
    { const k = fs.readFileSync(path.join(root, 'settings-ui.tsx'), 'utf8'); const a = k.indexOf('toggle("ipv6", "IPv6")'), b = k.indexOf('<HeaderFields icon='), c = k.indexOf('<NestedDelayRow'), d = k.indexOf('Text>绑定地址'); assert.ok(a > 0 && a < b && b < c && c < d) }
    assert.ok(!nodes(tree, ui.Choice).some(n => n.props.title === '外观模式')); assert.ok(button(tree, '清除图片缓存'))
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
      const foldedArrow=nodes(tree,pages.GroupChevron)[0];assert.ok(foldedArrow);assert.equal(foldedArrow.props.expanded,false)
      head.props.action(); tree = render(pages.GroupSection, props); await flush()
      const expandedArrow=nodes(tree,pages.GroupChevron)[0];assert.ok(expandedArrow);assert.equal(expandedArrow.props.expanded,true)
      nodes(tree, 'Button').find(n => n.props.frame?.alignment === 'leading').props.action(); tree = render(pages.GroupSection, props); await flush()
      assert.equal(nodes(tree, 'Button').filter(n => n.props.systemImage === 'bolt.fill').length, 1)
      unmount(); tree = render(pages.GroupSection, props, true); assert.equal(nodes(tree, pages.GroupIcon).length, 0); await flush()
      pref.savePreferences({ customIcons: true }); tree = render(pages.GroupSection, props); assert.equal(nodes(tree, pages.GroupIcon).length, 1)
      unmount()
    }
  })
  await test('策略组保留完整交互，不调用动画工厂、旋转修饰符或状态包装器',()=>{
    const src=fs.readFileSync(path.join(root,'dashboard-pages.tsx'),'utf8'),group=src.slice(src.indexOf('export function GroupChevron'),src.indexOf('const PROXY_MODE_OPTIONS'));
    assert.ok(!/Animation\.|rotationEffect|animation=|withAnimation|Transition\.move|setInterval|setTimeout|<SVG/.test(group));
    const props={c,g:{name:'compat-group',type:'Selector',all:['A'],now:'A',delays:{A:10}},onChanged(){}};
    for(const expanded of [false,true]){const tree=render(pages.GroupSection,{...props,expanded},true);assert.ok(text(tree).includes('compat-group'));assert.equal(nodes(tree,pages.GroupChevron)[0].props.expanded,expanded);assert.equal(nodes(tree,'Button').filter(b=>b.props.systemImage==='bolt.fill').length,1);unmount()}
  })
  await test('箭头采用官方原生符号内容过渡，无逐帧计时器且两个方向均可渲染',async()=>{
    const baseline=intervals.size;
    let tree=render(pages.GroupChevron,{expanded:false},true);await flush();let image=nodes(tree,'Image')[0];assert.ok(image);assert.equal(image.props.systemName,'chevron.right');assert.equal(image.props.contentTransition,'symbolEffect');assert.equal(image.props.animation,undefined);assert.equal(image.props.rotationEffect,undefined);assert.equal(image.props.font,12);assert.equal(image.props.frame.width,28);assert.equal(intervals.size,baseline);
    for(const expanded of [true,false,true,false]){tree=render(pages.GroupChevron,{expanded});await flush();image=nodes(tree,'Image')[0];assert.equal(image.props.systemName,expanded?'chevron.down':'chevron.right');assert.equal(image.props.contentTransition,'symbolEffect');assert.equal(intervals.size,baseline)}
    assert.equal(nodes(tree,'SVG').length,0);unmount();assert.equal(intervals.size,baseline);
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
    const arrow = t => nodes(t, 'Button').find(n => !n.props.frame && n.props.buttonStyle === 'plain' && nodes(n,pages.GroupChevron).length===1)
    arrow(tree).props.action(); tree = render(pages.GroupSection, props); await flush(); assert.equal(cards(tree).length, 0)
    arrow(tree).props.action(); tree = render(pages.GroupSection, props); await flush(); assert.equal(cards(tree).length, 2)
    responder = u => ({ body: { delay: u.includes('/proxies/A/') ? 51 : 62 } })
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
  await test('展开补测逐个显示快结果，慢节点只测一次，不重测已有延迟的节点', async () => {
    const g = { name: 'ProgressiveProbeGroup', type: 'Selector', all: ['probe-known', 'probe-fast', 'probe-slow'], now: 'probe-known', delays: { 'probe-known': 19 } }, props = { c, g, onChanged() {} }
    let release; const wait = new Promise(r => { release = r }); calls.length = 0
    responder = url => url.includes('/group/') ? { body: { 'probe-slow': 0 } } : url.includes('/probe-slow/') ? { wait, body: { delay: 0 } } : { body: { delay: 47 } }
    let tree = render(pages.GroupSection, props, true); await flush()
    nodes(tree, 'Button').find(n => n.props.frame?.alignment === 'leading').props.action(); render(pages.GroupSection, props); await flush()
    tree = render(pages.GroupSection, props); assert.ok(text(tree).includes('47ms'))
    assert.equal(calls.filter(x => x.url.includes('/proxies/')).length, 2); assert.ok(!calls.some(x => x.url.includes('/probe-known/')))
    assert.equal(calls.filter(x => x.url.includes('/group/')).length, 0)
    release(); await flush(); await flush(); tree = render(pages.GroupSection, props)
    assert.equal(calls.filter(x => x.url.includes('/proxies/')).length, 2); assert.equal(calls.filter(x => x.url.includes('/group/')).length, 0)
    assert.ok(text(nodes(tree, 'Button').find(n => text(n).includes('probe-slow'))).includes('超时')); unmount()
  })
  await test('自动补测失败即结束，不追加整组重测；超时不写入共享缓存', async () => {
    const g = { name: 'FallbackGroup', type: 'Selector', all: ['OK', 'ONLYGROUP', 'DEAD'], now: 'OK', delays: { OK: 20 } }
    responder = url => url.includes('/group/') ? { body: { ONLYGROUP: 196, DEAD: 0 } } : { body: { delay: 0 }, status: 504 }
    calls.length = 0
    let t = render(pages.GroupSection, { c, g, onChanged() {} }, true); await flush()
    nodes(t, 'Button').find(n => n.props.frame?.alignment === 'leading').props.action(); t = render(pages.GroupSection, { c, g, onChanged() {} }); await flush(); await flush(); await flush()
    t = render(pages.GroupSection, { c, g, onChanged() {} })
    assert.ok(!calls.some(x => x.url.includes('/group/FallbackGroup/delay'))); assert.ok(!text(t).includes('196ms')); assert.equal(calls.length, 2)
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
  await test('规则页菜单“全部更新”：只更新可更新的提供者，不弹确认，完成后刷新', async () => {
    const prov = { providers: { A: { type: 'Rule', vehicleType: 'HTTP', ruleCount: 1, proxies: [] }, B: { type: 'Rule', vehicleType: 'HTTP', ruleCount: 2, proxies: [] }, L: { type: 'Rule', vehicleType: 'Inline', ruleCount: 3, proxies: [] } } }
    responder = url => ({ body: url.includes('/providers/') ? prov : url.endsWith('/rules') ? { rules: [] } : { proxies: {} } })
    for (const [Page, kind, title] of [[pages.RulesPage, 'rules', '全部更新']]) {
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
  await test('活动中与已关闭搜索右侧均可清空，恢复各自列表且不关闭搜索或发送请求', async () => {
    const active = { ...c, id: 'search-clear-test', url: 'http://search-clear.invalid' }, props = { active, version: 0 }
    const all = ['active-one', 'active-two', 'closed-one', 'closed-two']
    let ids = all
    responder = () => ({ body: { connections: ids.map(id => ({ id, start: new Date(now - 1000).toISOString(), metadata: { host: id + '.invalid', destinationPort: '443', sourceIP: '10.0.0.2' }, upload: 1, download: 2 })) } })
    render(pages.ConnectionsPage, props, true); await flush()
    ids = all.slice(0, 2); await [...intervals.values()].find(t => t.ms === 1500).fn(); await flush()
    let tree = render(pages.ConnectionsPage, props)
    nodes(tree, 'Button').find(n => nodes(n, 'Image').some(i => i.props.systemName === 'magnifyingglass')).props.action()
    for (const [tab, prefix] of [['活动中', 'active'], ['已关闭', 'closed']]) {
      tree = render(pages.ConnectionsPage, props); button(tree, tab).props.action(); tree = render(pages.ConnectionsPage, props)
      assert.equal(nodes(tree, 'TextField')[0].props.value, '')
      assert.equal(nodes(tree, 'Button').filter(n => n.props.accessibilityLabel === '清除连接搜索').length, 0)
      nodes(tree, 'TextField')[0].props.onChanged(prefix + '-one'); tree = render(pages.ConnectionsPage, props)
      assert.ok(text(tree).includes(prefix + '-one.invalid')); assert.ok(!text(tree).includes(prefix + '-two.invalid'))
      const before = calls.length, confirmBefore = confirms.length
      const clear = button(tree, '清除连接搜索'); assert.equal(nodes(clear, 'Image')[0].props.systemName, 'xmark.circle.fill'); clear.props.action()
      tree = render(pages.ConnectionsPage, props)
      assert.equal(nodes(tree, 'TextField').length, 1); assert.equal(nodes(tree, 'TextField')[0].props.value, '')
      assert.ok(text(tree).includes(prefix + '-one.invalid')); assert.ok(text(tree).includes(prefix + '-two.invalid'))
      assert.equal(nodes(tree, 'Button').filter(n => n.props.accessibilityLabel === '清除连接搜索').length, 0)
      assert.equal(calls.length, before); assert.equal(confirms.length, confirmBefore)
    }
    unmount()
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
      let tree = render(pages.ProxiesPage, { active: null, version: 0 }, true); await flush()
      nodes(trailing(tree.props.toolbar), 'Toggle').find(n => n.props.title === '显示图标').props.onChanged(false)
      tree = render(pages.ProxiesPage, { active: null, version: 0 }); await flush(); unmount()
      render(pages.ProxiesPage, { active: null, version: 0 }, true); await flush(); unmount()
      render(pages.GroupSection, { c, g: { name: 'private-group-name', type: 'Selector', all: ['A'], now: 'A', delays: {}, icon: 'https://private.invalid/secret-image' }, onChanged() {} }, true); await flush(); unmount()
      const diagnostic = logs.filter(x => x.startsWith('[preferences-icon]'))
      for (const stage of ['change','accepted','proxies-render','group-render']) assert.ok(diagnostic.some(x => x.includes('stage=' + stage) && x.includes('enabled=false')))
      assert.ok(diagnostic.every(x => !x.includes('private.invalid') && !x.includes('private-group-name') && !x.includes('secret-')))
      assert.ok(diagnostic.every(x => x.includes('build=1.5.195') && /instance=[a-z0-9]+/.test(x)))
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
    assert.ok(nodes(tree,pages.GroupChevron).some(n=>n.props.expanded===true)); assert.ok(text(tree).includes('42ms'))
    pref.savePreferences({ customIcons: true }); tree = render(pages.GroupSection, props); await flush()
    assert.equal(nodes(tree, pages.GroupIcon).length, 1); assert.ok(nodes(tree,pages.GroupChevron).some(n=>n.props.expanded===true))
    unmount(); pref.savePreferences({ collapseGesture: false })
  })
  await test('更多从预挂载未选中切到选中，无需onAppear或进入子页就启动读取，隐藏即停',async()=>{
    const n={...c,id:'more-selection-start',kind:'openwrt',plugin:'nikki',auto:false,cport:9090}
    const props={active:n,onChanged(){},selected:false}
    responder=(url,init)=>({body:url.endsWith('/ubus')?{result:[0,JSON.parse(init.body).params[1]==='session'?{ubus_rpc_session:'selection-session'}:{app:'selected-app',core:'selected-core'}]}:url.endsWith('/version')?{version:'selected-core'}:{mode:'global'}})
    calls.length=0;render(pages.MorePage,props,true);await flush();assert.equal(calls.length,0)
    render(pages.MorePage,{...props,selected:true});await flush()
    render(pages.MorePage,{...props,selected:true});await flush()
    let tree=render(pages.MorePage,{...props,selected:true});assert.ok(calls.length>0);assert.ok(text(tree).includes('selected-app'));assert.ok(text(tree).includes('全局模式'));assert.ok(intervals.size>0)
    // Native tab switching may call disappear but omit a later appear. Selection must restart work itself.
    tree.props.onDisappear();render(pages.MorePage,props);await flush();assert.equal(intervals.size,0)
    calls.length=0;render(pages.MorePage,{...props,selected:true});await flush();render(pages.MorePage,{...props,selected:true});await flush()
    tree=render(pages.MorePage,{...props,selected:true});assert.ok(calls.length>0);assert.ok(text(tree).includes('全局模式'))
    // Pushing a subpage while still selected still pauses background work until returning.
    tree.props.onDisappear();render(pages.MorePage,{...props,selected:true});await flush();assert.equal(intervals.size,0)
    calls.length=0;tree.props.onAppear();render(pages.MorePage,{...props,selected:true});await flush();assert.ok(calls.length>0);unmount()
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
    assert.ok(fs.readFileSync(path.join(root,'home-ui.tsx'),'utf8').includes('RamCard'))
  })
  await test('首页关键行为（速度图表、数字动画）', () => {
    const source=fs.readFileSync(path.join(root,'index.tsx'),'utf8')
    assert.ok(!source.includes('title="下载速率"'));assert.ok(!source.includes('title="上传速率"'));assert.ok(source.includes('>速度</Text>'));assert.ok(source.includes('<HomeDashboard overview={homeFrame.overview}'));assert.ok(fs.readFileSync(path.join(root,'home-ui.tsx'),'utf8').includes('<InlineCanvasPlot {...props}/>'));assert.ok(source.includes('(Date.now() - at) / span'));assert.ok(source.includes('}, 16)'))
  })
  console.log(`\n${count} tests passed. All fetch, Storage, Keychain, iCloud and UI bindings were mocked; no device/remote effects executed.`)
})().catch(e => { console.error(e); process.exitCode = 1 })
