// Focused regressions. All IO and clocks are mocked; no router/network access.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
let harness = fs.readFileSync(path.join(__dirname, 'run.cjs'), 'utf8').split(';(async () => {')[0]
harness = harness.replace('export { EditController,', 'export { WrtInterfacesPage, WrtLeasesPage, EditController,')
harness = harness.replace("if (name === 'settings-ui')", "if (name === 'dashboard-pages') source += '\\nexport { updateAllProviders };';\n  if (name === 'settings-ui')")
const checks = String.raw`
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}}
async function settle(){for(let i=0;i<8;i++)await flush()}
const failures=[]
async function check(name,fn){try{await test(name,fn)}catch(e){failures.push(name);console.error('FAIL',name,e.message)}finally{unmount()}}
const c={id:'optimization-mock',kind:'openwrt',name:'Mock',url:'http://optimization.invalid',username:'root'}
;(async()=>{
  for(const [component,loader,ms,value] of [[app.WrtInterfacesPage,'loadWrtInterfaces',5000,{name:'mock-iface',up:true}],[app.WrtLeasesPage,'loadWrtLeases',10000,{host:'mock-host',mac:'mock-mac',ip:'192.0.2.1'}]]){
    await check(loader+' serializes slow polls and ignores completion after unmount',async()=>{
      const original=api[loader],pending=deferred();let reads=0
      api[loader]=()=>{reads++;return pending.promise}
      try{
        render(component,{active:c,version:0},true);await settle()
        const timer=[...intervals.values()].find(t=>t.ms===ms);assert.ok(timer)
        for(let i=0;i<5;i++)timer.fn();await settle();assert.equal(reads,1)
        unmount();pending.resolve([value]);await settle();assert.equal(hooks.length,0,'late response must not write unmounted state');assert.equal(intervals.size,0)
      }finally{pending.resolve([value]);await settle();api[loader]=original}
    })
    await check(loader+' uses latest same-id source and rejects stale response/error',async()=>{
      const original=api[loader],old=deferred();let reads=0
      api[loader]=device=>{reads++;return device.url===c.url?old.promise:Promise.resolve([value])}
      const next={active:{...c,url:'http://replacement.invalid'},version:0}
      try{
        render(component,{active:c,version:0},true);await settle();render(component,next);await settle();assert.equal(reads,2)
        old.reject(Error('stale response'));await settle();const tree=render(component,next)
        assert.ok(!text(tree).includes('stale response'));assert.ok(text(tree).includes(value.name??value.host))
        const timer=[...intervals.values()].find(t=>t.ms===ms);timer.fn();await settle();assert.equal(reads,3,'lock must release after success')
      }finally{old.resolve([]);await settle();api[loader]=original}
    })
    await check(loader+' retries next interval after a failed read',async()=>{
      const original=api[loader];let reads=0
      api[loader]=()=>++reads===1?Promise.reject(Error('temporary failure')):Promise.resolve([value])
      try{const props={active:c,version:0};render(component,props,true);await settle();assert.ok(text(render(component,props)).includes('temporary failure'));[...intervals.values()].find(t=>t.ms===ms).fn();await settle();const tree=render(component,props);assert.ok(!text(tree).includes('temporary failure'));assert.ok(text(tree).includes(value.name??value.host))}finally{api[loader]=original}
    })
  }
  await check('provider batch refresh notifies exactly once, including partial failure; skips inline',async()=>{
    const original=api.updateProvider;let updates=[],notified=0
    const ps=[{name:'A',vehicleType:'HTTP'},{name:'B',vehicleType:'file'},{name:'inline',vehicleType:'Compatible'}]
    try{
      api.updateProvider=async(_c,_k,name)=>{updates.push(name)}
      await pages.updateAllProviders(c,'rules',ps,()=>notified++);assert.equal(notified,1);assert.deepEqual(updates,['A','B'])
      updates=[];notified=0;const before=alerts.length
      api.updateProvider=async(_c,_k,name)=>{updates.push(name);if(name==='B')throw Error('mock failure')}
      await pages.updateAllProviders(c,'rules',ps,()=>notified++);assert.equal(notified,1);assert.equal(alerts.length,before+1)
      notified=0;await pages.updateAllProviders(c,'rules',[ps[2]],()=>notified++);assert.equal(notified,0)
    }finally{api.updateProvider=original}
  })
  await check('concurrent icon reads share download; failure does not block retry',async()=>{
    pref.clearImageCache();calls.length=0;const pending=deferred(),url='https://icons.invalid/concurrent.png'
    responder=()=>({contentType:'image/png',imageWait:pending.promise})
    const a=pref.cachedIcon(url),b=pref.cachedIcon(url);await settle();const requests=calls.length;pending.resolve();const result=await Promise.all([a,b]);assert.equal(requests,1);assert.ok(result.every(Boolean));assert.equal(result[0],result[1])
    const failURL='https://icons.invalid/retry.png';responder=()=>({throw:'mock image failure'});await assert.rejects(()=>pref.cachedIcon(failURL));responder=()=>({contentType:'image/png'});assert.ok(await pref.cachedIcon(failURL))
  })
  await check('cache clear separates in-flight generations; old completion cannot replace new bytes or pending',async()=>{
    pref.clearImageCache();calls.length=0;const old=deferred(),fresh=deferred(),url='https://icons.invalid/generation.png'
    responder=()=>({contentType:'image/png',imageWait:old.promise,data:'old'});const a=pref.cachedIcon(url);await settle()
    pref.clearImageCache();responder=()=>({contentType:'image/png',imageWait:fresh.promise,data:'new'});const b=pref.cachedIcon(url);await settle();old.resolve();await a
    const d=pref.cachedIcon(url);await settle();assert.equal(calls.length,2,'old finalizer must not delete new pending');fresh.resolve();await Promise.all([b,d]);assert.equal(store.get('dashboard_image_v140_'+encodeURIComponent(url)),'new')
  })
  await check('connections dispose delay timers and reset hidden fresh entries on effect restart',async()=>{
    const original=api.loadConnections,originalTimeout=context.setTimeout,originalClear=context.clearTimeout
    const timeouts=new Map();let id=0,sample=[]
    context.setTimeout=(fn,ms)=>{const key=++id;timeouts.set(key,{fn,ms});return key};context.clearTimeout=key=>timeouts.delete(key)
    api.loadConnections=async()=>sample
    const device={...c,kind:'clash'},props={active:device,version:0,selected:true},connection=i=>({id:String(i),host:'host-'+i,src:'192.0.2.1',dst:'192.0.2.2',network:'TCP',rule:'',chain:'',up:0,down:0,start:now})
    try{
      render(pages.ConnectionsPage,props,true);await settle();sample=Array.from({length:100},(_,i)=>connection(i));[...intervals.values()].find(t=>t.ms===1500).fn();await settle();assert.equal(timeouts.size,10,'100 arrivals share ten existing stagger deadlines')
      const next={...props,version:1};render(pages.ConnectionsPage,next);await settle();assert.equal(timeouts.size,0,'restart releases old delays');assert.ok(text(render(pages.ConnectionsPage,next)).includes('host-0'),'fresh rows cannot remain hidden after cleanup')
      sample=[...sample,connection(101)];[...intervals.values()].find(t=>t.ms===1500).fn();await settle();assert.ok(timeouts.size>0);unmount();assert.equal(timeouts.size,0,'unmount releases delays')
    }finally{api.loadConnections=original;context.setTimeout=originalTimeout;context.clearTimeout=originalClear}
  })
  await check('connection batching preserves all 60..600ms insertion deadlines and releases completed timers',async()=>{
    const original=api.loadConnections,originalTimeout=context.setTimeout,originalClear=context.clearTimeout
    const timeouts=new Map();let id=0,sample=[]
    context.setTimeout=(fn,ms)=>{const key=++id;timeouts.set(key,{fn,ms});return key};context.clearTimeout=key=>timeouts.delete(key)
    api.loadConnections=async()=>sample
    const props={active:{...c,id:'stagger-deadlines',kind:'clash'},version:0,selected:true}
    try{
      render(pages.ConnectionsPage,props,true);await settle()
      sample=Array.from({length:100},(_,i)=>({id:String(i),host:'fixture',src:'',dst:'',network:'TCP',rule:'',chain:'',up:0,down:0,start:now}))
      ;[...intervals.values()].find(t=>t.ms===1500).fn();await settle()
      const deadlines=[...timeouts.entries()].sort((a,b)=>a[1].ms-b[1].ms)
      assert.deepEqual(deadlines.map(([,t])=>t.ms),Array.from({length:10},(_,i)=>(i+1)*60))
      const fresh=()=>hooks.find(x=>x&&Object.keys(x).some(k=>k.startsWith('a:')))
      assert.equal(Object.keys(fresh()).length,100)
      for(let i=0;i<deadlines.length;i++){
        const [key,timer]=deadlines[i];timeouts.delete(key);timer.fn();await settle()
        assert.equal(Object.keys(fresh()??{}).length,i===9?0:99-i)
      }
      assert.equal(timeouts.size,0);assert.ok(text(render(pages.ConnectionsPage,props)).includes('fixture'))
    }finally{api.loadConnections=original;context.setTimeout=originalTimeout;context.clearTimeout=originalClear}
  })
  await check('connection novelty tracking retains only currently observed active/closed IDs',async()=>{
    const original=api.loadConnections;let sample=[];api.loadConnections=async()=>sample
    const props={active:{...c,id:'bounded-seen',kind:'clash'},version:0,selected:true}
    try{
      render(pages.ConnectionsPage,props,true);await settle();const timer=[...intervals.values()].find(t=>t.ms===1500)
      for(let i=0;i<15;i++){sample=[{id:String(i),host:'fixture',src:'',dst:'',network:'TCP',rule:'',chain:'',up:0,down:0,start:now}];now+=3600001;timer.fn();await settle()}
      const tracker=hooks.find(x=>x?.seen&&typeof x.seen.size==='number');assert.ok(tracker);assert.ok(tracker.seen.size<=2,'expired history IDs must be released')
    }finally{api.loadConnections=original}
  })
  if(failures.length)throw Error(failures.length+' regression groups failed: '+failures.join('; '))
  console.log('All '+count+' conservative optimization regression groups passed (mock only).')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
