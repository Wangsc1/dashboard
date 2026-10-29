// Upgrade verification end-to-end: real API/UI, all native IO/network mocked.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const harness=fs.readFileSync(path.join(__dirname,'run.cjs'),'utf8').split(';(async () => {')[0]
const checks=String.raw`
const c={id:'upgrade-direct',name:'Upgrade',kind:'clash',url:'http://upgrade.invalid'},other={...c,id:'other-upgrade',url:'http://other.invalid'}
const old='v1.20.0',next='v1.20.1'
const draw=(active=c,reset=false,selected=true)=>render(pages.MorePage,{active,selected,onChanged(){}},reset)
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
const upgrades=()=>calls.filter(x=>x.url.endsWith('/upgrade'))
const versionCalls=()=>calls.filter(x=>x.url.endsWith('/version'))
function rawNodes(tree,name){const out=[];function walk(n){if(!n||typeof n!=='object')return;if(n.type?.name===name)out.push(n);for(const child of n.props?.children??[])walk(child)}walk(tree);return out}
const core=tree=>rawNodes(tree,'MoreLine').find(n=>n.props.title==='内核版本')
const message=tree=>text(tree.props.overlay?.content).trim()
let posts,reads,after,before,postResult
function scenario({versions=[next],pre=old,post={body:{status:'ok'}}}={}){
 posts=0;reads=0;after=versions;before=pre;postResult=post;calls.length=0
 responder=(url)=>{
  if(url.endsWith('/upgrade')){posts++;return postResult}
  if(url.endsWith('/version')){const v=posts?after[Math.min(reads++,after.length-1)]:before;return typeof v==='string'?{body:{version:v}}:v??{body:{}}}
  if(url.startsWith('https://github.com/'))return {text:next}
  return {body:{mode:'rule'}}
 }
}
async function page(){const tree=draw(c,true);await flush();return draw()}
const timer=context.setTimeout
context.setTimeout=(fn,ms)=>{if(ms===1000)fn();return 1} // finite waits immediate; retain notices for assertions
;(async()=>{
 await test('upgrade remains first arrow.up.circle; unchanged one-layer confirmation; cancellation has zero requests',async()=>{
  scenario();let tree=await page();const panel=rawNodes(tree,'MorePanel').find(n=>rawNodes(n,'MoreLine').some(x=>x.props.title==='升级核心')),lines=rawNodes(panel,'MoreLine')
  assert.equal(JSON.stringify(lines.map(x=>x.props.title)),JSON.stringify(['升级核心','重启核心','重载配置','更新GEO']));assert.equal(lines[0].props.icon,'arrow.up.circle')
  calls.length=0;context.confirmResult=false;const count=confirms.length;await button(tree,'升级核心').props.action();assert.equal(calls.length,0);assert.equal(confirms.length,count+1)
  assert.equal(JSON.stringify(confirms.at(-1)),JSON.stringify({title:'升级核心',message:'将下载并替换核心，可能重启并短暂中断代理服务。是否继续？',confirmLabel:'确认升级',cancelLabel:'取消'}));assert.equal(button(draw(),'升级核心').props.disabled,false)
  assert.ok(!text(draw(null,true)).includes('升级核心'));context.confirmResult=true;unmount()
 })
 await test('changed live version confirms upgrade, auto-refreshes displayed version and clears latest green dot',async()=>{
  scenario();secrets.set('neko_secret_'+c.id,'direct-token');let tree=await page();assert.equal(core(tree).props.updateDot,true)
  calls.length=0;await button(tree,'升级核心').props.action();tree=draw();assert.equal(posts,1);assert.equal(upgrades().length,1);assert.equal(versionCalls().length,2)
  assert.equal(upgrades()[0].init.method,'POST');assert.equal(upgrades()[0].init.body,undefined);assert.equal(upgrades()[0].init.headers.Authorization,'Bearer direct-token');assert.equal(core(tree).props.detail,next);assert.equal(core(tree).props.updateDot,false);assert.equal(message(tree),'核心升级成功');assert.equal(button(tree,'升级核心').props.disabled,false)
  unmount();tree=draw(c,true);assert.equal(core(tree).props.detail,next);unmount()
 })
 await test('same version online, no baseline, empty/unknown versions and timeout never claim upgrade success; polling bounded',async()=>{
  for(const options of [{versions:[old]},{pre:{status:500},versions:[next]},{versions:[{body:{version:'unknown'}}]},{versions:[{throw:'timeout'}]},{versions:[{body:{}}]}]){
   scenario(options);const tree=await page();calls.length=0;await button(tree,'升级核心').props.action();const final=draw()
   assert.equal(posts,1);assert.equal(versionCalls().length,9);assert.equal(message(final),'尚未确认核心升级完成，版本未变化或无法验证');assert.equal(nodes(final.props.overlay.content,'Image')[0].props.systemName,'exclamationmark.circle.fill');assert.equal(button(final,'升级核心').props.disabled,false);unmount()
  }
 })
 await test('POST disconnect/timeout plus recovery to changed version succeeds, but same-version restart remains unconfirmed',async()=>{
  for(const post of [{throw:'connection reset after restart'},{throw:'timeout'}]){
   scenario({post,versions:[{throw:'restarting'},{status:503},next]});const tree=await page();calls.length=0;await button(tree,'升级核心').props.action();assert.equal(posts,1);assert.equal(versionCalls().length,4);assert.equal(message(draw()),'核心升级成功');assert.equal(core(draw()).props.detail,next);unmount()
  }
  scenario({post:{throw:'reset'},versions:[{throw:'down'},old]});const tree=await page();await button(tree,'升级核心').props.action();assert.equal(posts,1);assert.ok(message(draw()).startsWith('尚未确认'));unmount()
 })
 await test('definite unsupported/denied/failed HTTP is existing error alert with no retry or false success',async()=>{
  for(const status of [404,405,403,500]){
   scenario({post:{status}});const tree=await page();calls.length=0;const count=alerts.length;await button(tree,'升级核心').props.action()
   assert.equal(posts,1);assert.equal(versionCalls().length,1);assert.equal(alerts.length,count+1);assert.equal(alerts.at(-1).title,'操作未完成');assert.equal(message(draw()),'');assert.equal(button(draw(),'升级核心').props.disabled,false);unmount()
  }
 })
 await test('manual/discovered plugin sources retain controller auth isolation through baseline, POST and verification',async()=>{
  for(const plugin of ['nikki','openclash','mihomo'])for(const auto of [false,true]){
   const id='upgrade-'+plugin+'-'+auto,n={id,name:id,kind:'openwrt',plugin,auto,host:id+'.invalid',url:'http://'+id+'.invalid',cport:9191,username:'root'};let sent=false
   secrets.set('neko_secret_'+id,'router-password-'+id);secrets.set('neko_csecret_'+id,'manual-'+id)
   responder=(url,init)=>{
    if(url.endsWith('/ubus')){const p=JSON.parse(init.body).params;return {body:{result:[0,p[1]==='session'?{ubus_rpc_session:'session-'+id}:{values:plugin==='openclash'?{cn_port:'9292',dashboard_password:'discovered-'+id}:{api_listen:'0.0.0.0:9292',api_secret:'discovered-'+id}}]}}}
    if(url.endsWith('/upgrade')){sent=true;return {body:{status:'ok'}}}return {body:{version:sent?next:old}}
   }
   calls.length=0;const result=await api.upgradeCoreAndVerify(n);assert.equal(result.verified,true);assert.equal(upgrades().length,1)
   for(const call of calls.filter(x=>!x.url.endsWith('/ubus'))){assert.equal(call.url.split('/').slice(0,3).join('/'),'http://'+id+'.invalid:'+(auto?9292:9191));assert.equal(call.init.headers.Authorization,'Bearer '+(auto?'discovered-':'manual-')+id);assert.ok(!JSON.stringify(call).includes('router-password'))}
  }
 })
 await test('busy spans confirmation, pre-read, POST, recovery polling; duplicate handlers cannot repeat POST',async()=>{
  scenario();const confirm=deferred(),recovery=deferred(),originalConfirm=context.Dialog.confirm,originalFetch=context.fetch;let confirmsCount=0
  context.Dialog.confirm=()=>{confirmsCount++;return confirm.promise};context.fetch=async(url,init)=>{if(posts&&url.endsWith('/version'))await recovery.promise;return originalFetch(url,init)}
  try{
   let tree=await page();const handler=button(tree,'升级核心').props.action,pending=handler();await handler();assert.equal(confirmsCount,1);assert.equal(button(draw(),'升级核心').props.disabled,true)
   confirm.resolve(true);await flush();assert.equal(posts,1);assert.equal(message(draw()),'正在升级核心…');await handler();assert.equal(posts,1);assert.equal(confirmsCount,1);assert.equal(button(draw(),'升级核心').props.disabled,true)
   recovery.resolve();await pending;assert.equal(message(draw()),'核心升级成功');assert.equal(button(draw(),'升级核心').props.disabled,false)
  }finally{confirm.resolve(false);recovery.resolve();context.Dialog.confirm=originalConfirm;context.fetch=originalFetch;unmount()}
 })
 await test('cancel source/hidden/unmounted confirmation; source switch and leave/re-enter stop late verification UI and retries',async()=>{
  const originalConfirm=context.Dialog.confirm,originalFetch=context.fetch
  try{
   for(const mode of ['source','hide','unmount']){
    scenario();const gate=deferred();context.Dialog.confirm=()=>gate.promise;const tree=await page(),pending=button(tree,'升级核心').props.action()
    if(mode==='source'){draw(other);await flush()}else if(mode==='hide'){tree.props.onDisappear();draw();await flush()}else unmount()
    calls.length=0;gate.resolve(true);await pending;assert.equal(upgrades().length,0);unmount()
   }
   context.Dialog.confirm=originalConfirm
   for(const mode of ['source','hide','unmount']){
    scenario();const gate=deferred();context.fetch=async(url,init)=>{if(posts&&url.endsWith('/version'))await gate.promise;return originalFetch(url,init)}
    const tree=await page(),pending=button(tree,'升级核心').props.action();await flush();assert.equal(posts,1)
    if(mode==='source'){draw(other);await flush()}else if(mode==='hide'){tree.props.onDisappear();draw();await flush();draw().props.onAppear();draw();await flush()}else unmount()
    gate.resolve();await pending;assert.equal(posts,1)
    if(mode!=='unmount'){assert.notEqual(message(draw(mode==='source'?other:c)),'核心升级成功')}
    context.fetch=originalFetch;unmount()
   }
  }finally{context.Dialog.confirm=originalConfirm;context.fetch=originalFetch;unmount()}
 })
 await test('pre-upgrade delayed version read/update check cannot overwrite verified new version or green dot',async()=>{
  scenario();const stale=deferred(),original=api.loadRuntimeVersions;let callback
  api.loadRuntimeVersions=async(_c,update)=>{callback=update;return stale.promise}
  try{
   const tree=await page();await button(tree,'升级核心').props.action();assert.equal(core(draw()).props.detail,next);assert.equal(core(draw()).props.updateDot,false)
   callback({core:old,app:'不适用',failed:false});stale.resolve({core:old,app:'不适用',failed:false});await flush();assert.equal(core(draw()).props.detail,next);assert.equal(core(draw()).props.updateDot,false)
  }finally{stale.resolve({core:old,app:'不适用',failed:false});api.loadRuntimeVersions=original;unmount()}
 })
 console.log('All '+count+' verified-core-upgrade regression groups passed (mock IO only; no real upgrade).')
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{context.setTimeout=timer})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
