// Replay the 1.101 phone trace through the real page; all network/native IO mocked.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
const c={id:'native-lifecycle',kind:'clash',name:'Synthetic',url:'http://synthetic.invalid'}
let selected=false,active=c,tree
const draw=()=>tree=render(pages.ConnectionsPage,{active,selected,version:0})
const poll=()=>[...intervals.values()].find(x=>x.ms===1000)
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
const copy=async()=>{await button(trailing(tree.props.toolbar),'复制刷新诊断').props.action();return JSON.parse(clipboard).events}
;(async()=>{
 await test('phone chronology: repeated 20ms appear/disappear never hides a selected foreground root; three subsequent polls publish',async()=>{
  const initial=now;store.set('dashboard_connections_snapshot_v1',{key:model.sourceKey(c),at:now,conns:Array.from({length:69},(_,i)=>({id:'cached-'+i,host:'cached.invalid',src:'',dst:'',network:'TCP',rule:'',chain:'',up:0,down:0,start:0}))})
  let bytes=10;responder=()=>({body:{connections:[{id:'live',metadata:{host:'live.invalid'},upload:bytes,download:bytes*2}]}})
  render(pages.ConnectionsPage,{active,selected,version:0},true);await flush();draw()
  // Exact supplied timestamps; disappear follows appear even though selection stays true.
  const timeline=[[45,'appear'],[46,'select'],[59,'appear'],[70,'disappear'],[154,'draw'],[159,'draw'],[210,'appear'],[229,'disappear'],[257,'draw'],[17042,'deselect'],[24107,'background'],[28523,'resume'],[29874,'appear'],[29876,'select'],[29944,'appear'],[29973,'disappear'],[30010,'draw'],[30015,'draw'],[30067,'appear'],[30086,'disappear'],[30123,'draw']]
  for(const [ms,event] of timeline){now=initial+ms
   if(event==='appear')tree.props.onAppear()
   if(event==='disappear')tree.props.onDisappear()
   if(event==='select')selected=true
   if(event==='deselect')selected=false
   if(event==='background')emitScene('background')
   if(event==='resume'){emitScene('inactive');emitScene('active');emitScene('inactive');emitScene('active')}
   draw();await flush();draw();await flush()
   if(event==='deselect'||event==='background')assert.ok(!poll())
  }
  assert.ok(poll(),'selected foreground root must not remain not-visible after native disappear')
  const before=calls.length
  for(let i=0;i<3;i++){bytes+=15;now+=1000;poll().fn();await flush();draw();assert.equal(model.historyFor(c).active[0].up,bytes);assert.ok(text(tree).includes('live.invalid'))}
  assert.equal(calls.length,before+3);const events=await copy();assert.ok(events.some(x=>x.event==='effect-start'));assert.ok(events.filter(x=>x.event==='publish').length>=3);assert.ok(events.some(x=>x.event==='render'&&x.snapshot>0));unmount()
 })
 await test('controlled detail push pauses immediately; disappear noise and background do not reopen it; native back resumes',async()=>{
  selected=true;active={...c,id:'detail-owner'};responder=()=>({body:{connections:[{id:'one',metadata:{host:'one.invalid'},upload:1,download:2}]}})
  render(pages.ConnectionsPage,{active,selected,version:0},true);await flush();draw();const before=calls.length
  button(tree,'查看连接详情').props.action();assert.ok(!poll(),'push aborts/stops synchronously');draw();await flush();assert.equal(tree.props.navigationDestination.isPresented,true)
  tree.props.onDisappear();tree.props.onAppear();draw();await flush();assert.ok(!poll());assert.equal(calls.length,before)
  emitScene('background');emitScene('active');draw();await flush();assert.ok(!poll(),'still obscured by detail')
  tree.props.navigationDestination.onChanged(false);draw();await flush();draw();assert.ok(poll());assert.equal(calls.length,before+1)
  // Tab selection is authoritative even without native disappear.
  selected=false;draw();await flush();assert.ok(!poll());selected=true;draw();await flush();assert.ok(poll());unmount()
 })
 await test('single request chain and immediate background stop; old source/unmounted results cannot publish',async()=>{
  for(const mode of ['background','source','unmount']){
   selected=true;active={...c,id:'late-'+mode};const wait=deferred();responder=()=>({wait:wait.promise,body:{connections:[{id:'stale',metadata:{host:'stale.invalid'}}]}})
   render(pages.ConnectionsPage,{active,selected,version:0},true);await flush();draw();const before=calls.length
   poll().fn();void tree.props.refreshable();await flush();assert.equal(calls.length,before)
   if(mode==='background'){emitScene('background');assert.ok(!poll());draw();await flush()}
   if(mode==='source'){active={...active,url:'http://new.invalid'};responder=()=>({body:{connections:[]}});draw();await flush()}
   if(mode==='unmount')unmount()
   wait.resolve();await flush();if(mode!=='unmount'){draw();assert.ok(!text(tree).includes('stale.invalid'));assert.ok((await copy()).some(x=>x.event==='drop'))}
   if(mode==='background'){responder=()=>({body:{connections:[]}});emitScene('active');draw();await flush();assert.ok(poll());assert.equal(calls.length,before+1)}
   unmount();assert.equal(intervals.size,0);assert.equal(sceneListeners.size,0)
  }
 })
 console.log(count+' native connection lifecycle groups passed (mock IO; phone timing trace replayed).')
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>unmount())
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
