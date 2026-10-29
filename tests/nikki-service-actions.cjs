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
 await test('Nikki 1.26.2 service contract sends rc.init name/action for all four actions (mock only)',async()=>{
  // Official v1.26.2 tools/nikki.js uses rc.init('nikki', action), not luci.nikki.
  responder=(url,init)=>{
   assert.equal(url,c.url+'/ubus');const req=JSON.parse(init.body)
   assert.equal(req.method,'call')
   if(req.params[1]==='session')return {body:{result:[0,{ubus_rpc_session:'synthetic'}]}}
   assert.equal(req.params[1],'rc');assert.equal(req.params[2],'init')
   return {body:{result:[0]}} // rpcd rc.init succeeds without a response payload.
  }
  for(const action of ['start','stop','restart','reload']){
   calls.length=0;await api.nikkiService(c,action)
   const writes=calls.map(x=>JSON.parse(x.init.body)).filter(x=>x.params[1]!=='session')
   assert.equal(writes.length,1);assert.deepEqual(writes[0].params,['synthetic','rc','init',{name:'nikki',action}])
  }
  for(const reply of [{status:404},{body:{result:[4]}},{body:{result:[7]}},{throw:'synthetic timeout'}]){
   responder=()=>reply;calls.length=0
   await assert.rejects(()=>api.nikkiService(c,'restart'))
   assert.equal(calls.length,1,'no automatic replay on missing method, timeout or interruption')
  }
  calls.length=0;await assert.rejects(()=>api.nikkiService(c,'unsupported'));assert.equal(calls.length,0)
  await assert.rejects(()=>api.nikkiService({...c,plugin:'openclash'},'start'));assert.equal(calls.length,0)
 })
 await test('service response parser accepts status-only success, but rejects absent status/body without replay',async()=>{
  for(const result of [[0],[0,{}],[0,null]]){
   calls.length=0;responder=()=>({body:{jsonrpc:'2.0',id:1,result}})
   await api.nikkiService(c,'reload');assert.equal(calls.length,1)
  }
  for(const reply of [{status:204,text:''},{text:''},{body:{result:[]}},{body:{}},{body:{result:null}},{text:'null'}]){
   calls.length=0;responder=()=>reply
   await assert.rejects(()=>api.nikkiService(c,'reload'));assert.equal(calls.length,1)
  }
 })
 await test('service-only timeout is 65s; login/reads keep preference seconds; auth lifetime remains separate',async()=>{
  const saved=pref.getPreferences().requestTimeout
  try{
   pref.savePreferences({requestTimeout:4})
   for(const action of ['start','stop','restart','reload']){
    const fresh={...c,id:'auth-timeout-'+action};let sequence=[]
    responder=(url,init)=>{
     const req=JSON.parse(init.body);sequence.push(req.params[1]+'.'+req.params[2]);assert.equal(init.timeout,req.params[1]==='session'?4:65)
     if(req.params[1]==='session'){
      assert.equal(req.params[3].timeout,3600);assert.equal(req.params[0],'00000000000000000000000000000000')
      return {body:{result:[0,{ubus_rpc_session:'fresh'}]}}
     }
     assert.equal(req.params[0],'fresh');return {body:{result:[0]}}
    }
    await api.nikkiService(fresh,action);assert.deepEqual(sequence,['session.login','rc.init'])
    for(const [reply,pattern] of [[{status:403},/HTTP 403/],[{status:404},/HTTP 404/],[{text:'<html>login</html>'},/响应正文读取或解析失败/],[{body:{error:{message:'Access denied'}}},/JSONRPC/],[{body:{result:[7]}},/ubus 7/]]){
     calls.length=0;responder=()=>reply;await assert.rejects(()=>api.nikkiService(fresh,action),pattern)
     assert.equal(calls.length,1,'HTTP/JSON-RPC/transport errors are not ubus status 6')
    }
    calls.length=0;responder=(_url,init)=>{const req=JSON.parse(init.body);return {body:req.params[1]==='session'?{result:[0,{ubus_rpc_session:'renewed'}]}:{result:[6]}}}
    await assert.rejects(()=>api.nikkiService(fresh,action),/ubus 6/)
    assert.deepEqual(calls.map(x=>JSON.parse(x.init.body).params[1]),['rc'],'service writes never retry even on ACCESS')
   }
  }finally{pref.savePreferences({requestTimeout:saved})}
 })
 await test('29-second synchronous service fits its budget; over-budget/disconnect stays unknown with one write; empty status read is unknown',async()=>{
  const saved=pref.getPreferences().requestTimeout
  try{
   pref.savePreferences({requestTimeout:8})
   for(const action of ['start','stop','restart','reload']){
    for(const seconds of [29,59,66]){
     calls.length=0
     responder=(_url,init)=>{
      const req=JSON.parse(init.body);assert.equal(req.params[2],'init');assert.equal(init.timeout,65)
      if(seconds>init.timeout)return {throw:'synthetic TimeoutError private details'}
      return {body:{result:[0]}}
     }
     if(seconds<=65)await api.nikkiService(c,action)
     else await assert.rejects(()=>api.nikkiService(c,action),/可能已执行；不会自动重试/)
     assert.equal(calls.length,1)
     assert.equal(pref.getPreferences().requestTimeout,8)
    }
   }
   responder=(_url,init)=>{assert.equal(init.timeout,8);return {body:{result:[0]}}}
   assert.equal(await api.nikkiServiceStatus(c),null,'status-only success cannot invent a running state')
   for(const action of ['start','stop']){
    calls.length=0;const checked=await api.verifyNikkiService(c,action,null)
    assert.equal(checked.running,null);assert.equal(checked.verified,false);assert.equal(calls.length,6)
   }
   calls.length=0;const reload=await api.verifyNikkiService(c,'reload',null)
   assert.equal(reload.verified,false);assert.equal(calls.length,0,'running cannot prove reload applied')
  }finally{pref.savePreferences({requestTimeout:saved})}
 })
 await test('real verification refreshes started runtime and requires changed generation for restart/reload without writes',async()=>{
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
  calls.length=0;r=await api.verifyNikkiService(c,'reload',before);assert.equal(r.verified,true);assert.ok(calls.length>0)
  const same=await api.loadNikkiRuntime(c);r=await api.verifyNikkiService(c,'reload',same);assert.equal(r.verified,false,'script exit or live old core cannot prove reload applied')
  calls.length=0;r=await api.verifyNikkiService(c,'reload',null);assert.equal(r.verified,false);assert.equal(calls.length,0,'no reliable baseline remains unknown')
  calls.length=0;r=await api.verifyNikkiService(c,'start',null,()=>false);assert.equal(calls.length,0);assert.equal(r.verified,false)
  responder=()=>({status:503});r=await api.verifyNikkiService(c,'stop',null);assert.equal(r.verified,false);assert.equal(r.running,null)
 })
 await test('stopped -> start refreshes real core/service ages immediately; unavailable files never invent durations',async()=>{
  const reads={runtime:api.loadNikkiRuntime,versions:api.loadRuntimeVersions,config:api.loadConfig}
  api.loadNikkiRuntime=original.runtime
  api.loadRuntimeVersions=async()=>({core:'v1',app:'p1',failed:false});api.loadConfig=async()=>({mode:'rule'})
  const aux=require('node:buffer').Buffer.alloc(32);aux.writeBigUInt64LE(17n,0);aux.writeBigUInt64LE(100n,8)
  try{
   for(const denied of [false,true]){
    const active={...c,id:'start-real-runtime-'+denied};let running=false,writes=0
    responder=(_url,init)=>{const [,obj,method,args]=JSON.parse(init.body).params
     if(obj==='session')return {body:{result:[0,{ubus_rpc_session:'runtime-session'}]}}
     if(method==='init'){writes++;running=true;return {body:{result:[0]}}}
     if(obj==='rc')return {body:{result:[0,{nikki:{running}}]}}
     if(obj==='service')return {body:{result:[0,{nikki:{instances:running?{nikki:{running:true,pid:10126}}:{}}}]}}
     if(obj==='system')return {body:{result:[0,{localtime:1793290456,uptime:4901814}]}}
     if(denied)return {body:{result:[6]}}
     if(method==='stat')return {body:{result:[0,{type:'file',mtime:1793261518}]}}
     const values={'/etc/TZ':'CST-8\n','/proc/uptime':'4901814 0','/proc/self/auxv':aux.toString('base64'),'/proc/10126/comm':'mihomo\n','/proc/10126/stat':'10126 (mihomo) S '+Array.from({length:26},(_,i)=>i===18?'490180000':i===24?'2000':'1').join(' ')}
     return {body:{result:[0,{data:values[args.path]}]}}
    }
    render(pages.MorePage,{active,onChanged(){}},true);await flush()
    let tree=render(pages.MorePage,{active,onChanged(){}});assert.ok(text(tree).includes('Nikki 服务 · 未运行'))
    await button(tree,'启动').props.action();tree=render(pages.MorePage,{active,onChanged(){}})
    assert.equal(writes,1);assert.equal(message(tree),'启动服务完成')
    if(denied){assert.ok(text(tree).includes('Nikki 服务（运行时间：未提供）'))}
    else{assert.ok(text(tree).includes('运行时间：'+api.fmtUptime(14,true)));assert.ok(text(tree).includes('Nikki 服务（运行时间：'+api.fmtUptime(138,true)+'）'))}
    unmount()
   }
  }finally{api.loadNikkiRuntime=reads.runtime;api.loadRuntimeVersions=reads.versions;api.loadConfig=reads.config;unmount()}
 })
 await test('four-button alerts report trusted numeric categories and session/request stages without secrets or replay',async()=>{
  const privateText='PRIVATE-SECRET-http://private.invalid-sid-password-body'
  const reads={runtime:api.loadNikkiRuntime,versions:api.loadRuntimeVersions,config:api.loadConfig}
  api.loadNikkiRuntime=async()=>({running:true,coreSeconds:1,serviceSeconds:1,measuredAt:now})
  api.loadRuntimeVersions=async()=>({core:'v1',app:'p1',failed:false});api.loadConfig=async()=>({mode:'rule'})
  const cases=[
   [{status:403,text:privateText},'HTTP 403'],
   [{status:404,text:privateText},'HTTP 404'],
   [{body:{result:[6],privateText}},'ubus 6'],
   [{body:{result:[7],privateText}},'ubus 7'],
   [{body:{error:{code:-32002,message:privateText,data:privateText}}},'JSONRPC -32002'],
   [{body:{error:{code:privateText,message:privateText}}},'JSONRPC'],
   [{text:privateText},'响应正文读取或解析失败'],
   [{body:{result:[],privateText}},'响应结构异常'],
   [{body:{result:[privateText]}},'响应结构异常'],
   [{throw:privateText},'网络、传输或本地异常'],
  ]
  try{
   let serial=0
   for(const [action,title] of [['start','启动'],['stop','停止'],['restart','重启'],['reload','重载']])for(const session of [true,false])for(const [reply,category] of cases){
    const active={...c,id:'private-stage-'+serial++}
    secrets.set('neko_secret_'+active.id,privateText)
    responder=(_url,init)=>{const req=JSON.parse(init.body)
     if(req.params[1]==='session'&&!session)return {body:{result:[0,{ubus_rpc_session:privateText}]}}
     return reply
    }
    render(pages.MorePage,{active,onChanged(){}},true);await flush()
    const tree=render(pages.MorePage,{active,onChanged(){}}),n=alerts.length;calls.length=0
    await button(tree,title).props.action()
    assert.equal(alerts.length,n+1);assert.equal(alerts.at(-1).title,'操作未完成')
    const msg=alerts.at(-1).message
    assert.ok(msg.includes(session?'会话获取失败，未发送服务动作':'可能已执行；不会自动重试'));assert.ok(msg.includes('类别：'+category))
    assert.ok(!msg.includes(privateText));assert.ok(!JSON.stringify(pref.getLogs()).includes(privateText))
    const rpc=calls.filter(x=>x.url.endsWith('/ubus')).flatMap(x=>{const req=JSON.parse(x.init.body);return Array.isArray(req)?req:[req]})
    assert.equal(rpc.filter(x=>x.params[1]==='rc'&&x.params[2]==='init').length,session?0:1)
    assert.equal(rpc.filter(x=>x.params[1]==='session').length,1)
    const uncertain=!session&&['响应正文读取或解析失败','响应结构异常','网络、传输或本地异常'].includes(category)
    assert.equal(rpc.filter(x=>x.params[1]==='rc'&&x.params[2]==='list').length,uncertain&&['start','stop'].includes(action)?6:0,'only uncertain dispatched actions get bounded read-only verification')
    unmount()
   }
   const fresh={...c,id:'missing-login-session'}
   responder=()=>({body:{result:[0,{}]}})
   await assert.rejects(()=>api.nikkiService(fresh,'start'),/会话获取失败.*登录未取得有效会话/)
   assert.ok(!api.nikkiServiceErrorText(new Error(privateText)).includes(privateText))
  }finally{api.loadNikkiRuntime=reads.runtime;api.loadRuntimeVersions=reads.versions;api.loadConfig=reads.config;unmount()}
 })
 await test('single write verifies after success/disconnect; reload needs a new generation, not an old running core or [0] alone',async()=>{
  const reads={runtime:api.loadNikkiRuntime,versions:api.loadRuntimeVersions,config:api.loadConfig}
  api.loadRuntimeVersions=async()=>({core:'v1',app:'p1',failed:false});api.loadConfig=async()=>({mode:'rule'})
  try{
   let serial=0
   for(const [action,title,identity,baseline,readFailure,verified,responseOK] of [
    ['start','启动','same',true,false,true],['stop','停止','same',true,false,true],
    ['restart','重启','new',true,false,true],['restart','重启','old',true,false,false],
    ['restart','重启','new',false,false,false],['reload','重载','new',true,false,true],
    ['reload','重载','old',true,false,false],['reload','重载','new',false,false,false],
    ['start','启动','new',true,true,false],
    ['reload','重载','new',true,false,true,true],['reload','重载','old',true,false,false,true],
   ]){
    const active={...c,id:'transport-recovery-'+serial++};let writes=0,rcReads=0
    api.loadNikkiRuntime=async()=>!writes&&!baseline?null:({running:true,coreIdentity:'42:1000:2000',coreSeconds:10,serviceSeconds:20,measuredAt:now})
    responder=(_url,init)=>{const [,obj,method,args]=JSON.parse(init.body).params
     if(obj==='session')return {body:{result:[0,{ubus_rpc_session:'safe-session'}]}}
     if(obj==='rc'&&method==='init'){writes++;return responseOK?{body:{result:[0]}}:{throw:'synthetic PRIVATE disconnect'}}
     if(obj==='rc'&&method==='list'){rcReads++;return readFailure?{throw:'unavailable'}:{body:{result:[0,{nikki:{running:action!=='stop'}}]}}}
     if(obj==='service')return {body:{result:[0,{nikki:{instances:{core:{running:true,pid:42}}}}]}}
     if(obj==='file'&&args.path==='/proc/42/comm')return {body:{result:[0,{data:'mihomo'}]}}
     if(obj==='file'&&args.path==='/proc/42/stat')return {body:{result:[0,{data:'42 (mihomo) S '+Array.from({length:26},(_,i)=>i===18?'1000':i===24?(identity==='new'?'3000':'2000'):'1').join(' ')}]}}
     return {body:{result:[0,{}]}}
    }
    render(pages.MorePage,{active,onChanged(){}},true);await flush()
    const tree=render(pages.MorePage,{active,onChanged(){}}),n=alerts.length
    await button(tree,title).props.action();const final=render(pages.MorePage,{active,onChanged(){}})
    assert.equal(writes,1);assert.equal(alerts.length,n+(verified||responseOK?0:1))
    assert.equal(nodes(final.props.overlay.content,'Image')[0].props.systemName,verified?'checkmark.circle.fill':'exclamationmark.circle.fill')
    if(verified)assert.equal(message(final),title+'服务完成')
    else{assert.ok(message(final).includes('尚未确认'));if(!responseOK){assert.ok(alerts.at(-1).message.includes('网络、传输或本地异常'));assert.ok(!alerts.at(-1).message.includes('PRIVATE'))}}
    if(action==='stop')assert.ok(text(final).includes('Nikki 服务 · 未运行'))
    if(action==='reload')assert.equal(rcReads,0)
    unmount()
   }
  }finally{api.loadNikkiRuntime=reads.runtime;api.loadRuntimeVersions=reads.versions;api.loadConfig=reads.config;unmount()}
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
 await test('runtime pre-read failure is swallowed; other page read failures do not enter the service catch',async()=>{
  const runtime=api.loadNikkiRuntime,versions=api.loadRuntimeVersions,config=api.loadConfig,verify=api.verifyNikkiService
  try{
   api.loadNikkiRuntime=async()=>{throw Error('synthetic read failure')}
   api.loadRuntimeVersions=async()=>{throw Error('synthetic version failure')}
   api.loadConfig=async()=>{throw Error('synthetic config failure')}
   api.verifyNikkiService=async()=>({verified:false,running:null,runtime:null})
   for(const title of ['启动','停止','重启','重载']){
    const tree=await page(),n=alerts.length;await button(tree,title).props.action()
    assert.equal(commands.length,1);assert.equal(alerts.length,n)
    assert.ok(!message(draw()).includes('请求失败或响应中断'));unmount()
   }
  }finally{api.loadNikkiRuntime=runtime;api.loadRuntimeVersions=versions;api.loadConfig=config;api.verifyNikkiService=verify}
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
