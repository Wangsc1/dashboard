// More/core API regression. All native UI, credentials and network are mocked.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const harness=fs.readFileSync(path.join(__dirname,'run.cjs'),'utf8').split(';(async () => {')[0]
const checks=String.raw`
const c={id:'upgrade-direct',name:'Upgrade',kind:'clash',url:'http://upgrade.invalid'}
const draw=(active=c,reset=false)=>render(pages.MorePage,{active,selected:false,onChanged(){}},reset)
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
const upgrades=()=>calls.filter(x=>x.url.endsWith('/upgrade'))
function rawNodes(tree,name){const out=[];function walk(n){if(!n||typeof n!=='object')return;if(n.type?.name===name)out.push(n);for(const child of n.props?.children??[])walk(child)}walk(tree);return out}
;(async()=>{
 await test('upgrade first with arrow.up.circle; one same-style explicit confirmation; cancel sends no request',async()=>{
  let tree=draw(c,true);await flush();tree=draw()
  const panel=rawNodes(tree,'MorePanel').find(n=>rawNodes(n,'MoreLine').some(x=>x.props.title==='升级核心'))
  assert.ok(panel);const lines=rawNodes(panel,'MoreLine');assert.equal(JSON.stringify(lines.map(x=>x.props.title)),JSON.stringify(['升级核心','重启核心','重载配置','更新GEO数据库']));assert.equal(lines[0].props.icon,'arrow.up.circle')
  calls.length=0;context.confirmResult=false;const before=confirms.length;await button(tree,'升级核心').props.action();assert.equal(calls.length,0);assert.equal(confirms.length,before+1)
  assert.equal(JSON.stringify(confirms.at(-1)),JSON.stringify({title:'升级核心',message:'将下载并替换核心，可能重启并短暂中断代理服务。是否继续？',confirmLabel:'确认升级',cancelLabel:'取消'}))
  tree=draw();assert.equal(button(tree,'升级核心').props.disabled,false);assert.equal(tree.props.overlay,undefined)
  tree=draw(null,true);assert.ok(!text(tree).includes('升级核心'));unmount();context.confirmResult=true
 })
 await test('accept sends one bodyless POST /upgrade with current auth; reports only request submitted',async()=>{
  secrets.set('neko_secret_'+c.id,'direct-token');responder=()=>({body:{status:'ok'}});calls.length=0
  let tree=draw(c,true);await flush();await button(tree,'升级核心').props.action();tree=draw()
  assert.equal(calls.length,1);assert.equal(calls[0].url,c.url+'/upgrade');assert.equal(calls[0].init.method,'POST');assert.equal(calls[0].init.body,undefined);assert.equal(calls[0].init.headers.Authorization,'Bearer direct-token')
  assert.equal(text(tree.props.overlay.content).trim(),'已提交升级请求');assert.ok(!text(tree.props.overlay.content).includes('升级成功'));assert.equal(button(tree,'升级核心').props.disabled,false);unmount()
 })
 await test('manual/discovered Nikki, OpenClash and Mihomo resolve own controller/auth, never router password',async()=>{
  for(const plugin of ['nikki','openclash','mihomo'])for(const auto of [false,true]){
   const id='upgrade-'+plugin+'-'+auto,n={id,name:id,kind:'openwrt',plugin,auto,host:id+'.invalid',url:'http://'+id+'.invalid',cport:9191,username:'root'}
   secrets.set('neko_secret_'+id,'router-password-'+id);secrets.set('neko_csecret_'+id,'manual-'+id)
   responder=(url,init)=>{
    if(url.endsWith('/ubus')){const p=JSON.parse(init.body).params;return {body:{result:[0,p[1]==='session'?{ubus_rpc_session:'session-'+id}:{values:plugin==='openclash'?{cn_port:'9292',dashboard_password:'discovered-'+id}:{api_listen:'0.0.0.0:9292',api_secret:'discovered-'+id}}]}}}
    return {body:{status:'ok'}}
   }
   calls.length=0;await api.coreAction(n,'upgrade');assert.equal(upgrades().length,1);const post=upgrades()[0]
   assert.equal(post.url,'http://'+id+'.invalid:'+(auto?9292:9191)+'/upgrade');assert.equal(post.init.method,'POST');assert.equal(post.init.body,undefined);assert.equal(post.init.headers.Authorization,'Bearer '+(auto?'discovered-':'manual-')+id)
   assert.ok(!JSON.stringify(post).includes('router-password'));assert.ok(!calls.some(x=>x.url.endsWith('/restart')))
  }
 })
 await test('busy during confirmation and network prevents duplicate old/new handler requests',async()=>{
  const originalConfirm=context.Dialog.confirm,originalFetch=context.fetch,confirm=deferred(),network=deferred();let confirmations=0
  context.Dialog.confirm=async()=>{confirmations++;return confirm.promise}
  context.fetch=async(url,init)=>{if(url.endsWith('/upgrade'))await network.promise;return originalFetch(url,init)};responder=()=>({body:{status:'ok'}})
  try{
   calls.length=0;let tree=draw(c,true);await flush();const handler=button(tree,'升级核心').props.action,pending=handler()
   await handler();tree=draw();assert.equal(button(tree,'升级核心').props.disabled,true);await button(tree,'升级核心').props.action();assert.equal(confirmations,1);assert.equal(upgrades().length,0)
   confirm.resolve(true);await flush();tree=draw();assert.equal(button(tree,'升级核心').props.disabled,true);await handler();assert.equal(confirmations,1)
   network.resolve();await pending;assert.equal(upgrades().length,1);assert.equal(button(draw(),'升级核心').props.disabled,false)
  }finally{confirm.resolve(false);network.resolve();context.Dialog.confirm=originalConfirm;context.fetch=originalFetch;unmount()}
 })
 await test('source switch/unmount during confirmation sends nothing; stale handler cannot target old source',async()=>{
  const original=context.Dialog.confirm,other={...c,id:'upgrade-other',url:'http://other-upgrade.invalid'}
  try{
   for(const mode of ['switch','unmount']){
    const gate=deferred();context.Dialog.confirm=()=>gate.promise;calls.length=0
    const tree=draw(c,true);await flush();const handler=button(tree,'升级核心').props.action,pending=handler()
    if(mode==='switch'){draw(other);await flush()}else unmount()
    gate.resolve(true);await pending;assert.equal(upgrades().length,0)
    if(mode==='switch'){context.Dialog.confirm=async()=>true;await handler();assert.equal(upgrades().length,0)}
    unmount()
   }
  }finally{context.Dialog.confirm=original;unmount()}
 })
 await test('source change during request suppresses stale success; replacement source receives no upgrade',async()=>{
  const original=context.fetch,gate=deferred(),other={...c,id:'upgrade-replacement',url:'http://replacement.invalid'}
  context.fetch=async(url,init)=>{if(url.endsWith('/upgrade'))await gate.promise;return original(url,init)};responder=()=>({body:{status:'ok'}})
  try{
   calls.length=0;const tree=draw(c,true);await flush();const pending=button(tree,'升级核心').props.action();await flush();draw(other);await flush();gate.resolve();await pending
   assert.equal(upgrades().length,1);assert.equal(upgrades()[0].url,c.url+'/upgrade');assert.equal(draw(other).props.overlay,undefined)
  }finally{gate.resolve();context.fetch=original;unmount()}
 })
 await test('unsupported/denied/HTTP/network failures use existing error alert, no success, and release busy',async()=>{
  for(const result of [{status:404},{status:405},{status:403},{status:500},{throw:'upgrade connection failed'}]){
   responder=()=>result;calls.length=0;const before=alerts.length;let tree=draw(c,true);await flush();await button(tree,'升级核心').props.action();tree=draw()
   assert.equal(upgrades().length,1);assert.equal(alerts.length,before+1);assert.equal(alerts.at(-1).title,'操作未完成');assert.equal(alerts.at(-1).message,pages.safeError());assert.equal(tree.props.overlay,undefined);assert.equal(button(tree,'升级核心').props.disabled,false);unmount()
  }
 })
 console.log('All '+count+' core upgrade regression groups passed (mock UI/network only; no real upgrade).')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
