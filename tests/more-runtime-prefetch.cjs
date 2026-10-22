// More runtime prefetch contract; API/native IO mocked.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
;(async()=>{
 const originalRuntime=api.loadNikkiRuntime,originalVersions=api.loadRuntimeVersions
 let reads=0,release;const wait=new Promise(r=>release=r)
 api.loadRuntimeVersions=async()=>({core:'v-test',app:'p-test',failed:false})
 api.loadNikkiRuntime=async(c,onUpdate)=>{reads++;await wait;const value={coreSeconds:120,serviceSeconds:3600,measuredAt:now,running:true};onUpdate?.(value);return value}
 try{
  const c={id:'runtime-prefetch',name:'test',kind:'openwrt',plugin:'nikki',url:'http://runtime-prefetch.invalid',auto:true,cport:9090}
  pages.prefetchMoreVersions(c);pages.prefetchMoreVersions(c);await flush();assert.equal(reads,1)
  release();for(let i=0;i<4;i++)await flush()
  now+=5000
  const tree=render(pages.MorePage,{active:c,selected:false,onChanged(){}},true)
  assert.ok(text(tree).includes('v-test'));assert.ok(text(tree).includes('p-test'))
  const src=fs.readFileSync(root+'/dashboard-pages.tsx','utf8');assert.ok(src.includes('cachedVersions?.runtime??null'))
  // The same elapsed-time formatter used by the live page is applied to the prefetched measurement.
  assert.ok(text(tree).includes(api.fmtUptime(125,true)),text(tree))
  assert.ok(text(tree).includes(api.fmtUptime(3605,true)),text(tree))
  const other=render(pages.MorePage,{active:{...c,id:'other',url:'http://other.invalid'},selected:false,onChanged(){}},true)
  assert.ok(!text(other).includes('v-test'))
  const cpu=home.CpuCard({history:[],running:false})
  const badge=nodes(cpu,'Text').find(n=>text(n)==='-- °C')
  assert.equal(badge.props.background.props.fill.light,'#d6e8ff');assert.equal(badge.props.background.props.fill.dark,'#24374d')
  console.log('PASS runtime prefetch, first-frame elapsed durations, source isolation; temperature badge light contrast and preserved dark colour')
 }finally{unmount();api.loadNikkiRuntime=originalRuntime;api.loadRuntimeVersions=originalVersions}
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
