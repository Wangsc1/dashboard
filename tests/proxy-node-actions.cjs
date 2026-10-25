// Native menus/navigation and real API transport with synthetic data only.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
scripting.useState=function(v){const slots=hooks,i=hookIndex++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]}
function owner(fn){const state={hooks:[],cleanups:new Map()};let props
 return {render(p){props=p??props;const saved={hooks,cleanups,effects,hookIndex};hooks=state.hooks;cleanups=state.cleanups;effects=[];hookIndex=0;const tree=fn(props),queued=effects;hooks=saved.hooks;cleanups=saved.cleanups;effects=saved.effects;hookIndex=saved.hookIndex;for(const f of queued){const old=cleanups;cleanups=state.cleanups;f();cleanups=old}return tree},close(){for(const f of state.cleanups.values())f();state.cleanups.clear()},state}}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
async function settle(){for(let i=0;i<100;i++)await Promise.resolve()}
function menu(t,n){const card=nodes(t,'VStack').find(v=>v.props.contextMenu&&text(v).includes(n));assert.ok(card);return card.props.contextMenu.menuItems}
function action(t,n,title){return nodes(menu(t,n),'Button').find(b=>b.props.systemImage===title).props.action()}
const device={id:'node-action-test',kind:'clash',name:'Synthetic',url:'http://node-action.invalid'},name='香港 / A?#'
const group=(title='test')=>({name:title,type:'Selector',all:[name,'other'],now:name,delays:{[name]:30,other:40},types:{[name]:'Shadowsocks',other:'VMess'}})
;(async()=>{
 await test('single delay encodes exact node, honors preferences and shares queue/in-flight requests',async()=>{
  const before=pref.getPreferences();pref.savePreferences({testURL:'https://probe.invalid/a?b=1&c=2',testTimeout:1200})
  const wait=deferred();calls.length=0;responder=()=>({wait:wait.promise,body:{delay:81}})
  const a=api.testProxyNode(device,name),b=api.testProxyNode(device,name);await settle();assert.equal(calls.length,1)
  assert.ok(calls[0].url.includes('/proxies/'+encodeURIComponent(name)+'/delay?url='+encodeURIComponent(pref.getPreferences().testURL)+'&timeout=1200'))
  assert.equal(calls[0].init.method,'GET');wait.resolve();assert.deepEqual(await Promise.all([a,b]),[81,81]);pref.savePreferences(before)
 })
 await test('detail API returns only typed whitelist, bounded normalized history, and rejects failed delay',async()=>{
  responder=()=>({body:{type:'Shadowsocks',udp:true,xudp:false,tfo:'yes',mptcp:true,alive:false,password:'NEVER',server:'NEVER',extra:{url:'NEVER'},history:[{delay:2,time:'garbage'},...Array.from({length:12},()=>({delay:0,time:'2026-01-01T00:00:00Z',secret:'NEVER'}))]}})
  const d=await api.loadProxyNode(device,name);assert.equal(d.type,'Shadowsocks');assert.equal(d.udp,true);assert.equal(d.tfo,undefined);assert.equal(d.history.length,10);assert.ok(!JSON.stringify(d).includes('NEVER'));assert.ok(!('server'in d));assert.equal(d.history[0].time,'2026-01-01T00:00:00.000Z')
  assert.ok(calls.at(-1).url.endsWith('/proxies/'+encodeURIComponent(name)))
  responder=()=>({body:{udp:0,history:[null,{delay:-2},{delay:'3'},{delay:4,time:'invalid'}]}});const missing=await api.loadProxyNode(device,name);assert.equal(missing.udp,undefined);assert.equal(missing.history.length,1);assert.equal(missing.history[0].time,undefined)
  responder=()=>({status:503});await assert.rejects(()=>api.testProxyNode(device,name),/HTTP 503/)
  responder=()=>({body:{delay:0}});await assert.rejects(()=>api.testProxyNode(device,name),/未返回有效延迟/)
 })
 await test('menu actions never select; exact single request updates mounted same-name cards and cached cards',async()=>{
  const a=owner(pages.GroupSection),b=owner(pages.GroupSection),g=group('shared-one'),h=group('shared-two');calls.length=0;responder=()=>({body:{delay:123}})
  try{
   let t=a.render({c:device,g,expanded:true,onChanged(){throw Error('must not refresh group')}});const hidden=b.render({c:device,g:h,expanded:true,onChanged(){}});await settle();hidden.props.onDisappear()
   const bottom=nodes(t,'HStack').find(x=>text(x.props.children[0])==='Shadowsocks');assert.ok(bottom);assert.equal(text(bottom.props.children.at(-1)),'30ms');assert.equal(bottom.props.children[0].props.foregroundStyle,'white');assert.equal(bottom.props.children.at(-1).props.foregroundStyle,api.delayColor(30))
   assert.equal(nodes(t,'Image').filter(n=>n.props.systemName==='checkmark').length,0)
   action(t,name,'info.circle');t=a.render();assert.equal(t.props.navigationDestination.content.type,pages.ProxyNodeDetailPage);assert.equal(calls.length,0);t.props.navigationDestination.onChanged(false)
   await action(a.render(),name,'speedometer');await settle();assert.equal(calls.length,1);assert.ok(calls[0].url.includes('/delay?'));assert.ok(text(a.render()).includes('123ms'));assert.ok(!text(b.render()).includes('123ms'));b.render().props.onAppear();assert.ok(text(b.render()).includes('123ms'));assert.equal(confirms.length,0)
   b.close();const remount=owner(pages.GroupSection);try{assert.ok(text(remount.render({c:device,g:h,expanded:true,onChanged(){}})).includes('123ms'))}finally{remount.close()}
  }finally{a.close();b.close()}
 })
 await test('duplicate clicks, failures, disappearance, source changes and unmount reject late publication',async()=>{
  for(const kind of ['duplicate','failure','disappear','source','unmount']){
   const c={...device,id:'case-'+kind},g=group('case-'+kind),a=owner(pages.GroupSection),wait=deferred();calls.length=0
   responder=()=>({wait:wait.promise,status:kind==='failure'?500:200,body:{delay:678}})
   let t=a.render({c,g,expanded:true,onChanged(){}});await settle();const start=()=>action(t,name,'speedometer');const pending=start();await settle()
   if(kind==='duplicate'){await start();assert.equal(calls.length,1)}
   if(kind==='disappear')t.props.onDisappear()
   if(kind==='source'){t=a.render({c:{...c,url:'http://other.invalid'},g,expanded:true,onChanged(){}});await settle()}
   if(kind==='unmount')a.close()
   wait.resolve();await pending;await settle()
   if(kind==='failure'){t=a.render();assert.ok(text(t).includes('HTTP 500'));assert.ok(!text(t).includes('678ms'))}
   if(['disappear','source'].includes(kind)){assert.ok(!text(a.render()).includes('678ms'))}
   a.close()
   if(['disappear','source','unmount'].includes(kind)){const fresh=owner(pages.GroupSection);try{assert.ok(!text(fresh.render({c,g,expanded:true,onChanged(){}})).includes('678ms'))}finally{fresh.close()}}
  }
 })
 await test('native detail unknown fields, HTTP error and late completion safety',async()=>{
  const a=owner(pages.ProxyNodeDetailPage);responder=()=>({body:{type:'VMess',udp:true,alive:false}})
  let t=a.render({c:device,name});await settle();t=a.render();assert.equal(t.props.navigationTitle,name);assert.ok(text(t).includes('UDP：是'));assert.ok(text(t).includes('XUDP：内核未提供'));assert.ok(text(t).includes('存活（最近探测）：否'));assert.ok(!text(t).includes('流量'));a.close()
  for(const kind of ['failure','unmount','disappear','source']){
   const b=owner(pages.ProxyNodeDetailPage),wait=deferred();responder=()=>({wait:wait.promise,status:kind==='failure'?404:200,body:{type:'OLD-DETAIL'}})
   let view=b.render({c:device,name});await settle()
   if(kind==='unmount')b.close()
   if(kind==='disappear')view.props.onDisappear()
   if(kind==='source'){responder=()=>({body:{type:'NEW-DETAIL'}});view=b.render({c:{...device,url:'http://new.invalid'},name});await settle()}
   wait.resolve();await settle()
   if(kind!=='unmount'){view=b.render();if(kind==='failure')assert.ok(text(view).includes('HTTP 404'));else assert.ok(!text(view).includes('OLD-DETAIL'))}
   b.close()
  }
 })
 console.log(count+' proxy node action groups passed (mock only).')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
