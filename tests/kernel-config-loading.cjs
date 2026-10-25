// KernelConfigPage loading placeholder / same-source first-frame cache. UI, storage and network are mocked.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const harness=fs.readFileSync(path.join(__dirname,'run.cjs'),'utf8').split(';(async () => {')[0]
const checks=String.raw`
let serial=0
const src=()=>{serial++;return {id:'kcl-'+serial,name:'KCL',kind:'clash',url:'http://kcl-'+serial+'.invalid'}}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
const cfgOf=extra=>({mode:'rule',port:80,'socks-port':1080,'mixed-port':7890,'redir-port':0,'tproxy-port':0,'allow-lan':false,ipv6:true,'bind-address':'*',tun:{enable:false,stack:'mixed'},'log-level':'info',secret:'TOP-SECRET',authentication:['u:p'],...extra})
const page=c=>render(ui.KernelConfigPage,{c})
const patches=()=>calls.filter(x=>x.init.method==='PATCH').map(x=>JSON.parse(x.init.body))
const field=(tree,title)=>nodes(tree,'TextField').find(n=>n.props.title===title)
;(async()=>{
 await test('no cache: first frame has placeholders, never 未提供; real values after success',async()=>{
  const c=src(),gate=deferred();responder=()=>({body:cfgOf(),wait:gate.promise});calls.length=0
  let tree=render(ui.KernelConfigPage,{c},true);assert.ok(!text(tree).includes('未提供'));assert.ok(nodes(tree,'TextField').every(n=>n.props.disabled&&n.props.value===''&&n.props.prompt===''))
  assert.equal(nodes(tree,'Toggle').length,0);assert.equal(nodes(tree,'HStack').filter(n=>n.props.frame?.minHeight===31&&n.props.frame?.maxHeight===31).length,3)
  assert.equal(nodes(tree,'Menu')[0].props.disabled,true);await flush();tree=page(c);assert.ok(!text(tree).includes('未提供'))
  gate.resolve();await flush();tree=page(c)
  assert.ok(!text(tree).includes('未提供'));assert.equal(field(tree,'混合端口').props.value,'7890');assert.equal(field(tree,'绑定地址').props.value,'*')
  assert.deepEqual(nodes(tree,'Toggle').map(n=>n.props.value),[false,true,false]);assert.equal(nodes(tree,'Toggle').length,3);unmount()
 })
 await test('failed load and truly missing fields show 未提供 (and failed load drops the cache)',async()=>{
  const c=src();responder=()=>({body:cfgOf()});render(ui.KernelConfigPage,{c},true);await flush();unmount()
  assert.ok(api.cachedKernelConfig(c))
  responder=()=>({status:500});let tree=render(ui.KernelConfigPage,{c},true);assert.equal(field(tree,'混合端口').props.value,'7890')
  await flush();tree=page(c);assert.match(text(tree),/读取内核配置失败/);assert.match(text(tree),/未提供/);assert.ok(nodes(tree,'TextField').every(n=>n.props.disabled&&n.props.value===''&&n.props.prompt==='未提供'));assert.equal(api.cachedKernelConfig(c),null);unmount()
  const d=src();responder=()=>({body:{mode:'rule','mixed-port':7890}});render(ui.KernelConfigPage,{c:d},true);await flush();tree=page(d)
  assert.equal(field(tree,'混合端口').props.value,'7890');assert.equal(field(tree,'HTTP 端口').props.disabled,true);assert.equal(field(tree,'HTTP 端口').props.prompt,'未提供');assert.match(text(tree),/未提供/);assert.equal(nodes(tree,'Toggle').length,0);unmount()
 })
 await test('same-source cache gives a real first frame, then silent refresh replaces it; no extra requests',async()=>{
  const c=src();responder=()=>({body:cfgOf({'mixed-port':7001})});render(ui.KernelConfigPage,{c},true);await flush();unmount()
  const gate=deferred();responder=()=>({body:cfgOf({'mixed-port':7002,ipv6:false}),wait:gate.promise});calls.length=0
  let tree=render(ui.KernelConfigPage,{c},true)
  assert.ok(!text(tree).includes('未提供'));assert.equal(field(tree,'混合端口').props.value,'7001');assert.deepEqual(nodes(tree,'Toggle').map(n=>n.props.value),[false,true,false]);assert.equal(field(tree,'混合端口').props.disabled,false)
  await flush();assert.equal(calls.length,1);assert.equal(calls[0].init.method,'GET');gate.resolve();await flush();tree=page(c)
  assert.equal(field(tree,'混合端口').props.value,'7002');assert.equal(nodes(tree,'Toggle')[1].props.value,false);assert.equal(calls.length,1);unmount()
 })
 await test('cache is source scoped, memory-only and holds no secret/auth fields',async()=>{
  const a=src(),b=src();responder=()=>({body:cfgOf({'mixed-port':7101})});await api.loadConfig(a)
  assert.equal(api.cachedKernelConfig(b),null);assert.equal(api.cachedKernelConfig({...a,username:'other'}),null)
  const snap=api.cachedKernelConfig(a);assert.equal(snap['mixed-port'],7101);assert.equal(JSON.stringify(Object.keys(snap).sort()),JSON.stringify(['allow-lan','bind-address','ipv6','log-level','mixed-port','port','redir-port','socks-port','tproxy-port','tun']))
  assert.equal(JSON.stringify(snap.tun),'{"enable":false,"stack":"mixed"}');assert.ok(!JSON.stringify(snap).includes('TOP-SECRET'));assert.ok(!JSON.stringify([...store.values()]).includes('TOP-SECRET')&&!JSON.stringify([...store.keys()]).includes('kernel'))
  responder=()=>({body:cfgOf({'mixed-port':7202})});const gate=deferred();responder=()=>({body:cfgOf({'mixed-port':7202}),wait:gate.promise})
  const tree=render(ui.KernelConfigPage,{c:b},true);assert.equal(field(tree,'混合端口').props.value,'');assert.ok(!text(tree).includes('未提供'))
  await flush();gate.resolve();await flush();assert.equal(field(page(b),'混合端口').props.value,'7202');assert.equal(api.cachedKernelConfig(a)['mixed-port'],7101);unmount()
 })
 await test('refresh never overwrites a draft; edits made on the cached frame wait for the refresh then save',async()=>{
  const c=src();responder=()=>({body:cfgOf({'mixed-port':7301})});render(ui.KernelConfigPage,{c},true);await flush();unmount()
  const gate=deferred();responder=(_u,init)=>init.method==='PATCH'?{}:{body:cfgOf({'mixed-port':7302,port:81}),wait:gate.promise};calls.length=0
  let tree=render(ui.KernelConfigPage,{c},true);await flush()
  const mixed=field(tree,'混合端口');mixed.props.onChanged('7399');mixed.props.onBlur();nodes(tree,'Toggle').find(n=>n.props.title==='IPv6').props.onChanged(false)
  assert.equal(patches().length,0);tree=page(c);assert.equal(field(tree,'混合端口').props.value,'7399');assert.equal(nodes(tree,'Toggle').find(n=>n.props.title==='IPv6').props.value,false)
  gate.resolve();await flush();tree=page(c)
  assert.equal(JSON.stringify(patches()),JSON.stringify([{'mixed-port':7399,ipv6:false}]));assert.equal(field(tree,'HTTP 端口').props.value,'81')
  assert.equal(field(tree,'混合端口').props.value,'7399');assert.equal(api.cachedKernelConfig(c)['mixed-port'],7399);unmount()
  // an uncommitted typing draft survives the refresh as well
  const c2=src();responder=()=>({body:cfgOf({'mixed-port':7401})});render(ui.KernelConfigPage,{c:c2},true);await flush();unmount()
  const g2=deferred();responder=()=>({body:cfgOf({'mixed-port':7402}),wait:g2.promise});tree=render(ui.KernelConfigPage,{c:c2},true);await flush()
  field(tree,'混合端口').props.onChanged('7488');g2.resolve();await flush();tree=page(c2);assert.equal(field(tree,'混合端口').props.value,'7488');unmount()
 })
 await test('load failure with a cached frame discards queued edits (no stale write) and shows 未提供',async()=>{
  const c=src();responder=()=>({body:cfgOf()});render(ui.KernelConfigPage,{c},true);await flush();unmount()
  const gate=deferred();responder=(_u,init)=>init.method==='PATCH'?{}:{status:500,wait:gate.promise};calls.length=0
  let tree=render(ui.KernelConfigPage,{c},true);await flush();nodes(tree,'Toggle').find(n=>n.props.title==='IPv6').props.onChanged(false)
  gate.resolve();await flush();tree=page(c);assert.equal(patches().length,0);assert.match(text(tree),/读取内核配置失败/);assert.match(text(tree),/未提供/);unmount()
 })
 await test('cache never crosses sources through the page: switching source in one mount starts from that source only',async()=>{
  const a=src(),b=src();responder=()=>({body:cfgOf({'mixed-port':7501})});render(ui.KernelConfigPage,{c:a},true);await flush();unmount()
  const gate=deferred();responder=()=>({body:cfgOf({'mixed-port':7502}),wait:gate.promise})
  render(ui.KernelConfigPage,{c:a},true);await flush();let tree=page(b);assert.equal(field(tree,'混合端口').props.value,'');assert.ok(!text(tree).includes('未提供'))
  gate.resolve();await flush();tree=page(b);assert.equal(field(tree,'混合端口').props.value,'7502');unmount()
 })
 console.log('All '+count+' kernel-config loading groups passed (mock UI/storage/network only).')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
