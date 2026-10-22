// Actual GridPlot hooks under nonuniform arrivals. No native performance claim.
// CPU_COMPARE_REF=ed4825a executes the same assertions against old 170 source in memory.
const fs=require('node:fs'),vm=require('node:vm')
let harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
harness=harness.replace('const code = ts.transpileModule(source',`if(name==='home-ui'&&process.env.CPU_COMPARE_REF)source=require('node:child_process').execFileSync('git',['show',process.env.CPU_COMPARE_REF+':home-ui.tsx'],{cwd:root,encoding:'utf8'});\n  const code = ts.transpileModule(source`)
const checks=String.raw`
let setters=0
scripting.useState=function(v){const slots=hooks,i=hookIndex++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],v=>{setters++;slots[i]=typeof v==='function'?v(slots[i]):v}]}
function instance(fn){const state={hooks:[],cleanups:new Map()};return {async draw(props){
 const saved={hooks,cleanups,effects,hookIndex};hooks=state.hooks;cleanups=state.cleanups;effects=[];hookIndex=0
 let out=fn(props);await flush();hookIndex=0;effects=[];out=fn(props);await flush()
 hooks=saved.hooks;cleanups=saved.cleanups;effects=saved.effects;hookIndex=saved.hookIndex;return out
},close(){for(const c of state.cleanups.values())c();state.cleanups.clear()}}}
const chart=load('chart'),originalPath=chart.smoothPath,originalSubscribe=chart.animateChart
let frame=null,builds=0,active=0,starts=0,stops=0
chart.smoothPath=(points,height,scale,...rest)=>{builds++;frame={points:points.map(x=>({...x})),scale};return originalPath(points,height,scale,...rest)}
chart.animateChart=cb=>{starts++;active++;let live=true;const end=()=>{if(live){stops++;active--;live=false}};const cancel=originalSubscribe(at=>{const more=cb(at);if(!more)end();return more});return()=>{end();cancel()}}
const near=(a,b,label)=>assert.ok(Math.abs(a-b)<1e-7,label+': '+a+' vs '+b)
const same=(a,b)=>{near(a.scale,b.scale,'scale at arrival');assert.equal(a.points.length,b.points.length);a.points.forEach((p,i)=>{near(p.x,b.points[i].x,'x at arrival');near(p.value,b.points[i].value,'value at arrival')})}
function clock(plot,getProps){const fires=new Map();return async ms=>{
 const end=now+ms;let out
 while(true){for(const [id,t] of intervals)if(!fires.has(id))fires.set(id,now+t.ms)
  let next=Infinity;for(const [id,at] of fires)if(intervals.has(id))next=Math.min(next,at)
  if(next>end)break;now=next
  for(const [id,at] of [...fires])if(at===next&&intervals.has(id)){const t=intervals.get(id);fires.set(id,at+t.ms);t.fn()}
  const before=frame
  out=await plot.draw(getProps())
  assert.ok(frame.points.length<=61)
  if(before&&before.points.length===frame.points.length)frame.points.forEach((p,i)=>assert.ok(p.x<=before.points[i].x+1e-7,'within-window time-axis knots never move right'))
 }
 now=end;return await plot.draw(getProps())
}}
;(async()=>{
 await test('抖动/短突发到样：保留实际画面全部点位及量程，最多61几何点，最新60个真样本到终点',async()=>{
  for(const percent of [true,false])for(const length of [60,58]){
   const plot=instance(home.GridPlot);let samples=Array.from({length},(_,i)=>percent?(i*7)%90:1000+i*100),props={samples,tone:'#2dbf82',percent,stableSamples:true,running:true,plotWidth:295,plotHeight:76}
   let out=await plot.draw(props);out.props.onAppear();await plot.draw(props);const advance=clock(plot,()=>props)
   now+=1000;samples=[...samples,percent?20:20000].slice(-60);props={...props,samples};out=await plot.draw(props)
   let maxJump=0,maxKnots=0;const trace=[]
   const deltas=[900,1100,950,1050,900,1100,950,1050,100,150,50,25,75,200,...Array(80).fill(25)]
   for(const [cycle,delta] of deltas.entries()){
    out=await advance(delta);const before=frame,wasActive=active>0,beforeCode=out.props.code,beforeSetters=setters,beforeBuilds=builds
    samples=[...samples,(percent?(cycle*13+40)%100:30000+cycle*1700)].slice(-60);props={...props,samples};out=await plot.draw(props)
    const after=frame
    if(wasActive){if(process.env.CPU_COMPARE_REF)console.log(JSON.stringify({oldRef:process.env.CPU_COMPARE_REF,deltaMs:delta,tipBefore:before.points.at(-1).value,tipAfter:after.points.at(-1).value,scaleBefore:before.scale,scaleAfter:after.scale}));maxJump=Math.max(maxJump,Math.abs(before.points.at(-1).value-after.points.at(-1).value));near(before.points.at(-1).value,after.points.at(-1).value,'tip at arrival');same(before,after);assert.equal(out.props.code,beforeCode,'unfinished-frame SVG is byte-identical at retarget p0');assert.equal(builds,beforeBuilds,'identical p0 reuses the last generated SVG, no redundant path build')}
    else {assert.ok(after.points.every(p=>p.x>=0),'completed frame rebases only clipped outgoing geometry')}
    assert.equal(setters,beforeSetters,'detail sample p0 requires no extra setTick')
    maxKnots=Math.max(maxKnots,after.points.length);assert.ok(after.points.length<=61);assert.ok(after.points.every((p,i,a)=>i===0||p.x>=a[i-1].x))
    const b=builds,s=starts,z=stops;props={...props,samples:[...samples]};await plot.draw(props)
    assert.equal(builds,b);assert.equal(starts,s);assert.equal(stops,z,'same history cannot cancel or restart')
    if(cycle<8)trace.push({deltaMs:delta,tipBefore:before.points.at(-1).value,tipAfter:after.points.at(-1).value})
   }
   out=await advance(1200);assert.equal(active,0);assert.equal(intervals.size,0)
   const expected=chart.scrollPoints(samples,samples,0,295),actual=frame.points.filter(p=>p.x>=0)
   assert.equal(actual.length,expected.length);actual.forEach((p,i)=>{near(p.x,expected[i].x,'final time axis');near(p.value,expected[i].value,'final real sample')})
   near(frame.scale,percent?100:Math.max(1024,...samples),'final scale')
   const b=builds,s=setters;await advance(1000);assert.equal(builds,b);assert.equal(setters,s,'completed window never keeps setting ticks')
   console.log(JSON.stringify({percent,initialLength:length,arrivals:deltas.length,maxJump,maxKnots,trace}))
   plot.close();assert.equal(intervals.size,0)
  }
 })
 await test('暂停/屏外期间仍接受最新数据，无订阅；恢复不重放旧动画，卸载全部释放',async()=>{
  const plot=instance(home.GridPlot);let props={samples:Array.from({length:60},(_,i)=>i),tone:'#2dbf82',percent:true,stableSamples:true,running:true,plotWidth:295,plotHeight:76}
  let out=await plot.draw(props);out.props.onAppear();await plot.draw(props);const advance=clock(plot,()=>props)
  for(const mode of ['paused','offscreen']){
   now+=1000;props={...props,samples:[...props.samples.slice(1),70]};out=await plot.draw(props);await advance(150);assert.equal(active,1)
   if(mode==='paused')props={...props,running:false};else out.props.onDisappear()
   out=await plot.draw(props);assert.equal(active,0)
   props={...props,samples:[...props.samples.slice(1),91]};out=await plot.draw(props);assert.equal(active,0);near(frame.points.at(-1).value,91,'offscreen uses newest sample')
   if(mode==='paused')props={...props,running:true};else out.props.onAppear()
   out=await plot.draw(props);assert.equal(active,0);near(frame.points.at(-1).value,91,'resume is current, no stale replay')
  }
  props={...props,samples:[...props.samples.slice(1),92]};await plot.draw(props);assert.equal(active,1);plot.close();assert.equal(active,0);assert.equal(intervals.size,0)
 })
 await test('空历史建立基线及合并到样增长：不访问空起点，58到60点不漏中间真实样本',async()=>{
  const plot=instance(home.GridPlot);let props={samples:[],tone:'#2dbf82',percent:true,stableSamples:true,running:true,plotWidth:295,plotHeight:76}
  let out=await plot.draw(props);out.props.onAppear();await plot.draw(props);const advance=clock(plot,()=>props)
  for(const length of [2,58,60]){
   props={...props,samples:Array.from({length},(_,i)=>i)};await plot.draw(props);await advance(1200)
   const actual=frame.points.filter(p=>p.x>=0);assert.equal(actual.length,length)
   actual.forEach((p,i)=>{near(p.value,i,'all real samples present');near(p.x,(60-length+i)*5,'right aligned history')});assert.equal(active,0)
  }
  plot.close();assert.equal(intervals.size,0)
 })
 console.log(count+' arrival-retarget dynamic groups passed; no iPhone smoothness claim')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
