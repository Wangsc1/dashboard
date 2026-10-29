// Real core API/UI code, synthetic network/native bindings only. Never runs device operations.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
const c={id:'core-contract',name:'offline',kind:'clash',url:'http://offline.invalid'}
const timer=context.setTimeout;context.setTimeout=(fn,ms)=>{if(ms===700||ms===1000)fn();return 1}
const message=t=>text(t.props.overlay?.content)
;(async()=>{
 await test('six core writes match official method/path and only their successful status/body contract',async()=>{
  const routes={upgrade:['POST','/upgrade'],restart:['POST','/restart'],reload:['PUT','/configs?force=true'],geo:['POST','/configs/geo'],dns:['POST','/cache/dns/flush'],fakeip:['POST','/cache/fakeip/flush']}
  for(const [action,[method,path]] of Object.entries(routes)){
   const ack=['upgrade','restart'].includes(action),good=ack?{body:{status:'ok'}}:{status:204,text:''}
   const bad=[{status:400},{status:401},{status:403},{status:404},{status:500},{status:202,text:''},{text:'<html>PRIVATE</html>'},{body:{message:'PRIVATE'}},{body:{error:'PRIVATE'}},{body:{}},{body:null,text:'null'},{body:[]},{body:{status:'failed'}},ack?{status:204,text:''}:{body:{status:'ok'}},{status:204,text:'PRIVATE'}]
   for(const [reply,ok] of [[good,true],...bad.map(x=>[x,false])]){
    calls.length=0;responder=()=>reply
    if(ok)await api.coreAction(c,action)
    else await assert.rejects(()=>api.coreAction(c,action),e=>!api.coreActionMayHaveExecuted(e)&&!e.message.includes('PRIVATE'))
    assert.equal(calls.length,1);assert.equal(calls[0].url,c.url+path);assert.equal(calls[0].init.method,method);assert.equal(calls[0].init.body,action==='reload'?'{}':undefined)
   }
   responder=()=>({throw:'synthetic transport'});calls.length=0
   await assert.rejects(()=>api.coreAction(c,action),e=>api.coreActionMayHaveExecuted(e));assert.equal(calls.length,1)
  }
 })
 await test('DNS response validates status and rendered answer shape; NXDOMAIN/extended RCODE preserved, bad inputs send zero',async()=>{
  for(const type of ['A','AAAA','CNAME','TXT','MX','HTTPS'])for(const status of [0,2,3,16,4095]){
   responder=()=>({body:{Status:status}});calls.length=0
   assert.equal((await api.queryDNS(c,'example.test',type)).status,status)
   assert.equal(calls[0].init.method,'GET');assert.equal(calls[0].url,c.url+'/dns/query?name=example.test&type='+type)
  }
  const valid={Status:0,Answer:[{data:'answer',TTL:60,type:1}]}
  responder=()=>({body:valid});assert.equal((await api.queryDNS(c,'example.test','A')).answers[0].ttl,60)
  for(const body of [{},null,[],{Status:'0'},{Status:-1},{Status:4096},{Status:0.5},{Status:0,Answer:null},{Status:0,Answer:{}},{Status:0,Answer:[{}]},{Status:0,Answer:[{data:'x',TTL:-1,type:1}]},{Status:0,Answer:[{data:1,TTL:60,type:1}]},{Status:0,Answer:[{data:'x',TTL:60,type:0}]}]){
   responder=()=>({body});await assert.rejects(()=>api.queryDNS(c,'example.test','A'))
  }
  for(const reply of [{status:204,text:''},{text:'<html>PRIVATE</html>'},{status:500}]){responder=()=>reply;await assert.rejects(()=>api.queryDNS(c,'example.test','A'))}
  calls.length=0;await assert.rejects(()=>api.queryDNS(c,'bad/name','A'));await assert.rejects(()=>api.queryDNS(c,'example.test','AXFR'));assert.equal(calls.length,0)
 })
 api.loadRuntimeVersions=async()=>({core:'v1',app:'p1',failed:false});api.loadConfig=async()=>({mode:'rule'})
 await test('four immediate core action banners reject wrong HTTP200 payloads; cache messages match synchronous/asynchronous semantics',async()=>{
  for(const [title,success] of [['重载配置','配置已重载'],['更新GEO','GEO 数据库更新成功'],['刷新 DNS 缓存','已提交 DNS 缓存清理请求'],['刷新 FakeIP 缓存','FakeIP 缓存清理接口已完成']])for(const ok of [true,false]){
   responder=()=>ok?{status:204,text:''}:{text:'<html>PRIVATE</html>'}
   render(pages.MorePage,{active:c,onChanged(){}},true);await flush();let t=render(pages.MorePage,{active:c,onChanged(){}}),n=alerts.length;calls.length=0
   await button(t,title).props.action();t=render(pages.MorePage,{active:c,onChanged(){}})
   assert.equal(calls.filter(x=>x.init.method!=='GET').length,1);assert.equal(alerts.length,n+(ok?0:1))
   if(ok)assert.ok(message(t).includes(success));else{assert.ok(!message(t).includes(success));assert.ok(!JSON.stringify(alerts.at(-1)).includes('PRIVATE'))}
   unmount()
  }
 })
 await test('restart HTTP rejection/invalid acknowledgement never enters recovery polling; unknown transport never retries',async()=>{
  for(const reply of [{status:403},{status:500},{body:{message:'PRIVATE'}},{text:'<html>PRIVATE</html>'},{throw:'synthetic disconnect'}]){
   let reads=0,writes=0
   responder=url=>url.endsWith('/restart')?(writes++,reply):url.endsWith('/version')?(++reads===1?{throw:'transient unrelated outage'}:{body:{version:'v1'}}):{body:{}}
   render(pages.MorePage,{active:c,onChanged(){}},true);await flush();let t=render(pages.MorePage,{active:c,onChanged(){}}),n=alerts.length
   await button(t,'重启核心').props.action();t=render(pages.MorePage,{active:c,onChanged(){}})
   assert.equal(writes,1);assert.ok(!message(t).includes('核心重启成功'))
   assert.equal(alerts.length,n+(reply.throw?0:1));assert.equal(reads,reply.throw?6:0)
   unmount()
  }
 })
 await test('Nikki core restart requires reliable changed generation, never just health loss/recovery',async()=>{
  const n={...c,id:'nikki-restart-contract',kind:'openwrt',plugin:'nikki',auto:false,cport:9090}
  for(const changed of [false,true]){
   let probes=0
   responder=url=>url.endsWith('/version')?(++probes===1?{throw:'unrelated outage'}:{body:{version:'live'}}):{body:{}}
   // Populate the real internal loadNikkiRuntime reads, not an exported-function stub.
   const net=responder
   responder=(url,init)=>{if(!url.endsWith('/ubus'))return net(url,init)
    const [,obj,method,args]=JSON.parse(init.body).params
    let value={}
    if(obj==='session')value={ubus_rpc_session:'synthetic-session'}
    if(obj==='service')value={nikki:{instances:{nikki:{running:true,pid:42}}}}
    if(obj==='file'&&args.path==='/proc/42/comm')value={data:'mihomo'}
    if(obj==='file'&&args.path==='/proc/42/stat')value={data:'42 (mihomo) S '+Array.from({length:26},(_,i)=>i===18?'1000':i===24?(changed?'3000':'2000'):'1').join(' ')}
    return {body:{result:[0,value]}}
   }
   const before={running:true,coreIdentity:'42:1000:2000',coreSeconds:1,serviceSeconds:1,measuredAt:now}
   assert.equal((await api.verifyCoreRestart(n,before,()=>true,false)).verified,changed)
  }
 })
 await test('core restart confirmation, pending duplicate tap and source switch preserve single-write isolation',async()=>{
  let release;const wait=new Promise(r=>release=r);let writes=0
  responder=url=>url.endsWith('/restart')?(writes++,{body:{status:'ok'},wait}):{body:{}}
  render(pages.MorePage,{active:c,onChanged(){}},true);await flush();let t=render(pages.MorePage,{active:c,onChanged(){}})
  context.confirmResult=false;await button(t,'重启核心').props.action();assert.equal(writes,0);context.confirmResult=true
  const pending=button(render(pages.MorePage,{active:c,onChanged(){}}),'重启核心').props.action();await flush()
  await button(render(pages.MorePage,{active:c,onChanged(){}}),'重启核心').props.action();assert.equal(writes,1)
  const other={...c,id:'other-source',url:'http://other.invalid'};render(pages.MorePage,{active:other,onChanged(){}});await flush();const n=alerts.length
  release();await pending;t=render(pages.MorePage,{active:other,onChanged(){}})
  assert.equal(writes,1);assert.equal(alerts.length,n);assert.ok(!message(t).includes('成功'));unmount()
 })
 await test('DNS UI invalid response alerts instead of showing status0; confirmation cancellation sends zero',async()=>{
  render(pages.DNSPage,{c},true);let t=render(pages.DNSPage,{c});nodes(t,'TextField')[0].props.onChanged('example.test');t=render(pages.DNSPage,{c})
  context.confirmResult=false;calls.length=0;await button(t,'查询').props.action();assert.equal(calls.length,0);context.confirmResult=true
  responder=()=>({body:{}});let n=alerts.length;await button(render(pages.DNSPage,{c}),'查询').props.action();assert.equal(alerts.length,n+1);assert.ok(!text(render(pages.DNSPage,{c})).includes('状态 0'))
  responder=()=>({body:{Status:3}});await button(render(pages.DNSPage,{c}),'查询').props.action();assert.ok(text(render(pages.DNSPage,{c})).includes('状态 3'));unmount()
 })
 console.log('7 core-action/DNS contract groups passed (all network/native IO mocked).')
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{unmount();context.setTimeout=timer})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
