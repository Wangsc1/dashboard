// Standalone regression. Reuse ONLY the existing in-memory harness, not its test cases.
// All fetches are the harness's mock; no devices, services or native UI are accessed.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const harness = fs.readFileSync(path.join(__dirname, 'run.cjs'), 'utf8').split(';(async () => {')[0]
const checks = String.raw`
const chart = load('chart')
function svgPaths(tree) { return [...nodes(tree, 'SVG')[0].props.code.matchAll(/d="([^"]+)" fill="none" stroke="([^"]+)"/g)].map(m => m[1]) }
function ys(d) { return [...d.matchAll(/-?\d+\.\d+,(-?\d+\.\d+)/g)].map(m => Number(m[1])) }
function plot(down, up, reset = true, enabled = true) { return render(app.RateChart, { down, up, enabled }, reset) }
;(async () => {
  await test('WAN RX delta is real download B/s; shared scale reproduces sub-pixel failure', async () => {
    let rx = 10000, tx = 20000
    const c = { id: 'chart-download', kind: 'openwrt', url: 'http://mock.invalid', username: 'root' }
    responder = (url, init) => {
      assert.equal(url, c.url + '/ubus')
      const b = JSON.parse(init.body), object = b.params[1], method = b.params[2]
      let data = { data: '0' }
      if (object === 'session') data = { ubus_rpc_session: 'mock-session' }
      if (object === 'system') data = method === 'info' ? { uptime: 10, memory: { total: 100, free: 50 }, load: [0,0,0] } : { release: { description: 'mock' } }
      if (object === 'network.interface') data = { interface: [{ interface: 'wan', l3_device: 'eth0', route: [{ target: '0.0.0.0' }] }] }
      if (object === 'network.device') data = { eth0: { statistics: { rx_bytes: rx, tx_bytes: tx } } }
      return { body: { id: b.id, result: [0, data] } }
    }
    assert.equal((await api.loadOverview(c)).traffic.down, 0)
    const down = [], up = []
    for (const delta of [1, 4, 2]) {
      now += 1000; rx += delta; tx += 10000000
      const o = await api.loadOverview(c)
      assert.equal(o.traffic.down, delta); assert.equal(o.traffic.up, 10000000)
      down.push(o.traffic.down); up.push(o.traffic.up)
    }
    const oldHeight = Math.max(...down) / chart.plotScale([down, up], [down, up], 1, 1024) * 120
    assert.ok(oldHeight < 0.00005)
    let tree = plot(down, up), actual = svgPaths(tree)
    assert.deepEqual(ys(actual[0]), [90, 90, 0, 0, 0, 60, 60])
    const upPoints = chart.scrollPoints(up, up, 0, 300), step = 300 / 59
    const oldUpload = chart.smoothPath([{ x: upPoints[0].x - step, value: 0 }, ...upPoints], 120, 10000000)
    assert.equal(actual[1], oldUpload)
    assert.ok(text(tree).includes('下载·左轴')); assert.ok(text(tree).includes('上传·右轴'))
    // Axes correspond to actual blue/green path scales, not unlabeled normalization.
    const labels = nodes(tree, 'Text').map(n => text(n))
    for (const f of [1, .75, .5, .25]) { assert.ok(labels.includes(api.fmtSpeed(4 * f))); assert.ok(labels.includes(api.fmtSpeed(10000000 * f))) }
  })
  await test('zero stays zero; tiny rates and reversed disparity are visible; no invented points', () => {
    for (const up of [[0, 0, 0], [10000000, 10000000, 10000000]]) {
      assert.ok(ys(svgPaths(plot([0, 0, 0], up))[0]).every(y => y === 120))
    }
    assert.equal(Math.min(...ys(svgPaths(plot([1, 4, 2], [0, 0, 0]))[0])), 0)
    const fractional = plot([0.001, 0.004, 0.002], [10000000, 10000000, 10000000])
    assert.equal(Math.min(...ys(svgPaths(fractional)[0])), 0)
    assert.ok(text(fractional).includes('0.0040 B/s'))
    assert.equal(Math.min(...ys(svgPaths(plot([10000000, 20000000], [1, 2]))[0])), 0)
    assert.equal(svgPaths(plot([], [])).length, 0)
    assert.ok(!nodes(plot([5], [0]), 'SVG')[0].props.code.includes('stroke="#3B82F6"'))
    // No impact to the shared utility's existing floor or other metric semantics.
    assert.equal(chart.plotScale([[1, 4]], [[1, 4]], 1, 1024), 1024)
    unmount()
  })
  await test('download interpolation preserves changes and zero endpoint; disabled animation cleans up', async () => {
    let down = [1, 4, 2], up = [0, 0, 0]
    plot(down, up); await flush()
    now += 1000; down = [...down, 8]; up = [...up, 0]
    plot(down, up, false); await flush()
    now += 500; for (const t of [...intervals.values()]) t.fn()
    let tree = plot(down, up, false), mid = ys(svgPaths(tree)[0])
    assert.ok(mid.every(Number.isFinite)); assert.ok(new Set(mid).size > 1)
    now += 1000; for (const t of [...intervals.values()]) t.fn()
    tree = plot(down, up, false); assert.equal(Math.min(...ys(svgPaths(tree)[0])), 0)
    now += 1000; down = [...down, 0]; up = [...up, 0]
    plot(down, up, false); await flush()
    now += 3000; for (const t of [...intervals.values()]) t.fn()
    tree = plot(down, up, false); assert.equal(ys(svgPaths(tree)[0]).at(-1), 120)
    plot(down, up, false, false); await flush(); assert.equal(intervals.size, 0)
    unmount()
  })
  await test('push pauses sampling/animation props; pop resumes once, retaining toolbar and chart owner', async () => {
    pref.savePreferences({ connectionBackground: false })
    const router = { id: 'visibility-mock', kind: 'openwrt', url: 'http://visibility.invalid', username: 'root' }
    responder = (_url, init) => { const b = JSON.parse(init.body); return { body: { id: b.id, result: [0, b.params[1] === 'session' ? { ubus_rpc_session: 'visible' } : { uptime: 1, load: [], memory: { total: 100, free: 50 }, interface: [], data: '0' }] } } }
    const props = { active: router, version: 0, selected: true, onSwitch() {} }
    let tree = render(app.OverviewPage, props, true); await flush()
    tree = render(app.OverviewPage, props); const toolbar = tree.props.toolbar, link = trailing(toolbar)
    const polling = () => [...intervals.values()].filter(x => x.ms === 1000)
    for (let i = 0; i < 3; i++) {
      tree = render(app.OverviewPage, props)
      assert.equal(polling().length, 1)
      assert.equal(nodes(tree, app.RateChart).length, 1)
      const down = nodes(tree, app.RateChart)[0].props.down
      tree.props.onDisappear(); tree = render(app.OverviewPage, props); await flush()
      assert.equal(polling().length, 0); assert.equal(nodes(tree, app.RateChart)[0].props.enabled, false)
      assert.equal(nodes(tree, app.RateChart)[0].props.down, down)
      assert.equal(tree.props.toolbar, toolbar); assert.equal(trailing(tree.props.toolbar), link)
      const before = calls.length
      emitScene('background'); render(app.OverviewPage, props); await flush()
      emitScene('active'); tree = render(app.OverviewPage, props); await flush()
      assert.equal(calls.length, before); assert.equal(polling().length, 0)
      tree.props.onAppear(); tree = render(app.OverviewPage, props); await flush()
      assert.equal(polling().length, 1); assert.equal(nodes(tree, app.RateChart)[0].props.enabled, true)
      assert.equal(tree.props.toolbar, toolbar)
      tree = render(app.OverviewPage, { ...props, selected: false }); await flush()
      assert.equal(polling().length, 0)
      tree.props.onAppear(); render(app.OverviewPage, { ...props, selected: false }); await flush()
      assert.equal(polling().length, 0)
      tree = render(app.OverviewPage, props); await flush()
    }
    unmount(); assert.equal(intervals.size, 0); assert.equal(sceneListeners.size, 0)
  })
  console.log('All ' + count + ' targeted local regression groups passed')
})().catch(e => { console.error(e); process.exitCode = 1 })
`
vm.runInNewContext(harness + checks, { require, __dirname, console, process }, { filename: __filename })
