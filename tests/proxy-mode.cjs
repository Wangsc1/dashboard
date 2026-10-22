// Retained proxy-mode behaviour only: cache, prefetch and GLOBAL visibility. No ProxyModeControl.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const harness=fs.readFileSync(path.join(__dirname,'run.cjs'),'utf8').split(';(async () => {')[0]
const checks=String.raw`
let activeOwner=null
scripting.useState=v=>{const o=activeOwner,i=o.cursor++;if(!(i in o.slots))o.slots[i]=typeof v==='function'?v():v;return [o.slots[i],v=>{o.slots[i]=typeof v==='function'?v(o.slots[i]):v}]}
scripting.useEffect=(fn,deps=[])=>{const o=activeOwner,i=o.cursor++,old=o.slots[i];if(!old||deps.some((v,j)=>v!==old[j])){o.slots[i]=deps;o.effects.push(()=>{o.cleanups.get(i)?.();const cleanup=fn();if(typeof cleanup==='function')o.cleanups.set(i,cleanup)})}}
function owner(fn){return {fn,slots:[],cursor:0,effects:[],cleanups:new Map(),props:null,render(props=this.props){this.props=props;this.cursor=0;activeOwner=this;try{return this.fn(props)}finally{activeOwner=null}},async flush(){this.effects.splice(0).forEach(f=>f());await settle()},dispose(){this.cleanups.forEach(f=>f());this.cleanups.clear()}}}
async function settle(){for(let i=0;i<140;i++)await Promise.resolve()}
let a,b,serial=0
function fresh(){serial++;a={id:'proxy-mode-a-'+serial,name:'Mock A',kind:'clash',url:'http://proxy-mode-a-'+serial+'.invalid'};b={...a,id:'proxy-mode-b-'+serial,name:'Mock B',url:'http://proxy-mode-b-'+serial+'.invalid'}}
const PROXIES={PROXY:{type:'Selector',all:['N'],now:'N'},GLOBAL:{type:'Selector',all:['PROXY'],now:'PROXY'},Hidden:{type:'Selector',all:['N'],now:'N',hidden:true},N:{type:'Shadowsocks'}}
const mk=(mode,failProxies=false)=>url=>{if(url.includes('/providers/'))return {body:{providers:{}}};if(url.endsWith('/proxies'))return failProxies?{status:503}:{body:{proxies:PROXIES}};if(url.endsWith('/configs'))return {body:{mode}};return {body:{}}}
const groups=tree=>nodes(tree,pages.GroupSection).map(n=>n.props.g.name)
const patches=()=>calls.filter(x=>x.init.method==='PATCH')
async function loadPage(page,props,mode,reset=false){responder=mk(mode);const tree=page.render(props,reset);await page.flush();return page.render(props)}
;(async()=>{
 await test('代理页不再渲染代理模式区块：标题/Picker/错误与重试全部不存在，其余区块不变',async()=>{
  fresh();calls.length=0;pref.savePreferences({showGlobal:false,showHidden:false});responder=mk('global');pages.prefetchProxies(a);await settle()
  const page=owner(pages.ProxiesPage);page.render({active:a,version:0,selected:true});await page.flush();let tree=page.render()
  assert.ok(!text(tree).includes('代理模式'));assert.ok(!nodes(tree,'Picker').some(n=>n.props.title==='代理模式'));assert.ok(!nodes(tree,'Picker').some(n=>n.props.pickerStyle==='segmented'));assert.ok(!nodes(tree,'Button').some(n=>n.props.title==='重试读取代理模式'));assert.ok(!nodes(tree,'Text').some(n=>n.props.foregroundStyle==='systemRed'));assert.ok(!nodes(tree,pages.ProxyModeControl).length)
  for(const heading of ['策略组','代理来源'])assert.equal(nodes(tree,'Text').find(t=>text(t)===heading)?.props.font,20)
  assert.ok(nodes(tree,'Picker').some(n=>n.props.title==='节点排序')||nodes(trailing(tree.props.toolbar),'Picker').some(n=>n.props.title==='节点排序'));assert.equal(nodes(tree,pages.GroupSection).length,2);assert.equal(patches().length,0);page.dispose()
 })
 await test('prefetch fills mode cache once per source, first ProxiesPage frame uses it for GLOBAL; no duplicate read',async()=>{
  fresh();calls.length=0;let reads=0,failProxies=false;responder=url=>{if(url.endsWith('/configs')){reads++;return {body:{mode:'global'}}}if(url.includes('/providers/'))return {body:{providers:{}}};return failProxies?{status:503}:{body:{proxies:PROXIES}}}
  pages.prefetchProxies(a);const concurrent=pages.prefetchProxies(a);await settle();assert.equal(reads,1);assert.ok(concurrent===undefined)
  calls.length=0;const page=owner(pages.ProxiesPage);page.render({active:a,version:0,selected:true});await page.flush();let tree=page.render();assert.equal(reads,1);assert.ok(groups(tree).includes('GLOBAL'))
  page.dispose();calls.length=0;fresh();responder=mk('rule');pages.prefetchProxies(a);await settle();const again=owner(pages.ProxiesPage);again.render({active:a,version:0,selected:true});await again.flush();tree=again.render();assert.ok(!groups(tree).includes('GLOBAL'));again.dispose()
 })
 await test('cache is source scoped and Storage snapshot restores it for the same source only',async()=>{
  fresh();const page=owner(pages.ProxiesPage);responder=mk('global');pages.prefetchProxies(a);await settle();page.render({active:a,version:0,selected:true},true);await page.flush();page.render()
  assert.deepEqual(store.get('dashboard_mode_snapshot_v1'),{source:JSON.stringify(a),mode:'global'})
  let tree=page.render({active:b,version:0,selected:true});await page.flush();tree=page.render();assert.ok(!groups(tree).includes('GLOBAL'));assert.ok(!store.get('dashboard_mode_snapshot_v1')?.source?.includes(b.id));page.dispose()
  fresh();store.set('dashboard_mode_snapshot_v1',{source:JSON.stringify(b),mode:'global'});const restoredB=owner(pages.ProxiesPage)
  let bTree=restoredB.render({active:b,version:0,selected:true},true);await restoredB.flush();bTree=restoredB.render();assert.ok(groups(bTree).includes('GLOBAL'));restoredB.dispose()
  const restoredA=owner(pages.ProxiesPage)
  let aTree=restoredA.render({active:a,version:0,selected:true},true);await restoredA.flush();aTree=restoredA.render();assert.ok(!groups(aTree).includes('GLOBAL'));restoredA.dispose()
 })
 await test('GLOBAL follows cache changes across page re-entry; unrecognised mode and failed read never show it',async()=>{
  fresh()
  for(const mode of ['global','rule','global','direct']){responder=mk(mode);pages.prefetchProxies(a);await settle();const page=owner(pages.ProxiesPage);page.render({active:a,version:0,selected:true});await page.flush();let tree=page.render();await page.flush();tree=page.render();assert.equal(groups(tree).includes('GLOBAL'),mode==='global',mode);page.dispose()}
  responder=mk('mystery');pages.prefetchProxies(a);await settle();const mp=owner(pages.ProxiesPage);mp.render({active:a,version:0,selected:true});await mp.flush();const mtree=mp.render();await mp.flush();assert.ok(!groups(mp.render()).includes('GLOBAL'));mp.dispose()
  responder=mk('global');pages.prefetchProxies(a);await settle();const gp=owner(pages.ProxiesPage);gp.render({active:a,version:0,selected:true});await gp.flush();await gp.flush();assert.ok(groups(gp.render()).includes('GLOBAL'));gp.dispose()
  responder=url=>url.endsWith('/configs')?{status:500}:mk('global')(url);pages.prefetchProxies(a);await settle();const fp=owner(pages.ProxiesPage);fp.render({active:a,version:0,selected:true});await fp.flush();await fp.flush();assert.ok(groups(fp.render()).includes('GLOBAL'),'failed read keeps last known cache');fp.dispose()
  responder=mk('rule');pages.prefetchProxies(a);await settle();const rp=owner(pages.ProxiesPage);rp.render({active:a,version:0,selected:true});await rp.flush();await rp.flush();assert.ok(!groups(rp.render()).includes('GLOBAL'),'later successful read updates');rp.dispose()
 })
 await test('More page setMode still works and its accepted mode drives the next ProxiesPage GLOBAL state',async()=>{
  fresh();calls.length=0;responder=url=>url.endsWith('/configs')?(url.includes('/configs')?{body:{mode:'rule'}}:{}):{body:{}}
  const more=owner(pages.MorePage),n={...a,id:'more-mode-link',name:'Link',kind:'clash',url:'http://more-mode-link.invalid'}
  responder=url=>url.endsWith('/configs')?{body:{mode:'rule'}}:{body:{}}
  let tree=more.render({active:n,selected:true,onChanged(){}},true);await more.flush();tree=more.render();assert.ok(text(tree).includes('规则模式'))
  responder=(url,init)=>init.method==='PATCH'?(assert.deepEqual(JSON.parse(init.body),{mode:'global'}),{status:204}):{body:{mode:'global'}}
  await api.setMode(n,'global');pages.prefetchProxies(n);await settle();assert.deepEqual(store.get('dashboard_mode_snapshot_v1'),{source:JSON.stringify(n),mode:'global'})
  responder=mk('global');const page=owner(pages.ProxiesPage);let ptree=page.render({active:n,version:0,selected:true},true);await page.flush();ptree=page.render();await page.flush();ptree=page.render();assert.ok(groups(ptree).includes('GLOBAL'))
  responder=url=>url.endsWith('/configs')?{body:{mode:'direct'}}:{body:{}};await api.setMode(n,'direct');pages.prefetchProxies(n);await settle();assert.deepEqual(store.get('dashboard_mode_snapshot_v1'),{source:JSON.stringify(n),mode:'direct'})
  responder=mk('direct');const reload=owner(pages.ProxiesPage);ptree=reload.render({active:n,version:0,selected:true},true);await reload.flush();ptree=reload.render();await reload.flush();ptree=reload.render();assert.ok(!groups(ptree).includes('GLOBAL'));page.dispose();reload.dispose();more.dispose()
 })
 console.log('All '+count+' proxy mode retention groups passed (mock only; no native/device validation).')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
