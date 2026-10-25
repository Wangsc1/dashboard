// Native menus/navigation and real API transport with synthetic data only.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
scripting.useState=function(v){const slots=hooks,i=hookIndex++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]}
function expandDetail(n){if(!n||typeof n!=="object")return n;if(typeof n.type==="function"&&["NodeDetailBox","NodeDetailRow"].includes(n.type.name))return expandDetail(n.type(n.props));return {...n,props:{...n.props,children:(n.props?.children??[]).map(expandDetail)}}}
function owner(fn){const state={hooks:[],cleanups:new Map()};let props
 return {render(p){props=p??props;const saved={hooks,cleanups,effects,hookIndex};hooks=state.hooks;cleanups=state.cleanups;effects=[];hookIndex=0;const tree=expandDetail(fn(props)),queued=effects;hooks=saved.hooks;cleanups=saved.cleanups;effects=saved.effects;hookIndex=saved.hookIndex;for(const f of queued){const old=cleanups;cleanups=state.cleanups;f();cleanups=old}return tree},close(){for(const f of state.cleanups.values())f();state.cleanups.clear()},state}}
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
 function actionsOwner(){return owner(({c,enabled=true})=>pages.useProxyNodeActions(c,enabled))}
 await test('menu preview disposal cannot cancel page-owned navigation or single-node action',async()=>{
  const host=actionsOwner(),a=owner(pages.GroupSection),b=owner(pages.GroupSection),g=group('shared-one'),h=group('shared-two');calls.length=0
  try{
   let state=host.render({c:device}),t=a.render({c:device,g,expanded:true,nodeActions:state,onChanged(){throw Error('must not refresh group')}})
   b.render({c:device,g:h,expanded:true,onChanged(){}})
   const bottom=nodes(t,'HStack').find(x=>text(x.props.children[0])==='Shadowsocks');assert.ok(bottom);assert.equal(text(bottom.props.children.at(-1)),'30ms');assert.equal(bottom.props.children[0].props.foregroundStyle,'white');assert.equal(bottom.props.children.at(-1).props.foregroundStyle,api.delayColor(30))
   assert.equal(nodes(t,'Image').filter(n=>n.props.systemName==='checkmark').length,0)
   assert.equal(t.props.navigationDestination,undefined);assert.equal(t.props.onDisappear,undefined,'lazy card does not own action visibility')
   const frozenMenu=menu(t,name);a.close() // native preview/original lazy subtree is disposed before action delivery
   button(frozenMenu,'详细信息').props.action();state=host.render();assert.equal(state.destination.isPresented,true);assert.equal(state.destination.content.type,pages.ProxyNodeDetailPage);assert.equal(calls.length,0)
   state.disappear();state=host.render();assert.equal(state.destination.isPresented,true,'push disappearance must not pop its destination')
   state.destination.onChanged(false);state=host.render();assert.equal(state.destination.isPresented,false);state.appear()
   const wait=deferred();responder=()=>({wait:wait.promise,body:{delay:123}})
   const pending=button(frozenMenu,'延迟测试').props.action();await settle();state=host.render();assert.equal(calls.length,1);assert.ok(calls[0].url.includes('/delay?'));assert.ok(state.notice.includes('测速中'));assert.equal(state.busy,name)
   const replacement=owner(pages.GroupSection);try{
    t=replacement.render({c:device,g,expanded:true,nodeActions:state,onChanged(){}});assert.ok(text(t).includes('测速中'))
    wait.resolve();await pending;await settle();state=host.render();assert.equal(state.busy,'');assert.ok(state.notice.includes('123 ms'));assert.ok(text(replacement.render()).includes('123ms'));assert.ok(text(b.render()).includes('123ms'));assert.equal(confirms.length,0)
   }finally{replacement.close()}
   b.close();const remount=owner(pages.GroupSection);try{assert.ok(text(remount.render({c:device,g:h,expanded:true,onChanged(){}})).includes('123ms'))}finally{remount.close()}
  }finally{host.close();a.close();b.close()}
 })
 await test('actual ProxiesPage root hosts destination across lazy-card rebuild and page push',async()=>{
  const loadGroups=api.loadGroups,loadProviders=api.loadProviders,page=owner(pages.ProxiesPage),card=owner(pages.GroupSection)
  api.loadGroups=async()=>[group('stable-host')];api.loadProviders=async()=>[]
  try{
   let t=page.render({active:device,version:0,selected:true});await settle();t=page.render();assert.equal(t.type,'ScrollView');assert.ok(t.props.navigationDestination)
   let p=nodes(t,pages.GroupSection)[0].props;p={...p,expanded:true};const preview=card.render(p),saved=menu(preview,name);card.close()
   button(saved,'详细信息').props.action();t=page.render();assert.equal(t.props.navigationDestination.isPresented,true)
   t=page.render({active:{...device},version:1,selected:true});assert.equal(t.props.navigationDestination.isPresented,true,'same-value source refresh must retain detail');t.props.onDisappear();t=page.render();await settle();t=page.render();assert.equal(t.props.navigationDestination.isPresented,true)
   assert.equal(t.props.navigationDestination.content.props.name,name);assert.equal(t.props.navigationDestination.content.type,pages.ProxyNodeDetailPage)
   t.props.navigationDestination.onChanged(false);t=page.render();assert.equal(t.props.navigationDestination.isPresented,false)
   t.props.onAppear();t=page.render();await settle();t=page.render()
   const fresh=owner(pages.GroupSection);try{
    const v=fresh.render({...nodes(t,pages.GroupSection)[0].props,expanded:true});const wait=deferred();responder=()=>({wait:wait.promise,body:{delay:432}})
    const pending=action(v,name,'speedometer');await settle();t=page.render();assert.ok(!text(t).includes('测速中'));assert.ok(text(fresh.render({...nodes(t,pages.GroupSection)[0].props,expanded:true})).includes('测速中'));wait.resolve();await pending;t=page.render();assert.ok(!text(t).includes('432 ms'));assert.ok(text(fresh.render({...nodes(t,pages.GroupSection)[0].props,expanded:true})).includes('432ms'))
   }finally{fresh.close()}
  }finally{card.close();page.close();api.loadGroups=loadGroups;api.loadProviders=loadProviders}
 })
 await test('duplicate clicks, failures, real page departure, source changes, disabled and unmount reject late publication',async()=>{
  for(const kind of ['duplicate','failure','disappear','source','disabled','unmount']){
   const c={...device,id:'case-'+kind},g=group('case-'+kind),host=actionsOwner(),a=owner(pages.GroupSection),wait=deferred();calls.length=0
   responder=()=>({wait:wait.promise,status:kind==='failure'?500:200,body:{delay:678}})
   let state=host.render({c}),t=a.render({c,g,expanded:true,nodeActions:state,onChanged(){}});const start=()=>action(t,name,'speedometer');const pending=start();await settle()
   if(kind==='duplicate'){await start();assert.equal(calls.length,1)}
   if(kind==='disappear')state.disappear()
   if(kind==='source')state=host.render({c:{...c,url:'http://other.invalid'}})
   if(kind==='disabled')state=host.render({c,enabled:false})
   if(kind==='unmount')host.close()
   wait.resolve();await pending;await settle()
   if(kind==='failure'){state=host.render();assert.ok(state.notice.includes('HTTP 500'));assert.equal(state.busy,'');assert.ok(!text(a.render()).includes('678ms'))}
   if(['disappear','source','disabled'].includes(kind)){assert.ok(!host.render().notice.includes('678 ms'));assert.ok(!text(a.render()).includes('678ms'))}
   a.close();host.close()
   if(['disappear','source','disabled','unmount'].includes(kind)){const fresh=owner(pages.GroupSection);try{assert.ok(!text(fresh.render({c,g,expanded:true,onChanged(){}})).includes('678ms'))}finally{fresh.close()}}
  }
 })
 await test('OpenWrt Nikki/OpenClash discovery and emoji provider nodes use the same routes as working group probes',async()=>{
  const leaf='🇭🇰 GIGO-STD / %?#',local='🇯🇵 local / %?#',provider='订阅 / A%'
  const detail={type:'Snell',udp:true,history:[{time:'2026-01-01T00:00:00Z',delay:39}],password:'NEVER'}
  for(const plugin of ['nikki','openclash']){
   const c={id:'route-diff-'+plugin,name:'Mock',kind:'openwrt',plugin,auto:true,host:'router-'+plugin+'.invalid',url:'http://luci-'+plugin+'.invalid',username:'root'}
   const base='http://'+c.host+':9098',providerPath='/providers/proxies/'+encodeURIComponent(provider)+'/'+encodeURIComponent(leaf),localPath='/proxies/'+encodeURIComponent(local)
   responder=(url,init)=>{
    if(url===c.url+'/ubus'){
     const [,obj,method,args]=JSON.parse(init.body).params
     if(obj==='session')return {body:{result:[0,{ubus_rpc_session:'synthetic-session'}]}}
     assert.equal(obj,'uci');assert.equal(method,'get');assert.equal(args.config,plugin)
     return {body:{result:[0,{values:plugin==='nikki'?{api_listen:'0.0.0.0:9098',api_secret:'synthetic-token'}:{cn_port:'9098',dashboard_password:'synthetic-token'}}]}}
    }
    assert.ok(url.startsWith(base+'/'),'controller must use discovered host/port, not LuCI forwarding')
    assert.equal(init.headers.Authorization,'Bearer synthetic-token')
    const path=url.slice(base.length).split('?')[0]
    if(path==='/connections')return {body:{connections:[]}}
    if(path==='/proxies')return {body:{proxies:{G:{type:'Selector',all:[leaf,local],now:leaf},[local]:{type:'Direct',history:[{delay:33}]}}}}
    if(path==='/providers/proxies')return {body:{providers:{[provider]:{vehicleType:'HTTP',proxies:[{name:leaf,...detail}]}}}}
    if(path===providerPath||path===localPath)return {body:detail}
    if(path===providerPath+'/healthcheck'||path===localPath+'/delay')return {body:{delay:77}}
    return {status:404} // provider nodes are NOT in tunnel.Proxies().
   }
   calls.length=0;const g=(await api.loadGroups(c))[0];assert.equal(g.delays[leaf],39);assert.equal(g.testTargets[leaf].provider,provider)
   assert.equal(g.testTargets[local].provider,undefined);assert.ok(calls.some(x=>x.url===c.url+'/ubus'))
   calls.length=0;const batch=await api.testGroup(c,g);assert.equal(batch[leaf],77);assert.equal(batch[local],77)
   const successfulPaths=calls.map(x=>x.url.split('?')[0]);assert.ok(successfulPaths.includes(base+providerPath+'/healthcheck'));assert.ok(successfulPaths.includes(base+localPath+'/delay'))
   await assert.rejects(()=>api.testProxyNode(c,leaf),e=>/HTTP 404/.test(e.message)&&!/9090|端口/.test(e.message),'old global-only path must fail without suggesting a port change')
   const host=actionsOwner(),card=owner(pages.GroupSection),form=owner(pages.ProxyNodeDetailPage)
   try{
    let state=host.render({c}),t=card.render({c,g,expanded:true,nodeActions:state,onChanged(){throw Error('no switch/refetch')}});calls.length=0
    await action(t,leaf,'speedometer');assert.equal(calls.length,1);assert.ok(calls[0].url.startsWith(base+providerPath+'/healthcheck?'))
    assert.ok(calls[0].url.includes('timeout='+Math.min(2000,pref.getPreferences().testTimeout)));assert.ok(calls[0].url.includes('url='+encodeURIComponent(pref.getPreferences().testURL)))
    assert.ok(text(card.render()).includes('77ms'))
    action(t,leaf,'info.circle');state=host.render();assert.equal(state.destination.content.props.target.provider,provider)
    form.render(state.destination.content.props);await settle();assert.ok(text(form.render()).includes('Snell'));assert.equal(calls.length,3);assert.ok(calls.some(x=>x.url===base+providerPath));assert.ok(calls.some(x=>x.url===base+'/connections'))
    assert.ok(!text(form.render()).includes('NEVER'));assert.ok(calls.every(x=>x.init.method==='GET'))
    calls.length=0;await api.testProxyNode(c,local,g.testTargets[local]);await api.loadProxyNode(c,local,g.testTargets[local]);assert.equal(calls[0].url.split('?')[0],base+localPath+'/delay');assert.equal(calls[1].url,base+localPath)
   }finally{form.close();card.close();host.close()}
  }
 })
 await test('independent connection snapshot uses exact chain elements and aggregates all same-name connections without sampling',async()=>{
  const c={...device,id:'snapshot-independent'},node='🇭🇰 Exact',before=model.historyFor(c),active=before.active,closed=before.closed
  const rows=[{id:'a',chains:['Group',node],providerChains:['Subscription A'],upload:100,download:200},{id:'b',chains:[node],providerChains:['Subscription B'],upload:30,download:70},{id:'c',chains:[node+' extra'],upload:9000,download:9000},{id:'d',chains:['other'],upload:5000,download:5000}]
  responder=()=>({body:{connections:rows}});calls.length=0
  const result=await api.loadProxyNodeConnections(c,node);assert.equal(result.connections.length,2);assert.equal(result.upload,130);assert.equal(result.download,270);assert.equal(result.name,node);assert.ok(result.at>0)
  assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith('/connections'));assert.equal(before.active,active);assert.equal(before.closed,closed)
  responder=()=>({body:{connections:[]}});assert.equal((await api.loadProxyNodeConnections(c,node)).connections.length,0)
  responder=()=>({status:503});await assert.rejects(()=>api.loadProxyNodeConnections(c,node),/503/)
 })
 await test('detail capabilities, provider identity, name-only scope, totals, list cap, refresh and partial failures',async()=>{
  const node='actual-node',target={name:node,provider:'Subscription A'},view=owner(pages.ProxyNodeDetailPage)
  const connections=Array.from({length:22},(_,i)=>({id:String(i),chains:['Group',node],metadata:{host:'target-'+i+'.invalid'},rule:'MATCH',upload:100,download:200}))
  let failConnections=false,failDetail=false
  responder=url=>url.endsWith('/connections')?(failConnections?{status:503}:{body:{connections}}):(failDetail?{status:404}:{body:{type:'Shadowsocks',udp:true,xudp:true,tfo:false,mptcp:true,alive:true,history:[{delay:98765}],password:'NEVER'}})
  try{
   calls.length=0;view.render({c:device,name:'display-group',target});await settle();let t=view.render();assert.equal(calls.length,2)
   const words=text(t);for(const value of ['Subscription A','actual-node','XUDP','TFO','MPTCP','最近探测','存活','当前连接流量','22','仅展示前20条','同名节点',api.fmtBytes(2200),api.fmtBytes(4400),api.fmtBytes(6600)])assert.ok(words.includes(value),value)
   assert.ok(!/延迟历史|98765|NEVER|最高上传|最近错误/.test(words));assert.ok(words.includes('target-19.invalid'));assert.ok(!words.includes('target-20.invalid'))
   view.render();await settle();assert.equal(calls.length,2,'rerender does not poll')
   failConnections=true;button(t,'刷新快照').props.action();t=view.render();await settle();t=view.render();assert.ok(text(t).includes('Shadowsocks'));assert.ok(text(t).includes('连接快照读取失败'));assert.ok(!text(t).includes('总计'))
   failConnections=false;failDetail=true;button(t,'重试连接快照').props.action();view.render();await settle();t=view.render();assert.ok(text(t).includes('HTTP 404'));assert.ok(text(t).includes('当前连接流量'));assert.ok(text(t).includes('22'))
  }finally{view.close()}
  const empty=owner(pages.ProxyNodeDetailPage);try{responder=url=>({body:url.endsWith('/connections')?{connections:[]}:{type:'Direct'}});empty.render({c:device,name:node});await settle();const t=empty.render();assert.ok(text(t).includes('没有同名关联活动连接'));assert.ok(text(t).includes('未指定提供者（全局代理接口）'));assert.ok(!text(t).includes('连接快照读取失败'))}finally{empty.close()}
 })
 await test('detail snapshot late responses are isolated on source change, departure and disposal',async()=>{
  for(const kind of ['source','disappear','unmount']){
   const view=owner(pages.ProxyNodeDetailPage),wait=deferred();let isOld=true
   responder=url=>url.endsWith('/connections')?{wait:isOld?wait.promise:undefined,body:{connections:[{id:'one',metadata:{host:isOld?'OLD-HOST':'NEW-HOST'},chains:['actual'],upload:1,download:2}]}}:{body:{type:'Direct'}}
   let t=view.render({c:device,name:'display',target:{name:'actual',provider:'A'}});await settle()
   if(kind==='source'){isOld=false;t=view.render({c:{...device,url:'http://changed.invalid'},name:'display',target:{name:'actual',provider:'B'}});await settle()}
   if(kind==='disappear')t.props.onDisappear()
   if(kind==='unmount')view.close()
   wait.resolve();await settle();if(kind!=='unmount'){t=view.render();assert.ok(!text(t).includes('OLD-HOST'));if(kind==='source')assert.ok(text(t).includes('NEW-HOST'))}view.close()
  }
 })
 await test('native detail unknown fields, HTTP error and late completion safety',async()=>{
  const a=owner(pages.ProxyNodeDetailPage);responder=()=>({body:{type:'VMess',udp:true,alive:false}})
  let t=a.render({c:device,name});await settle();t=a.render();assert.equal(t.props.navigationTitle,name);assert.ok(text(t).includes('UDP 转发'));assert.ok(text(t).includes('支持'));assert.ok(text(t).includes('最近探测状态'));assert.ok(text(t).includes('未存活'));assert.ok(!/延迟历史|最高|最近错误/.test(text(t)))
  assert.equal(t.type,'ScrollView');assert.equal(t.props.background,'systemBackground');assert.equal(t.props.preferredColorScheme,undefined)
  const box=nodes(t,'VStack').find(n=>n.props.background?.type==='RoundedRectangle');assert.ok(box);assert.equal(box.props.background.props.fill,'secondarySystemBackground');assert.equal(box.props.background.props.cornerRadius,22)
  assert.equal(nodes(box,'Divider').length,1);assert.equal(nodes(box,'HStack').length,2)
  const rows=nodes(box,'HStack');assert.equal(text(rows[0].props.children[0]),'代理类型');assert.equal(text(rows[0].props.children.at(-1)),'VMess');assert.equal(rows[0].props.children.at(-1).props.foregroundStyle,'secondaryLabel')
  assert.equal(text(rows[1].props.children[0]),'UDP 转发');assert.equal(text(rows[1].props.children.at(-1)),'支持');assert.equal(rows[1].props.children.at(-1).props.foregroundStyle,'secondaryLabel');a.close()
  for(const udp of [undefined,false]){const view=owner(pages.ProxyNodeDetailPage);responder=()=>({body:{udp,history:[{delay:99}],xudp:true,alive:true}});view.render({c:device,name});await settle();const tree=view.render();assert.ok(text(tree).includes(udp===false?'不支持':'内核未提供'));assert.ok(!/延迟历史|99/.test(text(tree)));view.close()}
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
