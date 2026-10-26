// Root -> native selection -> retained connection shell. All IO/native hooks mocked;
// intentionally inspect the old JS tree BEFORE Root processes a binding update.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
scripting.useState=function(v){const slots=hooks,i=hookIndex++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]}
function owner(fn){const state={hooks:[],cleanups:new Map()};return {render(props={}){const saved={hooks,cleanups,effects,hookIndex};hooks=state.hooks;cleanups=state.cleanups;effects=[];hookIndex=0;const tree=fn(props),queued=effects;({hooks,cleanups,effects,hookIndex}=saved);for(const f of queued){const savedCleanup=cleanups;cleanups=state.cleanups;f();cleanups=savedCleanup}return tree},close(){for(const f of state.cleanups.values())f();state.cleanups.clear()}}}
async function settle(){for(let i=0;i<100;i++)await Promise.resolve()}
for(const name of ['prefetchProxies','prefetchRules','prefetchConnections','prefetchMoreVersions'])pages[name]=()=>{}
const stack=t=>nodes(t,'NavigationStack').find(n=>n.props.key==='connections-stack')
function declaration(t){const children=stack(t).props.children.filter(Boolean);assert.equal(children.length,1,'connections must exist before native selection/JS reconciliation');assert.equal(children[0].type,pages.ConnectionsPage);return children[0]}
function shell(t,name){assert.equal(t.type,'ScrollView');assert.equal(t.props.navigationTitle,name);assert.ok(t.props.toolbar.topBarLeading);assert.ok(t.props.toolbar.topBarTrailing);assert.ok(text(t).includes('活动中'));assert.ok(text(t).includes('已关闭'));assert.ok(nodes(t,'LazyVStack').length)}
const device={id:'first-frame',kind:'clash',name:'First frame',url:'http://first-frame.invalid'}
const conn={id:'first-frame-conn',host:'cached-first-frame.invalid',src:'192.0.2.1:1',dst:'192.0.2.2:443',network:'tcp',rule:'MATCH',chain:'DIRECT',chains:['DIRECT'],up:1,down:2,start:now}
let reads=0,pending=[]
const originalLoad=api.loadConnections
api.loadConnections=async()=>{reads++;return new Promise(r=>pending.push(r))}
function setup(c){store.set('neko_controllers_v1',[c]);store.set('neko_active_v1',c.id);pref.savePreferences({defaultPage:'proxies',connectionBackground:false})}
;(async()=>{
 for(const cached of [false,true])await test('other tab -> two-hour background -> connections before Root update; cache='+cached,async()=>{
  const c={...device,id:device.id+'-'+cached,url:device.url+'/'+cached};setup(c)
  if(cached)store.set('dashboard_connections_snapshot_v1',{key:model.sourceKey(c),at:now,conns:[conn]});else store.delete('dashboard_connections_snapshot_v1')
  const rootOwner=owner(app.Root),page=owner(pages.ConnectionsPage);let rootTree=rootOwner.render();let node=declaration(rootTree),tree=page.render(node.props);await settle();shell(tree,c.name);assert.equal(node.props.selected,false)
  const before=reads;assert.equal([...intervals.values()].filter(x=>x.ms===1000).length,0)
  emitScene('background');now+=7200000;emitScene('active');emitScene('inactive');emitScene('active');rootTree=rootOwner.render();node=declaration(rootTree);tree=page.render(node.props);await settle();assert.equal(reads,before,'resume on another tab must not poll connections')
  const key=node.props.key,selection=rootTree.props.selection
  // Native TabView can switch now; no Root render/effect/data completion yet.
  selection.setValue('connections');node=declaration(rootTree);assert.equal(node.props.key,key);assert.equal(node.props.selected,false);shell(tree,c.name)
  assert.equal(text(tree).includes(conn.host),cached,'cached rows or empty controls are already present, independent of request')
  tree.props.onAppear();rootTree=rootOwner.render();node=declaration(rootTree);assert.equal(node.props.key,key);assert.equal(node.props.selected,true)
  tree=page.render(node.props);await settle();tree=page.render(node.props);await settle();shell(tree,c.name);assert.equal(reads,before+1);assert.equal([...intervals.values()].filter(x=>x.ms===1000).length,1)
  assert.equal(text(tree).includes(conn.host),cached,'uncompleted request cannot blank the shell or cached rows')
  // No user pause exists: leaving and returning to the tab always resumes monitoring.
  assert.ok(!nodes(tree.props.toolbar.topBarTrailing,'Button').some(b=>/暂停监控|恢复监控/.test(b.props.title)))
  selection.setValue('proxies');rootTree=rootOwner.render();tree.props.onDisappear();tree=page.render(declaration(rootTree).props);await settle()
  emitScene('background');now+=7200000;emitScene('active');rootTree=rootOwner.render();tree=page.render(declaration(rootTree).props);await settle()
  selection.setValue('connections');shell(tree,c.name);rootTree=rootOwner.render();tree.props.onAppear();tree=page.render(declaration(rootTree).props);await settle();shell(tree,c.name)
  assert.ok(!nodes(tree.props.toolbar.topBarTrailing,'Button').some(b=>/暂停监控|恢复监控/.test(b.props.title)));assert.equal([...intervals.values()].filter(x=>x.ms===1000).length,1)
  page.close();rootOwner.close();for(const resolve of pending.splice(0))resolve([]);await settle();assert.equal(intervals.size,0);assert.equal(sceneListeners.size,0)
 })
 await test('source switch with same id: new connection owner first frame is isolated, recent/expired/no cache',async()=>{
  const first={...device,id:'source-first-frame'};setup(first);store.set('dashboard_connections_snapshot_v1',{key:model.sourceKey(first),at:now,conns:[conn]})
  const rootOwner=owner(app.Root);let rootTree=rootOwner.render(),node=declaration(rootTree),page=owner(pages.ConnectionsPage),tree=page.render(node.props);await settle();assert.ok(text(tree).includes(conn.host));const stackKey=stack(rootTree).props.key
  for(const mode of ['recent','expired','missing']){
   const next={...first,url:'http://source-'+mode+'.invalid'},nextConn={...conn,host:'source-'+mode+'.invalid'}
   if(mode!=='missing')store.set('dashboard_connections_snapshot_v1',{key:model.sourceKey(next),at:now-(mode==='expired'?3600000:1000),conns:[nextConn]});else store.delete('dashboard_connections_snapshot_v1')
   const previousKey=node.props.key;setup(next);rootTree=rootOwner.render();node=declaration(rootTree);assert.notEqual(node.props.key,previousKey);assert.equal(stack(rootTree).props.key,stackKey)
   page.close();page=owner(pages.ConnectionsPage);tree=page.render(node.props);shell(tree,next.name);assert.ok(!text(tree).includes(conn.host));assert.equal(text(tree).includes(nextConn.host),mode==='recent','first frame before effects/requests uses only a recent same-source snapshot');await settle()
  }
  page.close();rootOwner.close();await settle();assert.equal(intervals.size,0);assert.equal(sceneListeners.size,0)
 })
 api.loadConnections=originalLoad
 console.log(count+' connection first-frame groups passed; mocked native scheduling, no iPhone timing claim.')
})().catch(e=>{api.loadConnections=originalLoad;console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
