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
      assert.equal(nodes(tree, home.HomeDashboard).length, 1)
      const down = nodes(tree, home.HomeDashboard)[0].props.histories.down
      tree.props.onDisappear(); tree = render(app.OverviewPage, props); await flush()
      assert.equal(polling().length, 0); assert.equal(nodes(tree, home.HomeDashboard)[0].props.running, false)
      assert.equal(nodes(tree, home.HomeDashboard)[0].props.histories.down, down)
      assert.equal(tree.props.toolbar, toolbar); assert.equal(trailing(tree.props.toolbar), link)
      const before = calls.length
      emitScene('background'); render(app.OverviewPage, props); await flush()
      emitScene('active'); tree = render(app.OverviewPage, props); await flush()
      assert.equal(calls.length, before); assert.equal(polling().length, 0)
      tree.props.onAppear(); tree = render(app.OverviewPage, props); await flush()
      assert.equal(polling().length, 1); assert.equal(nodes(tree, home.HomeDashboard)[0].props.running, true)
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
