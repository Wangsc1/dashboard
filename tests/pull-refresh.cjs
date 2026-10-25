// Pull-to-refresh for rules and connections. All IO/native hooks mocked; no device or remote.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
scripting.useState=function(v){const slots=hooks,i=hookIndex++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]}
function owner(fn){const state={hooks:[],cleanups:new Map()};return {render(props={}){const saved={hooks,cleanups,effects,hookIndex};hooks=state.hooks;cleanups=state.cleanups;effects=[];hookIndex=0;const tree=fn(props),queued=effects;({hooks,cleanups,effects,hookIndex}=saved);for(const f of queued){const sc=cleanups;cleanups=state.cleanups;f();cleanups=sc}return tree},close(){for(const f of state.cleanups.values())f();state.cleanups.clear()}}}
async function settle(){for(let i=0;i<100;i++)await Promise.resolve()}
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
const base={id:'pull',kind:'clash',name:'Pull',url:'http://pull-a.invalid'}
const rule=n=>({type:'DOMAIN',payload:n,proxy:'DIRECT'})
const conn=n=>({id:n,metadata:{host:n+'.invalid'},upload:1,download:1})
const prov={providers:{A:{type:'Rule',vehicleType:'HTTP',ruleCount:1,proxies:[]}}}
;(async()=>{
 await test('Shell: only rules and connections are refreshable; menus; connections inline search icon still toggles search',async()=>{
  responder=()=>({body:{rules:[],providers:{},connections:[],proxies:{}}})
  const r=owner(pages.RulesPage).render({active:{...base,id:'sh-r'},version:0,selected:true});assert.equal(typeof r.props.refreshable,'function')
  assert.deepEqual(nodes(trailing(r.props.toolbar),'Button').map(b=>b.props.title),[]);assert.deepEqual(nodes(trailing(r.props.toolbar),'Toggle').map(b=>b.props.title),['禁用规则时打断连接'])
  const page=owner(pages.ConnectionsPage),props={active:{...base,id:'sh-c'},version:0,selected:true};let c=page.render(props);assert.equal(typeof c.props.refreshable,'function')
  const titles=nodes(trailing(c.props.toolbar),'Button').map(b=>b.props.title);assert.deepEqual(titles,['客户端标签','清理已断开连接','打断全部连接'])
  assert.equal(nodes(c,'TextField').filter(t=>t.props.title==='搜索连接...').length,0)
  const icon=nodes(c,'Button').find(b=>nodes(b,'Image').some(i=>i.props.systemName==='magnifyingglass'));assert.ok(icon,'inline search icon exists');icon.props.action()
  c=page.render(props);assert.equal(nodes(c,'TextField').filter(t=>t.props.title==='搜索连接...').length,1,'icon opens the search field');const searchField=nodes(c,'TextField').find(t=>t.props.title==='搜索连接...');assert.equal(searchField.props.frame.height,44);assert.equal(searchField.props.font,16);page.close()
  for(const [name,p] of [['ProxiesPage',{active:{...base,id:'sh-p'},version:0,selected:true}],['MorePage',{active:{...base,id:'sh-m'},selected:true,onChanged(){}}]]){
   if(!pages[name])continue;const t=owner(pages[name]).render(p);assert.equal(t.props.refreshable,undefined,name+' has no refreshable')}
 })
 await test('rules pull = update all providers (no confirm) then re-read; waits for both; repeats coalesce; failure keeps old data; stale dropped',async()=>{
  const url='http://pull-a.invalid';let putGate=gate(),readGate=gate(),puts=0,reads=0,rulesOut='fresh.example'
  responder=(u,i)=>{
   if(i?.method==='PUT'){puts++;return {wait:putGate.promise,status:204}}
   if(u.includes('/providers/rules'))return {body:prov}
   reads++;return {wait:readGate.promise,body:{rules:[rule(rulesOut)]}}}
  const page=owner(pages.RulesPage),props={active:{...base,id:'pull-rules',url},version:0,selected:true}
  readGate.resolve();let tree=page.render(props);await settle();tree=page.render(props);assert.ok(text(tree).includes('fresh.example'))
  putGate=gate();readGate=gate();puts=0;reads=0;rulesOut='pulled.example';const before=confirms.length
  let done=false;const p1=tree.props.refreshable().then(()=>done=true),p2=tree.props.refreshable();await settle()
  assert.equal(puts,1,'update-all issued once');assert.equal(reads,0,'re-read waits for updates to finish');assert.equal(done,false)
  putGate.resolve();await settle();assert.equal(reads,1,'re-read starts after update');assert.equal(done,false,'pending until the re-read completes')
  readGate.resolve();await p1;await p2;assert.equal(puts,1);assert.equal(reads,1);assert.equal(confirms.length,before,'no new confirmation');tree=page.render(props);assert.ok(text(tree).includes('pulled.example'))
  responder=(u,i)=>i?.method==='PUT'?{status:500}:u.includes('/providers/rules')?{body:prov}:{status:500}
  const alertsBefore=alerts.length;await tree.props.refreshable();tree=page.render(props);assert.ok(text(tree).includes('pulled.example'));assert.ok(text(tree).includes('请求未完成'));assert.ok(alerts.length>alertsBefore,'existing update failure alert kept')
  const g=gate();responder=(u,i)=>i?.method==='PUT'?{wait:g.promise,status:204}:u.includes('/providers/rules')?{body:prov}:{body:{rules:[rule('old-source.example')]}}
  const stale=tree.props.refreshable();const other={...props,active:{...props.active,url:'http://pull-b.invalid'}}
  responder=u=>u.includes('/providers/rules')?{body:{providers:{}}}:{body:{rules:[rule('new-source.example')]}}
  tree=page.render(other);await settle();g.resolve();await stale;await settle();tree=page.render(other)
  assert.ok(!text(tree).includes('old-source.example'),'stale result never published');assert.ok(text(tree).includes('new-source.example'))
  page.close()
 })
 await test('connections pull: joins poll read (no duplicate), waits; failure keeps data; background does nothing',async()=>{
  let g=gate(),n=0,fail=false;responder=()=>{n++;if(fail)return {status:500};return {wait:g.promise,body:{connections:[conn('c'+n)]}}}
  const page=owner(pages.ConnectionsPage),props={active:{...base,id:'pull-conns',url:'http://pull-c.invalid'},version:0,selected:true}
  let tree=page.render(props);await settle();tree=page.render(props)
  assert.equal(n,1,'poll read in flight');let done=false;const p=tree.props.refreshable().then(()=>done=true);await settle()
  assert.equal(n,1,'pull joined the in-flight poll read');assert.equal(done,false)
  g.resolve();await p;await settle();tree=page.render(props);assert.equal(n,1,'no duplicate after join');assert.ok(text(tree).includes('c1.invalid'))
  g=gate();g.resolve();await tree.props.refreshable();await settle();tree=page.render(props);assert.equal(n,2,'idle pull reads once');assert.ok(text(tree).includes('c2.invalid'));assert.ok([...intervals.values()].some(x=>x.ms===1500))
  fail=true;await tree.props.refreshable();await settle();tree=page.render(props);assert.ok(text(tree).includes('c2.invalid'));assert.ok(text(tree).includes('请求未完成'))
  fail=false;emitScene('inactive');emitScene('background');page.render(props);await settle();const before=n;await tree.props.refreshable();assert.equal(n,before)
  page.close()
 })
 console.log(count+' pull-refresh groups passed; mocked, no device claim.')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
