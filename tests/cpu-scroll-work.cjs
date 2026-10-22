// Executes real detail/plot hooks + shared timer, with isolated component hook slots.
// All native events are simulated; this does NOT measure iPhone bridge/rasterization/FPS.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
// Capture hook arrays in setters, so timer callbacks can update multiple mounted instances.
scripting.useState=function(v){const slots=hooks,i=hookIndex++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]}
function instance(fn){
 const state={hooks:[],cleanups:new Map()}
 return {async draw(props){
   const saved={hooks,cleanups,effects,hookIndex};hooks=state.hooks;cleanups=state.cleanups;effects=[];hookIndex=0
   let out=fn(props);await flush();hookIndex=0;effects=[];out=fn(props);await flush()
   hooks=saved.hooks;cleanups=saved.cleanups;effects=saved.effects;hookIndex=saved.hookIndex;return out
 },close(){for(const c of state.cleanups.values())c();state.cleanups.clear()}}
}
const scheduler=load('chart'),originalAnimate=scheduler.animateChart
let active=0,callbacks=0,pathBuilds=0
const originalPath=scheduler.smoothPath
scheduler.smoothPath=(...args)=>{pathBuilds++;return originalPath(...args)}
scheduler.animateChart=cb=>{
 active++;let live=true
 const stop=()=>{if(live){live=false;active--}}
 const cancel=originalAnimate(at=>{callbacks++;const more=cb(at);if(!more)stop();return more})
 return ()=>{stop();cancel()}
}
function propsFor(tree){return nodes(tree,home.CoreRow).flatMap(row=>nodes(home.CoreRow(row.props),home.CoreCard).map(c=>{
 const card=home.CoreCard(c.props),p=nodes(card,home.SampledCpuPlot)[0];assert.equal(nodes(card,home.MetricNumber).length,0)
 return home.SampledCpuPlot(p.props).props
}))}
function input(n,sample=0){const cpus=Array.from({length:n},(_,i)=>({id:'cpu'+i,usage:sample+i}));return {overview:{wrt:{cpus:[{id:'cpu'},...cpus],cpuMeta:{cpu0:{mhz:2000+sample}}}},histories:{cpu:Object.fromEntries(cpus.map(c=>[c.id,Array.from({length:60},(_,i)=>(i+sample)%80)]))},running:true}}
;(async()=>{
 await test('详情无额外可见ID闸门：采样直达所有核心，共用SVG出现/消失与页面running控制',async()=>{
  for(const cores of [16,32]){
   const page=instance(home.CpuDetails),plots=Array.from({length:cores},()=>instance(home.GridPlot));let props=input(cores)
   let tree=await page.draw(props);assert.equal(nodes(tree,'ScrollView')[0].props.onScrollTargetVisibilityChange,undefined)
   assert.equal(nodes(tree,'LazyVStack').length,1)
   let pp=propsFor(tree);assert.equal(pp.length,cores);assert.ok(pp.every(p=>p.running))
   for(let i=0;i<cores;i++){const svg=await plots[i].draw(pp[i]);if(i<4){svg.props.onAppear();await plots[i].draw(pp[i])}}
   now+=1000;props=input(cores,1);tree=await page.draw(props);pp=propsFor(tree)
   for(let i=0;i<cores;i++)await plots[i].draw(pp[i]);assert.equal(active,4)
   for(let frame=0;frame<20;frame++){now+=50;for(const t of [...intervals.values()])t.fn();for(let i=0;i<cores;i++)await plots[i].draw(pp[i])}
   assert.equal(active,0)
   now+=1000;props=input(cores,2);tree=await page.draw(props);pp=propsFor(tree);for(let i=0;i<cores;i++)await plots[i].draw(pp[i]);assert.equal(active,4)
   tree=await page.draw({...props,running:false});pp=propsFor(tree);for(let i=0;i<cores;i++)await plots[i].draw(pp[i]);assert.equal(active,0)
   assert.equal(nodes(tree,home.CoreRow).flatMap(r=>r.props.cpus).length,cores)
   for(const plot of plots)plot.close();page.close();assert.equal(intervals.size,0)
  }
 })
 await test('相同内容新数组：主页详情共用引用更新语义与平滑周期',async()=>{
  for(const stableSamples of [false,true]){
   const plot=instance(home.GridPlot);let p={samples:Array(60).fill(10),tone:'#2dbf82',running:true,percent:true,stableSamples}
   let tree=await plot.draw(p);tree.props.onAppear();tree=await plot.draw(p);const code=tree.props.code
   for(let j=0;j<3;j++){
    const beforePaths=pathBuilds
    now+=1000;p={...p,samples:[...p.samples]};tree=await plot.draw(p)
    assert.ok(pathBuilds>=beforePaths)
    assert.equal(active,1)
    // Both callers now share the same path.
    // Slow arrival can select the existing capped 1500ms duration (30 callbacks).
    for(let k=0;k<30;k++){now+=50;for(const t of [...intervals.values()])t.fn()}
    tree=await plot.draw(p);assert.equal(active,0)
   }
   now+=1000;p={...p,samples:[...p.samples.slice(1),40]};tree=await plot.draw(p);assert.equal(active,1)
   const start=tree.props.code;now+=500;for(const t of [...intervals.values()])t.fn();tree=await plot.draw(p);assert.notEqual(tree.props.code,start)
   tree.props.onDisappear();await plot.draw(p);assert.equal(active,0)
   plot.close();assert.equal(intervals.size,0)
  }
 })
 await test('主页running=false释放既有数字/曲线timer，无需改变主页架构',async()=>{
  const number=instance(home.MetricNumber);let p={value:10,running:true};await number.draw(p);now+=1000;p={...p,value:40};await number.draw(p);assert.equal([...intervals.values()].filter(t=>t.ms===16).length,0)
  await number.draw({...p,running:false});assert.equal(intervals.size,0);number.close()
  const plot=instance(home.GridPlot);p={samples:[10,20],tone:'#3485eb',running:true};let out=await plot.draw(p);out.props.onAppear();await plot.draw(p);now+=1000;p={...p,samples:[10,20,30]};await plot.draw(p);assert.equal(active,1)
  await plot.draw({...p,running:false});assert.equal(active,0);assert.equal(intervals.size,0);plot.close()
 })
 console.log(count+' dynamic CPU scroll-work groups passed; no native FPS claim')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
