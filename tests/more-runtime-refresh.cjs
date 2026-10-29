// Native/API mocked: partial runtime responses must not blank the last completed sample.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
;(async()=>{
 const original=api.loadNikkiRuntime,versions=api.loadRuntimeVersions,config=api.loadConfig
 const c={id:'runtime-refresh',name:'runtime-refresh',kind:'openwrt',plugin:'nikki',url:'http://runtime-refresh.invalid',auto:true,cport:9090}
 let release,phase='initial'
 api.loadRuntimeVersions=async()=>({core:'v1',app:'p1',failed:false});api.loadConfig=async()=>({mode:'rule'})
 api.loadNikkiRuntime=async(c,onUpdate)=>{
  if(phase==='initial')return {coreSeconds:120,serviceSeconds:3600,measuredAt:now,running:true}
  onUpdate?.({coreSeconds:null,serviceSeconds:3610,measuredAt:now,running:true})
  return new Promise(r=>{release=r})
 }
 const coreText=t=>text(nodes(t,'HStack').find(n=>text(n).includes('内核版本')&&text(n).includes('运行时间')))
 try{
  pages.prefetchMoreVersions(c);await flush();phase='refresh'
  let tree=render(pages.MorePage,{active:c,selected:true,onChanged(){}},true);await flush()
  tree=render(pages.MorePage,{active:c,selected:true,onChanged(){}})
  assert.ok(!coreText(tree).includes('未提供'),'intermediate core=null must not blank known runtime')
  assert.ok(coreText(tree).includes(api.fmtUptime(120,true)))
  release({coreSeconds:130,serviceSeconds:3610,measuredAt:now,running:true});await flush()
  tree=render(pages.MorePage,{active:c,selected:true,onChanged(){}})
  assert.ok(coreText(tree).includes(api.fmtUptime(130,true)))
  assert.ok(text(tree).includes('Nikki 服务（运行时间：'+api.fmtUptime(3610,true)+'）'))
  // Refresh failures preserve the last known value, but a completed stopped result is authoritative.
  const poll=[...intervals.values()].find(x=>x.ms===30000)
  api.loadNikkiRuntime=async()=>{throw Error('unavailable')};await poll.fn();await flush()
  tree=render(pages.MorePage,{active:c,selected:true,onChanged(){}});assert.ok(coreText(tree).includes(api.fmtUptime(130,true)))
  api.loadNikkiRuntime=async()=>({coreSeconds:null,serviceSeconds:null,measuredAt:now,running:false});await poll.fn();await flush()
  tree=render(pages.MorePage,{active:c,selected:true,onChanged(){}});assert.ok(coreText(tree).includes('未运行'))
  assert.ok(text(tree).includes('Nikki 服务 · 未运行'));assert.ok(!text(tree).includes('Nikki 服务（运行时间：未运行）'))
  api.loadNikkiRuntime=async()=>({coreSeconds:null,serviceSeconds:null,measuredAt:now,running:null});await poll.fn();await flush()
  tree=render(pages.MorePage,{active:c,selected:true,onChanged(){}})
  assert.ok(text(tree).includes('Nikki 服务（运行时间：未提供）'));assert.ok(!text(tree).includes('未运行'))
  // A late stopped sample from the old source cannot label the new source as stopped.
  let finishOld
  api.loadNikkiRuntime=async()=>new Promise(r=>{finishOld=r})
  const pending=poll.fn();await flush()
  const other={...c,id:'runtime-other',url:'http://runtime-other.invalid'}
  api.loadNikkiRuntime=async()=>({coreSeconds:null,serviceSeconds:null,measuredAt:now,running:null})
  render(pages.MorePage,{active:other,selected:true,onChanged(){}});await flush()
  finishOld({coreSeconds:null,serviceSeconds:null,measuredAt:now,running:false});await pending;await flush()
  tree=render(pages.MorePage,{active:other,selected:true,onChanged(){}})
  assert.ok(text(tree).includes('Nikki 服务（运行时间：未提供）'));assert.ok(!text(tree).includes('未运行'))
  console.log('PASS runtime refresh preserves durations; confirmed stop labels plugin stopped; unknown and late other-source stop never fake stopped')
 }finally{unmount();api.loadNikkiRuntime=original;api.loadRuntimeVersions=versions;api.loadConfig=config}
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
