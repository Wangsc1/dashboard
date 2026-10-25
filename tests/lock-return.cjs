// Lock-screen/background return regressions. IO/native lifecycle mocked; no device timing claim.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
scripting.useState=function(v){const slots=hooks,i=hookIndex++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]}
function owner(fn){const state={hooks:[],cleanups:new Map()};return {render(props={}){const saved={hooks,cleanups,effects,hookIndex};hooks=state.hooks;cleanups=state.cleanups;effects=[];hookIndex=0;const tree=fn(props),queued=effects;({hooks,cleanups,effects,hookIndex}=saved);for(const f of queued){const sc=cleanups;cleanups=state.cleanups;f();cleanups=sc}return tree},close(){for(const f of state.cleanups.values())f();state.cleanups.clear()}}}
async function settle(){for(let i=0;i<100;i++)await Promise.resolve()}
const device={id:'lock-return',kind:'openwrt',name:'Lock',url:'http://lock-return.invalid',username:'root'}
const homeRunning=t=>nodes(t,home.HomeDashboard)[0].props.running
;(async()=>{
 await test('SceneVisibility: hide-before-scene, scene-before-hide, coalesced and push-style cases',()=>{
  const V=model.SceneVisibility
  let v=new V();assert.equal(v.disappear(1000),true);v.scene(false,1100);assert.equal(v.scene(true,9000),true,'hide just before inactive is scene-caused')
  v=new V();v.scene(false,1000);assert.equal(v.disappear(1100),false);assert.equal(v.scene(true,9000),true,'hide after inactive is scene-caused')
  v=new V();v.scene(false,1000);v.scene(false,1001);assert.equal(v.scene(true,2000),false,'no hide, nothing to restore')
  v=new V();assert.equal(v.disappear(1000),true);v.scene(false,9000);assert.equal(v.scene(true,9500),false,'earlier push remains hidden')
  v=new V();v.disappear(1000);v.appear();v.scene(false,1100);assert.equal(v.scene(true,2000),false)
 })
 for(const order of ['hide-first','scene-first']) await test('home lock return restores logical visibility without tab switch; '+order,async()=>{
  const page=owner(app.OverviewPage),props={active:device,version:0,selected:true,onSwitch(){},onClose(){}}
  let view=page.render(props);await settle();view=page.render(props);assert.equal(homeRunning(view),true)
  if(order==='hide-first'){view.props.onDisappear();emitScene('inactive');emitScene('background')}else{emitScene('inactive');emitScene('background');view.props.onDisappear()}
  view=page.render(props);await settle();assert.equal(homeRunning(view),false)
  now+=7200000;emitScene('active');view=page.render(props);await settle();view=page.render(props);assert.equal(homeRunning(view),true,'no onAppear and no tab switch')
  // Navigation push remains hidden through lock/unlock; real appear restores it.
  now+=5000;view.props.onDisappear();view=page.render(props);now+=5000;emitScene('inactive');emitScene('active');view=page.render(props);await settle();assert.equal(homeRunning(view),false)
  view.props.onAppear();view=page.render(props);assert.equal(homeRunning(view),true)
  page.render({...props,selected:false});emitScene('background');emitScene('active');view=page.render({...props,selected:false});await settle();assert.equal(homeRunning(view),false,'hidden tab does not wake on scene active')
  page.close();await settle()
 })
 await test('connections lock return without onAppear polls again; detail hide stays gated, no user pause',async()=>{
  const owner1={...device,kind:'clash',id:'lock-connections'},props={active:owner1,version:0,selected:true};let reads=0
  responder=()=>{reads++;return {body:{connections:[{id:'a',metadata:{host:'a.invalid'},upload:1,download:1}]}}}
  const page=owner(pages.ConnectionsPage);let tree=page.render(props);await settle();tree=page.render(props);assert.ok(text(tree).includes('a.invalid'))
  tree.props.onDisappear();emitScene('inactive');emitScene('background');page.render(props);await settle();assert.equal(intervals.size,0)
  now+=7200000;const before=reads;emitScene('active');page.render(props);await settle();tree=page.render(props);assert.equal(reads,before+1);assert.ok([...intervals.values()].some(x=>x.ms===1500))
  now+=9000;tree.props.onDisappear();now+=9000;emitScene('inactive');emitScene('active');page.render(props);await settle();assert.equal(intervals.size,0,'detail/push hide stays paused')
  tree.props.onAppear();page.render(props);await settle();tree=page.render(props);assert.ok(!nodes(trailing(tree.props.toolbar),'Button').some(b=>/暂停监控|恢复监控/.test(b.props.title)))
  emitScene('background');emitScene('active');page.render(props);await settle();assert.ok([...intervals.values()].some(x=>x.ms===1500),'monitoring always resumes')
  page.close()
 })
 await test('proxies and more lock return refresh without onAppear',async()=>{
  let groups=0,versions=0;const origG=api.loadGroups,origV=api.loadRuntimeVersions
  api.loadGroups=async()=>{groups++;return [{name:'g',all:[],type:'Selector'}]};api.loadProviders=async()=>[]
  api.loadRuntimeVersions=async(c,u)=>{versions++;u?.({core:'v',app:'p',failed:false});return {core:'v',app:'p',failed:false}}
  try{
   const p=owner(pages.ProxiesPage),pp={active:{...device,kind:'clash',id:'lock-proxies'},version:0,selected:true};let tree=p.render(pp);await settle();p.render(pp);const g0=groups
   tree.props.onDisappear();emitScene('inactive');emitScene('background');now+=7200000;emitScene('active');p.render(pp);await settle();assert.ok(groups>g0,"proxies");p.close()
   const m=owner(pages.MorePage),mp={active:{...device,kind:'clash',id:'lock-more'},selected:true,onChanged(){}};tree=m.render(mp);await settle();m.render(mp);const v0=versions
   tree.props.onDisappear();emitScene('inactive');emitScene('background');now+=7200000;emitScene('active');m.render(mp);await settle();assert.ok(versions>v0,"more");m.close()
  }finally{api.loadGroups=origG;api.loadRuntimeVersions=origV}
 })
 console.log(count+' lock-return groups passed; mocked lifecycle ordering only.')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
