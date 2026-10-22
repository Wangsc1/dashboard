// Real API requests with delayed response; home stays unmounted like a lazy native tab.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
scripting.useState=function(v){const slots=hooks,i=hookIndex++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]}
function owner(fn){const state={hooks:[],cleanups:new Map()};return {render(props){const saved={hooks,cleanups,effects,hookIndex};hooks=state.hooks;cleanups=state.cleanups;effects=[];hookIndex=0;const tree=fn(props),queued=effects;hooks=saved.hooks;cleanups=saved.cleanups;effects=saved.effects;hookIndex=saved.hookIndex;queued.forEach(f=>{const previous=cleanups;cleanups=state.cleanups;f();cleanups=previous});return tree},close(){for(const f of state.cleanups.values())f();state.cleanups.clear()}}}
async function settle(){for(let i=0;i<120;i++)await Promise.resolve()}
for(const name of ['prefetchProxies','prefetchRules','prefetchConnections','prefetchMoreVersions'])pages[name]=()=>{}
pref.savePreferences({defaultPage:'more'})
let batches=0
responder=(_url,init)=>{if(_url.includes('cgi-download'))return {status:403};const q=JSON.parse(init.body),[,obj,method,args]=q.params;let value={};if(obj==='session')value={ubus_rpc_session:'recovery-session'};if(obj==='system'&&method==='info'){batches++;value={uptime:42,load:[0,0,0],memory:{total:100,free:50}}}if(obj==='system'&&method==='board')value={model:'Recovery board',release:{description:'Fixture'}};if(obj==='file'&&args.path==='/proc/stat')value={data:'cpu 1 0 1 8 0 0 0 0\ncpu0 1 0 1 8 0 0 0 0\n'};return {body:{id:q.id,result:[0,value]}}}
const device=id=>({id,name:id,kind:'openwrt',url:'http://'+id+'.invalid',username:'root'})
function active(c){store.set('neko_controllers_v1',c?[c]:[]);if(c)store.set('neko_active_v1',c.id)}
function frame(tree){return nodes(tree,home.HomeDashboard)[0].props}
async function tick(){for(const timer of [...intervals.values()])await timer.fn();await settle()}
;(async()=>{
 await test('delayed launch failure is retried by Root without mounting home; first home frame is cached',async()=>{
  const c=device('lazy-home-recovery');active(c)
  const original=context.fetch;let release;const wait=new Promise(r=>release=r);let first=true
  context.fetch=async(url,init)=>{if(first&&init.body.startsWith('[')){first=false;await wait;throw Error('temporary launch failure')}return original(url,init)}
  app.primeOverview(c);await settle()
  const root=owner(app.Root);root.render({});await settle();release();await settle()
  await tick();assert.ok(batches>0,'Root must retry failed launch while home is unmounted')
  const homePage=owner(app.OverviewPage);const tree=homePage.render({active:c,version:0,selected:false,onSwitch(){}})
  assert.equal(frame(tree).overview.wrt.model,'Recovery board','first native home frame uses successful retry')
  await settle();const reads=batches;await tick();assert.equal(batches,reads,'successful hidden prime does not keep polling')
  homePage.close();root.close();context.fetch=original;assert.equal(intervals.size,0);assert.equal(sceneListeners.size,0)
 })
 await test('active becoming available after launch primes home; background pauses retry and resume recovers',async()=>{
  active(null);app.primeOverview(api.getActive());const root=owner(app.Root);root.render({});await settle()
  const c=device('late-active-home');active(c)
  const original=context.fetch;let fail=true
  context.fetch=async(url,init)=>{if(fail&&init.body.startsWith('['))throw Error('temporary unavailable');return original(url,init)}
  root.render({});await settle();const reads=batches
  emitScene('background');root.render({});await settle();fail=false;await tick();assert.equal(batches,reads,'no background retries')
  emitScene('active');root.render({});await settle();assert.ok(batches>reads,'resume retries without visiting home')
  const page=owner(app.OverviewPage);assert.equal(frame(page.render({active:c,version:0,selected:false,onSwitch(){}})).overview.wrt.model,'Recovery board')
  await settle();page.close();root.close();context.fetch=original;assert.equal(intervals.size,0);assert.equal(sceneListeners.size,0)
 })
 await test('sampling reset discards delayed prime but Root retries instead of leaving an empty lazy home',async()=>{
  const c=device('reset-delayed-prime');active(c)
  const original=context.fetch;let release;const wait=new Promise(r=>release=r);let first=true
  context.fetch=async(url,init)=>{const response=await original(url,init);if(first&&init.body.startsWith('[')){first=false;await wait}return response}
  app.primeOverview(c);await settle();const root=owner(app.Root);root.render({});await settle()
  api.resetOverviewSampling(c);release();await settle();const reads=batches
  await tick();assert.equal(batches,reads+2,'invalidated launch must warm a fresh two-sample epoch')
  const page=owner(app.OverviewPage);assert.equal(frame(page.render({active:c,version:0,selected:false,onSwitch(){}})).overview.wrt.model,'Recovery board')
  await settle();page.close();root.close();context.fetch=original;assert.equal(intervals.size,0);assert.equal(sceneListeners.size,0)
 })
 await test('same-id URL and authentication changes get independent home caches while old response is delayed',async()=>{
  const c=device('switch-delayed-prime');active(c)
  const original=context.fetch;let release;const wait=new Promise(r=>release=r)
  context.fetch=async(url,init)=>{const response=await original(url,init);if(url===c.url+'/ubus'&&init.body.startsWith('['))await wait;return response}
  app.primeOverview(c);await settle();const root=owner(app.Root);root.render({});await settle()
  const next={...c,url:'http://new-prime-source.invalid'};active(next);root.render({});await settle()
  const oldKey=api.overviewSource(next);secrets.set('neko_secret_'+c.id,'private-test-auth');root.render({});await settle();assert.notEqual(api.overviewSource(next),oldKey)
  release();await settle();const reads=batches;await tick();assert.equal(batches,reads)
  const page=owner(app.OverviewPage);assert.equal(frame(page.render({active:next,version:0,selected:false,onSwitch(){}})).overview.wrt.model,'Recovery board')
  await settle();page.close();root.close();context.fetch=original;assert.equal(intervals.size,0);assert.equal(sceneListeners.size,0)
 })
 console.log(count+' home prime recovery groups passed (mock IO/native lifecycle, not device)')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
