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
 console.log('Cadence improvement passed: request time is subtracted; slow baselines retain 1000ms and steady completions retain >=500ms; one chain.')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+setup+checks,{require,__dirname,console,process},{filename:__filename})
