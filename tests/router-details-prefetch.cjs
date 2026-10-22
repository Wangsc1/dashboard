// Effective SettingsPage -> bounded read queue -> real API transport/parsers ->
// each destination's first render. All IO/native bindings mocked; no router writes.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0].replace('Root, AppearanceRoot };','Root, AppearanceRoot, WrtInterfacesPage, WrtLeasesPage, DockerPage, ContainerPage, ImagePage, DockerSettingsPage, FrpPage, FrpCommonPage, FrpProxyPage, SoftwarePage, PkgRow, Row, Field };')
const checks=String.raw`
scripting.useState=function(v){const slots=hooks,i=hookIndex++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]}
function owner(fn){const state={hooks:[],cleanups:new Map()};return {render(props){const saved={hooks,cleanups,effects,hookIndex};hooks=state.hooks;cleanups=state.cleanups;effects=[];hookIndex=0;const tree=fn(props),queued=effects;hooks=saved.hooks;cleanups=saved.cleanups;effects=saved.effects;hookIndex=saved.hookIndex;queued.forEach(f=>{const previous=cleanups;cleanups=state.cleanups;f();cleanups=previous});return tree},close(){for(const f of state.cleanups.values())f();state.cleanups.clear()}}}
async function settle(){for(let i=0;i<700;i++)await Promise.resolve()}
const details=load('router-details'),cid='a'.repeat(64),iid='sha256:'+'b'.repeat(64)
let tag='one',fail=false,serial=0
function device(){return {id:'details-'+(++serial),name:'fixture router',kind:'openwrt',url:'http://details-'+serial+'.invalid',username:'root'}}
function fixture(url,init){
 if(url.includes('cgi-exec')){const body=decodeURIComponent(init.body),installed=body.includes('list-installed');return {text:JSON.stringify([{name:tag+'-pkg',version:installed?'1':'2',description:'Fixture package','installed-size':100,'file-size':100}])}}
 const q=JSON.parse(init.body),[,o,m,a]=q.params,ok=v=>({body:{id:q.id,result:[0,v]}}),docker=v=>ok({code:200,body:v})
 if(o==='session')return ok({ubus_rpc_session:'details-sid-'+tag})
 if(fail)throw Error('fixture offline')
 if(o==='network.interface')return ok({interface:[{interface:tag+'-wan',proto:'dhcp',l3_device:'eth0',up:true,uptime:90,'ipv4-address':[{address:'192.0.2.1'}]}]})
 if(o==='luci-rpc')return ok({dhcp_leases:[{hostname:tag+'-host',ipaddr:'192.0.2.10',macaddr:'aa:bb:cc:dd:ee:ff'}]})
 if(o==='docker'&&m==='info')return docker({Containers:1,ContainersRunning:1,NGoroutines:4,MemTotal:1000000,DockerRootDir:'/fixture/docker'})
 if(o==='docker'&&m==='version')return docker({Version:tag+'-docker',ApiVersion:'1.4'})
 if(o==='docker.container'&&m==='list')return docker([{Id:cid,Names:['/'+tag+'-container'],Image:tag+'-image',State:'running',Status:'Up',ImageID:iid}])
 if(o==='docker.container'&&m==='inspect')return docker({Id:cid,Name:'/'+tag+'-inspect',State:{Status:'running'},Config:{Image:tag+'-image'},HostConfig:{NetworkMode:'bridge',RestartPolicy:{Name:'always'}},Path:'/bin/fixture',Created:'2025-01-01'})
 if(o==='docker.image'&&m==='list')return docker([{Id:iid,RepoTags:[tag+'-image:latest'],Size:4096,Created:1}])
 if(o.startsWith('docker'))return docker({})
 if(o==='uci'&&a.config==='dockerd')return ok({values:{globals:{log_level:'warn',data_root:'/fixture/docker'},proxies:{http_proxy:'http://'+tag+'.invalid'}}})
 if(o==='uci'&&a.config==='frpc')return ok({values:{common:{server_addr:tag+'.frp.invalid',server_port:'7000',token:'private-canary-token'},p1:{'.type':'conf','.name':'p1',type:'tcp',name:tag+'-proxy',local_ip:'127.0.0.1',local_port:'22',remote_port:'2222'}}})
 if(o==='rc')return ok({frpc:{running:true,enabled:true}})
 if(o==='luci')return ok({result:[{mount:'/overlay',size:10000,avail:5000}]})
 return ok({})
}
responder=fixture
function remoteCalls(){return calls.filter(x=>x.url.includes('/ubus')||x.url.includes('cgi-exec'))}
function assertReadOnly(){for(const {url,init}of calls){if(url.includes('cgi-exec')){assert.match(decodeURIComponent(init.body),/list-(installed|available)/);continue}if(!url.includes('/ubus'))continue;const q=JSON.parse(init.body);for(const x of Array.isArray(q)?q:[q]){const [,o,m,a]=x.params;assert.ok(['login','dump','getDHCPLeases','info','version','list','inspect','get','getMountPoints'].includes(m),o+'.'+m)}}}
const settings=(c)=>({active:c,onChanged(){}})
const destinations=[app.WrtInterfacesPage,app.WrtLeasesPage,app.DockerPage,app.FrpPage,app.SoftwarePage]
const valueIn=(tree,value)=>text(tree).includes(value)||nodes(tree,app.Row).some(n=>n.props.value===value)||nodes(tree,app.Field).some(n=>n.props.value===value)
;(async()=>{
 await test('entering Settings warms every read-only router entry, lazy Docker inspect/settings and software segments; local logs need no IO',async()=>{
  const c=device(),page=owner(app.SettingsPage);tag='warm';calls.length=0
  const beforeStore=JSON.stringify([...store.entries()].filter(([k])=>k!=='dashboard_logs_v140')),beforeSecrets=JSON.stringify([...secrets.entries()])
  const tree=page.render(settings(c));await settle();assertReadOnly()
  for(const key of Object.keys(details.detailReads))assert.notEqual(details.peekDetail(c,key),undefined,key)
  assert.equal(details.peekDetail(c,'container:'+cid).name,'warm-inspect')
  const names=nodes(tree,'NavigationLink').map(n=>n.props.destination?.type)
  for(const fn of destinations)assert.ok(names.includes(fn),fn.name)
  assert.ok(names.includes(ui.LogsPage));assert.equal(confirms.length,0)
  assert.equal(JSON.stringify([...store.entries()].filter(([k])=>k!=='dashboard_logs_v140')),beforeStore,'prefetch never persists private snapshots');assert.equal(JSON.stringify([...secrets.entries()]),beforeSecrets)
  const count=calls.length;const logs=owner(ui.LogsPage);logs.render({});await settle();assert.equal(calls.length,count);logs.close()
  const first=[
   [app.WrtInterfacesPage,{active:c,version:0},t=>text(t).includes('warm-wan')],
   [app.WrtLeasesPage,{active:c,version:0},t=>text(t).includes('warm-host')],
   [app.DockerPage,{active:c},t=>text(t).includes('warm-docker')&&text(t).includes('warm-container')&&text(t).includes('warm-image:latest')],
   [app.ContainerPage,{active:c,x:details.peekDetail(c,'containers')[0]},t=>valueIn(t,'warm-inspect')&&nodes(t,'Picker')[0].props.value==='always'],
   [app.DockerSettingsPage,{active:c},t=>nodes(t,'Picker')[0].props.value==='warn'&&nodes(t,app.Field)[0].props.value==='http://warm.invalid'],
   [app.FrpPage,{active:c},t=>text(t).includes('warm-proxy')],
   [app.SoftwarePage,{active:c},t=>nodes(t,app.PkgRow).some(n=>n.props.p.name==='warm-pkg')&&text(t).includes('50% 已用')],
  ]
  for(const [fn,p,check]of first){const o=owner(fn),t=o.render(p);assert.ok(check(t),fn.name+' first render must use snapshot');await settle();o.close()}
  // Parent object children perform no remote read at all.
  for(const [fn,p]of [[app.ImagePage,{active:c,x:details.peekDetail(c,'images')[0],onDone(){}}],[app.FrpCommonPage,{active:c,info:details.peekDetail(c,'frp'),onDone(){}}],[app.FrpProxyPage,{active:c,initial:details.peekDetail(c,'frp').proxies[0],onDone(){}}]]){const count=calls.length,o=owner(fn);o.render(p);await settle();assert.equal(calls.length,count,fn.name);o.close()}
  const software=owner(app.SoftwarePage);let t=software.render({active:c});await settle();const segmented=nodes(t,'Picker').find(p=>p.props.pickerStyle==='segmented');segmented.props.onChanged('available');t=software.render({active:c});assert.ok(!text(t).includes('正在读取软件源'));segmented.props.onChanged('updates');t=software.render({active:c});assert.ok(!text(t).includes('正在读取软件源'));software.close()
  page.close();assert.equal(intervals.size,0);assert.equal(sceneListeners.size,0)
 })
 await test('silent refresh retains a cached first frame on failure and never overwrites dirty Docker settings',async()=>{
  const c=device();tag='silent';const settingsOwner=owner(app.SettingsPage);settingsOwner.render(settings(c));await settle()
  fail=true;const iface=owner(app.WrtInterfacesPage);let view=iface.render({active:c,version:0});assert.ok(text(view).includes('silent-wan'));await settle();view=iface.render({active:c,version:0});assert.ok(text(view).includes('silent-wan'));assert.ok(text(view).includes('fixture offline'));iface.close();fail=false
  const editor=owner(app.DockerSettingsPage);view=editor.render({active:c});await settle();nodes(view,'Picker')[0].props.onChanged('debug');view=editor.render({active:c});assert.equal(nodes(view,'Picker')[0].props.value,'debug')
  tag='server-change';emitScene('inactive');emitScene('active');await settle();view=editor.render({active:c});assert.equal(nodes(view,'Picker')[0].props.value,'debug','background silent refresh cannot clobber an edited draft')
  editor.close();settingsOwner.close();assert.equal(sceneListeners.size,0)
 })
 await test('pending requests coalesce Settings and destination readers; queue limits active chains to two',async()=>{
  const c=device();tag='dedup';let release;const wait=new Promise(r=>release=r),original=context.fetch;let held=true,active=0,max=0
  context.fetch=async(url,init)=>{active++;max=Math.max(max,active);try{if(held)await wait;return await original(url,init)}finally{active--}}
  const originals=new Map(),chainNames=['loadWrtInterfaces','loadWrtLeases','loadDockerOverview','loadDockerContainers','loadDockerImages','loadDockerSettings','loadFrp','loadInstalledPkgs','loadAvailablePkgs','loadDiskUsage','loadContainerDetail'];let chains=0,maxChains=0
  for(const name of chainNames){const original=api[name];originals.set(name,original);api[name]=async(...args)=>{chains++;maxChains=Math.max(maxChains,chains);try{return await original(...args)}finally{chains--}}}
  const a=owner(app.SettingsPage),b=owner(app.SettingsPage),child=owner(app.WrtInterfacesPage)
  calls.length=0;a.render(settings(c));b.render(settings(c));child.render({active:c,version:0});await settle()
  assert.ok(max<=2);held=false;release();await settle();assertReadOnly()
  const dumps=calls.flatMap(x=>{try{const q=JSON.parse(x.init.body);return Array.isArray(q)?q:[q]}catch{return []}}).filter(q=>q.params?.[1]==='network.interface'&&q.params?.[2]==='dump')
  assert.equal(dumps.length,1,'same pending interface read is shared across both settings and child')
  assert.ok(text(child.render({active:c,version:0})).includes('dedup-wan'))
  assert.equal(maxChains,2,'all top-level resource reads, including lazy inspect, share the two-chain queue');assert.equal(chains,0)
  for(const [name,fn]of originals)api[name]=fn
  a.close();b.close();child.close();context.fetch=original;assert.equal(sceneListeners.size,0)
 })
 await test('a destination adopts pending prefetch even when settings unmounts; a paused pending read retries after foreground resume',async()=>{
  const c=device();tag='adopt';const original=context.fetch;let release;const wait=new Promise(r=>release=r);let hold=true
  context.fetch=async(url,init)=>{const response=await original(url,init);if(hold)await wait;return response}
  const settingsOwner=owner(app.SettingsPage),child=owner(app.WrtInterfacesPage);settingsOwner.render(settings(c));await settle();child.render({active:c,version:0});await settle();settingsOwner.close()
  emitScene('inactive');emitScene('active');hold=false;release();await settle()
  const tree=child.render({active:c,version:0});assert.ok(text(tree).includes('adopt-wan'));assert.ok(!text(tree).includes('读取代次已改变'));child.close();context.fetch=original;assert.equal(sceneListeners.size,0)
 })
 await test('cold failures stay unknown instead of fabricated empty snapshots and can retry on reentry',async()=>{
  const c=device();tag='retry';fail=true;const a=owner(app.SettingsPage);a.render(settings(c));await settle()
  assert.equal(details.peekDetail(c,'docker'),undefined);assert.equal(details.peekDetail(c,'interfaces'),undefined)
  const child=owner(app.WrtInterfacesPage);let t=child.render({active:c,version:0});await settle();t=child.render({active:c,version:0});assert.ok(text(t).includes('fixture offline'));child.close();a.close()
  fail=false;const b=owner(app.SettingsPage);b.render(settings(c));await settle();assert.ok(details.peekDetail(c,'interfaces').length);b.close()
 })
 await test('same-id URL/auth change rejects in-flight old responses; new identity has no cached first frame',async()=>{
  const c=device();tag='old';let release;const wait=new Promise(r=>release=r),original=context.fetch;let block=true
  context.fetch=async(url,init)=>{const r=await original(url,init);if(block)await wait;return r}
  const a=owner(app.SettingsPage);a.render(settings(c));await settle();a.close()
  const changed={...c,url:c.url+'/new'};tag='new';const b=owner(app.SettingsPage);b.render(settings(changed));const child=owner(app.DockerPage);const first=child.render({active:changed});assert.ok(!text(first).includes('old-docker'))
  block=false;release();await settle();assert.equal(details.peekDetail(c,'interfaces'),undefined);assert.equal(details.peekDetail(changed,'docker').version,'new-docker')
  child.close();b.close();secrets.set('neko_secret_'+c.id,'new-auth');assert.equal(details.peekDetail(changed,'docker'),undefined)
  const d=owner(app.SettingsPage);tag='auth';d.render(settings(changed));await settle();assert.equal(details.peekDetail(changed,'docker').version,'auth-docker');d.close();context.fetch=original
 })
 await test('system background stops queued reads and late publication; foreground retries dropped jobs',async()=>{
  const c=device();tag='scene';let release;const wait=new Promise(r=>release=r),original=context.fetch;let hold=true
  context.fetch=async(url,init)=>{if(hold)await wait;return original(url,init)}
  const page=owner(app.SettingsPage);page.render(settings(c));await settle();emitScene('background');const before=calls.length;hold=false;release();await settle()
  assert.equal(details.peekDetail(c,'interfaces'),undefined);const settled=calls.length;await settle();assert.equal(calls.length,settled,'no queued new requests start in background')
  emitScene('active');await settle();assert.notEqual(details.peekDetail(c,'docker'),undefined);assert.notEqual(details.peekDetail(c,'frp'),undefined);assertReadOnly()
  page.close();context.fetch=original;assert.equal(sceneListeners.size,0)
 })
 await test('existing write confirmation is retained; confirmed writes invalidate their group, unrelated snapshots survive; stale read cannot refill',async()=>{
  const c=device();tag='write';const page=owner(app.SettingsPage);page.render(settings(c));await settle();page.close()
  // Image deletion is an actual UI path, transport remains mocked.
  const img=details.peekDetail(c,'images')[0],o=owner(app.ImagePage);let t=o.render({active:c,x:img,onDone(){}})
  context.confirmResult=false;const before=calls.length;await nodes(t,'Button').find(n=>n.props.title==='删除').props.action();await settle();assert.equal(calls.length,before);assert.notEqual(details.peekDetail(c,'images'),undefined)
  context.confirmResult=true;await nodes(t,'Button').find(n=>n.props.title==='删除').props.action();await settle();assert.equal(details.peekDetail(c,'images'),undefined);assert.equal(details.peekDetail(c,'containers'),undefined);assert.equal(details.peekDetail(c,'container:'+cid),undefined);assert.notEqual(details.peekDetail(c,'frp'),undefined);o.close()
  // Exercise the confirmed FRP service action; API is mocked, not a real service.
  const frp=owner(app.FrpPage);t=frp.render({active:c});await settle();t=frp.render({active:c});await nodes(t,'Button').find(n=>n.props.title==='重启').props.action();await settle();frp.close()
  // Software update-list keeps its original explicit confirmation (not prefetch).
  const software=owner(app.SoftwarePage);t=software.render({active:c});await settle();t=software.render({active:c});await nodes(t,'Button').find(n=>n.props.title==='更新列表').props.action();await settle();software.close()
  assert.ok(calls.some(x=>x.url.includes('cgi-exec')&&decodeURIComponent(x.init.body).includes('package-manager-call update')))
  // Active pages may immediately refill invalidated entries; drop those owners
  // and verify the exact grouped invalidation boundary independently as well.
  for(const group of ['frp','software'])details.invalidateDetails(c,group)
  for(const key of ['frp','installed','available','disk'])assert.equal(details.peekDetail(c,key),undefined)
  const p=owner(app.SettingsPage);p.render(settings(c));await settle();p.close();assert.notEqual(details.peekDetail(c,'installed'),undefined)
  // Existing non-cached read beginning before a write must not republish.
  const keeper=owner(app.SettingsPage);keeper.render(settings(c));await settle();let resolve;const pending=details.readDetail(c,'container:'+cid,()=>new Promise(r=>resolve=r));await settle();details.invalidateDetails(c,'docker');resolve({name:'stale'});await assert.rejects(pending);assert.equal(details.peekDetail(c,'container:'+cid),undefined);keeper.close()
 })
 assert.equal(intervals.size,0);assert.equal(sceneListeners.size,0)
 console.log(count+' router-details effective prefetch groups passed (mock IO/native; all mutations mocked)')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
