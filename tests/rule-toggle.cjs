// Rules page: persistent search, per-rule toggle, optional connection interruption. All IO/native hooks mocked; no device or remote.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
scripting.useState=function(v){const slots=hooks,i=hookIndex++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]}
function owner(fn){const state={hooks:[],cleanups:new Map()};return {render(props={}){const saved={hooks,cleanups,effects,hookIndex};hooks=state.hooks;cleanups=state.cleanups;effects=[];hookIndex=0;const tree=fn(props),queued=effects;({hooks,cleanups,effects,hookIndex}=saved);for(const f of queued){const sc=cleanups;cleanups=state.cleanups;f();cleanups=sc}return tree},close(){for(const f of state.cleanups.values())f();state.cleanups.clear()}}}
async function settle(){for(let i=0;i<100;i++)await Promise.resolve()}
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
const base={id:'pull',kind:'clash',name:'Pull',url:'http://pull-a.invalid'}
const rule=n=>({type:'DOMAIN',payload:n,proxy:'DIRECT'})
const conn=n=>({id:n,metadata:{host:n+'.invalid'},upload:1,download:1})
const prov={providers:{A:{type:'Rule',vehicleType:'HTTP',ruleCount:1,proxies:[]}}}

const mkRule=(i,type,payload,proxy,disabled)=>({index:i,type,payload,proxy,size:-1,...(disabled===undefined?{}:{extra:{disabled}})})
const kernelOf=(rules,conns=[])=>{
 const k={rules,conns,patches:[],deletes:[],patchGate:undefined,failPatch:false,failRead:false}
 k.responder=(u,i)=>{
  if(i?.method==='PATCH'&&u.endsWith('/rules/disable')){k.patches.push(JSON.parse(i.body));if(k.failPatch)return {status:500};const b=JSON.parse(i.body);const apply=()=>{for(const [idx,v] of Object.entries(b)){const r=k.rules.find(x=>x.index===Number(idx));if(r&&r.extra)r.extra.disabled=v}};if(k.patchGate)return {wait:k.patchGate.promise.then(apply),status:204};apply();return {status:204}}
  if(i?.method==='DELETE'&&u.includes('/connections/')){k.deletes.push(decodeURIComponent(u.split('/connections/')[1]));return {status:204}}
  if(u.includes('/providers/rules'))return {body:{providers:{Alpha:{type:'Rule',vehicleType:'HTTP',ruleCount:2,behavior:'domain'},Beta:{type:'Rule',vehicleType:'File',ruleCount:1,behavior:'ipcidr'}}}}
  if(u.endsWith('/rules')){if(k.failRead)return {status:500};return {body:{rules:JSON.parse(JSON.stringify(k.rules))}}}
  if(u.endsWith('/connections'))return {body:{connections:k.conns}}
  return {status:204}
 }
 return k
}
const cn=(id,rule,rulePayload)=>({id,rule,rulePayload,upload:1,download:1,metadata:{host:id+'.invalid'}})
const toggles=t=>nodes(t,'Toggle').filter(x=>x.props.title==='启用规则')
;(async()=>{
 await test('rules search is persistent (menu has no search); filters rules and providers; tabs keep their own input',async()=>{
  const k=kernelOf([mkRule(0,'DomainSuffix','google.com','Proxy',false),mkRule(1,'GeoIP','CN','DIRECT',false),mkRule(2,'Match','','Final',false)]);responder=k.responder
  const page=owner(pages.RulesPage),props={active:{...base,id:'rt-search',url:'http://rt-s.invalid'},version:0,selected:true}
  page.render(props);await settle();let t=page.render(props)
  assert.equal(nodes(trailing(t.props.toolbar),'Button').length,0);assert.deepEqual(nodes(trailing(t.props.toolbar),'Toggle').map(x=>x.props.title),['禁用规则时打断连接'])
  const field=()=>nodes(t,'TextField')[0];assert.equal(field().props.title,'搜索规则')
  field().props.onChanged('geoip');t=page.render(props);assert.ok(text(t).includes('CN'));assert.ok(!text(t).includes('google.com'))
  field().props.onChanged('final');t=page.render(props);assert.ok(text(t).includes('#3'),'original rule number kept')
  nodes(t,'Picker')[0].props.onChanged('providers');t=page.render(props);assert.equal(field().props.title,'搜索提供者');assert.equal(field().props.value,'')
  assert.equal(nodes(t,pages.ProviderCard).length,2);field().props.onChanged('file');t=page.render(props);assert.equal(nodes(t,pages.ProviderCard).length,1)
  field().props.onChanged('alp');t=page.render(props);assert.equal(nodes(t,pages.ProviderCard).length,1)
  nodes(t,'Picker')[0].props.onChanged('rules');t=page.render(props);assert.equal(field().props.value,'final','rules input kept')
  page.close()
 })
 await test('unsupported kernel (no index/extra.disabled): no switch, rows unchanged',async()=>{
  const k=kernelOf([mkRule(undefined,'Domain','a.com','P')].map(r=>{delete r.index;return r}));responder=k.responder
  const page=owner(pages.RulesPage),props={active:{...base,id:'rt-old',url:'http://rt-o.invalid'},version:0,selected:true}
  page.render(props);await settle();const t=page.render(props);assert.ok(text(t).includes('a.com'));assert.equal(toggles(t).length,0);page.close()
 })
 await test('toggle: optimistic, PATCH body {index:bool}, read-back, failure rollback, repeat click not concurrent, stale source isolated',async()=>{
  const k=kernelOf([mkRule(0,'Domain','a.com','P',false),mkRule(1,'Domain','b.com','Q',false)]);responder=k.responder
  const page=owner(pages.RulesPage),props={active:{...base,id:'rt-tog',url:'http://rt-t.invalid'},version:0,selected:true}
  page.render(props);await settle();let t=page.render(props);assert.equal(toggles(t).length,2);assert.equal(toggles(t)[1].props.value,true)
  k.patchGate=gate();toggles(t)[1].props.onChanged(false);t=page.render(props);assert.equal(toggles(t)[1].props.value,false,'optimistic');assert.equal(toggles(t)[1].props.disabled,true,'busy')
  toggles(t)[1].props.onChanged(true);toggles(t)[1].props.onChanged(false);await settle();assert.equal(k.patches.length,1,'repeat click does not send a second PATCH');assert.deepEqual(k.patches[0],{1:true})
  k.patchGate.resolve();await settle();await settle();t=page.render(props);assert.equal(toggles(t)[1].props.value,false);assert.equal(toggles(t)[1].props.disabled,false);assert.equal(toggles(t)[0].props.value,true)
  // failure rolls back and shows existing hint
  k.patchGate=undefined;k.failPatch=true;toggles(t)[0].props.onChanged(false);t=page.render(props);assert.equal(toggles(t)[0].props.value,false);await settle();t=page.render(props)
  assert.equal(toggles(t)[0].props.value,true,'rolled back');assert.ok(text(t).includes('请求未完成'));k.failPatch=false
  // enable again: body false
  toggles(t)[1].props.onChanged(true);await settle();await settle();assert.deepEqual(k.patches.at(-1),{1:false});t=page.render(props);assert.equal(toggles(t)[1].props.value,true)
  // source switch while PATCH in flight: result of old source never shown on the new one
  k.patchGate=gate();toggles(t)[0].props.onChanged(false);await settle()
  const k2=kernelOf([mkRule(0,'Domain','other.com','Z',false)]);responder=k2.responder
  const other={...props,active:{...props.active,url:'http://rt-u.invalid'}};t=page.render(other);await settle();t=page.render(other)
  k.patchGate.resolve();await settle();await settle();t=page.render(other);assert.ok(text(t).includes('other.com'));assert.ok(!text(t).includes('a.com'));assert.equal(toggles(t)[0].props.value,true)
  page.close()
 })
 await test('interruptOnRuleDisable: default off + persisted + normalized; closes only matching connections, only on successful disable',async()=>{
  assert.equal(pref.DEFAULTS.interruptOnRuleDisable,false);assert.equal(pref.normalizePreferences({interruptOnRuleDisable:'yes'}).interruptOnRuleDisable,false)
  pref.savePreferences({interruptOnRuleDisable:true});assert.equal(pref.getPreferences().interruptOnRuleDisable,true);pref.savePreferences({interruptOnRuleDisable:false});assert.equal(pref.getPreferences().interruptOnRuleDisable,false)
  const conns=[cn('hit1','Domain','a.com'),cn('hit2','Domain','a.com'),cn('other-payload','Domain','b.com'),cn('other-type','DomainSuffix','a.com'),cn('nomatch','',''),]
  const run=async(on,idx,toDisabled)=>{
   const k=kernelOf([mkRule(0,'Domain','a.com','P',!toDisabled),mkRule(1,'Domain','b.com','Q',false)],conns);responder=k.responder
   pref.savePreferences({interruptOnRuleDisable:on})
   const page=owner(pages.RulesPage),props={active:{...base,id:'rt-int'+Math.random(),url:'http://rt-i.invalid'},version:0,selected:true}
   page.render(props);await settle();let t=page.render(props);toggles(t)[idx].props.onChanged(!toDisabled);await settle();await settle();await settle();page.close();return k
  }
  let k=await run(true,0,true);assert.deepEqual(k.deletes.sort(),['hit1','hit2'],'only matching ids closed, never all')
  k=await run(false,0,true);assert.deepEqual(k.deletes,[],'option off: no interruption')
  k=await run(true,0,false);assert.deepEqual(k.deletes,[],'enabling never interrupts')
  // failed PATCH: no interruption
  const kf=kernelOf([mkRule(0,'Domain','a.com','P',false)],conns);kf.failPatch=true;responder=kf.responder;pref.savePreferences({interruptOnRuleDisable:true})
  const page=owner(pages.RulesPage),props={active:{...base,id:'rt-int-fail',url:'http://rt-f.invalid'},version:0,selected:true};page.render(props);await settle();let t=page.render(props);toggles(t)[0].props.onChanged(false);await settle();await settle();assert.deepEqual(kf.deletes,[]);page.close()
  // partial close failure is summarized
  const kp=kernelOf([mkRule(0,'Domain','a.com','P',false)],conns);const base2=kp.responder;responder=(u,i)=>i?.method==='DELETE'&&u.endsWith('/hit2')?{status:500}:base2(u,i)
  const page2=owner(pages.RulesPage),props2={active:{...base,id:'rt-int-part',url:'http://rt-p.invalid'},version:0,selected:true};page2.render(props2);await settle();t=page2.render(props2);toggles(t)[0].props.onChanged(false);await settle();await settle();await settle();t=page2.render(props2)
  assert.ok(text(t).includes('1 条连接未能关闭'));page2.close();pref.savePreferences({interruptOnRuleDisable:false})
 })
 console.log(count+' rule-toggle groups passed; mocked, no device or router.')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
