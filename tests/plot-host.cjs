// Real native TSX host contract. Mock TimelineCanvas draw calls are NOT iPhone pixel proof.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
let insideDraw=false,writes=0,timers=new Map(),timerId=0
context.setTimeout=f=>{const id=++timerId;timers.set(id,f);return id};context.clearTimeout=id=>timers.delete(id)
context.WebViewController=class{constructor(){throw Error('native charts must never construct WebView')}}
scripting.useState=function(v){const slots=hooks,i=hookIndex++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],v=>{assert.equal(insideDraw,false,'no React setters in native draw');writes++;slots[i]=typeof v==='function'?v(slots[i]):v}]}
const plot=load('plot-view'),geometry=load('native-plot')
function instance(initial){const state={hooks:[],cleanups:new Map()},p={...initial};return {props:p,render(){const saved={hooks,cleanups,effects,hookIndex};hooks=state.hooks;cleanups=state.cleanups;effects=[];hookIndex=0;let tree=plot.MountedCanvasPlot(p);const queued=effects;queued.forEach(f=>f());hookIndex=0;effects=[];tree=plot.MountedCanvasPlot(p);hooks=saved.hooks;cleanups=saved.cleanups;effects=saved.effects;hookIndex=saved.hookIndex;return tree},host(){return state.hooks[0].current},close(){for(const f of state.cleanups.values())f();state.cleanups.clear()}}}
function draw(tree,width=145,height=76){const ops=[],ctx=new Proxy({}, {get:(_,k)=>(...args)=>ops.push([k,...args]),set:(_,k,v)=>{ops.push([k,v]);return true}});const before=writes;insideDraw=true;try{tree.props.draw(ctx,{width,height},now/1000)}finally{insideDraw=false};assert.equal(writes,before);return ops}
function drain(){const callbacks=[...timers.values()];timers.clear();callbacks.forEach(f=>f())}
function native(tree){assert.equal(tree.type,'TimelineCanvas');assert.equal(tree.props.schedule.minimumInterval,1/30);assert.equal(tree.props.opaque,false);assert.equal(nodes(tree,'WebView').length,0);assert.equal(nodes(tree,'ZStack').length,0);assert.ok(!('opacity' in tree.props));return tree}
;(async()=>{
 await test('20 native hosts: stable models/frames, one completion queue, final drawn geometry before pause, no per-frame React renders',async()=>{
  const os=Array.from({length:20},(_,i)=>instance({samples:[10,20,30],tone:'#3485eb',percent:true,running:true,plotHeight:i<3?96:76}))
  const first=os.map(o=>native(o.render())),models=os.map(o=>o.host().model);assert.equal(new Set(models).size,20)
  first.forEach(t=>draw(t));assert.equal(timers.size,1,'20 completions use ONE process timer');drain()
  os.forEach((o,i)=>{assert.equal(o.render().props.paused,true);assert.equal(o.host().model,models[i])})
  now+=1000;os.forEach(o=>{o.props.samples=[10,20,50]});let trees=os.map(o=>native(o.render()));assert.ok(trees.every(t=>t.props.paused===false));assert.ok(os.every(o=>o.host().model.animating))
  const before=writes;now+=500;trees.forEach(t=>draw(t));const mid=os[0].host().model.shown.at(-1).y;assert.equal(os[0].host().model.shown.at(-1).y,mid,'duplicate calls do not snap interpolation');emitScene('active');assert.equal(os[0].host().model.shown.at(-1).y,mid,'duplicate active does not snap');assert.equal(writes,before);assert.equal(timers.size,0);assert.ok(os.every(o=>o.host().model.shown.at(-1).y===40))
  now+=500;trees.forEach(t=>draw(t));assert.equal(timers.size,1);assert.ok(os.every(o=>o.host().model.shown.at(-1).y===50),'target actually drawn before park');assert.ok(os.every(o=>o.render().props.paused===false))
  // A new sample invalidates that host's pending completion, without canceling siblings.
  os[0].props.samples=[10,20,70];os[0].render();drain();assert.equal(os[0].render().props.paused,false);assert.ok(os.slice(1).every(o=>o.render().props.paused===true))
  os.forEach(o=>o.close());assert.equal(timers.size,0);assert.equal(sceneListeners.size,0);assert.equal(intervals.size,0)
 })
 await test('pause/static samples/style/size/empty grid redraw once; retain same native node/model; no idle full-speed loop',async()=>{
  const o=instance({samples:[],tone:'#3485eb',percent:true,running:false,plotHeight:66});let t=native(o.render());const model=o.host().model
  let ops=draw(t);assert.equal(ops.filter(x=>x[0]==='lineTo').length,13);assert.equal(o.host().model.animating,false);drain();assert.equal(o.render().props.paused,true)
  o.props.samples=[10,80];t=o.render();assert.equal(t.props.paused,false);ops=draw(t);assert.ok(ops.some(x=>x[0]==='bezierCurveTo'));drain();assert.equal(o.render().props.paused,true)
  mockColorScheme='dark';o.props.elevated=true;o.props.plotHeight=96;o.props.plotWidth=329;t=o.render();ops=draw(t,329,96);assert.equal(o.host().model,model);assert.ok(ops.some(x=>x[0]==='fillStyle'&&x[1]==='#2c2c2e'));assert.equal(t.props.frame.minHeight,96);drain();assert.equal(o.render().props.paused,true)
  mockColorScheme='light';o.close();assert.equal(timers.size,0);assert.equal(sceneListeners.size,0)
 })
 await test('scene/tab/offscreen stops timeline and queue; newest background samples snap on restore without catch-up; retained identity',async()=>{
  const o=instance({samples:[10,20],tone:'#2dbf82',running:true,percent:true});let t=o.render();draw(t);drain();const model=o.host().model
  now+=1000;o.props.samples=[30,80];t=o.render();now+=300;draw(t);assert.ok(model.animating)
  emitScene('inactive');emitScene('background');assert.equal(o.render().props.paused,true);assert.equal(timers.size,0)
  o.props.samples=[60,90];o.render();assert.equal(o.render().props.paused,true);assert.equal(model.animating,false)
  emitScene('active');t=o.render();assert.equal(t.props.paused,false);assert.equal(model.shown.at(-1).y,90);assert.equal(model.animating,false);draw(t);drain();assert.equal(o.render().props.paused,true)
  // Page/sheet/tab invisibility arrives as running=false; TimelineCanvas has no appear/disappear gate.
  o.props.running=false;o.props.samples=[70,100];t=o.render();plot.requestPlotKick('selected');draw(t);drain();assert.equal(o.render().props.paused,true,'running=false draws its static final state then parks')
  o.props.running=true;t=o.render();assert.equal(model.shown.at(-1).y,100);draw(t);drain();assert.equal(o.render().props.paused,true)
  o.props.running=false;o.render();draw(o.render());drain();plot.requestPlotKick('appear');t=o.render();assert.equal(model.animating,false);draw(t);drain()
  assert.equal(o.host().model,model);o.close();assert.equal(timers.size,0);assert.equal(sceneListeners.size,0);plot.requestPlotKick('selected');assert.equal(timers.size,0)
 })
 await test('resume cadence matches uninterrupted 1s samples across long gaps and native event orderings',async()=>{
  const history=Array.from({length:60},(_,i)=>10+i)
  async function series(order){
   const o=instance({samples:history,tone:'#3485eb',running:true,percent:true});let t=o.render();draw(t);drain()
   now+=1000;o.props.samples=history.map(x=>x+1);t=o.render();now+=400;draw(t);now+=600;draw(t);drain()
   if(order){
    emitScene('inactive');emitScene('background');if(order!=='retained-running'){o.props.running=false;o.render()}now+=120000

    if(order==='props-first'){o.props.running=true;o.render()}
    emitScene('inactive');emitScene('active')

    o.props.running=true;t=o.render();assert.equal(o.host().model.animating,false,'retained snapshot is not a sample/shift');draw(t);drain()
   }
   const result=[],base=order?now:now-1000
   for(let i=2;i<6;i++){
    now=base+(i-1)*1000;o.props.samples=history.map(x=>x+i);t=o.render();const m=o.host().model
    result.push({duration:m.duration,from:m.from.map(p=>({...p})),to:m.to.map(p=>({...p}))})
    now+=400;draw(t);now+=600;draw(t);drain()
   }
   o.close();return result
  }
  const cold=await series(null)
  for(const order of ['appear-first','active-first','retained-running','props-first']){
   const resumed=await series(order)
   assert.deepEqual(resumed.map(x=>x.duration),cold.map(x=>x.duration),'background time must not become a 2500ms transition')
   assert.deepEqual(resumed.slice(1),cold.slice(1),'after immediate restore, equal relative samples have equal geometry/cadence')
  }
  assert.equal(timers.size,0);assert.equal(sceneListeners.size,0)
 })
 await test('resume does not wake retained running=false hosts; duplicate kicks/appear do not reset a live interpolation',async()=>{
  const os=Array.from({length:20},(_,i)=>instance({samples:Array.from({length:60},(_,j)=>j),tone:'#3485eb',running:i<3,percent:true}))
  let trees=os.map(o=>o.render());trees.forEach(t=>draw(t));drain()
  emitScene('background');now+=60000;emitScene('active');trees=os.map(o=>o.render())
  assert.ok(trees.slice(3).every(t=>t.props.paused),'17 closed detail hosts stay paused on foreground')
  trees.slice(0,3).forEach(t=>draw(t));drain()
  now+=1000;os[0].props.samples=Array.from({length:60},(_,j)=>j+20);let t=os[0].render();now+=400;draw(t)
  const m=os[0].host().model,before=JSON.stringify({shown:m.shown,from:m.from,to:m.to,start:m.start,duration:m.duration}),n=writes
  plot.requestPlotKick('appear');plot.requestPlotKick('selected');emitScene('active')
  assert.equal(JSON.stringify({shown:m.shown,from:m.from,to:m.to,start:m.start,duration:m.duration}),before,'duplicate lifecycle cannot snap or restart current animation')
  assert.equal(writes,n+2,'only the two idle visible hosts accept a one-shot external redraw; live/hidden hosts do not toggle pause')
  assert.ok(os.slice(3).every(o=>o.render().props.paused))
  os.forEach(o=>o.close());assert.equal(timers.size,0);assert.equal(sceneListeners.size,0)
 })
 await test('exact stationary geometry completes after one actual draw; parent renders alone do not toggle timeline state',async()=>{
  const os=Array.from({length:20},()=>instance({samples:Array(12).fill(0),tone:'#3485eb',running:true,percent:true}))
  os.map(o=>o.render()).forEach(t=>draw(t));drain()
  for(let sample=0;sample<3;sample++){
   now+=1000
   for(const o of os){o.props.samples=Array(12).fill(0);const t=o.render();assert.equal(o.host().model.animating,false);assert.equal(t.props.paused,false);draw(t)}
   assert.equal(timers.size,1);drain();assert.ok(os.every(o=>o.render().props.paused))
   const before=writes;for(let j=0;j<5;j++)for(const o of os)assert.equal(o.render().props.paused,true)
   assert.equal(writes,before,'unchanged parent props do not restart JS animation or pause setters');assert.equal(timers.size,0)
  }
  os.forEach(o=>o.close());assert.equal(timers.size,0);assert.equal(sceneListeners.size,0)
 })
 await test('real host draws with or without native time; pause and scene stop the timeline, sample boundary does not',async()=>{
  const o=instance({samples:[10,20],tone:'#3485eb',running:true,percent:true});let t=o.render();draw(t);drain()
  now+=1000;o.props.samples=[20,30];t=o.render();const rawCtx=new Proxy({}, {get:()=>()=>{},set:()=>true});t.props.draw(rawCtx,{width:145,height:76},undefined);draw(t)
  now+=30;draw(t);const before=writes;assert.equal(timers.size,0)
  now+=30;o.props.samples=[30,40];t=o.render();assert.equal(t.props.paused,false);draw(t);assert.equal(writes,before,'draws never set React state')
  emitScene('inactive');assert.equal(o.render().props.paused,true);now+=60000;emitScene('active');t=o.render();assert.equal(t.props.paused,false);draw(t);assert.equal(o.host().model.animating,false,'restore is static, no catch-up');drain()
  now+=1000;o.props.samples=[40,50];t=o.render();assert.equal(o.host().model.animating,true);draw(t)
  o.props.running=false;o.render();o.close();assert.equal(timers.size,0);assert.equal(sceneListeners.size,0)
 })
 await test('TimelineCanvas has no appear/disappear gate (native disappear once froze detail charts): later real samples still animate while running; running=false parks',async()=>{
  const o=instance({samples:[10,20,30,40,50,60,70,80],tone:'#2dbf82',running:true,percent:true});let t=o.render();assert.equal(t.props.onAppear,undefined);assert.equal(t.props.onDisappear,undefined);draw(t);drain()
  const host=o.host(),model=host.model
  now+=1000;o.props.samples=[10,20,30,40,50,60,70,80,90];t=o.render();assert.equal(model.animating,true,'native disappear cannot disable animation');assert.equal(t.props.paused,false);assert.equal(host.ticking,true)
  const before=JSON.stringify(model.shown);now+=500;draw(t);assert.notEqual(JSON.stringify(model.shown),before);assert.ok(model.animating)
  now+=500;draw(t);assert.equal(model.shown.at(-1).y,90);drain();assert.equal(o.render().props.paused,true)
  now+=1000;o.props.samples=[10,20,30,40,50,60,70,80,95];t=o.render();assert.equal(t.props.paused,false);now+=300;draw(t)
  o.props.running=false;t=o.render();assert.equal(model.animating,false,'running=false stops interpolation');draw(t);drain();assert.equal(o.render().props.paused,true,'closed sheet/page final static draw then parks');assert.equal(host.ticking,false)
  o.close();assert.equal(timers.size,0)
 })
 await test('unmount before completion cancels queue, stale draw cannot set state; native TimelineCanvas',async()=>{
  const o=instance({samples:[1,2],tone:'#3485eb',running:true});const t=o.render();draw(t,0,0);assert.equal(timers.size,0,'data is not parked before a measurable final draw');draw(t);assert.equal(timers.size,1);o.close();const n=writes;drain();draw(t);assert.equal(writes,n);assert.equal(timers.size,0)
 })
 console.log(count+' native TimelineCanvas lifecycle groups passed; no native performance/pixel claim')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
