// Nikki management pages: same-source in-memory first frame + silent refresh. All IO mocked.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const harness=fs.readFileSync(path.join(__dirname,'run.cjs'),'utf8').split(';(async () => {')[0]
const checks=String.raw`
let serial=0,values,gate=null,failReads=false,uciReads=0,wrote=0
const src=()=>{serial++;return {id:'mgc-'+serial,name:'MGC',kind:'openwrt',plugin:'nikki',url:'http://mgc-'+serial+'.invalid',username:'root'}}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
const base=name=>({config:{'.type':'config','.index':0,profile:'file:a.yaml'},mixin:{'.type':'mixin','.index':1,rule:'0'},s1:{'.type':'subscription','.index':2,name,url:'https://sub.invalid/token-'+name,update:'2026-01-01 00:00:00'}})
function install(){
 responder=(url,init)=>{
  const [,obj,method,args]=JSON.parse(init.body).params
  if(obj==='session')return {body:{result:[0,{ubus_rpc_session:'mgc-session'}]}}
  if(obj==='uci'&&method==='get'&&args.section)return {body:{result:[0,{values:{}}]}}
  if(obj==='uci'&&method==='get'){uciReads++;if(failReads)return {status:500};return {body:{result:[0,{values:values}]},wait:gate?.promise}}
  if(obj==='file'&&method==='list')return {body:{result:[0,{entries:[]}]}}
  throw Error('unexpected '+obj+'.'+method)
 }
}
const page=(c,kind)=>render(pages.ManagementPage,{c,kind})
const reading=tree=>text(tree).includes('正在读取')
;(async()=>{
 await test('first entry without cache shows 正在读取, then data',async()=>{
  const c=src();values=base('First');gate=deferred();install()
  let tree=render(pages.ManagementPage,{c,kind:'subscription'},true);assert.ok(reading(tree));await flush();assert.ok(reading(page(c,'subscription')))
  gate.resolve();gate=null;await flush();tree=page(c,'subscription');assert.ok(!reading(tree));assert.ok(text(tree).includes('First'));unmount()
 })
 await test('second entry of the same source shows cached data on the first frame, no 读取 text, then silently refreshes',async()=>{
  const c=src();values=base('Old');gate=null;install();render(pages.ManagementPage,{c,kind:'subscription'},true);await flush();unmount()
  values=base('New');gate=deferred();uciReads=0
  let tree=render(pages.ManagementPage,{c,kind:'subscription'},true);assert.ok(!reading(tree));assert.ok(text(tree).includes('Old'))
  await flush();tree=page(c,'subscription');assert.ok(!reading(tree));assert.ok(text(tree).includes('Old'));assert.equal(uciReads,1)
  gate.resolve();gate=null;await flush();tree=page(c,'subscription');assert.ok(text(tree).includes('New')&&!text(tree).includes('Old'));unmount()
  // other kinds of the same source reuse the same read
  tree=render(pages.ManagementPage,{c,kind:'profile'},true);assert.ok(!reading(tree));await flush();unmount()
 })
 await test('cache is source scoped: another source (or identity) starts uncached',async()=>{
  const a=src(),b=src();values=base('SrcA');gate=null;install();render(pages.ManagementPage,{c:a,kind:'subscription'},true);await flush();unmount()
  values=base('SrcB');gate=deferred()
  let tree=render(pages.ManagementPage,{c:b,kind:'subscription'},true);assert.ok(reading(tree));assert.ok(!text(tree).includes('SrcA'))
  tree=render(pages.ManagementPage,{c:{...a,username:'other'},kind:'subscription'},true);assert.ok(reading(tree));assert.ok(!text(tree).includes('SrcA'))
  gate.resolve();gate=null;await flush();unmount()
 })
 await test('refresh failure keeps cached content (no fake success, writes blocked); first-time failure still shows the error',async()=>{
  const c=src();values=base('Keep');gate=null;failReads=false;install();render(pages.ManagementPage,{c,kind:'subscription'},true);await flush();unmount()
  failReads=true;let tree=render(pages.ManagementPage,{c,kind:'subscription'},true);assert.ok(text(tree).includes('Keep'));await flush();tree=page(c,'subscription')
  assert.ok(text(tree).includes('Keep'));assert.ok(nodes(tree,'Button').some(b=>b.props.title==='重试'))
  assert.ok(nodes(trailing(tree.props.toolbar),'Button').concat([trailing(tree.props.toolbar)]).every(b=>b.props.disabled!==false))
  const before=calls.length;await nodes(tree,'Button').find(b=>b.props.accessibilityLabel==='删除订阅').props.action();assert.equal(calls.length,before);unmount()
  const d=src();failReads=true;install();tree=render(pages.ManagementPage,{c:d,kind:'subscription'},true);await flush();tree=page(d,'subscription')
  assert.ok(!reading(tree));assert.ok(nodes(tree,'Button').some(b=>b.props.title==='重试'));failReads=false;unmount()
 })
 await test('writes are blocked until fresh data lands, a write invalidates the cache, and late reads cannot overwrite it',async()=>{
  const c=src();values=base('W1');gate=null;install();render(pages.ManagementPage,{c,kind:'subscription'},true);await flush();unmount()
  // cached frame: stale data must not be used as a write base before the silent refresh finishes
  gate=deferred();let tree=render(pages.ManagementPage,{c,kind:'subscription'},true);await flush();tree=page(c,'subscription')
  const del=()=>nodes(tree,'Button').find(b=>b.props.accessibilityLabel==='删除订阅')
  const confirmsBefore=confirms.length;await del().props.action();assert.equal(confirms.length,confirmsBefore)
  assert.equal(trailing(tree.props.toolbar).props.disabled,true)
  gate.resolve();gate=null;await flush();tree=page(c,'subscription');assert.equal(trailing(tree.props.toolbar).props.disabled,false)
  // a successful write drops the cached copy: leaving and re-entering during the re-read shows no stale data
  const w1=base('W1');values=base('W2');wrote++;const late=deferred();gate=late
  const upd=nodes(tree,'Button').find(b=>b.props.accessibilityLabel==='更新订阅')
  responder=(url,init)=>{const [,obj,method,args]=JSON.parse(init.body).params;if(obj==='session')return {body:{result:[0,{ubus_rpc_session:'s'}]}};if(obj==='uci'&&method==='changes')return {body:{result:[0,{changes:[]}]}};if(obj==='uci'&&method==='get'&&args.section)return {body:{result:[0,{values:w1[args.section]}]}};if(obj==='uci'&&method==='get')return {body:{result:[0,{values}]},wait:gate?.promise};if(obj==='file'&&method==='list')return {body:{result:[0,{entries:[]}]}};if(obj==='luci.nikki')return {body:{result:[0,{success:true}]}};return {body:{result:[0,{}]}}}
  context.confirmResult=true;try{await upd.props.action()}catch{}
  await flush();unmount()
  tree=render(pages.ManagementPage,{c,kind:'subscription'},true);assert.ok(reading(tree));assert.ok(!text(tree).includes('W1'))
  late.resolve();gate=null;await flush();tree=page(c,'subscription');assert.ok(text(tree).includes('W2'));unmount()
 })
 await test('prefetch from the More page fills the cache once per source without a request storm',async()=>{
  const c=src();values=base('Pre');gate=null;uciReads=0;install()
  pages.prefetchMoreVersions(c);pages.prefetchMoreVersions(c);await flush();await flush()
  assert.equal(uciReads,1)
  const tree=render(pages.ManagementPage,{c,kind:'subscription'},true);assert.ok(!reading(tree));assert.ok(text(tree).includes('Pre'));await flush();unmount()
  const other={id:'mgc-clash',name:'C',kind:'clash',url:'http://c.invalid'};uciReads=0;pages.prefetchMoreVersions(other);await flush();assert.equal(uciReads,0)
 })
 console.log('All '+count+' management cache groups passed (mock UI/network only).')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
