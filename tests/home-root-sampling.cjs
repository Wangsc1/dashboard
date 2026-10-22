// Effective Root -> real API/ubus -> CPU/rate sampler -> OverviewPage lifecycle.
// Only transport/native hooks/time are mocked; no router or device IO.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
const writes=new WeakMap()
scripting.useState=function(v){const slots=hooks,i=hookIndex++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],v=>{writes.set(slots,(writes.get(slots)||0)+1);slots[i]=typeof v==='function'?v(slots[i]):v}]}
function owner(fn){const state={hooks:[],cleanups:new Map()};return {render(props={}){const saved={hooks,cleanups,effects,hookIndex};hooks=state.hooks;cleanups=state.cleanups;effects=[];hookIndex=0;const tree=fn(props),queued=effects;hooks=saved.hooks;cleanups=saved.cleanups;effects=saved.effects;hookIndex=saved.hookIndex;queued.forEach(f=>{const previous=cleanups;cleanups=state.cleanups;f();cleanups=previous});return tree},writes(){return writes.get(state.hooks)||0},close(){for(const f of state.cleanups.values())f();state.cleanups.clear()}}}
const timeouts=new Map();let timerID=0
context.setTimeout=(fn,ms)=>{const id=++timerID;timeouts.set(id,{fn,ms});return id};context.clearTimeout=id=>timeouts.delete(id)
async function settle(){for(let i=0;i<160;i++)await Promise.resolve()}
for(const name of ['prefetchProxies','prefetchRules','prefetchConnections','prefetchMoreVersions'])pages[name]=()=>{}
pref.savePreferences({defaultPage:'proxies',connectionBackground:false})
let user=100,idle=900,uptime=100,rx=10000,tx=20000,batches=0,serial=0,failBatch=false,block=null,activeChains=0,maxChains=0
function fixture(url,init){
 if(url.includes('cgi-download'))return {status:403}
 const q=JSON.parse(init.body),[,obj,method,args]=q.params,ok=value=>({body:{id:q.id,result:[0,value]}})
 if(obj==='session')return ok({ubus_rpc_session:'root-sampling-session'})
 if(obj==='system'&&method==='info'){batches++;return ok({uptime,load:[],memory:{total:1000,free:500}})}
 if(obj==='system'&&method==='board')return ok({model:'Fixture board',release:{description:'Fixture'}})
 if(obj==='network.interface')return ok({interface:[{interface:'wan',l3_device:'eth0',route:[{target:'0.0.0.0'}]}]})
 if(obj==='network.device')return ok({eth0:{statistics:{rx_bytes:rx,tx_bytes:tx}}})
 if(obj==='file'&&args?.path==='/proc/stat')return ok({data:'cpu '+user+' 0 0 '+idle+' 0 0 0 0\ncpu0 '+user+' 0 0 '+idle+' 0 0 0 0\n'})
 return ok({})
}
responder=fixture
const realOverview=api.loadOverview,results=[]
api.loadOverview=async c=>{activeChains++;maxChains=Math.max(maxChains,activeChains);try{const o=await realOverview(c);results.push(o);return o}finally{activeChains--}}
const originalFetch=context.fetch
context.fetch=async(url,init)=>{
 const batch=init.body?.startsWith('[')
 if(batch&&failBatch){failBatch=false;throw Error('fixture temporary timeout')}
 const response=await originalFetch(url,init)
 if(batch&&block){const b=block;block=null;b.signal=init.signal;await b.wait;/* Deliberately ignore abort here to prove epoch rejects a late transport. */}
 return response
}
function delay(){let release;const b={wait:new Promise(r=>release=r),release:()=>release()};block=b;return b}
function counters(percent=25){user+=percent;idle+=100-percent;uptime++;rx+=1000;tx+=2000}
function device(){const id='root-sampling-'+(++serial);return {id,name:id,kind:'openwrt',url:'http://'+id+'.invalid',username:'root'}}
function active(c){store.set('neko_controllers_v1',c?[c]:[]);if(c)store.set('neko_active_v1',c.id);else store.delete('neko_active_v1')}
function frame(tree){return nodes(tree,home.HomeDashboard)[0].props}
function props(c,selected=true){return {active:c,selected,version:0,onSwitch(){}}}
function polls(){return [...intervals.values()].filter(t=>t.ms===1000)}
async function tick(percent=25){counters(percent);now+=1000;for(const t of [...intervals.values()])t.fn();await settle()}
function clean(){assert.equal(intervals.size,0);assert.equal(timeouts.size,0);assert.equal(sceneListeners.size,0);assert.equal(activeChains,0)}
const equal=(a,b)=>assert.equal(JSON.stringify(a),JSON.stringify(b))
;(async()=>{
 await test('non-home launch accumulates real history before home ever mounts; hidden home has zero per-sample state writes',async()=>{
  const c=device();active(c);const root=owner(app.Root),page=owner(app.OverviewPage)
  let rt=root.render();assert.equal(rt.props.selection.value,'proxies');await settle();assert.equal(polls().length,1)
  for(let i=0;i<8;i++)await tick(20+i)
  let tree=page.render(props(c));let f=frame(tree);assert.equal(f.histories.up.length,8);assert.equal(f.histories.down.length,8);assert.equal(f.histories.cpu.cpu.length,8);assert.equal(f.overview.traffic.down,1000);assert.equal(f.overview.wrt.cpu,27)
  await settle();tree=page.render(props(c,false));await settle();const before=page.writes(),old=frame(tree).histories
  for(let i=0;i<4;i++)await tick(40)
  assert.equal(page.writes(),before,'hidden home is not subscribed to sampling updates')
  tree=page.render(props(c));f=frame(tree);assert.equal(f.histories.cpu.cpu.length,12,'return first render already contains the complete latest snapshot');assert.notEqual(f.histories,old)
  assert.ok(!text(tree).includes('主页诊断'));assert.equal(polls().length,1)
  await settle();page.close();root.close();await settle();clean()
 })
 await test('all foreground tabs and pushed settings keep one uninterrupted chain and real deltas; history remains capped at 60',async()=>{
  const c=device();active(c);const root=owner(app.Root),page=owner(app.OverviewPage);let rt=root.render();await settle();await tick(30)
  let tree=page.render(props(c));await settle();const link=trailing(tree.props.toolbar)
  for(const tab of ['home','proxies','rules','connections','more','home']){
   const before=batches;rt.props.selection.setValue(tab);rt=root.render();tree=page.render(props(c,tab==='home'));await settle();assert.equal(batches,before,'switch alone causes no request or reset');assert.equal(polls().length,1)
   await tick(35);assert.equal(results.at(-1).wrt.cpu,35);assert.equal(results.at(-1).traffic.down,1000)
  }
  tree=page.render(props(c));await settle();tree.props.onDisappear();page.render(props(c));await settle();await tick(45);assert.equal(polls().length,1)
  tree.props.onAppear();tree=page.render(props(c));await settle();assert.equal(trailing(tree.props.toolbar).props.destination.type,app.SettingsPage);assert.equal(frame(tree).overview.wrt.cpu,45)
  for(let i=0;i<65;i++)await tick(50)
  tree=page.render(props(c));assert.equal(frame(tree).histories.up.length,60);assert.equal(frame(tree).histories.cpu.cpu.length,60);assert.equal(maxChains,1)
  await settle();page.close();root.close();await settle();clean()
 })
 await test('a delayed first batch cannot race tabs/page mount/ticks; next delta waits a real interval after completion',async()=>{
  const c=device();active(c);const root=owner(app.Root),page=owner(app.OverviewPage),held=delay();let rt=root.render();await settle();const before=batches
  page.render(props(c));await settle()
  for(let i=0;i<4;i++){rt.props.selection.setValue(i%2?'home':'more');rt=root.render();await tick(20)}
  assert.equal(batches,before);assert.equal(activeChains,1);assert.equal(maxChains,1)
  held.release();await settle();let tree=page.render(props(c));assert.equal(frame(tree).histories.up.length,0);assert.equal(frame(tree).overview.wrt.cpu,undefined)
  for(const t of polls())t.fn();await settle();assert.equal(batches,before,'no immediate near-zero delta after slow completion')
  await tick(30);tree=page.render(props(c));assert.equal(frame(tree).histories.up.length,1);assert.ok(Number.isFinite(frame(tree).overview.wrt.cpu));assert.equal(maxChains,1)
  await settle();page.close();root.close();await settle();clean()
 })
 await test('background/inactive pause immediately without waiting for render; resume baseline preserves history but adds no fabricated point',async()=>{
  const c=device();active(c);const root=owner(app.Root),page=owner(app.OverviewPage);root.render();await settle();await tick(20);await tick(40)
  let tree=page.render(props(c));await settle();tree=page.render(props(c));const old=frame(tree),history=old.histories
  emitScene('inactive');assert.equal(polls().length,0);emitScene('background');const before=batches
  for(let i=0;i<5;i++)await tick(90);assert.equal(batches,before)
  emitScene('active');await settle();tree=page.render(props(c));assert.equal(frame(tree).histories.cpu,history.cpu);assert.equal(frame(tree).histories.up,history.up);assert.equal(frame(tree).histories.down,history.down);assert.equal(frame(tree).overview.wrt.cpu,40)
  await tick(30);tree=page.render(props(c));equal(frame(tree).histories.cpu.cpu,[20,40,30]);assert.equal(frame(tree).overview.traffic.down,1000);assert.equal(frame(tree).overview.wrt.cpu,30)
  await settle();page.close();root.close();await settle();clean()
 })
 await test('paused in-flight read is aborted and late response rejected; resume keeps single chain, exit prevents later work',async()=>{
  const c=device();active(c);const root=owner(app.Root),page=owner(app.OverviewPage);root.render();await settle();await tick(20)
  const held=delay();await tick(40);assert.equal(activeChains,1);emitScene('background');assert.equal(held.signal.aborted,true)
  emitScene('active');await tick(60);assert.equal(activeChains,1,'resume cannot overlap an unfinished request')
  held.release();await settle();await tick(30);let tree=page.render(props(c));await settle();equal(frame(tree).histories.cpu.cpu,[20]);await tick(50);tree=page.render(props(c));equal(frame(tree).histories.cpu.cpu,[20,50]);assert.equal(maxChains,1)
  const exitRead=delay();await tick(70);root.close();assert.equal(exitRead.signal.aborted,true);exitRead.release();await settle();const before=batches;emitScene('active');await tick();assert.equal(batches,before)
  page.close();clean()
 })
 await test('same-id URL/auth changes isolate histories and reject delayed old-source data; returning to source restores its own real history',async()=>{
  const c=device();active(c);const root=owner(app.Root),page=owner(app.OverviewPage);root.render();await settle();await tick(20)
  let tree=page.render(props(c));await settle();const original=frame(tree).histories
  const held=delay();await tick(40);const changed={...c,url:c.url+'/changed'};active(changed);root.render();await settle();assert.equal(held.signal.aborted,true)
  tree=page.render(props(changed));await settle();assert.equal(frame(tree).histories.up.length,0)
  held.release();await settle();await tick(60);tree=page.render(props(changed));assert.equal(frame(tree).histories.cpu.cpu.length,1)
  const heldAuth=delay();await tick(70);secrets.set('neko_secret_'+c.id,'changed-auth');root.render();await settle();assert.equal(heldAuth.signal.aborted,true)
  tree=page.render(props(changed));assert.equal(frame(tree).histories.up.length,0);heldAuth.release();await settle();await tick(30);tree=page.render(props(changed));equal(frame(tree).histories.cpu.cpu,[30])
  secrets.delete('neko_secret_'+c.id);active(c);root.render();await settle();tree=page.render(props(c));assert.equal(frame(tree).histories.up,original.up);equal(frame(tree).histories.cpu.cpu,[20]);await tick(35);tree=page.render(props(c));equal(frame(tree).histories.cpu.cpu,[20,35])
  await settle();page.close();root.close();await settle();clean()
 })
 await test('cold failure and later transient error retry on same single loop; visible status recovers; no synthetic history during failures',async()=>{
  const c=device();active(c);const root=owner(app.Root),page=owner(app.OverviewPage);failBatch=true;root.render();await settle();let tree=page.render(props(c));await settle();tree=page.render(props(c));assert.ok(text(tree).includes('fixture temporary timeout'));assert.equal(frame(tree).overview,null)
  await tick(20);tree=page.render(props(c));assert.equal(frame(tree).histories.up.length,0,'first successful read remains baseline');await tick(30);tree=page.render(props(c));equal(frame(tree).histories.cpu.cpu,[30]);await settle()
  failBatch=true;await tick(40);tree=page.render(props(c));equal(frame(tree).histories.cpu.cpu,[30]);assert.ok(text(tree).includes('fixture temporary timeout'));await settle()
  await tick(60);tree=page.render(props(c));await settle();tree=page.render(props(c));assert.ok(!text(tree).includes('fixture temporary timeout'));assert.equal(frame(tree).histories.cpu.cpu.length,2);assert.equal(polls().length,1)
  await settle();page.close();root.close();await settle();clean()
 })
 await test('Root with no controller retries naturally when one becomes available; non-OpenWrt does not sample; remount keeps snapshot but rebases',async()=>{
  active(null);const root=owner(app.Root),page=owner(app.OverviewPage);root.render();await settle();assert.equal(polls().length,0)
  active({id:'not-wrt',kind:'clash',url:'http://not-wrt.invalid'});root.render();await settle();assert.equal(polls().length,0)
  const c=device();active(c);root.render();await settle();await tick(30);root.close();await settle();const before=batches
  const second=owner(app.Root);second.render();await settle();assert.equal(batches,before+1);let tree=page.render(props(c));equal(frame(tree).histories.cpu.cpu,[30]);await tick(40);tree=page.render(props(c));equal(frame(tree).histories.cpu.cpu,[30,40]);assert.equal(polls().length,1)
  await settle();page.close();second.close();await settle();clean()
 })
 const exported=pref.exportLogs();assert.ok(!exported.includes('主页诊断'));assert.ok(!exported.includes('plot-state'));assert.ok(!fs.readFileSync(path.join(root,'index.tsx'),'utf8').includes('homeDiagnostic'))
 console.log(count+' Root foreground sampling groups passed; real API differential lifecycle, mocked transport/native, no device claims')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
