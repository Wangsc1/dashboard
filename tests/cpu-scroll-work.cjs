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
 await test('16/32核最坏lazy预取：可见集合把订阅32/16降到4，滚离取消，采集值继续更新',async()=>{
  for(const countCores of [16,32])for(const gated of [false,true]){
   const page=instance(home.CpuDetails),plots=Array.from({length:countCores},()=>instance(home.GridPlot));let props=input(countCores)
   let tree=await page.draw(props),scroll=nodes(tree,'ScrollView')[0]
   assert.equal(nodes(tree,'LazyVStack')[0].props.scrollTargetLayout,true)
   assert.equal(scroll.props.onScrollTargetVisibilityChange.idType,'string');assert.equal(scroll.props.onScrollTargetVisibilityChange.threshold,0.1)
   if(gated){scroll.props.onScrollTargetVisibilityChange.onChanged(['core-cpu0','core-cpu2']);tree=await page.draw(props)}
   assert.equal(nodes(tree,home.DetailCpuSummary)[0].props.running,!gated,'summary obeys native visible ids too')
   assert.equal(nodes(home.CoreRow(nodes(tree,home.CoreRow)[0].props),'HStack')[0].props.key,'core-cpu0','native root carries target id')
   let pp=propsFor(tree)
   // Deliberately report EVERY prefetched SVG appeared, even though only two rows are visible.
   for(let i=0;i<plots.length;i++){const p=await plots[i].draw(pp[i]);p.props.onAppear();await plots[i].draw(pp[i])}
   assert.equal(active,0)
   now+=1000;props=input(countCores,1);tree=await page.draw(props);pp=propsFor(tree)
   for(let i=0;i<plots.length;i++)await plots[i].draw(pp[i])
   const subscribed=gated?4:countCores;assert.equal(active,subscribed);assert.equal(intervals.size,1)
   const startCallbacks=callbacks,startPaths=pathBuilds
   for(let j=0;j<20;j++){
    now+=50;for(const t of [...intervals.values()])t.fn()
    for(let i=0;i<plots.length;i++)await plots[i].draw(pp[i])
   }
   assert.equal(pathBuilds-startPaths,subscribed*20)
   assert.equal(callbacks-startCallbacks,subscribed*20);assert.equal(active,0);assert.equal(intervals.size,0)
   console.log(JSON.stringify({cores:countCores,preciseVisibility:gated,activeInterpolationSubscriptions:subscribed,oneSecondPlotCallbacks:callbacks-startCallbacks,oneSecondDynamicPathBuilds:pathBuilds-startPaths,expiryMs:1000}))
   // Start a new window, then a native scroll event removes all core rows from viewport.
   now+=1000;props=input(countCores,2);tree=await page.draw(props);pp=propsFor(tree)
   for(let i=0;i<plots.length;i++)await plots[i].draw(pp[i]);assert.equal(active,subscribed)
   scroll.props.onScrollTargetVisibilityChange.onChanged([]);tree=await page.draw(props);pp=propsFor(tree)
   for(let i=0;i<plots.length;i++)await plots[i].draw(pp[i]);assert.equal(active,0);assert.equal(intervals.size,0)
   // All cards and latest metadata/history remain available while animation is gated off.
   now+=1000;props=input(countCores,3);tree=await page.draw(props)
   const rows=nodes(tree,home.CoreRow);assert.equal(rows.flatMap(r=>r.props.cpus).length,countCores)
   const first=nodes(home.CoreRow(rows[0].props),home.CoreCard)[0];assert.equal(first.props.cpu.usage,3);assert.equal(first.props.w.cpuMeta.cpu0.mhz,2003);assert.equal(first.props.history.at(-1),62)
   scroll.props.onScrollTargetVisibilityChange.onChanged(['core-cpu0','summary']);tree=await page.draw(props);pp=propsFor(tree)
   assert.equal(nodes(tree,home.DetailCpuSummary)[0].props.running,true)
   for(let i=0;i<plots.length;i++)await plots[i].draw(pp[i]);assert.equal(active,0,'re-entry snaps to latest, no stale replay')
   now+=1000;props=input(countCores,4);tree=await page.draw(props);pp=propsFor(tree)
   for(let i=0;i<plots.length;i++)await plots[i].draw(pp[i]);assert.equal(active,2,'smooth interpolation resumes on next genuine sample')
   for(const p of plots)p.close();page.close();assert.equal(active,0);assert.equal(intervals.size,0)
  }
 })
 await test('相同内容新数组：详情静止曲线0订阅，变化仍20fps平滑，到期立即停止；主页保持旧语义',async()=>{
  for(const stableSamples of [false,true]){
   const plot=instance(home.GridPlot);let p={samples:Array(60).fill(10),tone:'#2dbf82',running:true,percent:true,stableSamples}
   let tree=await plot.draw(p);tree.props.onAppear();tree=await plot.draw(p);const code=tree.props.code
   for(let j=0;j<3;j++){
    const beforePaths=pathBuilds
    now+=1000;p={...p,samples:[...p.samples]};tree=await plot.draw(p)
    if(stableSamples)assert.equal(pathBuilds,beforePaths,'identical samples do not rebuild path')
    assert.equal(active,stableSamples?0:1)
    if(stableSamples)assert.equal(tree.props.code,code)
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
  const number=instance(home.MetricNumber);let p={value:10,running:true};await number.draw(p);now+=1000;p={...p,value:40};await number.draw(p);assert.equal([...intervals.values()].filter(t=>t.ms===16).length,1)
  await number.draw({...p,running:false});assert.equal(intervals.size,0);number.close()
  const plot=instance(home.GridPlot);p={samples:[10,20],tone:'#3485eb',running:true};let out=await plot.draw(p);out.props.onAppear();await plot.draw(p);now+=1000;p={...p,samples:[10,20,30]};await plot.draw(p);assert.equal(active,1)
  await plot.draw({...p,running:false});assert.equal(active,0);assert.equal(intervals.size,0);plot.close()
 })
 console.log(count+' dynamic CPU scroll-work groups passed; no native FPS claim')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
