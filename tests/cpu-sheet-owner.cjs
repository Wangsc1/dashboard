// Dynamic multi-cycle detail interpolation, not native bridge/FPS measurement.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
scripting.useState=function(v){const slots=hooks,i=hookIndex++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]}
function instance(fn){const state={hooks:[],cleanups:new Map()};return {async draw(props){
 const saved={hooks,cleanups,effects,hookIndex};hooks=state.hooks;cleanups=state.cleanups;effects=[];hookIndex=0
 let out=fn(props);await flush();hookIndex=0;effects=[];out=fn(props);await flush()
 hooks=saved.hooks;cleanups=saved.cleanups;effects=saved.effects;hookIndex=saved.hookIndex;return out
},close(){for(const c of state.cleanups.values())c();state.cleanups.clear()}}}
;(async()=>{
 await test('生产普通feed同步/引用相等/快照发布/实例隔离，不调用Observable或隐式setter',async()=>{
  const original=scripting.useObservable;scripting.useObservable=()=>{throw Error('no Observable allowed')}
  try{
   const frame=n=>({overview:{wrt:{uptime:n}},histories:{cpu:{},up:[],down:[]},running:!!n})
   const zero=frame(0),one=frame(1),two=frame(2),a=home.createCpuDetailFeed(zero),b=home.createCpuDetailFeed(zero)
   assert.equal(Object.getPrototypeOf(a),vm.runInContext('Object.prototype',context))
   const descriptor=Object.getOwnPropertyDescriptor(a,'value');assert.equal(descriptor.get,undefined);assert.equal(descriptor.set,undefined);assert.equal(descriptor.value,zero)
   const log=[],other=[],first=(v,old)=>{assert.equal(a.value,v);log.push([v,old]);a.unsubscribe(second)},second=(v,old)=>log.push(['second',v,old])
   a.subscribe(first);a.subscribe(first);a.subscribe(second);b.subscribe(v=>other.push(v))
   a.setValue(zero);assert.equal(log.length,0,'same frame reference is silent')
   a.setValue(one);assert.equal(log.length,2,'synchronous snapshot delivers both listeners despite in-flight unsubscribe');assert.equal(log[0][0],one);assert.equal(log[0][1],zero)
   a.setValue(two);assert.equal(log.length,3);assert.equal(log[2][1],one);assert.equal(other.length,0);assert.equal(b.value,zero)
   a.unsubscribe(first);a.unsubscribe(first);a.setValue(frame(3));assert.equal(log.length,3,'unsubscribe is idempotent')
   b.setValue(one);assert.equal(other.length,1)
   // Actual OverviewPage must allocate a stable plain feed, not merely a replacement mock.
   const props={active:null,version:0,onSwitch:()=>{},selected:true}
   render(app.OverviewPage,props,true);await flush();const feed=hooks.find(x=>x&&x.setValue&&x.subscribe&&Object.prototype.hasOwnProperty.call(x,'value'))
   assert.ok(feed);assert.equal(Object.getOwnPropertyDescriptor(feed,'value').get,undefined)
   render(app.OverviewPage,props);await flush();assert.ok(hooks.includes(feed));unmount()
  }finally{scripting.useObservable=original}
 })
 await test('普通feed订阅边界取最新帧，卸载停止UI订阅，重进不读旧快照',async()=>{
  const frame=(n,running=true)=>({overview:{wrt:{uptime:n}},histories:{cpu:{cpu:[n]},up:[],down:[]},running})
  const feed=home.createCpuDetailFeed(frame(0)),first=render(home.LiveCpuDetails,{feed},true)
  assert.equal(first.props.overview.wrt.uptime,0)
  // Publication between render and effect must not be lost.
  feed.setValue(frame(1));await flush();let out=render(home.LiveCpuDetails,{feed});await flush();assert.equal(out.props.overview.wrt.uptime,1)
  feed.setValue(frame(2,false));out=render(home.LiveCpuDetails,{feed});await flush();assert.equal(out.props.running,false,'retained closed sheet pauses plots as before')
  const retained=hooks;unmount();feed.setValue(frame(3));assert.equal(retained[0].overview.wrt.uptime,2,'disposed UI receives no writes')
  out=render(home.LiveCpuDetails,{feed},true);assert.equal(out.props.overview.wrt.uptime,3,'fresh mount reads latest snapshot')
  // Publication during subscription installation is followed by reading the current value.
  const subscribe=feed.subscribe;feed.subscribe=fn=>{feed.setValue(frame(4));subscribe(fn)}
  await flush();out=render(home.LiveCpuDetails,{feed});await flush();assert.equal(out.props.overview.wrt.uptime,4)
  unmount()
 })
 await test('固定详情owner内部订阅最新帧，原始数据不冻结，关闭/卸载退订',async()=>{
  const listeners=new Set(),frame=(n,running=true)=>({overview:{wrt:{cpus:[{id:'cpu',usage:n}]}},histories:{cpu:{cpu:[n]},down:[],up:[]},running})
  const feed=home.createCpuDetailFeed(frame(0)),sub=feed.subscribe,unsub=feed.unsubscribe;feed.subscribe=fn=>{listeners.add(fn);sub(fn)};feed.unsubscribe=fn=>{listeners.delete(fn);unsub(fn)}
  const page=instance(home.LiveCpuDetails),props={feed};let out=await page.draw(props);assert.equal(listeners.size,1)
  for(let i=1;i<=8;i++){
   feed.setValue(frame(i))
   out=await page.draw(props);assert.equal(out.type,home.CpuDetails);assert.equal(out.props.histories,feed.value.histories);assert.equal(out.props.overview,feed.value.overview);assert.equal(out.props.running,true);assert.equal(listeners.size,1)
  }
  feed.setValue(frame(9,false));out=await page.draw(props);assert.equal(out.props.running,false)
  page.close();assert.equal(listeners.size,0);assert.equal(intervals.size,0)
 })
 await test('sheet原生appear先于content effect不等于内容尚未构建；首次/再次保留内容，首次时间不被覆盖',async()=>{
  const diag=load('cadence-diagnostics'),trace=diag.createSheetTrace(),listeners=new Set()
  const feed={value:{overview:null,histories:{cpu:{cpu:[]},up:[],down:[]},running:false},subscribe(fn){listeners.add(fn)},unsubscribe(fn){listeners.delete(fn)}}
  const props={feed,trace};let out=render(home.LiveCpuDetails,props,true)
  // Actual order under test: JS render -> native callback -> useEffect. No synthetic delays in production.
  now+=188;home.CpuDetails(out.props).props.onAppear();await flush();diag.sheetLifecycle('state-open',trace)
  let summary=diag.plotLifecycleSummary(),row=summary.split('\n').find(l=>l.startsWith('sheet='+trace+' appearanceCount='))
  assert.ok(row.includes('first.content-create=-188ms'));assert.ok(row.includes('first.appear=-0ms'));assert.ok(row.includes('first.content-mount=-0ms'))
  const push=running=>{const old=feed.value;feed.value={...old,running};for(const fn of listeners)fn(feed.value,old)}
  push(true);out=render(home.LiveCpuDetails,props);await flush();assert.equal(out.props.running,true)
  home.CpuDetails(out.props).props.onDisappear();diag.sheetLifecycle('state-closed',trace);push(false);render(home.LiveCpuDetails,props);await flush()
  now+=1000;home.CpuDetails(out.props).props.onAppear();diag.sheetLifecycle('state-open',trace);push(true);out=render(home.LiveCpuDetails,props);await flush()
  assert.equal(listeners.size,1);assert.equal(out.props.running,true)
  summary=diag.plotLifecycleSummary();row=summary.split('\n').find(l=>l.startsWith('sheet='+trace+' appearanceCount='));assert.ok(row.includes('appearanceCount=2'));assert.ok(row.includes('first.appear=-1000ms'));assert.ok(row.includes('first.content-create=-1188ms'))
  assert.equal(summary.split('\n').filter(l=>l.includes('sheet='+trace+' content-mount')).length,1)
  unmount();assert.equal(listeners.size,0)
 })
 await test('完整LiveCpuDetails展开到原生树：首帧/running/连续采样/元信息/关闭再显示不移动或复用WebView',async()=>{
  const controllers=[],timers=new Map();let nextTimer=0
  context.setTimeout=fn=>{const id=++nextTimer;timers.set(id,fn);return id};context.clearTimeout=id=>timers.delete(id)
  context.WebViewController=class{constructor(){this.handlers={};this.loads=0;this.disposed=false;controllers.push(this)}async addScriptMessageHandler(n,f){this.handlers[n]=f}async loadHTML(){this.loads++;return true}async evaluateJavaScript(){return true}dispose(){this.disposed=true}}
  const instances=new Map(),listeners=new Set(),trace=load('cadence-diagnostics').createSheetTrace()
  const frame=(n,running=true,count=16)=>{
   const cpus=Array.from({length:count},(_,i)=>({id:'cpu'+i,usage:n+i}));cpus.unshift({id:'cpu',usage:n})
   return {overview:{wrt:{cpus,uptime:n,release:'test',cpuModel:'test',cpuMeta:n?{cpu0:{mhz:1000,cacheKB:12}}:undefined}},histories:{cpu:Object.fromEntries(cpus.map(c=>[c.id,[10,n]])),up:[],down:[]},running}
  }
  const feed=home.createCpuDetailFeed(frame(0,false)),sub=feed.subscribe,unsub=feed.unsubscribe;feed.subscribe=f=>{listeners.add(f);sub(f)};feed.unsubscribe=f=>{listeners.delete(f);unsub(f)}
  const publish=f=>feed.setValue(f)
  async function tree(){
   const seen=new WeakSet(),plots=[],skeleton=[]
   async function walk(n,path){
    if(!n||typeof n!=='object')return
    assert.ok(!seen.has(n),'VirtualNode reused across tree: '+path);seen.add(n)
    const name=typeof n.type==='function'?n.type.name:n.type,where=path+'/'+name+(n.props?.key!==undefined?'#'+n.props.key:'')
    if(typeof n.type==='function'){
     let own=instances.get(where);if(!own){own=instance(n.type);instances.set(where,own)}
     return walk(await own.draw(n.props),where)
    }
    skeleton.push([where,n.props.frame??null])
    if(n.type==='WebView')plots.push({path:where,controller:n.props.controller,opacity:n.props.opacity})
    // Assert key uniqueness at the actual sibling scope, not globally across distinct parents.
    const kids=(n.props?.children??[]).filter(x=>x&&typeof x==='object'),keys=kids.map(x=>x.props?.key).filter(x=>x!==undefined)
    assert.equal(new Set(keys).size,keys.length,'duplicate sibling key '+where)
    for(let i=0;i<kids.length;i++)await walk(kids[i],where+'/'+i)
   }
   await walk({type:home.LiveCpuDetails,props:{feed,trace}},'sheet')
   return {plots,skeleton}
  }
  let baseline=await tree();assert.equal(baseline.plots.length,17);assert.equal(controllers.length,17);assert.equal(listeners.size,1)
  const signature=x=>JSON.stringify(x.plots.map(p=>[p.path,p.opacity]))
  for(const c of controllers){assert.equal(c.loads,1);c.handlers.plotReady({generation:1});c.handlers.plotPainted({generation:1,w:145,h:76})}
  await flush()
  for(const n of [1,2,3,4,5]){
   publish(frame(n));const next=await tree();assert.equal(signature(next),signature(baseline));assert.equal(JSON.stringify(next.skeleton),JSON.stringify(baseline.skeleton),'all native paths/frames remain stable')
   next.plots.forEach((p,i)=>assert.equal(p.controller,baseline.plots[i].controller));assert.equal(controllers.length,17)
  }
  publish(frame(6,false));await tree();publish(frame(7,true));assert.equal(signature(await tree()),signature(baseline),'retained second sheet uses same tree')
  // Empty-data prompt -> populated cores only inserts rows after the existing summary; summary path stays fixed.
  publish(frame(8,true,0));const empty=await tree();assert.equal(empty.plots.length,1);assert.equal(empty.plots[0].path,baseline.plots[0].path)
  for(const own of instances.values())own.close();assert.equal(listeners.size,0);assert.ok(controllers.every(c=>c.disposed));assert.equal(intervals.size,0);assert.equal(timers.size,0)
 })
 await test('CPU详情恢复滚动容器，保留内容/导航/关闭/原生生命周期',async()=>{
  const trace=load('cadence-diagnostics').createSheetTrace(),histories={cpu:{cpu:[12],cpu0:[23]},up:[],down:[]},w={cpus:[{id:'cpu',usage:12},{id:'cpu0',usage:23}]}
  const tree=home.CpuDetails({overview:{wrt:w},histories,running:true,trace})
  assert.equal(tree.type,'NavigationStack');assert.equal(nodes(tree,'ScrollView').length,1)
  assert.deepEqual(Array.from(tree.props.presentationDetents),['large']);assert.equal(tree.props.presentationDragIndicator,'visible');assert.equal(tree.props.presentationContentInteraction,'scrolls')
  assert.equal(typeof tree.props.onAppear,'function');assert.equal(typeof tree.props.onDisappear,'function')
  const container=tree.props.children[0];assert.equal(container.type,'ScrollView');assert.equal(container.props.navigationTitle,'CPU');assert.equal(container.props.navigationBarTitleDisplayMode,'inline');assert.equal(container.props.background,home.HOME_BG)
  const close=container.props.toolbar.topBarLeading;assert.equal(close.type,'Button');assert.equal(close.props.systemImage,'xmark');assert.equal(close.props.accessibilityLabel,'关闭CPU详情');assert.equal(typeof close.props.action,'function')
  const content=container.props.children[0];assert.equal(content.type,'VStack');assert.equal(content.props.spacing,16);assert.equal(JSON.stringify(content.props.padding),JSON.stringify({horizontal:16,top:12,bottom:24}))
  const summary=nodes(tree,home.DetailCpuSummary)[0],row=nodes(tree,home.CoreRow)[0];assert.equal(summary.props.w,w);assert.equal(summary.props.history,histories.cpu.cpu);assert.equal(summary.props.running,true);assert.equal(summary.props.sheetTrace,trace);assert.equal(summary.props.key,'summary')
  assert.equal(row.props.histories,histories);assert.equal(row.props.cpus[0],w.cpus[1]);assert.equal(row.props.running,true);assert.equal(row.props.sheetTrace,trace);assert.equal(row.props.key,'core-cpu0')
  tree.props.onAppear();tree.props.onDisappear();const summaryLog=load('cadence-diagnostics').plotLifecycleSummary();assert.ok(summaryLog.includes('sheet='+trace+' appear'));assert.ok(summaryLog.includes('sheet='+trace+' disappear'))
 })
 console.log(count+' mounted sheet data-flow groups passed; not a native remount/FPS measurement')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
