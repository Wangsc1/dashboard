// Real API -> ubus batch -> CpuSampler -> OverviewPage. Delayed RPC and virtual time;
// no API sampling stubs, router IO, native rendering or performance claims.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
scripting.useState=function(v){const slots=hooks,i=hookIndex++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]}
function owner(fn){const state={hooks:[],cleanups:new Map()};return {render(props){const saved={hooks,cleanups,effects,hookIndex};hooks=state.hooks;cleanups=state.cleanups;effects=[];hookIndex=0;const tree=fn(props),queued=effects;hooks=saved.hooks;cleanups=saved.cleanups;effects=saved.effects;hookIndex=saved.hookIndex;queued.forEach(f=>{const previous=cleanups;cleanups=state.cleanups;f();cleanups=previous});return tree},close(){for(const f of state.cleanups.values())f();state.cleanups.clear()}}}
async function settle(){for(let i=0;i<140;i++)await Promise.resolve()}
const timeouts=new Map();let timerID=0
context.setTimeout=(fn,ms)=>{const id=++timerID;timeouts.set(id,{fn,at:now+ms});return id};context.clearTimeout=id=>timeouts.delete(id)
async function advance(ms){now+=ms;const due=[...timeouts.entries()].filter(([,v])=>v.at<=now);for(const [id,v]of due){timeouts.delete(id);v.fn()}await settle()}
for(const name of ['prefetchProxies','prefetchRules','prefetchConnections','prefetchMoreVersions'])pages[name]=()=>{}
pref.savePreferences({defaultPage:'more'})
let user=100,idle=900,uptime=100,rx=10000,tx=20000,batches=0
function fixture(url,init){
 if(url.includes('cgi-download'))return {status:403}
 const q=JSON.parse(init.body),[,obj,method,args]=q.params,ok=value=>({body:{id:q.id,result:[0,value]}})
 if(obj==='session')return ok({ubus_rpc_session:'warmup-session'})
 if(obj==='system'&&method==='info'){batches++;return ok({uptime,load:[],memory:{total:1000,free:500}})}
 if(obj==='system'&&method==='board')return ok({model:'Warmup board',release:{description:'Fixture'}})
 if(obj==='network.interface')return ok({interface:[{interface:'wan',l3_device:'eth0',route:[{target:'0.0.0.0'}]}]})
 if(obj==='network.device')return ok({eth0:{statistics:{rx_bytes:rx,tx_bytes:tx}}})
 if(obj==='file'&&args?.path==='/proc/stat')return ok({data:'cpu '+user+' 0 0 '+idle+' 0 0 0 0\ncpu0 '+user+' 0 0 '+idle+' 0 0 0 0\n'})
 return ok({})
}
responder=fixture
// Observe actual results without replacing API behavior or the sampler.
const realOverview=api.loadOverview,results=[]
api.loadOverview=async c=>{const o=await realOverview(c);results.push(o);return o}
const originalFetch=context.fetch
let block=null
context.fetch=async(url,init)=>{const response=await originalFetch(url,init);if(block&&init.body.startsWith('[')&&(!block.url||block.url===url)){const b=block;block=null;await b.wait}return response}
function delay(url){let release;const wait=new Promise(r=>release=r);block={wait,url};return release}
function counters(percent=25){user+=percent;idle+=100-percent;uptime++;rx+=1000;tx+=2000}
let serial=0
function device(){const id='startup-warm-'+(++serial);return {id,name:id,kind:'openwrt',url:'http://'+id+'.invalid',username:'root'}}
function active(c){store.set('neko_controllers_v1',[c]);store.set('neko_active_v1',c.id)}
function frame(tree){return nodes(tree,home.HomeDashboard)[0].props}
function props(c,selected=false){return {active:c,selected,version:0,onSwitch(){}}}
async function polls(){for(const timer of [...intervals.values()])timer.fn();await settle()}
function clean(){assert.equal(intervals.size,0);assert.equal(timeouts.size,0);assert.equal(sceneListeners.size,0)}
;(async()=>{
 await test('delayed first result is only a baseline; second real sample warms CPU and rates before selecting home',async()=>{
  const c=device();active(c);const root=owner(app.Root),page=owner(app.OverviewPage)
  const release=delay();const pending=app.primeOverview(c);root.render({});await settle();const before=batches
  assert.equal(timeouts.size,0,'warm interval starts after slow response, not launch')
  await advance(700);release();await settle()
  let tree=page.render(props(c));await settle();tree=page.render(props(c));await settle()
  assert.equal(results.at(-1).wrt.cpu,undefined,'real API first sample has no CPU delta')
  assert.ok(frame(tree).overview);assert.equal(frame(tree).overview.wrt.cpu,undefined,'single /proc/stat cannot calculate CPU')
  assert.equal(frame(tree).overview.traffic.down,0,'first byte counters are only a baseline')
  assert.equal(timeouts.size,1)
  counters(25);await advance(499);assert.equal(batches,before,'not enough time for second sample')
  const secondRelease=delay();await advance(501);assert.equal(batches,before+1)
  secondRelease();await pending;await settle();tree=page.render(props(c));await settle()
  assert.equal(frame(tree).overview.wrt.cpu,25);assert.equal(frame(tree).overview.wrt.cpus[1].usage,25)
  assert.equal(frame(tree).overview.traffic.down,1000);assert.equal(frame(tree).overview.traffic.up,2000)
  const reads=batches;await polls();await advance(5000);assert.equal(batches,reads,'successful hidden warmup stops after two samples')
  // Simulate the reported 54-second lazy tab gap, then a delayed selected baseline.
  await advance(54000);counters(80);const selectedRelease=delay();tree=page.render(props(c,true));await settle()
  assert.equal(frame(tree).overview.wrt.cpu,25,'first selected frame has prewarmed numeric CPU')
  selectedRelease();await settle();tree=page.render(props(c,true));await settle()
  assert.equal(results.at(-1).wrt.cpu,undefined,'real selected reset response is a new baseline')
  assert.equal(frame(tree).overview.wrt.cpu,25,'selected reset baseline must retain same-source warm CPU')
  assert.deepEqual(Array.from(frame(tree).histories.cpu.cpu??[]),[25],'baseline retains the one real warmup graph point without adding a held CPU')
  assert.equal(frame(tree).overview.traffic.down,1000,'baseline must not replace the displayed warm rate with zero')
  assert.deepEqual(Array.from(frame(tree).histories.down),[1000])
  counters(60);await advance(1000);await polls();tree=page.render(props(c,true));await settle()
  assert.equal(frame(tree).overview.wrt.cpu,60);assert.deepEqual(Array.from(frame(tree).histories.cpu.cpu),[25,60])
  page.close();root.close();clean()
 })
 await test('tab return and same-source unmount/remount restore overview and CPU/traffic history before delayed baseline',async()=>{
  const c=device(),page=owner(app.OverviewPage);page.render(props(c,true));await settle()
  for(const percent of [20,40,60]){counters(percent);await advance(1000);await polls();page.render(props(c,true));await settle()}
  let tree=page.render(props(c,true));const held=frame(tree),history=JSON.stringify(held.histories),rate=held.overview.traffic.down
  assert.equal(held.overview.wrt.cpu,60);assert.equal(rate,1000)
  page.render(props(c));await settle();const reads=batches;await advance(15000);await polls();assert.equal(batches,reads,'hidden tab does not sample')
  counters(80);let release=delay();tree=page.render(props(c,true));assert.equal(frame(tree).overview,held.overview);assert.equal(JSON.stringify(frame(tree).histories),history)
  await settle();release();await settle();tree=page.render(props(c,true));await settle();assert.equal(frame(tree).overview.wrt.cpu,60);assert.equal(frame(tree).overview.traffic.down,rate);assert.equal(JSON.stringify(frame(tree).histories),history)
  page.render(props(c));await settle();page.close()
  const remount=owner(app.OverviewPage);await advance(15000);counters(90);release=delay();tree=remount.render(props(c,true))
  assert.equal(frame(tree).overview.wrt.cpu,60,'remount first frame restores numeric CPU')
  assert.equal(frame(tree).overview.traffic.down,rate,'remount first frame restores numeric rate')
  assert.equal(JSON.stringify(frame(tree).histories),history,'remount first frame includes all existing plots')
  await settle();release();await settle();tree=remount.render(props(c,true));await settle();assert.equal(JSON.stringify(frame(tree).histories),history);assert.equal(frame(tree).overview.wrt.cpu,60);assert.equal(frame(tree).overview.traffic.down,rate)
  counters(30);await advance(1000);await polls();tree=remount.render(props(c,true));await settle();assert.equal(frame(tree).overview.wrt.cpu,30);assert.deepEqual(Array.from(frame(tree).histories.cpu.cpu),[20,40,60,30]);assert.deepEqual(Array.from(frame(tree).histories.down),[1000,1000,1000,1000])
  // A reboot must not hold the old drawing as if it were the same running device.
  remount.render(props(c));await settle();uptime=1;user=1;idle=9;rx=100;tx=200
  remount.render(props(c,true));await settle();tree=remount.render(props(c,true));await settle();assert.equal(frame(tree).overview.wrt.cpu,undefined);assert.equal(frame(tree).overview.traffic.down,0);assert.deepEqual(Array.from(frame(tree).histories.down),[]);assert.deepEqual(Array.from(frame(tree).histories.cpu.cpu??[]),[])
  remount.close();clean()
 })
 await test('selected home ticks cannot race the bounded warmup into a zero CPU delta',async()=>{
  const c=device();const pending=app.primeOverview(c),page=owner(app.OverviewPage);page.render(props(c,true));await settle()
  const before=batches;await polls();assert.equal(batches,before,'page consumes prime notifications instead of competing RPC')
  counters(40);await advance(1000);await pending;let tree=page.render(props(c,true));await settle()
  assert.equal(batches,before+1);assert.equal(frame(tree).overview.wrt.cpu,40)
  page.close();clean()
 })
 await test('background cancels sample-two timer; Root resumes unfinished warmup even though baseline is cached',async()=>{
  const c=device();active(c);const root=owner(app.Root);const first=app.primeOverview(c);root.render({});await settle();const before=batches
  emitScene('background');root.render({});await first;await settle();assert.equal(timeouts.size,0)
  await advance(30000);await polls();assert.equal(batches,before,'no background sample-two request')
  counters(20);emitScene('active');root.render({});await settle();assert.equal(batches,before+1,'resume obtains new baseline')
  counters(35);await advance(1000);await settle();assert.equal(batches,before+2)
  const page=owner(app.OverviewPage);let tree=page.render(props(c));await settle();assert.equal(frame(tree).overview.wrt.cpu,35)
  const reads=batches;await polls();assert.equal(batches,reads,'successful retry stops')
  page.close();root.close();clean()
 })
 await test('background during delayed sample two rejects old epoch; resume warms a fresh pair',async()=>{
  const c=device();active(c);const root=owner(app.Root);const first=app.primeOverview(c);root.render({});await settle()
  counters(30);const release=delay();await advance(1000);emitScene('background');root.render({});release();await first;await settle()
  counters(70);emitScene('active');root.render({});await settle();counters(45);await advance(1000)
  const page=owner(app.OverviewPage);const tree=page.render(props(c));await settle();assert.equal(frame(tree).overview.wrt.cpu,45)
  page.close();root.close();clean()
 })
 await test('same-id URL/auth switch never uses old warm CPU; delayed old-source sample cannot populate current UI',async()=>{
  const c=device();const old=app.primeOverview(c);await settle();counters(20);const release=delay(c.url+'/ubus');await advance(1000)
  const next={...c,url:c.url+'-new'};secrets.set('neko_secret_'+c.id,'changed-auth-not-logged');const warming=app.primeOverview(next);await settle()
  const page=owner(app.OverviewPage);let tree=page.render(props(next));await settle();assert.equal(frame(tree).overview.wrt.cpu,undefined,'different-source first sample cannot borrow old CPU');assert.deepEqual(Array.from(frame(tree).histories.down),[])
  counters(55);await advance(1000);await warming;release();await old;await settle();tree=page.render(props(next));await settle();assert.ok(Math.abs(frame(tree).overview.wrt.cpu-55)<1e-9)
  // Changing auth again without a warmed cache must clear the old display.
  secrets.set('neko_secret_'+c.id,'another-auth');tree=page.render(props(next,true));assert.equal(frame(tree).overview,null);assert.deepEqual(Array.from(frame(tree).histories.down),[]);await settle();tree=page.render(props(next,true));await settle();assert.equal(frame(tree).overview.wrt.cpu,undefined)
  page.close();clean()
 })
 console.log(count+' real API startup warmup groups passed (mock IO/native lifecycle)')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
