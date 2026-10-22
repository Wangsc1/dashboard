// Safe effective-path diagnostics, not a reproduction of the reported iPhone failure.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
scripting.useState=function(v){const slots=hooks,i=hookIndex++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]}
function owner(fn){const state={hooks:[],cleanups:new Map()};return {render(props){const saved={hooks,cleanups,effects,hookIndex};hooks=state.hooks;cleanups=state.cleanups;effects=[];hookIndex=0;const tree=fn(props),queued=effects;hooks=saved.hooks;cleanups=saved.cleanups;effects=saved.effects;hookIndex=saved.hookIndex;queued.forEach(f=>{const previous=cleanups;cleanups=state.cleanups;f();cleanups=previous});return tree},close(){for(const f of state.cleanups.values())f();state.cleanups.clear()}}}
async function settle(){for(let i=0;i<120;i++)await Promise.resolve()}
const timers=new Map();let timerID=0
context.setTimeout=(fn,ms)=>{const id=++timerID;timers.set(id,{fn,ms});return id};context.clearTimeout=id=>timers.delete(id)
const secret='private-canary-effective-secret',url='http://private-canary-effective.invalid',id='private-canary-effective-id'
const c={id,name:'private-canary-effective-name',url,kind:'openwrt',username:'private-canary-effective-user'}
secrets.set('neko_secret_'+id,secret)
let cpu=20
const sample=()=>({version:'private-canary-effective-data',traffic:{up:9876543210,down:8765432109},upTotal:1,downTotal:2,connCount:1,wrt:{model:'private-canary-effective-model',uptime:100,cpus:[{id:'cpu',usage:cpu},{id:'cpu0',usage:cpu}],cpu,load:[]}})
api.loadOverview=async()=>sample()
const homeLine=tree=>nodes(tree,'Text').map(text).find(t=>t.startsWith('主页诊断 '))
const graphLine=tree=>nodes(tree,'Text').map(text).find(t=>t.startsWith('图诊断 '))
const homeProps={active:c,selected:true,version:0,onSwitch(){}}
let hosts=[]
context.WebViewController=class{constructor(){this.handlers={};this.loads=0;this.disposed=0;hosts.push(this)}async addScriptMessageHandler(n,f){this.handlers[n]=f}async loadHTML(html){this.loads++;this.html=html;return true}async evaluateJavaScript(code){this.last=code;return true}dispose(){this.disposed++}}
const plot=load('plot-view')
;(async()=>{
 await test('home diagnostics show cache/history continuity across native remount and distinguish a changed source',async()=>{
  const page=owner(app.OverviewPage);let tree=page.render(homeProps);await settle()
  for(cpu of [30,40]){now+=1000;for(const t of [...intervals.values()])t.fn();await settle();tree=page.render(homeProps);await settle()}
  let line=homeLine(tree);assert.match(line,/CPU点3 上点2 下点2/);assert.match(line,/匹配1/)
  const run=line.match(/R(\d+)/)[1],source=line.match(/源(\d+)/)[1],pageId=line.match(/页(\d+)/)[1]
  page.render({...homeProps,selected:false});await settle();page.close()
  const remount=owner(app.OverviewPage);tree=remount.render({...homeProps,selected:false});line=homeLine(tree)
  assert.ok(line.includes('R'+run));assert.ok(line.includes('源'+source));assert.notEqual(line.match(/页(\d+)/)[1],pageId);assert.match(line,/初缓存1/);assert.match(line,/CPU点3 上点2 下点2/)
  await settle();secrets.set('neko_secret_'+id,secret+'-changed');tree=remount.render({...homeProps,selected:false});line=homeLine(tree)
  assert.notEqual(line.match(/源(\d+)/)[1],source);assert.match(line,/CPU点0 上点0 下点0/)
  await settle();remount.close();assert.equal(intervals.size,0)
 })
 await test('default-visible graph trace distinguishes supplied points, actual draw, readiness/reveal and host remount without resetting samples',async()=>{
  const props={samples:[123450001,234560002,345670003],tone:'#3485eb',running:false,percent:false,diagnostic:true},page=owner(plot.MountedCanvasPlot)
  let tree=page.render(props);assert.match(graphLine(tree),/入3 画0 尺0 线0/);await settle();const host=hosts.at(-1)
  assert.equal(host.loads,1);assert.ok(host.html.includes('"samples":[123450001,234560002,345670003]'));assert.ok(host.html.includes('traceEnabled=true'));assert.ok(host.html.includes('diagnosticEnabled=false'))
  host.handlers.plotReady();host.handlers.plotTrace({seq:1,samples:3,sized:true,line:true});host.handlers.plotPainted();await settle();tree=page.render(props)
  assert.match(graphLine(tree),/入3 画3 尺1 线1 就绪1 显1/)
  const logs=()=>pref.getLogs().filter(l=>l.detail.startsWith('plot-state'))
  const before=JSON.stringify(logs());for(let i=0;i<60;i++)host.handlers.plotTrace({seq:1,samples:3,sized:true,line:true});assert.equal(JSON.stringify(logs()),before,'no per-frame or per-second log writes')
  for(const bad of [{seq:999,samples:3,sized:true,line:true},{seq:1,samples:61,sized:true,line:true},{seq:1,samples:secret,sized:true,line:true},{seq:1,samples:3,sized:secret,line:true}])assert.equal(host.handlers.plotTrace(bad),false)
  assert.equal(JSON.stringify(logs()),before)
  const oldId=graphLine(tree).match(/H(\d+)/)[1];page.close();assert.equal(host.handlers.plotTrace({seq:1,samples:3,sized:true,line:true}),false)
  const newPage=owner(plot.MountedCanvasPlot);tree=newPage.render(props);await settle();assert.notEqual(graphLine(tree).match(/H(\d+)/)[1],oldId);assert.match(graphLine(tree),/入3/);assert.equal(hosts.at(-1).loads,1);newPage.close();assert.equal(timers.size,0)
 })
 await test('only home plots opt into visible diagnostics; CPU detail plots have no extra bridge reports',async()=>{
  const cpu=nodes(home.CpuCard({history:[10,20],running:true}),home.GridPlot)[0];assert.equal(cpu.props.diagnostic,true)
  const core=home.SampledCpuPlot({samples:[10,20],running:true});assert.equal(core.props.diagnostic,undefined)
  const page=owner(plot.MountedCanvasPlot);const tree=page.render(core.props);await settle();const host=hosts.at(-1);assert.equal(graphLine(tree),undefined);assert.equal(host.handlers.plotTrace,undefined);assert.ok(host.html.includes('traceEnabled=false'));page.close()
 })
 await test('exported trace is bounded enums/counters only; no controller identity, source token, sample values or error text',()=>{
  pref.recordEvent('homeDiagnostic',true,{home:{stage:'plot-state',host:secret,input:9999999999,drawn:-1,run:url,source:secret,cpuPoints:61,reason:secret,raw:secret}})
  const exported=pref.exportLogs();for(const value of [secret,url,id,c.name,c.username,'private-canary-effective-data','private-canary-effective-model','123450001','234560002','345670003','9876543210','8765432109','wrt-source-','9999999999'])assert.ok(!exported.includes(value),value)
  const details=pref.getLogs().filter(x=>x.title.startsWith('主页诊断')).map(x=>x.detail)
  assert.ok(details.some(d=>d.includes('home-frame')&&d.includes('cpuPoints=3')));assert.ok(details.some(d=>d.includes('plot-state')&&d.includes('drawn=3')&&d.includes('line=1')))
 })
 assert.equal(intervals.size,0);assert.equal(timers.size,0);assert.equal(sceneListeners.size,0)
 console.log(count+' effective-path trace groups passed; no device-root-cause claim')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
