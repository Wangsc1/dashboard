// Migrated settings UI/persistence/action regression; all native and IO mocked.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const harness=fs.readFileSync(path.join(__dirname,'run.cjs'),'utf8').split(';(async () => {')[0]
const checks=String.raw`
const props={active:null,version:0,selected:true},key='dashboard_preferences_v140'
const toggle=(tree,title)=>nodes(trailing(tree.props.toolbar),'Toggle').find(n=>n.props.title===title)
const same=(a,b)=>assert.equal(JSON.stringify(a),JSON.stringify(b))
;(async()=>{
 await test('global proxy-group entries and migrated disconnect entry removed; other sections/preferences untouched',async()=>{
  pref.savePreferences({showHidden:true,customIcons:false,disconnectOnSwitch:true,groupIcons:{Fixture:'globe'},nestedDelay:true})
  const prior=pref.getPreferences(),stored=clone(store.get(key)),original=context.Storage.set;let writes=0
  context.Storage.set=(...args)=>{writes++;return original(...args)}
  try{
   const tree=render(ui.PanelSettingsSections,{active:null},true);await flush()
   same(nodes(tree,'Section').map(n=>text(n.props.header)),['缓存管理'])
   assert.ok(!nodes(tree,'Toggle').some(n=>['showHidden','customIcons','disconnectOnSwitch'].includes(n.props.key)))
   for(const title of ['显示隐藏代理组','自定义代理组图标','自动断开旧连接'])assert.ok(!text(tree).includes(title))
   assert.ok(!nodes(tree,'Toggle').some(n=>n.props.key==='nestedDelay'));assert.ok(button(tree,'清除缓存'))
   same(pref.getPreferences(),prior);same(store.get(key),stored);assert.equal(writes,0)
   assert.equal(pref.DEFAULTS.customIcons,true);assert.equal(pref.DEFAULTS.showHidden,false);assert.equal(pref.DEFAULTS.disconnectOnSwitch,false)
  }finally{context.Storage.set=original;unmount()}
 })
 await test('both switches use existing top-right native menu, stored values, reopening and persisted restart; no immediate IO',async()=>{
  let closed=0
  pref.savePreferences({showHidden:true,groupIcons:{Fixture:'globe'},theme:'dark',haptics:true})
  for(const value of [false,true,false,true]){
   const prior=pref.getPreferences();let tree=render(pages.ProxiesPage,{...props,onClose:()=>closed++},true);await flush()
   const menu=trailing(tree.props.toolbar);assert.equal(menu.type,'Menu');assert.equal(menu.props.label.type,'Image');assert.equal(menu.props.label.props.systemName,'ellipsis.circle')
   same(nodes(menu,'Picker').map(n=>n.props.title),['节点排序'])
   same(nodes(menu,'Toggle').map(n=>n.props.title),['展示全部代理组','显示代理来源','显示隐藏组','显示图标','自动断开旧连接'])
   assert.equal(toggle(tree,'显示隐藏组').props.value,true);same(Object.keys(tree.props.toolbar),['topBarLeading','topBarTrailing']);tree.props.toolbar.topBarLeading.props.action()
   const beforeCalls=calls.length,beforeHaptics=haptics
   toggle(tree,'显示图标').props.onChanged(value);toggle(tree,'自动断开旧连接').props.onChanged(!value)
   same(pref.getPreferences(),{...prior,customIcons:value,disconnectOnSwitch:!value});assert.equal(haptics,beforeHaptics);assert.equal(calls.length,beforeCalls,'menu actions are local-only')
   await flush();tree=render(pages.ProxiesPage,props);assert.equal(toggle(tree,'显示图标').props.value,value);assert.equal(toggle(tree,'自动断开旧连接').props.value,!value)
   unmount();tree=render(pages.ProxiesPage,props,true);await flush();assert.equal(toggle(tree,'显示图标').props.value,value);assert.equal(toggle(tree,'自动断开旧连接').props.value,!value)
   const saved=cache.get('preferences');cache.delete('preferences');try{const restarted=load('preferences');assert.equal(restarted.getPreferences().customIcons,value);assert.equal(restarted.getPreferences().disconnectOnSwitch,!value);same(restarted.getPreferences().groupIcons,prior.groupIcons);assert.equal(restarted.getPreferences().showHidden,true)}finally{cache.set('preferences',saved)}
   unmount()
  }
  assert.equal(closed,4)
 })
 await test('show-icons menu controls real group layout and default/mapped/cached icon rendering without removing business controls',async()=>{
  const c={id:'menu-fixture',name:'Fixture',kind:'clash',url:'http://menu-fixture.invalid'}
  const g={name:'Fixture',type:'Selector',all:['Node'],now:'Node',delays:{Node:25},icon:'https://icons.invalid/menu-setting.png'}
  pref.savePreferences({customIcons:true,groupIcons:{Fixture:'globe'}})
  let tree=render(pages.ProxiesPage,props,true);await flush();toggle(tree,'显示图标').props.onChanged(false)
  const groupProps={c,g,onChanged(){}}
  let group=render(pages.GroupSection,groupProps,true);await flush();assert.equal(nodes(group,pages.GroupIcon).length,0);assert.ok(text(group).includes('Fixture'));assert.ok(text(group).includes('Node'));assert.ok(nodes(group,'Button').some(n=>n.props.systemImage==='bolt.fill'))
  assert.equal(render(pages.GroupIcon,{g},true),null);await flush()
  tree=render(pages.ProxiesPage,props,true);await flush();toggle(tree,'显示图标').props.onChanged(true)
  group=render(pages.GroupSection,groupProps,true);await flush();assert.equal(nodes(group,pages.GroupIcon).length,1)
  const mapped=render(pages.GroupIcon,{g},true);await flush();assert.equal(mapped.props.systemName,'globe')
  const fallback=render(pages.GroupIcon,{g:{...g,name:'Unmapped',icon:undefined}},true);await flush();assert.equal(fallback.props.systemName,'point.3.connected.trianglepath.dotted')
  responder=()=>({contentType:'image/png'});await pref.cachedIcon(g.icon)
  const cachedProps={g:{...g,name:'Cached'}};render(pages.GroupIcon,cachedProps,true);await flush();assert.ok(render(pages.GroupIcon,cachedProps).props.image)
  tree=render(pages.ProxiesPage,props,true);await flush();toggle(tree,'显示图标').props.onChanged(false)
  assert.equal(render(pages.GroupIcon,cachedProps,true),null);await flush();unmount()
 })
 await test('both migrated switches preserve accepted values on failed storage and report existing save error',async()=>{
  for(const [title,name] of [['显示图标','customIcons'],['自动断开旧连接','disconnectOnSwitch']]){
   pref.savePreferences({customIcons:true,disconnectOnSwitch:true});let notifications=0
   const unsubscribe=pref.subscribePreferences(()=>notifications++),prior=pref.getPreferences(),stored=clone(store.get(key)),beforeAlerts=alerts.length,beforeCalls=calls.length,beforeHaptics=haptics
   let tree=render(pages.ProxiesPage,props,true);await flush();failStorage=true
   try{assert.doesNotThrow(()=>toggle(tree,title).props.onChanged(false));await flush();tree=render(pages.ProxiesPage,props);assert.equal(toggle(tree,title).props.value,true);same(pref.getPreferences(),prior);same(store.get(key),stored);assert.equal(notifications,0);assert.equal(haptics,beforeHaptics);assert.equal(calls.length,beforeCalls);assert.equal(alerts.length,beforeAlerts+1);assert.equal(alerts.at(-1).message,'本地设置保存失败，请重试')}
   finally{failStorage=false;unsubscribe();unmount()}
  }
 })
 await test('disconnect menu affects only subsequent successful proxy switches: disabled skips DELETE, failed PUT never disconnects',async()=>{
  const c={id:'switch-menu-fixture',name:'Fixture',kind:'clash',url:'http://switch-menu.invalid'}
  let tree=render(pages.ProxiesPage,props,true);await flush();calls.length=0
  toggle(tree,'自动断开旧连接').props.onChanged(false);assert.equal(calls.length,0)
  responder=()=>({});await api.selectProxy(c,'Group','Node');same(calls.map(c=>c.init.method),['PUT'])
  calls.length=0;toggle(tree,'自动断开旧连接').props.onChanged(true);assert.equal(calls.length,0)
  responder=()=>({status:503});await assert.rejects(()=>api.selectProxy(c,'Group','Node'));same(calls.map(c=>c.init.method),['PUT'])
  calls.length=0;responder=()=>({});await api.selectProxy(c,'Group','Node');same(calls.map(c=>c.init.method),['PUT','DELETE']);assert.ok(calls[1].url.endsWith('/connections'))
  calls.length=0;responder=(_u,init)=>init.method==='DELETE'?{status:503}:{};await assert.rejects(()=>api.selectProxy(c,'Group','Node'),/代理已切换/);same(calls.map(c=>c.init.method),['PUT','DELETE']);unmount()
 })
 console.log('All '+count+' proxy-menu setting migration groups passed (mock UI/storage/network; not native device).')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
