// Observe production ConnectionsPage requests, not a standalone probing path.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
const device={id:'SECRET-ID',kind:'clash',name:'SECRET-NAME',url:'http://SECRET-HOST.invalid'},props={active:device,version:0,selected:true}
const sample={id:'SECRET-CONNECTION-ID',metadata:{host:'SECRET-TARGET.invalid',sourceIP:'192.0.2.99'},chains:['SECRET-NODE'],upload:123,download:456}
const draw=(p=props,reset=false)=>render(pages.ConnectionsPage,p,reset)
async function copied(tree){await button(trailing(tree.props.toolbar),'复制刷新诊断').props.action();return JSON.parse(clipboard)}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
;(async()=>{
 await test('ring bounds and runtime whitelist reject all strings except fixed event/reason labels',()=>{
  const d=new model.ConnectionRefreshDiagnostic();d.add('SECRET-EVENT',{reason:'SECRET-REASON'});assert.equal(JSON.parse(d.copy()).events.length,0)
  for(let i=0;i<240;i++)d.add('view',{owner:i,count:i,status:'SECRET',epoch:Infinity,reason:'SECRET-REASON',sourceKey:'SECRET-SOURCE',url:device.url,error:'SECRET-ERROR',selected:true})
  const output=d.copy(),events=JSON.parse(output).events;assert.equal(events.length,160);assert.equal(events[0].count,80);assert.ok(!output.includes('SECRET'));assert.ok(!output.includes('Infinity'))
  for(const e of events)assert.equal(Object.keys(e).sort().join(','),'count,event,ms,owner,selected,seq')
 })
 await test('real poll -> publication -> render snapshot correlation, sums and non-invasive clipboard',async()=>{
  responder=()=>({body:{connections:[sample]}});let t=draw(props,true);await flush();t=draw();await flush()
  const before=calls.length,timers=[...intervals.keys()],n=confirms.length,previousHaptics=haptics
  const output=await copied(t);assert.equal(calls.length,before);assert.deepEqual([...intervals.keys()],timers);assert.equal(confirms.length,n);assert.ok(haptics>=previousHaptics)
  const e=output.events,start=e.find(x=>x.event==='request-start'),end=e.find(x=>x.event==='request-end'),publish=e.find(x=>x.event==='publish'),rendered=e.find(x=>x.event==='render'&&x.snapshot===publish.snapshot)
  assert.ok(start&&end&&publish&&rendered);assert.equal(start.owner,publish.owner);assert.equal(start.request,publish.request);assert.equal(publish.count,1);assert.equal(publish.up,123);assert.equal(publish.down,456);assert.equal(rendered.count,1)
  assert.ok(e.some(x=>x.event==='schedule'&&x.afterMs===1000));for(const secret of ['SECRET','192.0.2.99',device.url])assert.ok(!clipboard.includes(secret))
  responder=()=>({body:{connections:[]}});now+=1500;[...intervals.values()].find(x=>x.ms===1000).fn();await flush();t=draw();const next=await copied(t);assert.equal(next.events.filter(x=>x.event==='publish').at(-1).count,0);assert.equal([...intervals.values()].filter(x=>x.ms===1000).length,1)
  unmount()
 })
 await test('scene stop and delayed-response drop preserve safe precise reasons; error text never copied',async()=>{
  const wait=deferred();responder=()=>({wait:wait.promise,body:{connections:[sample]}});let t=draw(props,true);await flush()
  emitScene('background');draw();await flush();wait.resolve();await flush();t=draw();let e=(await copied(t)).events
  assert.ok(e.some(x=>x.event==='scene'&&x.scene===false));assert.ok(e.some(x=>x.event==='effect-stop'&&x.reason==='scene-inactive'));assert.ok(e.some(x=>x.event==='drop'&&x.reason==='owner-stopped'));assert.ok(!e.some(x=>x.event==='publish'))
  responder=()=>({throw:'SECRET-ERROR at '+device.url});emitScene('active');draw();await flush();t=draw();e=(await copied(t)).events;assert.ok(e.some(x=>x.event==='request-end'&&x.reason==='error'));assert.ok(!clipboard.includes('SECRET'));assert.ok(e.some(x=>x.event==='effect-start'));unmount()
 })
 await test('bounded production trace retains latest owner across hidden tab and source changes without writes',async()=>{
  responder=()=>({body:{connections:[]}});let t=draw(props,true);await flush();t=draw()
  t.props.onDisappear();draw({...props,selected:false});await flush();t=draw({...props,selected:false});let e=(await copied(t)).events;assert.ok(e.some(x=>x.event==='disappear'));assert.ok(e.some(x=>x.event==='effect-skip'&&x.reason==='not-selected'));assert.equal(intervals.size,0)
  draw();await flush();draw();await flush();t=draw();const oldOwner=(await copied(t)).events.filter(x=>x.event==='effect-start').at(-1).owner
  const next={...props,active:{...device,url:'http://OTHER-SECRET.invalid'}};draw(next);await flush();t=draw(next);e=(await copied(t)).events;assert.ok(e.filter(x=>x.event==='effect-start').at(-1).owner>oldOwner);assert.ok(!clipboard.includes('OTHER-SECRET'))
  for(let i=0;i<100;i++){now+=1500;[...intervals.values()].find(x=>x.ms===1000).fn();await flush();t=draw(next)}
  e=(await copied(t)).events;assert.equal(e.length,160);assert.ok(calls.every(x=>x.init.method==='GET'));unmount()
 })
 console.log(count+' diagnostic groups passed; native IO mocked.')
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>unmount())
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
