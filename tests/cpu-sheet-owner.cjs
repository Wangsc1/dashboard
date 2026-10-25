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
 await test('固定详情owner内部订阅最新帧，原始数据不冻结，关闭/卸载退订',async()=>{
  const listeners=new Set(),frame=(n,running=true)=>({overview:{wrt:{cpus:[{id:'cpu',usage:n}]}},histories:{cpu:{cpu:[n]},down:[],up:[]},running})
  const feed={value:frame(0),subscribe(fn){listeners.add(fn)},unsubscribe(fn){listeners.delete(fn)}}
  const page=instance(home.LiveCpuDetails),props={feed};let out=await page.draw(props);assert.equal(listeners.size,1)
  for(let i=1;i<=8;i++){
   const old=feed.value;feed.value=frame(i);for(const cb of listeners)cb(feed.value,old)
   out=await page.draw(props);assert.equal(out.type,home.CpuDetails);assert.equal(out.props.histories,feed.value.histories);assert.equal(out.props.overview,feed.value.overview);assert.equal(out.props.running,true);assert.equal(listeners.size,1)
  }
  const old=feed.value;feed.value=frame(9,false);for(const cb of listeners)cb(feed.value,old);out=await page.draw(props);assert.equal(out.props.running,false)
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
 console.log(count+' mounted sheet data-flow groups passed; not a native remount/FPS measurement')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
