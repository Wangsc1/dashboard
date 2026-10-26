// Synthetic transport and hook owners; no device/network access.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
scripting.useState=function(v){const slots=hooks,i=hookIndex++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]}
function owner(fn){const state={hooks:[],cleanups:new Map()};let props;return {render(p){props=p??props;const saved={hooks,cleanups,effects,hookIndex};hooks=state.hooks;cleanups=state.cleanups;effects=[];hookIndex=0;const tree=fn(props),queued=effects;hooks=saved.hooks;cleanups=saved.cleanups;effects=saved.effects;hookIndex=saved.hookIndex;for(const f of queued){const old=cleanups;cleanups=state.cleanups;f();cleanups=old}return tree},close(){for(const f of state.cleanups.values())f()}}}
async function settle(){for(let i=0;i<150;i++)await Promise.resolve()}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
const c={id:'auto-test',kind:'clash',name:'Auto',url:'http://auto.invalid'},g={name:'Auto group',type:'Selector',now:'a',all:['a','b'],delays:{b:20}}
;(async()=>{
 await test('collapsed group probes only missing delay, manual test still measures all',async()=>{
  const o=owner(pages.GroupSection);calls.length=0;responder=()=>({body:{delay:42}})
  let t=o.render({c,g,onChanged(){}});await settle();assert.equal(calls.filter(x=>x.url.includes('/delay?')).length,1);assert.ok(calls[0].url.includes('/a/delay?'))
  t=o.render();assert.ok(text(t).includes('42ms'));await nodes(t,'Button').find(x=>x.props.systemImage==='bolt.fill').props.action();await settle();assert.equal(calls.filter(x=>x.url.includes('/delay?')).length,3);o.close()
 })
 await test('queued auto requests stop on hide and resume without caching cancelled results',async()=>{
  const o=owner(pages.GroupSection),wait=deferred(),many={name:'queued',type:'Selector',now:'n0',all:Array.from({length:8},(_,i)=>'n'+i),delays:{}};calls.length=0;responder=()=>({wait:wait.promise,body:{delay:51}})
  o.render({c,g:many,autoTest:true,onChanged(){}});await settle();assert.equal(calls.length,5)
  o.render({c,g:many,autoTest:false,onChanged(){}});wait.resolve();await settle();assert.equal(calls.length,5)
  responder=()=>({body:{delay:52}});o.render({c,g:many,autoTest:true,onChanged(){}});await settle();assert.equal(calls.length,13);o.close()
 })
 await test('same group names on different sources do not reuse measured values',async()=>{
  const other={...c,id:'auto-other',url:'http://other.invalid'},o=owner(pages.GroupSection);calls.length=0;responder=()=>({body:{delay:77}})
  o.render({c:other,g,onChanged(){}});await settle();assert.equal(calls.length,1);assert.ok(calls[0].url.startsWith(other.url));o.close()
 })
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInThisContext('(function(require,__dirname,process){'+harness+'\n'+checks+'})',{filename:__filename})(require,__dirname,process)
