// Diagnostic-only instrumentation: native UI and requests are mocked; no device access.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0].replace('AppearanceRoot, primeOverview };','AppearanceRoot, primeOverview, run, homeFailure };')
const checks=String.raw`
scripting.useState=function(v){const slots=hooks,i=hookIndex++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]}
function owner(fn){const state={hooks:[],cleanups:new Map()};return {render(props){const saved={hooks,cleanups,effects,hookIndex};hooks=state.hooks;cleanups=state.cleanups;effects=[];hookIndex=0;const tree=fn(props),queued=effects;hooks=saved.hooks;cleanups=saved.cleanups;effects=saved.effects;hookIndex=saved.hookIndex;queued.forEach(f=>{const previous=cleanups;cleanups=state.cleanups;f();cleanups=previous});return tree},close(){for(const f of state.cleanups.values())f();state.cleanups.clear()}}}
async function settle(){for(let i=0;i<120;i++)await Promise.resolve()}
for(const name of ['prefetchProxies','prefetchRules','prefetchConnections','prefetchMoreVersions'])pages[name]=()=>{}
const secret='private-canary-credential',url='https://private-canary-router.invalid',id='private-canary-id'
const router={id,name:'private-canary-name',kind:'openwrt',url,username:'private-canary-user'}
secrets.set('neko_secret_'+id,secret)
const sample={version:'private-canary-data',traffic:{up:9876543,down:7654321},upTotal:42,downTotal:43,connCount:123,wrt:{model:'private-canary-model',uptime:42,cpus:[],load:[]}}
function active(c){store.set('neko_controllers_v1',c?[c]:[]);if(c)store.set('neko_active_v1',c.id)}
const logs=()=>pref.getLogs().filter(x=>x.title.startsWith('主页诊断'))
const has=(stage,fragment='')=>logs().some(x=>x.detail.startsWith(stage+' ·')||x.detail===stage ? x.detail.includes(fragment):false)
const originalLoad=api.loadOverview
;(async()=>{
 await test('startup records presence/kind only, even without an active controller',async()=>{
  scripting.Navigation.present=async()=>{};scripting.Script={exit(){}}
  active(null);await app.run();assert.ok(has('launch','active=none'))
  active({...router,kind:'clash'});await app.run();assert.ok(has('launch','active=clash'))
  active(router);api.loadOverview=async()=>sample;await app.run();await settle();assert.ok(has('launch','active=openwrt'));assert.ok(has('prime-start'));assert.ok(has('prime-success','cache=1'))
 })
 await test('Root retry, pending state, delayed failure, recovery and cached home/UI are observable without changing requests',async()=>{
  const c={...router,id:id+'-retry'};active(c);let release,requests=0
  api.loadOverview=()=>{requests++;return new Promise((_,reject)=>release=()=>reject(Error('timeout '+secret+' '+url)))}
  const root=owner(app.Root);root.render({});await settle();assert.equal(requests,1);assert.ok(has('root-retry','pending=0'))
  for(const t of [...intervals.values()])t.fn();await settle();assert.equal(requests,1);assert.ok(has('root-retry','pending=1'))
  release();await settle();assert.ok(has('prime-failure','reason=timeout'))
  api.loadOverview=async()=>{requests++;return sample};for(const t of [...intervals.values()])t.fn();await settle();assert.equal(requests,3,'one failed attempt plus the successful two-sample warmup')
  const page=owner(app.OverviewPage),props={active:c,selected:false,version:0,onSwitch(){}}
  let tree=page.render(props);await settle();tree=page.render(props);await settle()
  assert.equal(nodes(tree,home.HomeDashboard)[0].props.overview,sample);assert.ok(has('home-mount','cache=1'));assert.ok(has('home-state','ov=1'));assert.ok(has('home-receive'));assert.ok(has('home-ui','ui=1'))
  page.render({...props,selected:true});await settle();assert.ok(has('home-state','selected=1'));assert.ok(has('sampling-reset'));assert.ok(has('refresh-success'))
  page.close();root.close();assert.equal(intervals.size,0)
 })
 await test('empty home and late prime delivery distinguish cache miss, notification and UI data use',async()=>{
  const c={...router,id:id+'-late'};let resolve;const delayed=new Promise(r=>resolve=r);api.loadOverview=()=>delayed
  const pending=app.primeOverview(c);const page=owner(app.OverviewPage),props={active:c,selected:false,version:0,onSwitch(){}}
  page.render(props);await settle();assert.ok(has('home-mount','cache=0'));assert.ok(has('home-ui','ui=0'))
  resolve(sample);await pending;await settle();page.render(props);await settle();assert.ok(has('home-ui','ov=1'));page.close()
 })
 await test('errors are predefined categories, not raw strings; epoch and stale-source discard are visible',async()=>{
  for(const [message,reason] of [['来源或采样代次已改变','epoch'],['ACCESS','auth'],['请求失败 HTTP 503','http'],['路由器未返回系统信息','response'],['unknown '+secret,'other']]){
   const c={...router,id:id+'-'+reason};api.loadOverview=async()=>{throw Error(message+'')};await app.primeOverview(c);assert.ok(has('prime-failure','reason='+reason))
  }
  let release;const c={...router,id:id+'-discard'};api.loadOverview=()=>new Promise(r=>release=r);const p=app.primeOverview(c);secrets.set('neko_secret_'+c.id,secret+'changed');release(sample);await p;assert.ok(has('prime-discard'))
 })
 await test('runtime allowlists reject injected identifiers/data, and repeated diagnostics are throttled before storage writes',()=>{
  const before=logs().length
  pref.recordEvent('homeDiagnostic',true,{home:{stage:secret,active:secret,reason:secret}});assert.equal(logs().length,before)
  const writes=context.Storage.set;let countWrites=0;context.Storage.set=(...args)=>{countWrites++;return writes(...args)}
  try{for(let i=0;i<50;i++)pref.recordEvent('homeDiagnostic',true,{home:{stage:'root-state',active:'none',selected:false,source:secret,address:url,reason:secret,ov:secret}});assert.equal(countWrites,1)
   now+=30001;pref.recordEvent('homeDiagnostic',true,{home:{stage:'root-state',active:'none',selected:false}});assert.equal(countWrites,2)
  }finally{context.Storage.set=writes}
  const text=pref.exportLogs();for(const value of [secret,url,id,router.name,router.username,sample.version,sample.wrt.model,'9876543','7654321','wrt-source-'])assert.ok(!text.includes(value),'private input must not enter exported logs: '+value)
  assert.ok(!JSON.stringify(logs()).includes(secret))
 })
 await test('diagnostic storage failure cannot prevent prime completion or change UI data delivery',async()=>{
  const c={...router,id:id+'-log-failure'};api.loadOverview=async()=>sample;const saved=context.Storage.set
  context.Storage.set=(key,value)=>{if(key==='dashboard_logs_v140')throw Error('storage unavailable');return saved(key,value)}
  try{await app.primeOverview(c);const page=owner(app.OverviewPage);const tree=page.render({active:c,selected:false,version:0,onSwitch(){}});assert.equal(nodes(tree,home.HomeDashboard)[0].props.overview,sample);await settle();page.close()}finally{context.Storage.set=saved}
 })
 api.loadOverview=originalLoad
 assert.equal(intervals.size,0);assert.equal(sceneListeners.size,0)
 console.log(count+' home diagnostic groups passed (mock lifecycle/IO; no real device claims)')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
