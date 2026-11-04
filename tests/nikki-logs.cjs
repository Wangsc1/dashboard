const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
vm.runInNewContext(harness+String.raw`
const logs=load('nikki-logs'),c={id:'nikki-log-test',kind:'openwrt',plugin:'nikki',name:'Router',url:'http://offline.invalid'}
let body='PRIVATE log body',failure=false,size=20,downloads=0
function respond(url,init){
 if(url.endsWith('/cgi-bin/cgi-download')){downloads++;return failure?{status:403,text:'PRIVATE secret response'}:{text:body}}
 const p=JSON.parse(init.body).params
 if(p[1]==='session')return {body:{result:[0,{ubus_rpc_session:'PRIVATE-session'}]}}
 assert.equal(p[1],'file');assert.equal(p[2],'stat');return {body:{result:[0,{type:'file',size,mtime:1700000000}]}}
}
;(async()=>{
 await test('three official paths: authenticated read-only CGI download, content only in memory',async()=>{
  responder=respond
  for(const kind of ['app','core','debug']){calls.length=0;const r=await api.readNikkiLog(c,kind);assert.equal(r.text,body);assert.equal(r.mtime,1700000000)
   const call=calls.find(x=>x.url.endsWith('/cgi-bin/cgi-download'));assert.ok(call.init.body.includes('path='+encodeURIComponent('/var/log/nikki/'+kind+'.log')))
   assert.ok(calls.every(x=>!x.url.endsWith('/ubus')||['session','file'].includes(JSON.parse(x.init.body).params[1])))
  }
  assert.ok(!JSON.stringify([...store.values()]).includes(body));assert.ok(!pref.exportLogs().includes(body))
 })
 await test('non-Nikki, invalid kind, missing/denied/large and invalid response fail honestly without secret exceptions',async()=>{
  calls.length=0;await assert.rejects(()=>api.readNikkiLog({...c,plugin:'openclash'},'app'));await assert.rejects(()=>api.readNikkiLog(c,'../../secret'));assert.equal(calls.length,0)
  failure=true;await assert.rejects(()=>api.readNikkiLog(c,'debug'),e=>!e.message.includes('PRIVATE'));failure=false
  size=3*1024*1024;let d=downloads;await assert.rejects(()=>api.readNikkiLog(c,'core'));assert.equal(downloads,d);size=20
  for(const text of ['<html>PRIVATE</html>','bad\0binary']){body=text;await assert.rejects(()=>api.readNikkiLog(c,'core'))}body=''
  assert.equal((await api.readNikkiLog(c,'app')).text,'');body='PRIVATE log body'
  responder=()=>({body:{result:[4]}});await assert.rejects(()=>api.readNikkiLog(c,'app'));responder=respond
 })
 await test('all three log pages keep a system page background and adaptive gray grouped rows',()=>{
  for(const kind of ['app','core','debug']){
   const t=render(logs.NikkiLogPage,{c,kind},true);assert.equal(t.props.background,'systemBackground');assert.equal(t.props.scrollContentBackground,'hidden');const sections=nodes(t,'Section');assert.equal(sections.length,2);assert.ok(sections.every(s=>s.props.listRowBackground.type==='RoundedRectangle'&&s.props.listRowBackground.props.fill==='secondarySystemBackground'));unmount()
  }
 })
 await test('settings exposes ordered Nikki-only destinations beneath log level',async()=>{
  render(ui.KernelConfigPage,{c},true);await flush();let t=render(ui.KernelConfigPage,{c});let links=nodes(t,'NavigationLink').filter(x=>x.props.destination?.type===logs.NikkiLogPage)
  assert.equal(links.length,3);assert.ok(nodes(t,'VStack').filter(n=>n.props.background?.props?.cornerRadius===16).some(n=>text(n).includes('日志级别')&&nodes(n,'NavigationLink').filter(x=>x.props.destination?.type===logs.NikkiLogPage).length===3));assert.deepEqual(links.map(x=>x.props.destination.props.kind),['app','core','debug']);assert.ok(links.every(x=>!x.props.disabled));unmount()
  t=render(ui.KernelConfigPage,{c:{...c,kind:'clash'}},true);links=nodes(t,'NavigationLink').filter(x=>x.props.destination?.type===logs.NikkiLogPage);assert.ok(links.every(x=>x.props.disabled));unmount()
 })
 await test('page loads actual snapshots, refreshes, retains navigation; hidden/background pauses and source isolates',async()=>{
  responder=respond;let initial=render(logs.NikkiLogPage,{c,kind:'app'},true);assert.ok(!text(initial).includes('读取中'));assert.equal(nodes(initial,'ScrollView').length,0);const empty=nodes(initial,'Text').find(n=>text(n)==='尚无可显示的日志');assert.equal(empty.props.frame.minHeight,32);assert.equal(empty.props.frame.alignment,'leading');await flush();let t=render(logs.NikkiLogPage,{c,kind:'app'});assert.ok(text(t).includes(body));assert.equal(nodes(t,'ScrollView').length,1);assert.ok(text(t).includes('更新时间：'));assert.ok(!text(t).includes('文件修改时间'));assert.ok(!text(t).includes('已读取日志快照'));assert.ok(!text(t).includes('/var/log/nikki'));assert.ok(nodes(t,'Section').every(x=>!x.props.footer))
  t.props.onDisappear();let n=calls.length;await button(t,'刷新').props.action();await flush();assert.equal(calls.length,n)
  t.props.onAppear();await flush();assert.ok(calls.length>n)
  for(const fn of [...sceneListeners])fn('background');n=calls.length;await button(render(logs.NikkiLogPage,{c,kind:'app'}),'刷新').props.action();await flush();assert.equal(calls.length,n)
  for(const fn of [...sceneListeners])fn('active');await flush();assert.ok(calls.length>n)
  failure=true;await button(render(logs.NikkiLogPage,{c,kind:'app'}),'刷新').props.action();await flush();t=render(logs.NikkiLogPage,{c,kind:'app'});assert.ok(text(t).includes('暂无日志'));assert.ok(text(t).includes(body));failure=false
  t=render(logs.NikkiLogPage,{c:{...c,id:'unsupported',plugin:'other'},kind:'debug'});assert.ok(!text(t).includes(body));await flush();assert.ok(text(render(logs.NikkiLogPage,{c:{...c,id:'unsupported',plugin:'other'},kind:'debug'})).includes('不支持'));unmount()
 })
 await test('background during stat prevents subsequent download; no debug generation or remote writes',async()=>{
  let release;const wait=new Promise(r=>release=r);responder=(url,init)=>{const r=respond(url,init);if(url.endsWith('/ubus')&&JSON.parse(init.body).params[1]==='file')return {...r,wait};return r}
  render(logs.NikkiLogPage,{c,kind:'debug'},true);await flush();let d=downloads;for(const fn of [...sceneListeners])fn('background');release();await flush();assert.equal(downloads,d);unmount()
  assert.ok(!calls.some(x=>x.url.endsWith('/ubus')&&['debug','exec','write','remove'].includes(JSON.parse(x.init.body).params[2])))
 })
 console.log('All 6 Nikki log groups passed (mock IO only).')
})().catch(e=>{console.error(e);process.exitCode=1})
`,{require,__dirname,console,process},{filename:__filename})
