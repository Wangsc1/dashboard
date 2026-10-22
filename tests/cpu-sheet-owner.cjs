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
 console.log(count+' mounted sheet data-flow groups passed; not a native remount/FPS measurement')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
