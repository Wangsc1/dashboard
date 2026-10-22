// Native-setting migration tests. IO, native hooks and scene bindings are mocked.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const harness=fs.readFileSync(path.join(__dirname,'run.cjs'),'utf8').split(';(async () => {')[0]
const checks=String.raw`
let activeOwner=null
scripting.useState=v=>{const o=activeOwner,i=o.cursor++;if(!(i in o.slots))o.slots[i]=typeof v==='function'?v():v;return [o.slots[i],v=>{o.slots[i]=typeof v==='function'?v(o.slots[i]):v}]}
scripting.useEffect=(fn,deps=[])=>{const o=activeOwner,i=o.cursor++,old=o.slots[i];if(!old||deps.some((v,j)=>v!==old[j])){o.slots[i]=deps;o.effects.push(()=>{o.cleanups.get(i)?.();const cleanup=fn();if(typeof cleanup==='function')o.cleanups.set(i,cleanup)})}}
function owner(fn){return {fn,slots:[],cursor:0,effects:[],cleanups:new Map(),props:null,render(props=this.props){this.props=props;this.cursor=0;activeOwner=this;try{return this.fn(props)}finally{activeOwner=null}},async flush(){this.effects.splice(0).forEach(f=>f());for(let i=0;i<100;i++)await Promise.resolve()},close(){this.cleanups.forEach(f=>f());this.cleanups.clear()}}}
const props={active:null,selected:true,onChanged(){}},key='dashboard_preferences_v140'
const choice=(tree,title)=>nodes(tree,ui.Choice).find(n=>n.props.title===title)
const same=(a,b)=>assert.equal(JSON.stringify(a),JSON.stringify(b))
const themeOptions=[['system','跟随系统'],['light','浅色'],['dark','深色']],pageOptions=[['overview','主页'],['proxies','代理'],['rules','规则'],['connections','连接'],['more','更多']]
function rawNodes(tree,name){const out=[];function walk(n){if(!n||typeof n!=='object')return;if(n.type?.name===name)out.push(n);for(const child of n.props?.children??[])walk(child)}walk(tree);return out}
;(async()=>{
 await test('theme/start settings appear first in More on one row (left/right aligned) with original native pickers/options, including without controller; no duplicate global entries',async()=>{
  pref.savePreferences({theme:'dark',defaultPage:'rules',showHidden:true,groupIcons:{Fixture:'globe'}})
  const prior=pref.getPreferences(),stored=clone(store.get(key)),original=context.Storage.set;let writes=0
  context.Storage.set=(...args)=>{writes++;return original(...args)}
  try{
   for(const active of [null,{id:'more-fixture',name:'Fixture',kind:'clash',url:'http://more-fixture.invalid'}]){
    const page=owner(pages.MorePage),tree=page.render({...props,active,selected:false});await page.flush()
    same(rawNodes(tree,'MoreHeading').map(text),active?['主题及启动','运行信息','核心配置','快捷管理','服务管理','核心操作','DNS 工具']:['主题及启动'])
    const content=tree.props.children[0].props.children[0].props.children
    same(content.slice(0,2).map(n=>n.type.name),['MoreHeading','MorePanel']);const one=x=>[].concat(x);const row=one(content[1].props.children)[0];assert.equal(row.props.spacing,12);const cells=one(row.props.children);assert.equal(cells.length,2);same(cells.map(c=>c.props.frame.alignment),['leading','trailing']);same(cells.map(c=>one(c.props.children)[0].props.title),['外观模式','默认打开界面'])
    same(nodes(tree,ui.Choice).map(n=>n.props.title),['外观模式','默认打开界面'])
    for(const [title,options,value] of [['外观模式',themeOptions,'dark'],['默认打开界面',pageOptions,'rules']]){
     const node=choice(tree,title),native=ui.Choice(node.props);assert.equal(native.type,'Picker');assert.equal(native.props.pickerStyle,'menu');assert.equal(native.props.value,value);same(native.props.children.map(n=>[n.props.tag,text(n)]),options)
    }
    for(const panel of rawNodes(tree,'MorePanel').slice(0,1)){assert.equal(panel.props.contentInset,16);assert.equal(panel.props.padding,undefined);const native=panel.type(panel.props);assert.equal(native.type,'VStack');assert.equal(native.props.modifiers.steps[0][0],'padding');assert.equal(native.props.modifiers.steps[0][1],16)}
    assert.equal(tree.props.toolbar.topBarTrailing,undefined);assert.equal(tree.props.navigationTitle,active?.name??'更多');if(active){assert.ok(text(tree).includes('运行信息'));assert.ok(nodes(tree,'NavigationLink').length>=5)}
    page.close()
   }
   const global=owner(ui.GlobalConfigPage),tree=global.render({active:null});await global.flush();same(nodes(tree,ui.Choice),[]);same(nodes(tree,'Section').map(n=>text(n.props.header)),['缓存管理','控制器管理','交互体验','延迟阈值设置','网络请求','连接超时','测速设置','运行日志']);global.close()
   same(pref.getPreferences(),prior);same(store.get(key),stored);assert.equal(writes,0);assert.equal(calls.length,0)
  }finally{context.Storage.set=original}
 })
 await test('More theme selector immediately updates existing AppearanceRoot without replacing navigation content; other prefs preserved',async()=>{
  pref.savePreferences({theme:'system'});const page=owner(pages.MorePage),appearance=owner(app.AppearanceRoot)
  let tree=page.render(props);await page.flush();let shell=appearance.render({});await appearance.flush();const content=shell.props.children[0]
  const prior=pref.getPreferences(),beforeCalls=calls.length,beforeConfirms=confirms.length
  try{
   for(const theme of ['dark','light','system','dark']){
    choice(tree,'外观模式').props.onChanged(theme);await page.flush();tree=page.render();shell=appearance.render();await appearance.flush()
    assert.equal(choice(tree,'外观模式').props.value,theme);assert.equal(shell.props.preferredColorScheme,theme==='system'?undefined:theme);assert.equal(shell.props.children[0],content);same(pref.getPreferences(),{...prior,theme});assert.equal(store.get(key).theme,theme)
   }
   assert.equal(calls.length,beforeCalls);assert.equal(confirms.length,beforeConfirms)
  }finally{page.close();appearance.close()}
 })
 await test('default-page selector preserves options/start mapping and never switches the already-running tab',async()=>{
  pref.savePreferences({defaultPage:'overview'});const page=owner(pages.MorePage),root=owner(app.Root)
  let tree=page.render(props);await page.flush();const live=root.render({});await root.flush();const binding=nodes(live,'TabView')[0].props.selection
  const prior=pref.getPreferences()
  try{
   for(const [stored] of pageOptions){
    choice(tree,'默认打开界面').props.onChanged(stored);await page.flush();tree=page.render();assert.equal(choice(tree,'默认打开界面').props.value,stored);assert.equal(binding.value,'home')
    same(pref.getPreferences(),{...prior,defaultPage:stored});assert.equal(store.get(key).defaultPage,stored)
    const fresh=owner(app.Root),started=fresh.render({});assert.equal(nodes(started,'TabView')[0].props.selection.value,stored==='overview'?'home':stored);fresh.close()
   }
  }finally{page.close();root.close()}
 })
 await test('reopening More and restarting preference module keeps accepted settings during delayed persistence',async()=>{
  const original=context.Storage.set,pending=[]
  pref.savePreferences({theme:'light',defaultPage:'proxies'});context.Storage.set=(k,v)=>k===key?(pending.push([k,clone(v)]),true):original(k,v)
  let page=owner(pages.MorePage),tree=page.render(props);await page.flush()
  try{
   choice(tree,'外观模式').props.onChanged('dark');choice(tree,'默认打开界面').props.onChanged('more');assert.equal(store.get(key).theme,'light');page.close()
   page=owner(pages.MorePage);tree=page.render(props);await page.flush();assert.equal(choice(tree,'外观模式').props.value,'dark');assert.equal(choice(tree,'默认打开界面').props.value,'more')
   pending.forEach(([k,v])=>original(k,v));const cached=cache.get('preferences');cache.delete('preferences');try{const restarted=load('preferences');assert.equal(restarted.getPreferences().theme,'dark');assert.equal(restarted.getPreferences().defaultPage,'more')}finally{cache.set('preferences',cached)}
  }finally{context.Storage.set=original;page.close()}
 })
 await test('both selectors retain accepted values and theme on storage failure; default values remain unchanged',async()=>{
  pref.savePreferences({theme:'light',defaultPage:'proxies'});const page=owner(pages.MorePage),appearance=owner(app.AppearanceRoot);let tree=page.render(props);await page.flush();appearance.render({});await appearance.flush()
  const prior=pref.getPreferences(),stored=clone(store.get(key)),before=alerts.length;failStorage=true
  try{
   choice(tree,'外观模式').props.onChanged('dark');choice(tree,'默认打开界面').props.onChanged('more');await page.flush();tree=page.render();const shell=appearance.render()
   same(pref.getPreferences(),prior);same(store.get(key),stored);assert.equal(choice(tree,'外观模式').props.value,'light');assert.equal(choice(tree,'默认打开界面').props.value,'proxies');assert.equal(shell.props.preferredColorScheme,'light');assert.equal(alerts.length,before+2);assert.ok(alerts.slice(-2).every(x=>x.message==='本地设置保存失败，请重试'));assert.equal(pref.DEFAULTS.theme,'system');assert.equal(pref.DEFAULTS.defaultPage,'overview')
  }finally{failStorage=false;page.close();appearance.close()}
 })
 console.log('All '+count+' More preference migration groups passed (mock UI/storage; no device rendering claim).')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
