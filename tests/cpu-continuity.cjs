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
const chart=load('chart'),origPath=chart.smoothPath,origSubscribe=chart.animateChart
let points=[],starts=0,stops=0,active=0
chart.smoothPath=(p,...rest)=>{points=p.map(x=>({...x}));return origPath(p,...rest)}
chart.animateChart=cb=>{starts++;active++;let live=true;const end=()=>{if(live){live=false;stops++;active--}};const cancel=origSubscribe(at=>{const more=cb(at);if(!more)end();return more});return()=>{end();cancel()}}
const tick=async(plot,props,ms=50)=>{now+=ms;for(const t of [...intervals.values()])t.fn();return plot.draw(props)}
const near=(a,b,msg)=>assert.ok(Math.abs(a-b)<0.00001,msg+': '+a+' vs '+b)
;(async()=>{
 await test('相同满窗数个周期后变化：下一秒到终点，后续样本p0不跳到尚未显示的目标',async()=>{
  const plot=instance(home.GridPlot);let props={samples:Array(60).fill(0),tone:'#2dbf82',percent:true,plotWidth:295,plotHeight:76,stableSamples:true,running:true}
  let out=await plot.draw(props);out.props.onAppear();await plot.draw(props)
  for(let cycle=0;cycle<3;cycle++){now+=1000;props={...props,samples:[...props.samples]};await plot.draw(props);assert.equal(active,0)}
  now+=1000;props={...props,samples:[...props.samples.slice(1),40]};await plot.draw(props);assert.equal(active,1)
  for(let f=0;f<20;f++)await tick(plot,props)
  const tip=points.at(-1).value
  props={...props,samples:[...props.samples.slice(1),60]};await plot.draw(props)
  console.log(JSON.stringify({case:'after-equal-history',tipAt1000ms:tip,nextSampleP0:points.at(-1).value,starts,stops}))
  near(tip,40,'detail must finish ordinary 1s sample window, not stretch to 1500ms after dedupe')
  near(points.at(-1).value,tip,'next p0 equals preceding endpoint')
  plot.close();assert.equal(active,0)
 })
 await test('16/32核多个周期：同集合重复/换序/轻微滚动/父级同内容新数组不重启；58到满60窗连续',async()=>{
  for(const cores of [16,32]){
   const page=instance(home.CpuDetails),plot=instance(home.GridPlot)
   let history=Array.from({length:58},(_,i)=>i%40),input={overview:{wrt:{cpus:[{id:'cpu'},...Array.from({length:cores},(_,i)=>({id:'cpu'+i,usage:i}))]}},histories:{cpu:{cpu0:history}},running:true}
   let tree=await page.draw(input),event=nodes(tree,'ScrollView')[0].props.onScrollTargetVisibilityChange.onChanged
   event(['core-cpu0','core-cpu2']);tree=await page.draw(input)
   const coreProps=()=>{const row=nodes(tree,home.CoreRow)[0],card=nodes(home.CoreRow(row.props),home.CoreCard)[0];return home.SampledCpuPlot(nodes(home.CoreCard(card.props),home.SampledCpuPlot)[0].props).props}
   let p=coreProps(),out=await plot.draw(p);out.props.onAppear();await plot.draw(p)
   const beforeStarts=starts,beforeStops=stops;let previousEnd=null,maxBoundaryDelta=0,frames=0
   now+=1000
   for(let cycle=0;cycle<8;cycle++){
    history=[...history,30+cycle*3].slice(-60);input={...input,histories:{cpu:{cpu0:history}}};tree=await page.draw(input);p=coreProps();await plot.draw(p)
    assert.equal(active,1)
    if(previousEnd){const begin=points.slice(0,-1),end=previousEnd.filter(x=>x.x>=0);assert.equal(begin.length,end.length)
     for(let i=0;i<begin.length;i++){near(begin[i].x,end[i].x,'boundary x');near(begin[i].value,end[i].value,'boundary value');maxBoundaryDelta=Math.max(maxBoundaryDelta,Math.abs(begin[i].value-end[i].value))}}
    const origin=points.map(x=>({...x})),tip=origin.at(-1).value,startX=origin[0].x,target=history.at(-1),started=starts,stopped=stops
    for(let frame=1;frame<=20;frame++){
     out=await tick(plot,p);frames++
     near(points.at(-1).value,tip+(target-tip)*frame/20,'linear tip progression')
     near(points[0].x,startX-(p.plotWidth/59)*frame/20,'continuous one-cell horizontal motion')
     if(frame===5||frame===10||frame===15){
      event(frame===5?['core-cpu2','core-cpu0']:frame===10?['core-cpu0','core-cpu2']:['core-cpu0','core-cpu4'])
      // Parent render replaces the arrays but not the actual data.
      input={...input,histories:{cpu:{cpu0:[...history]}}};tree=await page.draw(input);p=coreProps();await plot.draw(p)
      out.props.onAppear();await plot.draw(p)
      assert.equal(starts,started);assert.equal(stops,stopped,'same visible row cannot cancel subscription mid-window')
     }
    }
    previousEnd=points.map(x=>({...x}));assert.equal(active,0)
   }
   assert.equal(starts-beforeStarts,8);assert.equal(stops-beforeStops,8)
   // A true empty native viewport set does pause; it is not evidence that the host emits it spuriously.
   history=[...history.slice(1),80];input={...input,histories:{cpu:{cpu0:history}}};tree=await page.draw(input);p=coreProps();await plot.draw(p);assert.equal(active,1)
   event([]);tree=await page.draw(input);p=coreProps();await plot.draw(p);assert.equal(active,0)
   now+=1000;history=[...history.slice(1),90];input={...input,histories:{cpu:{cpu0:history}}};tree=await page.draw(input);p=coreProps();await plot.draw(p);assert.equal(active,0)
   assert.equal(nodes(tree,home.CoreRow).flatMap(r=>r.props.cpus).length,cores)
   event(['core-cpu0']);tree=await page.draw(input);p=coreProps();await plot.draw(p);near(points.at(-1).value,90,'re-entry latest value, no stale replay')
   console.log(JSON.stringify({cores,cycles:8,frames,maxBoundaryDelta,subscriptionsStarted:8,subscriptionsExpired:8,offscreenActive:active}))
   plot.close();page.close();assert.equal(intervals.size,0)
  }
 })
 await test('上传/下载速率逐采样显示真实格式化值，不产生16ms数字timer；曲线样本/开关不变',async()=>{
  for(const heading of ['上传','下载']){
   const number=instance(home.MetricNumber),plot=instance(home.GridPlot);let history=[10,20],curve=null
   for(const rate of [undefined,0,31,1024,123456,3*1024**2,7*1024]){
    history=[...history,rate??0]
    const card=home.TrafficCard({heading,rate,total:5000,history,tone:'#2dbf82',running:true}),n=nodes(card,home.MetricNumber)[0],g=nodes(card,home.GridPlot)[0]
    assert.equal(n.props.running,false);assert.equal(g.props.running,true);assert.equal(g.props.samples,history)
    const parts=rate===undefined?null:api.fmtSpeed(rate).split(' '),v=parts?Number(parts[0]):undefined,expected=parts?v.toFixed(v<100?1:0)+' '+parts.slice(1).join(' '):'--'
    now+=1000;const displayed=await number.draw(n.props);assert.equal(text(displayed),expected)
    assert.equal([...intervals.values()].filter(t=>t.ms===16).length,0)
    curve=await plot.draw(g.props);curve.props.onAppear();await plot.draw(g.props)
    for(let i=0;i<5;i++){now+=50;for(const t of [...intervals.values()])t.fn();assert.equal(text(await number.draw(n.props)),expected)}
   }
   number.close();plot.close();assert.equal(intervals.size,0)
  }
 })
 console.log(count+' multi-cycle CPU continuity groups passed; no device smoothness claim')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
