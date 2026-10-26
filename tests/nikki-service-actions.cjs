// Service commands are synthetic only; API reads and page lifecycle are exercised offline.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
const c={id:'service-actions',name:'Synthetic',kind:'openwrt',plugin:'nikki',auto:false,cport:9090,url:'http://service.invalid'}
const timer=context.setTimeout;context.setTimeout=(fn,ms)=>{if(ms===700)fn();return 1}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
const draw=(active=c,reset=false,selected=true)=>render(pages.MorePage,{active,selected,onChanged(){}},reset)
const message=t=>text(t.props.overlay?.content).trim()
const original={runtime:api.loadNikkiRuntime,status:api.nikkiServiceStatus,verify:api.verifyNikkiService,service:api.nikkiService,versions:api.loadRuntimeVersions,config:api.loadConfig}
;(async()=>{
 await test('real verification uses bounded rc state reads, restart identity changes, no reload read or write',async()=>{
  let running=true,identity='2000',reads=0
  responder=(url,init)=>{
   assert.ok(url.endsWith('/ubus'));const req=JSON.parse(init.body)
   const answer=r=>{const [,obj,method,args]=r.params;let value={}
    assert.notEqual(method,'init','verification never writes')
    if(obj==='session')value={ubus_rpc_session:'synthetic'}
    if(obj==='rc'){reads++;value={nikki:{running}}}
    if(obj==='service')value={nikki:{instances:running?{core:{running:true,pid:42}}:{}}}
    if(obj==='file'&&args.path==='/proc/42/comm')value={data:'mihomo'}
    if(obj==='file'&&args.path==='/proc/42/stat')value={data:'42 (mihomo) S '+Array.from({length:26},(_,i)=>i===18?'1000':i===24?identity:'1').join(' ')}
    return {id:r.id,result:[0,value]}}
   return {body:Array.isArray(req)?req.map(answer):answer(req)}
  }
  let r=await api.verifyNikkiService(c,'start',null);assert.equal(r.verified,true);assert.equal(reads,1)
  running=false;reads=0;r=await api.verifyNikkiService(c,'stop',null);assert.equal(r.verified,true);assert.equal(reads,1)
  reads=0;r=await api.verifyNikkiService(c,'start',null);assert.equal(r.verified,false);assert.equal(reads,6)
  running=true;const before=await api.loadNikkiRuntime(c);assert.ok(before.coreIdentity)
  r=await api.verifyNikkiService(c,'restart',before);assert.equal(r.verified,false,'same PID/start/stack is not a restart')
  identity='3000';r=await api.verifyNikkiService(c,'restart',before);assert.equal(r.verified,true)
  r=await api.verifyNikkiService(c,'restart',null);assert.equal(r.verified,false,'missing baseline is unknown')
  calls.length=0;r=await api.verifyNikkiService(c,'reload',before);assert.equal(r.verified,false);assert.equal(calls.length,0)
  calls.length=0;r=await api.verifyNikkiService(c,'start',null,()=>false);assert.equal(calls.length,0);assert.equal(r.verified,false)
  responder=()=>({status:503});r=await api.verifyNikkiService(c,'stop',null);assert.equal(r.verified,false);assert.equal(r.running,null)
 })
 api.loadRuntimeVersions=async()=>({core:'v1',app:'p1',failed:false});api.loadConfig=async()=>({mode:'rule'})
 api.loadNikkiRuntime=async()=>({running:true,coreIdentity:'old',coreSeconds:10,serviceSeconds:20,measuredAt:now})
 api.nikkiServiceStatus=async()=>true
 let commands,verification,waiting,fail
 api.nikkiService=async(_c,action)=>{commands.push(action);if(waiting)await waiting.promise;if(fail)throw Error('failed')}
 api.verifyNikkiService=async(_c,action,before,current)=>{verification++;assert.equal(current(),true);if(action==='restart')assert.equal(before.coreIdentity,'old');return {verified:action!=='reload',running:action==='stop'?false:true,runtime:null}}
 async function page(){commands=[];verification=0;waiting=null;fail=false;const t=draw(c,true);await flush();return draw()}
 await test('four unchanged confirmations cancel with zero commands; verified or warning notices and one command',async()=>{
  for(const [action,title] of [['start','启动'],['stop','停止'],['restart','重启'],['reload','重载']]){
   let t=await page();context.confirmResult=false;await button(t,title).props.action();assert.equal(commands.length,0);assert.equal(verification,0)
   assert.equal(confirms.at(-1).title,title+'服务');assert.equal(message(draw()),'');assert.equal(button(draw(),title).props.disabled,false)
   context.confirmResult=true;waiting=deferred();const pending=button(draw(),title).props.action();await flush();t=draw();assert.equal(message(t),'正在'+title+'服务…');assert.equal(nodes(t.props.overlay.content,'ProgressView').length,1);assert.equal(button(t,title).props.disabled,true)
   await button(t,title).props.action();assert.equal(commands.length,1);waiting.resolve();await pending;t=draw();assert.equal(commands[0],action);assert.equal(verification,1);assert.equal(button(t,title).props.disabled,false)
   assert.equal(message(t),action==='reload'?'重载服务请求已发送，尚未确认应用完成':title+'服务完成')
   assert.equal(nodes(t.props.overlay.content,'Image')[0].props.systemName,action==='reload'?'exclamationmark.circle.fill':'checkmark.circle.fill')
   nodes(t.props.overlay.content,'Button')[0].props.action();assert.equal(message(draw()),'');unmount()
  }
 })
 await test('command failure stays warning with existing error alert, never retries or verifies',async()=>{
  for(const title of ['启动','停止','重启','重载']){let t=await page();fail=true;const n=alerts.length;await button(t,title).props.action();t=draw();assert.equal(commands.length,1);assert.equal(verification,0);assert.ok(message(t).includes('尚未确认'));assert.equal(alerts.length,n+1);assert.equal(alerts.at(-1).title,'操作未完成');assert.equal(button(t,title).props.disabled,false);unmount()}
 })
 await test('unverified state uses warning and late verification cannot overwrite a changed page',async()=>{
  const normal=api.verifyNikkiService
  for(const title of ['启动','停止','重启']){
   const t=await page();api.verifyNikkiService=async()=>({verified:false,running:null,runtime:null});await button(t,title).props.action();assert.ok(message(draw()).startsWith('尚未确认'+title));assert.equal(commands.length,1);assert.equal(nodes(draw().props.overlay.content,'Image')[0].props.systemName,'exclamationmark.circle.fill');unmount()
  }
  for(const kind of ['source','disappear']){
   const t=await page(),wait=deferred();api.verifyNikkiService=async()=>{await wait.promise;return {verified:true,running:true,runtime:null}}
   const pending=button(t,'启动').props.action();await flush();assert.equal(message(draw()),'正在启动服务…')
   if(kind==='source'){draw({...c,id:'verify-other',url:'http://other.invalid'});await flush()}else{draw().props.onDisappear();draw();await flush()}
   wait.resolve();await pending;const out=kind==='source'?draw({...c,id:'verify-other',url:'http://other.invalid'}):draw();assert.equal(message(out),'');assert.equal(commands.length,1);assert.equal(button(out,'启动').props.disabled,false);unmount()
  }
  api.verifyNikkiService=normal
 })
 await test('source, departure, deselection, background and unmount isolate late commands and release busy',async()=>{
  for(const kind of ['source','disappear','selected','background','unmount']){
   let t=await page();waiting=deferred();const pending=button(t,'启动').props.action();await flush();assert.equal(commands.length,1)
   if(kind==='source'){t=draw({...c,id:'other',url:'http://other.invalid'});await flush()}
   if(kind==='disappear'){t.props.onDisappear();t=draw();await flush()}
   if(kind==='selected'){t=draw(c,false,false);await flush()}
   if(kind==='background'){for(const fn of sceneListeners)fn('background');await flush()}
   if(kind==='unmount')unmount()
   waiting.resolve();await pending;assert.equal(verification,0);assert.equal(commands.length,1)
   if(kind!=='unmount'){t=kind==='source'?draw({...c,id:'other',url:'http://other.invalid'}):draw(c,false,kind!=='selected');assert.equal(message(t),'');assert.equal(button(t,'启动').props.disabled,false)}
   unmount();if(kind==='background'){for(const fn of sceneListeners)fn('active')}
  }
 })
 console.log(count+' service action groups passed (mock only).')
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{unmount();context.setTimeout=timer;api.loadNikkiRuntime=original.runtime;api.nikkiServiceStatus=original.status;api.verifyNikkiService=original.verify;api.nikkiService=original.service;api.loadRuntimeVersions=original.versions;api.loadConfig=original.config})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
