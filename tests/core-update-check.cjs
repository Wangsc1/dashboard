// Real update checker / More lifecycle, all network and native UI mocked.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const harness=fs.readFileSync(path.join(__dirname,'run.cjs'),'utf8').split(';(async () => {')[0]
const checks=String.raw`
const stableURL='https://github.com/MetaCubeX/mihomo/releases/latest/download/version.txt'
const alphaURL='https://github.com/MetaCubeX/mihomo/releases/download/Prerelease-Alpha/version.txt'
const compareURL='https://api.github.com/repos/MetaCubeX/mihomo/compare/94b13ae...abcdef0'
const c={id:'update-a',name:'A',kind:'clash',url:'http://private-controller.invalid'},b={...c,id:'update-b',name:'B',url:'http://private-b.invalid'}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
const publicCalls=()=>calls.filter(x=>x.url.startsWith('https://'))
const draw=(active=c,selected=true,reset=false)=>render(pages.MorePage,{active,selected,onChanged(){}},reset)
async function settle(active=c,selected=true){for(let i=0;i<3;i++){draw(active,selected);await flush()}return draw(active,selected)}
function rawNodes(tree,name){const out=[];function walk(n){if(!n||typeof n!=='object')return;if(n.type?.name===name)out.push(n);for(const child of n.props?.children??[])walk(child)}walk(tree);return out}
const coreLine=tree=>rawNodes(tree,'MoreLine').find(n=>n.props.title==='内核版本')
const dot=tree=>!!coreLine(tree)?.props.updateDot
let latest='v1.20.0',versions=new Map([[c.url,'v1.19.0'],[b.url,'v1.20.0']]),publicFailure=false
function respond(url){
 if(url===stableURL||url===alphaURL)return publicFailure?{status:503}:{text:latest}
 if(url.startsWith('https://api.github.com/'))return {body:{status:'ahead',ahead_by:1,behind_by:0}}
 if(url.endsWith('/version'))return {body:{version:versions.get(url.slice(0,-8))}}
 return {body:{mode:'rule'}}
}
;(async()=>{
 await test('stable compares numeric release components; equal/newer/older and malformed results',async()=>{
  for(const [current,target,expected] of [['v1.9.9','v1.10.0',true],['v1.20.0','v1.20.0',false],['v2.0.0','v1.99.0',false],['1.2.3','v1.2.4',true],['v1.2.3','alpha-abcdef0',null],['v1.2.3','v1.2.3-custom',null],['v1.2.3','99999999999999999999.0.0',null]]){
   calls.length=0;responder=()=>({text:target+'\n'});assert.equal(await api.checkCoreUpdate(current),expected);assert.equal(calls.length,1);assert.equal(calls[0].url,stableURL)
  }
 })
 await test('alpha uses official alpha artifact and ancestry, not string ordering or stable release',async()=>{
  calls.length=0;responder=()=>({text:'alpha-94b13ae\n'});assert.equal(await api.checkCoreUpdate('alpha-94b13ae'),false);assert.equal(calls.length,1);assert.equal(calls[0].url,alphaURL)
  for(const [status,ahead,behind,expected] of [['ahead',2,0,true],['behind',0,3,false],['identical',0,0,false],['diverged',2,1,null],['ahead',0,0,null],['ahead',2,1,null]]){
   calls.length=0;responder=url=>url===alphaURL?{text:'alpha-abcdef0'}:{body:{status,ahead_by:ahead,behind_by:behind}}
   assert.equal(await api.checkCoreUpdate('alpha-94b13ae'),expected);assert.equal(calls.length,2);assert.equal(calls[0].url,alphaURL);assert.equal(calls[1].url,compareURL)
  }
 })
 await test('unsupported builds, failed artifact/compare/JSON are unknown, never update available',async()=>{
  calls.length=0;for(const v of ['未提供','读取失败','Meta','v1.2.3-custom','v1.2.3-rc1','alpha-local','alpha-xyz1234','https://private.invalid/key',''])assert.equal(await api.checkCoreUpdate(v),null);assert.equal(calls.length,0)
  for(const result of [{status:404},{status:503},{throw:'timeout'},{text:'<html>error</html>'}]){responder=()=>result;assert.equal(await api.checkCoreUpdate('v1.2.3'),null)}
  for(const result of [{status:404},{status:403},{throw:'timeout'},{text:'not-json'}]){responder=url=>url===alphaURL?{text:'alpha-abcdef0'}:result;assert.equal(await api.checkCoreUpdate('alpha-94b13ae'),null)}
 })
 await test('public requests never inherit private controller credentials, custom headers or addresses',async()=>{
  secrets.set('neko_secret_'+c.id,'private-secret');pref.saveHeaders('{"X-Private":"private-header"}');pref.savePreferences({headersEnabled:true})
  responder=url=>url===alphaURL?{text:'alpha-abcdef0'}:{body:{status:'ahead',ahead_by:1,behind_by:0}};calls.length=0
  assert.equal(await api.checkCoreUpdate('alpha-94b13ae'),true);assert.equal(calls.length,2)
  for(const call of calls){assert.equal(call.init.headers.Authorization,undefined);assert.equal(call.init.headers['X-Private'],undefined);assert.equal(call.init.body,undefined);assert.ok(!JSON.stringify(call).includes('private-'));assert.equal(call.init.method,undefined)}
  pref.saveHeaders('{}')
 })
 await test('same-version concurrent checks share only in-flight work; completed checks re-fetch on next entry',async()=>{
  const gate=deferred();calls.length=0;responder=()=>({text:'v1.20.0',wait:gate.promise})
  const a=api.checkCoreUpdate('v1.19.0'),b=api.checkCoreUpdate('v1.19.0');await flush();assert.equal(calls.length,1);gate.resolve();assert.equal(await a,true);assert.equal(await b,true)
  await api.checkCoreUpdate('v1.19.0');assert.equal(calls.length,2)
 })
 await test('green 6pt dot overlays current version top-right, not row/plugin; layout remains unchanged',async()=>{
  responder=respond;latest='v1.20.0';calls.length=0;draw(c,true,true);await flush();const tree=await settle()
  assert.equal(dot(tree),true);const line=coreLine(tree),native=line.type(line.props),detail=nodes(native,'Text').find(n=>text(n)==='v1.19.0')
  assert.ok(detail);assert.equal(detail.props.overlay.alignment,'topTrailing');const circle=detail.props.overlay.content;assert.equal(circle.type,'Circle');assert.equal(circle.props.fill,'systemGreen');assert.equal(circle.props.frame.width,6);assert.equal(circle.props.frame.height,6);assert.equal(circle.props.offset.x,5);assert.equal(circle.props.offset.y,-2)
  assert.equal(native.props.overlay,undefined);assert.equal(native.props.spacing,14);assert.equal(native.props.padding.horizontal,16);assert.equal(detail.props.font,14);assert.equal(detail.props.lineLimit,1)
  const plugin=rawNodes(tree,'MoreLine').find(n=>n.props.title==='插件版本');assert.equal(plugin.props.updateDot,undefined);assert.ok(!calls.some(n=>n.url.endsWith('/upgrade')));unmount()
 })
 await test('each selected/visible re-entry checks again; hidden, latest, unknown and failures show no dot',async()=>{
  responder=respond;latest='v1.20.0';publicFailure=false;calls.length=0;draw(c,false,true);await flush();await settle(c,false);assert.equal(publicCalls().length,0)
  assert.equal(dot(await settle()),true);assert.equal(publicCalls().length,1)
  assert.equal(dot(await settle(c,false)),false);latest='v1.19.0';assert.equal(dot(await settle()),false);assert.equal(publicCalls().length,2)
  let tree=await settle();tree.props.onDisappear();await settle();assert.equal(publicCalls().length,2);latest='v1.20.0';tree=draw();tree.props.onAppear();assert.equal(dot(await settle()),true);assert.equal(publicCalls().length,3)
  await settle(c,false);publicFailure=true;assert.equal(dot(await settle()),false);assert.equal(publicCalls().length,4);publicFailure=false
  await settle(c,false);versions.set(c.url,'custom-build');assert.equal(dot(await settle()),false);assert.equal(publicCalls().length,4);versions.set(c.url,'v1.19.0');unmount()
 })
 await test('late checks cannot cross sources or restore a dot after hide/unmount',async()=>{
  const gate=deferred();latest='v1.20.0';responder=url=>url===stableURL?{text:latest,wait:gate.promise}:respond(url);calls.length=0
  draw(c,true,true);await flush();await settle();assert.equal(dot(draw()),false)
  // B is latest; its own check can complete before A's stale result.
  responder=respond;assert.equal(dot(draw(b)),false);await flush();assert.equal(dot(await settle(b)),false);gate.resolve();await flush();assert.equal(dot(await settle(b)),false)
  assert.equal(publicCalls().length,2);unmount()
  const hidden=deferred();responder=url=>url===stableURL?{text:latest,wait:hidden.promise}:respond(url)
  draw(c,true,true);await flush();await settle();await settle(c,false);hidden.resolve();await flush();assert.equal(dot(draw(c,false)),false);unmount()
  const disposed=deferred();responder=url=>url===stableURL?{text:latest,wait:disposed.promise}:respond(url);draw(c,true,true);await flush();await settle();unmount();disposed.resolve();await flush()
  responder=respond;draw(b,true,true);await flush();assert.equal(dot(await settle(b)),false);unmount()
 })
 await test('same-source re-entry ignores earlier epoch result and live version failure never checks cached stale version',async()=>{
  const gate=deferred();latest='v1.20.0';responder=url=>url===stableURL?{text:latest,wait:gate.promise}:respond(url)
  draw(c,true,true);await flush();await settle();await settle(c,false)
  versions.set(c.url,'v1.20.0');responder=respond;assert.equal(dot(await settle()),false);gate.resolve();await flush();assert.equal(dot(await settle()),false)
  await settle(c,false);calls.length=0;responder=url=>url.endsWith('/version')?{status:500}:respond(url);assert.equal(dot(await settle()),false);assert.equal(publicCalls().length,0);versions.set(c.url,'v1.19.0');unmount()
 })
 console.log('All '+count+' core-update check regression groups passed (mock native UI/network; no upgrade or device claim).')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
