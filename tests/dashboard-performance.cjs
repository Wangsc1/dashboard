// Focused behavior/work-count regressions; reuses the fully mocked main harness.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const harness = fs.readFileSync(path.join(__dirname, 'run.cjs'), 'utf8').split(';(async () => {')[0]
const checks = String.raw`
const device={id:'performance-fixture',kind:'clash',name:'Fixture',url:'http://fixture.invalid'}
async function settle(){for(let i=0;i<5;i++)await flush()}
const plain=x=>JSON.parse(JSON.stringify(x))
;(async()=>{
  await test('history batches retain legacy ordering, expiry, cap and speed/reset behavior',()=>{
    const h=new model.ConnectionHistory()
    const ref={active:[],closed:[],at:0,sample(xs,at){
      const prev=new Map(this.active.map(x=>[x.id,x])),ids=new Set(xs.map(x=>x.id)),dt=(at-this.at)/1000
      for(const old of this.active)if(!ids.has(old.id))this.closed.unshift({...old,upSpeed:0,downSpeed:0,closedAt:at})
      this.active=xs.map(x=>{const p=prev.get(x.id);return {...x,upSpeed:p&&dt>0?Math.max(0,x.up-p.up)/dt:0,downSpeed:p&&dt>0?Math.max(0,x.down-p.down)/dt:0}})
      this.closed=this.closed.filter(x=>at-(x.closedAt??at)<3600000).slice(0,300);this.at=at
    }}
    let t=10000
    for(let step=0;step<45;step++){
      t += step%9===0?3600000:step%5===0?0:1500
      const size=[0,1,25,400,1200][step%5]
      const xs=Array.from({length:size},(_,i)=>({id:String((i+step*13)%1400),up:(i+step)%19,down:i*31+step,host:'fixture'}))
      h.sample(xs,t);ref.sample(xs,t)
      assert.deepEqual(plain(h.active),plain(ref.active));assert.deepEqual(plain(h.closed),plain(ref.closed))
      if(step%7===0){h.resume();ref.active=[];ref.at=0}
      if(step%11===0){h.clear();ref.closed=[]}
    }
    // Exactly-one-hour expiration and absent closedAt keep the previous rules.
    h.active=[];h.closed=[{id:'expired',closedAt:t-3600000},{id:'recent',closedAt:t-3599999},{id:'missing'}]
    h.sample([],t);assert.deepEqual(Array.from(h.closed,x=>x.id),['recent','missing'])
  })
  await test('mass close materializes only 300 retained records, without mutating input rows',()=>{
    const h=new model.ConnectionHistory();let copies=0
    const xs=Array.from({length:10000},(_,i)=>({id:String(i),up:0,down:0,get host(){copies++;return 'fixture'}}))
    h.active=xs;h.sample([],1000)
    assert.equal(copies,300);assert.equal(h.closed.length,300)
    assert.equal(h.closed[0].id,'9999');assert.equal(h.closed[299].id,'9700')
    assert.ok(xs.every(x=>x.closedAt===undefined));assert.ok(h.closed.every(x=>x.closedAt===1000&&x.upSpeed===0&&x.downSpeed===0))
  })
  await test('group metadata resolves shared members once per response; cycles, order, missing nodes and refresh remain unchanged',async()=>{
    const before=pref.getPreferences(),parse=context.Date.parse;let parses=0,delay=11
    context.Date.parse=s=>{parses++;return parse(s)}
    pref.savePreferences({showGlobal:false,showHidden:false,nestedDelay:true})
    const groups={GLOBAL:{all:['G2','G1','G2','absent']},G1:{type:'Selector',all:['leaf','A','B','missing'],now:'leaf'},G2:{type:'Selector',all:['leaf','A','B','missing'],now:'leaf'},hidden:{type:'Selector',all:['leaf'],hidden:true},A:{type:'Selector',all:['B'],now:'B'},B:{type:'Fallback',all:['A'],now:'A'}}
    for(let i=0;i<60;i++)groups['shared'+i]={type:'Selector',all:['leaf','missing'],now:'leaf'}
    responder=url=>({body:url.endsWith('/providers/proxies')?{providers:{P:{vehicleType:'HTTP',proxies:[{name:'leaf',type:'Shadowsocks',extra:{one:{history:[{time:'2026-01-01T00:00:00Z',delay}]}}}]}}}:{proxies:groups}})
    try{
      let gs=await api.loadGroups(device)
      assert.deepEqual(Array.from(gs.slice(0,5),g=>g.name),['G2','G1','G2','A','B'])
      assert.ok(!gs.some(g=>g.name==='hidden'||g.name==='GLOBAL'));assert.equal(parses,1,'same leaf across 63 memberships is parsed once')
      const g=gs[0];assert.equal(g.delays.leaf,11);assert.equal(g.delays.A,undefined)
      assert.equal(g.types.A,'Fallback');assert.equal(g.types.B,'Selector');assert.equal(g.types.missing,'无节点信息')
      assert.deepEqual(plain(g.testTargets.leaf),{name:'leaf',provider:'P',type:'Shadowsocks'})
      assert.deepEqual(plain(g.testTargets.A),{name:'A',type:'Selector'});assert.deepEqual(plain(g.testTargets.B),{name:'B',type:'Fallback'})
      g.testTargets.leaf.name='local mutation';assert.equal(gs[1].testTargets.leaf.name,'leaf','groups retain independent target objects')
      delay=27;parses=0;gs=await api.loadGroups(device);assert.equal(gs[0].delays.leaf,27);assert.equal(parses,1,'no cache survives requests')
      pref.savePreferences({showHidden:true,nestedDelay:false})
      gs=await api.loadGroups(device,{includeGlobal:true});assert.ok(gs.some(g=>g.name==='GLOBAL'));assert.ok(gs.some(g=>g.name==='hidden'))
    }finally{context.Date.parse=parse;pref.savePreferences(before)}
  })
  await test('node sorting is reused on search, selection and pagination, invalidated by order and live delays',async()=>{
    const original=model.sortedNodes,select=api.selectProxy,testGroup=api.testGroup,before=pref.getPreferences();let sorts=0
    model.sortedNodes=(...args)=>{sorts++;return original(...args)};api.selectProxy=async()=>{};api.testGroup=async()=>({N099:1,N000:200})
    pref.savePreferences({nodeSort:'name'})
    const g={name:'Fixture',type:'Selector',now:'N000',all:Array.from({length:100},(_,i)=>'N'+String(99-i).padStart(3,'0')),delays:{N099:90,N000:10}}
    const props={c:device,g,onChanged(){}}
    try{
      let tree=render(pages.GroupNodesPage,props,true);await settle();sorts=0
      tree=render(pages.GroupNodesPage,props);assert.equal(sorts,0)
      button(tree,'加载更多').props.action();tree=render(pages.GroupNodesPage,props);assert.ok(text(tree).includes('N099'));assert.equal(sorts,0)
      nodes(tree,'TextField')[0].props.onChanged('n099');tree=render(pages.GroupNodesPage,props)
      assert.ok(text(tree).includes('N099'));assert.ok(!text(tree).includes('N098'));assert.equal(sorts,0)
      const pick=nodes(tree,'Button').find(n=>text(n).includes('N099'));await pick.props.action();tree=render(pages.GroupNodesPage,props);assert.equal(sorts,0)
      pref.savePreferences({nodeSort:'delay'});tree=render(pages.GroupNodesPage,props);assert.equal(sorts,1)
      await trailing(tree.props.toolbar).props.action();tree=render(pages.GroupNodesPage,props);assert.equal(sorts,2)
      const next={...props,g:{...g,all:['NEW',...g.all]}};render(pages.GroupNodesPage,next);assert.equal(sorts,3)
    }finally{unmount();model.sortedNodes=original;api.selectProxy=select;api.testGroup=testGroup;pref.savePreferences(before)}
  })
  await test('group previews skip collapsed sorting and reuse expanded ordering until inputs change',async()=>{
    const original=model.sortedNodes,before=pref.getPreferences();let sorts=0
    model.sortedNodes=(...args)=>{sorts++;return original(...args)}
    pref.savePreferences({nodeSort:'name'})
    const g={name:'Preview',type:'Selector',now:'N000',all:Array.from({length:90},(_,i)=>'N'+String(i).padStart(3,'0')),delays:Object.fromEntries(Array.from({length:90},(_,i)=>['N'+String(i).padStart(3,'0'),i+1]))}
    const props={c:device,g,onChanged(){},expanded:false}
    try{
      render(pages.GroupSection,props,true);await settle();assert.equal(sorts,0)
      const expanded={...props,expanded:true};let tree=render(pages.GroupSection,expanded);await settle();assert.equal(sorts,1)
      tree=render(pages.GroupSection,expanded);button(tree,'加载更多').props.action();tree=render(pages.GroupSection,expanded)
      assert.equal(sorts,1);assert.ok(text(tree).includes('N079'))
      pref.savePreferences({nodeSort:'nameDesc'});tree=render(pages.GroupSection,expanded);assert.equal(sorts,2)
      const next={...expanded,g:{...g,delays:{...g.delays,N000:999}}};render(pages.GroupSection,next);await settle();render(pages.GroupSection,next);assert.equal(sorts,3)
      render(pages.GroupSection,props);assert.equal(sorts,3,'collapse must not sort')
    }finally{unmount();model.sortedNodes=original;pref.savePreferences(before)}
  })
  await test('rule search preserves original numbers and paging without rescanning on UI-only renders; refresh invalidates',async()=>{
    const loadRules=api.loadRules,loadProviders=api.loadProviders;let reads=0
    const rules=Array.from({length:200},(_,i)=>({type:'DOMAIN',get payload(){reads++;return i%2?'MATCH-'+i:'other-'+i},proxy:'DIRECT'}))
    api.loadRules=async()=>rules;api.loadProviders=async()=>[]
    const props={active:{...device,id:'rules-work-count'},version:0,selected:true}
    try{
      render(pages.RulesPage,props,true);await settle();let tree=render(pages.RulesPage,props);reads=0
      tree=render(pages.RulesPage,props);assert.equal(reads,0)
      button(tree,'加载更多').props.action();tree=render(pages.RulesPage,props);assert.equal(reads,0);assert.ok(text(tree).includes('#160'))
      button(trailing(tree.props.toolbar),'搜索规则').props.action();tree=render(pages.RulesPage,props);assert.equal(reads,0)
      nodes(tree,'TextField')[0].props.onChanged('match-');tree=render(pages.RulesPage,props);assert.ok(reads>0)
      assert.ok(text(tree).includes('#2'));assert.ok(text(tree).includes('#160'));assert.ok(!text(tree).includes('other-'))
      reads=0;button(tree,'加载更多').props.action();tree=render(pages.RulesPage,props);assert.equal(reads,0);assert.ok(text(tree).includes('#200'))
      api.loadRules=async()=>[{type:'DOMAIN',payload:'MATCH-NEW',proxy:'DIRECT'}]
      void tree.props.refreshable();render(pages.RulesPage,props);await settle();tree=render(pages.RulesPage,props)
      assert.ok(text(tree).includes('MATCH-NEW'));assert.ok(text(tree).includes('#1'));assert.ok(!text(tree).includes('MATCH-199'))
    }finally{unmount();api.loadRules=loadRules;api.loadProviders=loadProviders}
  })
  console.log('\n'+count+' dashboard performance regression groups passed (mock only).')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
