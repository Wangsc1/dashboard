// Pure paging and rendered SoftwarePage derivations; all native IO is mocked.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0].replace('Root, AppearanceRoot };','Root, AppearanceRoot, SoftwarePage, PkgRow };')
const checks=String.raw`
;(async()=>{
 await test('package paging matches original filter+slice including unusual numeric boundaries',()=>{
  const list=Array.from({length:35},(_,i)=>({name:i%2?'中文-'+i:'PKG-'+i,desc:i%3?'emoji😀 match':'other',version:'1'}))
  const values=[undefined,-Infinity,-100,-2,-.5,-0,0,.5,1,1.5,2,10,100,Infinity,NaN]
  for(const query of ['', '  ', 'pkg', ' MATCH ', '中文', '😀', 'missing'])for(const limit of values)for(const offset of values){
   const l=limit===undefined?100:limit,o=offset===undefined?0:offset,k=query.trim().toLowerCase()
   const hit=k?list.filter(p=>p.name.toLowerCase().includes(k)||p.desc.toLowerCase().includes(k)):list
   const actual=api.filterPkgs(list,query,limit,offset)
   assert.equal(actual.total,hit.length);assert.deepEqual(Array.from(actual.items),hit.slice(o,o+l))
  }
 })
 await test('empty query reads only page rows, does not inspect names or descriptions',()=>{
  let reads=0
  const list=new Proxy(Array.from({length:10000},()=>({get name(){throw Error('must not inspect')},get desc(){throw Error('must not inspect')}})),{get(t,k,r){if(typeof k==='string'&&/^\d+$/.test(k))reads++;return Reflect.get(t,k,r)}})
  const result=api.filterPkgs(list,'  ',100,50)
  assert.equal(result.total,10000);assert.equal(result.items.length,100);assert.equal(reads,100)
 })
 await test('software rows preserve first duplicate update, membership, actions and linear lookup work',()=>{
  const details=load('router-details'),read=details.useRouterDetail,upgrade=api.upgradablePkgs
  let installed=[],available=[],updates=[]
  details.useRouterDetail=(_c,key)=>({value:key==='installed'?installed:key==='available'?available:undefined,error:''})
  api.upgradablePkgs=()=>updates
  const props={active:{id:'software-fixture',kind:'openwrt',url:'http://fixture.invalid',name:'Mock'}}
  try{
   let reads=0
   installed=Array.from({length:1000},(_,i)=>({get name(){reads++;return 'pkg-'+i},version:'1',desc:'',installed:true}))
   updates=[{name:'pkg-999',upgradeTo:undefined},{name:'pkg-999',upgradeTo:'WRONG-LAST'}]
   available=Array.from({length:100},(_,i)=>({name:i===99?'missing':'pkg-'+(900+i),version:'2',desc:'',installed:false}))
   let tree=render(app.SoftwarePage,props,true)
   assert.equal(nodes(tree,'Picker').length,0);const tabs=nodes(tree,'HStack').find(h=>nodes(h,'Button').filter(b=>['可用','已安装','更新'].includes(text(b))).length===3);assert.ok(tabs);assert.equal(tabs.props.background,undefined);assert.ok(nodes(tree,'Section').some(s=>['可用','已安装','更新'].every(label=>nodes(s,'Button').some(b=>text(b)===label))));assert.equal(nodes(tabs,'Button').length,3);assert.equal(tabs.props.padding,undefined);assert.equal(tabs.props.frame,undefined);assert.ok(nodes(tabs,'Text').every(t=>t.props.padding===undefined&&t.props.frame.height===undefined));assert.ok(nodes(tabs,'Text').every(t=>!t.props.glassEffect));assert.equal(nodes(tabs,'Text').filter(t=>t.props.background.props.fill==='tertiarySystemFill').length,1)
   nodes(tree,'Button').find(b=>text(b)==='可用').props.action();reads=0
   tree=render(app.SoftwarePage,props)
   assert.equal(reads,1000,'one installed traversal, not one scan per visible row')
   const rows=nodes(tree,app.PkgRow);assert.equal(rows.length,100)
   for(let i=0;i<99;i++)assert.equal(rows[i].props.p.installed,true)
   assert.equal(rows[99].props.p,available[99]);assert.equal(rows[99].props.actions[0].props.title,'安装')
   available=[{name:'pkg-999',version:'2',desc:''}];tree=render(app.SoftwarePage,props)
   let row=nodes(tree,app.PkgRow)[0];assert.equal(row.props.p.upgradeTo,undefined);assert.deepEqual(Array.from(row.props.actions,a=>a.props.title),['卸载'])
   updates=[{name:'pkg-999',upgradeTo:'FIRST'},{name:'pkg-999',upgradeTo:'SECOND'}];tree=render(app.SoftwarePage,props)
   row=nodes(tree,app.PkgRow)[0];assert.equal(row.props.p.upgradeTo,'FIRST');assert.deepEqual(Array.from(row.props.actions,a=>a.props.title),['升级','卸载'])
   nodes(tree,'Button').find(b=>text(b)==='已安装').props.action();tree=render(app.SoftwarePage,props);assert.equal(nodes(tree,app.PkgRow)[0].props.p,installed[0])
   nodes(tree,'Button').find(b=>text(b)==='更新').props.action();tree=render(app.SoftwarePage,props);assert.equal(nodes(tree,app.PkgRow)[0].props.p,updates[0])
  }finally{unmount();details.useRouterDetail=read;api.upgradablePkgs=upgrade}
 })
 console.log(count+' software derivation groups passed (mock only).')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
