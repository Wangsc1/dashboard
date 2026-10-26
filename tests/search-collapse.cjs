const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
const device={id:'search-collapse',kind:'clash',name:'Synthetic',url:'http://synthetic.invalid'},props={active:device,version:0,selected:true}
const magnifier=t=>nodes(t,'Button').find(b=>nodes(b,'Image').some(i=>i.props.systemName==='magnifyingglass'))
;(async()=>{
 await test('rules/provider collapse clears both queries, restores numbered list and reopens empty without reads',async()=>{
  const beforeRules=api.loadRules,beforeProviders=api.loadProviders
  api.loadRules=async()=>[{type:'DOMAIN',payload:'alpha.invalid',proxy:'DIRECT'},{type:'DOMAIN',payload:'beta.invalid',proxy:'DIRECT'}]
  api.loadProviders=async()=>[{name:'alpha-provider',type:'Rule',vehicleType:'HTTP'},{name:'beta-provider',type:'Rule',vehicleType:'HTTP'}]
  try{
   let t=render(pages.RulesPage,props,true);await flush();t=render(pages.RulesPage,props);calls.length=0
   button(t,'搜索规则与提供者').props.action();t=render(pages.RulesPage,props);nodes(t,'TextField')[0].props.onChanged('beta');t=render(pages.RulesPage,props);assert.ok(text(t).includes('#2'));assert.ok(!text(t).includes('#1'));assert.ok(!text(t).includes('alpha.invalid'))
   const providerTab=nodes(t,'Button').find(b=>nodes(b,'Text').some(n=>text(n)==='提供者'));providerTab.props.action();t=render(pages.RulesPage,props);nodes(t,'TextField')[0].props.onChanged('beta');t=render(pages.RulesPage,props)
   button(t,'搜索规则与提供者').props.action();t=render(pages.RulesPage,props);assert.equal(nodes(t,'TextField').length,0)
   function providerNames(t){const out=[];function visit(n){if(n?.type?.name==='ProviderCard')out.push(n.props.p.name);for(const c of n?.props?.children??[])visit(c)}visit(t);return out}
   assert.equal(providerNames(t).join(','),'alpha-provider,beta-provider')
   button(t,'搜索规则与提供者').props.action();t=render(pages.RulesPage,props);assert.equal(nodes(t,'TextField')[0].props.value,'')
   nodes(t,'Button').find(b=>nodes(b,'Text').some(n=>text(n)==='规则')).props.action();t=render(pages.RulesPage,props);assert.equal(nodes(t,'TextField')[0].props.value,'');assert.ok(text(t).includes('alpha.invalid'));assert.ok(text(t).includes('beta.invalid'));assert.ok(text(t).includes('#1'));assert.ok(text(t).includes('#2'));assert.equal(calls.length,0)
  }finally{unmount();api.loadRules=beforeRules;api.loadProviders=beforeProviders}
 })
 await test('connection collapse clears only query; restores rows, preserves client/sort and does not restart poll',async()=>{
  responder=()=>({body:{connections:[{id:'a',metadata:{host:'alpha.invalid',sourceIP:'192.0.2.1'},upload:1,download:2},{id:'b',metadata:{host:'beta.invalid',sourceIP:'192.0.2.1'},upload:3,download:4},{id:'c',metadata:{host:'other-client.invalid',sourceIP:'192.0.2.2'},upload:5,download:6}]}})
  let t=render(pages.ConnectionsPage,props,true);await flush();t=render(pages.ConnectionsPage,props);calls.length=0;const pollIds=[...intervals.keys()]
  button(nodes(t,'VStack').find(n=>n.props.contextMenu).props.contextMenu.menuItems,'筛选同源连接').props.action();t=render(pages.ConnectionsPage,props)
  button(t,'累计流量').props.action();t=render(pages.ConnectionsPage,props)
  magnifier(t).props.action();t=render(pages.ConnectionsPage,props);nodes(t,'TextField')[0].props.onChanged('beta');t=render(pages.ConnectionsPage,props);assert.ok(!text(t).includes('alpha.invalid'));assert.ok(text(t).includes('beta.invalid'))
  magnifier(t).props.action();t=render(pages.ConnectionsPage,props);await flush();assert.equal(nodes(t,'TextField').length,0);assert.ok(text(t).includes('alpha.invalid'));assert.ok(text(t).includes('beta.invalid'));assert.ok(!text(t).includes('other-client.invalid'));assert.equal(button(t,'✓ 累计流量').props.title,'✓ 累计流量')
  magnifier(t).props.action();t=render(pages.ConnectionsPage,props);assert.equal(nodes(t,'TextField')[0].props.value,'');assert.equal(calls.length,0);assert.deepEqual([...intervals.keys()],pollIds)
  unmount()
 })
 console.log(count+' search-collapse groups passed (mock only).')
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>unmount())
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
