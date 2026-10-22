// Diagnostic regression: actual Root -> ubus -> CPU/rate -> home/detail feed.
// Virtual wall clock + transport latency; no network/device IO or remote writes.
const fs=require('node:fs'),vm=require('node:vm')
const source=fs.readFileSync(__dirname+'/home-root-sampling.cjs','utf8')
const setup=source.slice(source.indexOf('const writes=new WeakMap()'),source.indexOf(';(async()=>{'))
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
let clockID=0;const clock=new Map()
context.setInterval=(fn,ms)=>{const id=++clockID;intervals.set(id,{fn,ms});clock.set(id,{fn,ms,at:now+ms,repeat:true});return id}
context.clearInterval=id=>{intervals.delete(id);clock.delete(id)}
context.setTimeout=(fn,ms)=>{const id=++clockID;clock.set(id,{fn,at:now+ms,repeat:false});return id}
context.clearTimeout=id=>clock.delete(id)
async function advance(ms){const end=now+ms;await settle();while(true){const next=[...clock.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;const [id,t]=next;now=t.at;if(t.repeat)t.at+=t.ms;else clock.delete(id);t.fn();await settle()}now=end;await settle()}
const delayFetch=context.fetch
let latency=0,starts=[],finishes=[],transport=[]
context.fetch=async(url,init)=>{
 const batch=init.body?.startsWith('['),at=now
 if(batch){const dt=(now-1800000000000)/1000;user=100+dt*25;idle=900+dt*75;uptime=100+dt;rx=10000+dt*1000;tx=20000+dt*2000}
 const response=await delayFetch(url,init)
 if(batch){const ms=typeof latency==='function'?latency():latency;if(ms)await new Promise(resolve=>context.setTimeout(resolve,ms));transport.push({start:at,end:now})}
 return response
}
const timedOverview=api.loadOverview
api.loadOverview=async c=>{starts.push(now);const o=await timedOverview(c);finishes.push(now);return o}
const differences=xs=>xs.slice(1).map((x,i)=>x-xs[i])
;(async()=>{
 for(const ms of [0,200,2000])await test('effective Root cadence with '+ms+' ms ubus latency',async()=>{
  const c=device();active(c);starts=[];finishes=[];transport=[];latency=ms;calls.length=0;pref.savePreferences({detailedAPI:false})
  const root=owner(app.Root),page=owner(app.OverviewPage);root.render();page.render(props(c));await advance(ms+(1000+ms)+3*Math.max(1000,ms+500))
  const f=frame(page.render(props(c))),gaps=differences(finishes)
  assert.equal(finishes.length,5);assert.equal(gaps[0],1000+ms,"baseline keeps a full interval");assert.ok(gaps.slice(1).every(x=>x===Math.max(1000,ms+500)));assert.equal(activeChains,0);assert.equal(maxChains,1)
  assert.equal(f.histories.cpu.cpu.length,4);assert.equal(f.overview.wrt.cpu,25);assert.equal(f.overview.traffic.down,1000)
  assert.equal(transport.length,5,'one ubus POST per overview, no serial call fallback')
  console.log(JSON.stringify({latencyMs:ms,startGaps:differences(starts),publishGaps:gaps,cpu:f.overview.wrt.cpu,down:f.overview.traffic.down,historyPoints:f.histories.cpu.cpu.length}))
  page.close();root.close();await settle();assert.equal(clock.size,0);clean()
 })
 await test('alternating response times affect completion intervals; no three-second JS timer is required',async()=>{
  const c=device();active(c);starts=[];finishes=[];transport=[];const times=[200,2000,100,2000,200];latency=()=>times.shift()??0
  const root=owner(app.Root);root.render();await advance(7400)
  const gaps=differences(finishes);assert.equal(JSON.stringify(gaps),JSON.stringify([3000,600,2900,700]))
  console.log(JSON.stringify({varyingLatencyMs:[200,2000,100,2000,200],publishGaps:gaps}));root.close();await settle();assert.equal(clock.size,0);clean()
 })
 for(const detailedAPI of [false,true])await test('ubus log persistence path with detailedAPI='+detailedAPI,async()=>{
  pref.savePreferences({detailedAPI});const c=device();active(c);latency=0
  const root=owner(app.Root);root.render();await settle()
  const set=context.Storage.set;let logWrites=0
  context.Storage.set=(key,value)=>{if(key==='dashboard_logs_v140')logWrites++;return set(key,value)}
  try{await advance(4000);assert.equal(logWrites,detailedAPI?4:0);console.log(JSON.stringify({detailedAPI,steadySamples:4,logWrites}))}
  finally{context.Storage.set=set;root.close();await settle()}
  assert.equal(clock.size,0);clean()
 })
 await test('actual canvas animates for one second, then waits for real data without fabricating points',()=>{
  const html=load('plot-canvas').plotCanvasHTML(),js=/<script>([\s\S]*)<\/script>/.exec(html)[1]
  let at=0,id=0;const raf=new Map(),ctx=new Proxy({},{get:()=>()=>{}})
  const canvas={getContext:()=>ctx,getBoundingClientRect:()=>({width:300,height:96}),width:0,height:0}
  const window={devicePixelRatio:1,addEventListener(){},webkit:{messageHandlers:{plotReady:{postMessage:()=>Promise.resolve(true)}}}}
  require('node:vm').runInNewContext(js,{window,document:{querySelector:()=>canvas,body:{style:{}},hidden:false,addEventListener(){}},performance:{now:()=>at},ResizeObserver:class{observe(){}},requestAnimationFrame:fn=>{const n=++id;raf.set(n,fn);return n},cancelAnimationFrame:n=>raf.delete(n),setTimeout(){},Promise})
  const plot=window.plotCanvas,send=(seq,samples)=>plot.update({seq,samples,running:true,percent:true,tone:'#3485eb'})
  const step=t=>{at=t;const callbacks=[...raf.values()];raf.clear();callbacks.forEach(fn=>fn(t))}
  send(1,[10,20]);send(2,[10,20,80]);for(let t=20;t<=1000;t+=20)step(t)
  const end=plot.inspect();assert.equal(end.stats.liveLoops,0);assert.equal(end.shown.at(-1).y,80)
  for(let t=1020;t<=3000;t+=20)step(t)
  const waiting=plot.inspect();assert.equal(waiting.stats.frames,end.stats.frames);assert.equal(waiting.history.length,3)
  send(3,[10,20,80,40]);step(3020);assert.equal(plot.inspect().stats.liveLoops,1)
  console.log(JSON.stringify({newDataIntervalMs:3000,animationMs:1000,stationaryMs:2000,framesWhileWaiting:waiting.stats.frames-end.stats.frames,fabricatedSamples:0}))
 })
 await test('adaptive animation uses received timestamps only; slow arrivals remain in motion longer without extrapolation',()=>{
  const html=load('plot-canvas').plotCanvasHTML(),js=/<script>([\s\S]*)<\/script>/.exec(html)[1]
  let at=10,id=0;const raf=new Map(),lags=[],ctx=new Proxy({},{get:()=>()=>{}})
  const canvas={getContext:()=>ctx,getBoundingClientRect:()=>({width:300,height:96}),width:0,height:0}
  const window={devicePixelRatio:1,addEventListener(){},webkit:{messageHandlers:{plotReady:{postMessage:()=>Promise.resolve(true)},plotLag:{postMessage:ms=>{lags.push(ms);return Promise.resolve(true)}}}}}
  require('node:vm').runInNewContext(js,{window,document:{querySelector:()=>canvas,body:{style:{}},hidden:false,addEventListener(){}},performance:{now:()=>at},ResizeObserver:class{observe(){}},requestAnimationFrame:fn=>{const n=++id;raf.set(n,fn);return n},cancelAnimationFrame:n=>raf.delete(n),setTimeout(){},Promise})
  const plot=window.plotCanvas,send=(seq,samples,sampleAt)=>plot.update({seq,samples,sampleAt,running:true,percent:true,tone:'#3485eb'})
  const step=t=>{at=t;const callbacks=[...raf.values()];raf.clear();callbacks.forEach(fn=>fn(t))}
  send(1,[10,20],1000);send(2,[10,20,80],3500)
  for(let t=30;t<=1510;t+=20)step(t)
  const mid=plot.inspect();assert.equal(mid.stats.liveLoops,1);assert.ok(mid.shown.at(-1).y>20&&mid.shown.at(-1).y<80);assert.equal(JSON.stringify(mid.history),'[10,20,80]')
  for(let t=1530;t<=2510;t+=20)step(t)
  assert.equal(plot.inspect().shown.at(-1).y,80);assert.equal(plot.inspect().stats.liveLoops,0);assert.equal(lags.length,0)
  send(3,[10,20,80,40],4500);step(4510);assert.equal(lags.length,1,'only abnormal rAF gap crosses bridge, not each frame')
  assert.equal(plot.inspect().history.length,4)
 })
 await test('bounded memory timing distinguishes request/JS/bridge and is actually copyable from existing logs UI',async()=>{
  const diag=load('cadence-diagnostics'),before=calls.length,set=context.Storage.set;let writes=0
  context.Storage.set=(k,v)=>{writes++;return set(k,v)}
  const ownerDiag=diag.beginCadenceDiagnostics('secret-address-auth-canary');ownerDiag.resume();const token=diag.timingToken('secret-address-auth-canary')
  assert.equal(diag.timingToken('other'),undefined)
  diag.timing(token,'headers',2200);const done=diag.timingSpan(token,'bridge');now+=3000
  const beat=[...intervals.values()].find(x=>x.ms===250);beat.fn()
  let summary=diag.cadenceSummary();assert.ok(summary.includes('bridge: 尚未完成'));assert.ok(summary.includes('js-gap'));assert.ok(summary.includes('headers'))
  done();for(let i=0;i<100;i++)diag.timing(token,'bridge',2000)
  summary=diag.cadenceSummary();assert.ok(summary.split('\n').filter(x=>/^-\d+ms/.test(x)).length<=32);assert.ok(!summary.includes('secret-address-auth-canary'));assert.equal(writes,0);assert.equal(calls.length,before)
  ownerDiag.pause();const paused=diag.cadenceSummary();diag.timing(token,'read',999999);assert.equal(diag.cadenceSummary(),paused,'late/background spans cannot enter a new epoch');ownerDiag.close();context.Storage.set=set
  const logs=owner(ui.LogsPage),tree=logs.render({});const copy=nodes(tree.props.toolbar.topBarTrailing,'Button').find(n=>n.props.title==='复制停顿诊断');assert.ok(copy);await copy.props.action();assert.ok(clipboard.includes('采样/绘图计时摘要'));assert.ok(!clipboard.includes('secret-address-auth-canary'));logs.close();await settle();assert.equal(clock.size,0);clean()
 })
 console.log('Cadence improvement passed: request time is subtracted; slow baselines retain 1000ms and steady completions retain >=500ms; one chain, no fabricated points.')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+setup+checks,{require,__dirname,console,process},{filename:__filename})
