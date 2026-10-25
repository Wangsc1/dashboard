// Actual destination hooks + native visibility callbacks, not an iPhone navigation test.
// Network/native hooks are mocked. No router IO/writes.
const fs=require('node:fs'),vm=require('node:vm')
let source=fs.readFileSync(__dirname+'/router-details-prefetch.cjs','utf8')
const setup=source.slice(source.indexOf('scripting.useState='),source.indexOf(';(async()=>{'))
let harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0].replace('Root, AppearanceRoot };','Root, AppearanceRoot, WrtInterfacesPage, WrtLeasesPage, DockerPage, ContainerPage, ImagePage, DockerSettingsPage, FrpPage, FrpCommonPage, FrpProxyPage, SoftwarePage, PkgRow, Row, Field };')
harness=harness.replace("if (name === 'settings-ui')", "if(name==='router-details') source += '\\nexport function lifecycleTestState(){return {owners,working,queue:queue.length,listeners:invalidations.size,readers:[...snapshots.values()].flatMap(r=>[...r.values()]).reduce((n,e)=>n+(e.readers?.size??0),0)}}';\n  if (name === 'settings-ui')")
const checks=String.raw`
let stateWrites=0;const stateHook=scripting.useState;scripting.useState=(value)=>{const [v,set]=stateHook(value);return [v,next=>{stateWrites++;set(next)}]}
function deferred(){let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b}),resolve:v=>resolve(v),reject:e=>reject(e)}}
function disappear(tree){tree.props.onDisappear?.()}
function appear(tree){assert.equal(typeof tree.props.onAppear,'function');tree.props.onAppear()}
;(async()=>{
 await test('a retained native destination stops polls/subscriptions on disappear, rejects late state and resumes on appear',async()=>{
  const c=device();tag='native';const settings=owner(app.SettingsPage);settings.render({active:c,onChanged(){}});await settle();settings.close()
  const original=api.loadWrtInterfaces,held=deferred();let reads=0
  api.loadWrtInterfaces=()=>{reads++;return held.promise}
  const page=owner(app.WrtInterfacesPage),props={active:c,version:0};let tree=page.render(props);await settle();assert.equal(reads,1)
  disappear(tree);assert.equal(intervals.size,0);assert.equal(details.lifecycleTestState().listeners,0);assert.equal(sceneListeners.size,0)
  held.resolve([{name:'late-hidden',up:true}]);await settle();tree=page.render(props)
  assert.ok(!text(tree).includes('late-hidden'),'late completion must not mutate a disappearing native destination')
  api.loadWrtInterfaces=async()=>[{name:'visible-again',up:true}];appear(tree);await settle();tree=page.render(props);assert.ok(text(tree).includes('visible-again'));assert.equal(intervals.size,1)
  disappear(tree);page.close();api.loadWrtInterfaces=original;await settle();assert.equal(sceneListeners.size,0)
 })
 await test('rapid push/pop of every router entry, including nested/local pages, leaves no hidden poll or global subscription',async()=>{
  const c=device();tag='stress';const settings=owner(app.SettingsPage);settings.render({active:c,onChanged(){}});await settle();settings.close()
  const container=details.peekDetail(c,'containers')[0],image=details.peekDetail(c,'images')[0],frp=details.peekDetail(c,'frp'),retained=[]
  const destinations=[
   [app.WrtInterfacesPage,{active:c,version:0}],[app.WrtLeasesPage,{active:c,version:0}],
   [app.DockerPage,{active:c}],[app.ContainerPage,{active:c,x:container}],[app.DockerSettingsPage,{active:c}],
   [app.ImagePage,{active:c,x:image,onDone(){}}],[app.FrpPage,{active:c}],
   [app.FrpCommonPage,{active:c,info:frp,onDone(){}}],[app.FrpProxyPage,{active:c,initial:frp.proxies[0],onDone(){}}],
   [app.FrpProxyPage,{active:c,onDone(){}}],[app.SoftwarePage,{active:c}],[ui.LogsPage,{}]
  ]
  const beforeConfirm=confirms.length
  for(let cycle=0;cycle<25;cycle++)for(const [fn,p]of destinations){
   const page=owner(fn),tree=page.render(p);disappear(tree);retained.push(page);await settle()
   assert.equal(intervals.size,0,fn.name+' hidden timers');assert.equal(sceneListeners.size,0,fn.name+' hidden scene subscriptions')
   const state=details.lifecycleTestState();assert.equal(state.listeners,0);assert.equal(state.readers,0);assert.equal(state.queue,0);assert.ok(state.working<=2)
  }
  assert.equal(confirms.length,beforeConfirm,'navigation never opens a write confirmation');assertReadOnly()
  for(const page of retained)page.close();await settle();assert.equal(details.lifecycleTestState().working,0)
 })
 await test('100 queued pages cancel synchronously on pop rather than collecting behind unrelated slow reads',async()=>{
  const c=device(),settings=owner(app.SettingsPage);settings.render({active:c,onChanged(){}});await settle();settings.close()
  const a=deferred(),b=deferred(),first=details.readDetail(c,'docker',()=>a.promise),second=details.readDetail(c,'frp',()=>b.promise)
  await settle();const original=api.loadWrtInterfaces;let reads=0;api.loadWrtInterfaces=async()=>{reads++;return []}
  for(let i=0;i<100;i++){
   const page=owner(app.WrtInterfacesPage),tree=page.render({active:c,version:0});assert.equal(details.lifecycleTestState().queue,1)
   disappear(tree);assert.equal(details.lifecycleTestState().queue,0,'orphan pending queue must clear before a transport settles');assert.equal(details.lifecycleTestState().readers,2,'only two real in-flight reader owners remain');page.close()
  }
  a.resolve({});b.resolve({});await Promise.all([first,second]);await settle();assert.equal(reads,0,'no popped page read is launched later');api.loadWrtInterfaces=original
  assert.equal(details.lifecycleTestState().working,0);assert.equal(sceneListeners.size,0)
 })
 await test('100 hide/show cycles adopt one in-flight read without retaining old page readers; retry succeeds after failure',async()=>{
  const c=device(),settings=owner(app.SettingsPage);settings.render({active:c,onChanged(){}});await settle();settings.close()
  const original=api.loadWrtLeases,held=deferred();let reads=0;api.loadWrtLeases=()=>{reads++;return held.promise}
  const page=owner(app.WrtLeasesPage),p={active:c,version:0};let tree=page.render(p);await settle()
  for(let i=0;i<100;i++){disappear(tree);assert.equal(details.lifecycleTestState().readers,0);appear(tree);assert.equal(details.lifecycleTestState().readers,1)}
  assert.equal(reads,1,'pending transport is adopted, never duplicated');held.reject(Error('one failed retained read'));await settle();tree=page.render(p);assert.ok(text(tree).includes('one failed retained read'))
  disappear(tree);api.loadWrtLeases=async()=>[{host:'retry-visible',ip:'192.0.2.3',mac:'fixture'}];appear(tree);await settle();tree=page.render(p);assert.ok(text(tree).includes('retry-visible'));assert.ok(!text(tree).includes('one failed retained read'))
  disappear(tree);page.close();api.loadWrtLeases=original;assert.equal(intervals.size,0);assert.equal(sceneListeners.size,0)
 })
 await test('disappearing a child does not cancel a shared Settings prefetch or stop warming other entries',async()=>{
  const c=device(),original=api.loadWrtInterfaces,held=deferred();let reads=0;api.loadWrtInterfaces=()=>{reads++;return held.promise}
  const settings=owner(app.SettingsPage);settings.render({active:c,onChanged(){}});await settle()
  const child=owner(app.WrtInterfacesPage),p={active:c,version:0},tree=child.render(p);await settle();disappear(tree);child.close()
  held.resolve([{name:'shared-warm',up:true}]);await settle();assert.equal(reads,1);assert.equal(details.peekDetail(c,'interfaces')[0].name,'shared-warm')
  for(const key of Object.keys(details.detailReads))assert.notEqual(details.peekDetail(c,key),undefined,key+' still prefetched')
  settings.close();api.loadWrtInterfaces=original;await settle();assert.equal(sceneListeners.size,0)
  const logs=owner(ui.LogsPage),view=logs.render({});assert.ok(!nodes(view.props.toolbar.topBarTrailing,'Button').some(n=>n.props.title==='复制停顿诊断'));disappear(view);logs.close()
 })
 await test('late failed reads, queued timer callbacks and native appear callbacks after pop/unmount perform zero state writes',async()=>{
  const c=device(),settings=owner(app.SettingsPage);settings.render({active:c,onChanged(){}});await settle();settings.close()
  const original=api.loadWrtInterfaces,held=deferred();api.loadWrtInterfaces=()=>held.promise
  const page=owner(app.WrtInterfacesPage),tree=page.render({active:c,version:0});await settle();const tick=[...intervals.values()].find(x=>x.ms===5000).fn
  disappear(tree);page.close();const before=stateWrites;tick();appear(tree);held.reject(Error('late popped failure'));await settle()
  assert.equal(stateWrites,before);assert.equal(intervals.size,0);assert.equal(sceneListeners.size,0);api.loadWrtInterfaces=original
  const logs=owner(ui.LogsPage),view=logs.render({}),poll=[...intervals.values()].find(x=>x.ms===2000).fn;disappear(view);const beforePoll=stateWrites;poll();assert.equal(stateWrites,beforePoll);logs.close()
 })
 console.log('Router navigation lifecycle regression passed (mocked IO; no claim about iPhone transition FPS)')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+setup+checks,{require,__dirname,console,process},{filename:__filename})
