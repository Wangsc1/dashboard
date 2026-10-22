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
 await test('主页CPU与详情每核同输入同节奏：增长/满窗/重复值/不等间隔逐帧几何一致',async()=>{
  for(const length of [58,60]){
   const front=instance(home.GridPlot),detail=instance(home.GridPlot)
   let history=Array.from({length},(_,i)=>i%40)
   const frontProps=()=>nodes(home.CpuCard({history,running:true}),home.GridPlot)[0].props
   const detailProps=()=>home.SampledCpuPlot({samples:history,running:true}).props
   // Normalize only visual size/color; callers retain the same actual function and algorithm.
   const norm=p=>({...p,tone:'#3485eb',plotWidth:300,plotHeight:76})
   const compare=async()=>{const a=await front.draw(norm(frontProps())),b=await detail.draw(norm(detailProps()));assert.equal(a.type,b.type);assert.equal(a.props.code,b.props.code);return [a,b]}
   let pair=await compare();pair[0].props.onAppear();pair[1].props.onAppear();await compare()
   for(let cycle=0;cycle<8;cycle++){
    now+=[900,1100,950,1050][cycle%4];history=[...history,cycle%2?10:50].slice(-60);await compare()
    for(let f=0;f<20;f++){now+=50;for(const t of [...intervals.values()])t.fn();await compare()}
   }
   pair=await compare();pair[0].props.onDisappear();pair[1].props.onDisappear();await compare();assert.equal(active,0)
   front.close();detail.close();assert.equal(intervals.size,0)
  }
  const src=fs.readFileSync(path.join(root,'home-ui.tsx'),'utf8');assert.ok(!src.includes('stableSamples'));assert.ok(!src.includes('track.motion'));assert.ok(!src.includes('track.shown'))
 })
 await test('CPU/RAM等全部MetricNumber也逐采样显示，无补间timer',async()=>{
  const number=instance(home.MetricNumber)
  for(const running of [true,false])for(const [value,unit,digits] of [[0,'%',1],[87.5,'%',1],[599,' MB',0],[15.5,' GB',1],[undefined,'',0]]){
   const out=await number.draw({value,unit,digits,running});assert.equal(text(out),(value===undefined?'--':value.toFixed(digits))+unit);assert.equal(intervals.size,0)
  }number.close()
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
