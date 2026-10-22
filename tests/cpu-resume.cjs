// Real API -> CpuSampler -> OverviewPage -> CPU card -> Canvas host regression.
// RPC, scene/navigation events and native WebView are mocked. No router/device IO.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
scripting.useState=function(v){const slots=hooks,i=hookIndex++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]}
function owner(fn){const state={hooks:[],cleanups:new Map()};return {render(props){const saved={hooks,cleanups,effects,hookIndex};hooks=state.hooks;cleanups=state.cleanups;effects=[];hookIndex=0;const tree=fn(props),queued=effects;hooks=saved.hooks;cleanups=saved.cleanups;effects=saved.effects;hookIndex=saved.hookIndex;queued.forEach(f=>{const previous=cleanups;cleanups=state.cleanups;f();cleanups=previous});return tree},close(){for(const f of state.cleanups.values())f();state.cleanups.clear()}}}
const timeouts=new Map();let timerID=0
context.setTimeout=(fn,ms)=>{const id=++timerID;timeouts.set(id,{fn,ms});return id};context.clearTimeout=id=>timeouts.delete(id)
let hosts=[]
context.WebViewController=class{constructor(){this.handlers={};this.loads=0;this.messages=[];this.disposed=0;hosts.push(this)}async addScriptMessageHandler(name,fn){this.handlers[name]=fn}async loadHTML(html){this.loads++;this.html=html;return true}async evaluateJavaScript(code){const payload=JSON.parse(code.match(/update\((.*)\)/)[1]);this.messages.push(payload);return true}dispose(){this.disposed++}}
const plot=load('plot-view')
async function settle(){for(let i=0;i<100;i++)await Promise.resolve()}
let serial=0,user=100,idle=900,uptime=100,batches=0,mode='normal'
function fixture(url,init){
 if(url.includes('/cgi-bin/cgi-download'))return {status:403}
 const request=JSON.parse(init.body),[,object,method,args]=request.params,ok=value=>({body:{id:request.id,result:[0,value]}})
 if(object==='session')return ok({ubus_rpc_session:'resume-fixture-session'})
 if(object==='system'&&method==='info'){batches++;return ok({uptime,load:[],memory:{total:1000,free:500}})}
 if(object==='system'&&method==='board')return ok({release:{description:'Fixture'},model:'Fixture board'})
 if(object==='network.interface')return ok({interface:[{interface:'wan',l3_device:'eth0',route:[{target:'0.0.0.0'}]}]})
 if(object==='network.device')return ok({eth0:{statistics:{rx_bytes:uptime*1000,tx_bytes:uptime*2000}}})
 if(object==='file'&&args?.path==='/proc/stat'){
  if(mode==='missing')return {body:{id:request.id,result:[6]}}
  return ok({data:'cpu '+user+' 0 0 '+idle+' 0 0 0 0\n'+'cpu0 '+user+' 0 0 '+idle+' 0 0 0 0\n'+(mode==='hotplug'?'cpu1 1 0 0 9 0 0 0 0\n':'')})
 }
 return ok({})
}
function sample(percent=25){user+=percent;idle+=100-percent;uptime++;now+=1000}
function frame(tree){return nodes(tree,home.HomeDashboard)[0].props}
function hostProps(tree){const f=frame(tree),dashboard=home.HomeDashboard(f),card=home.CpuCard(nodes(dashboard,home.CpuCard)[0].props),grid=nodes(card,home.GridPlot)[0];return grid.props}
function cpuValue(tree){const f=frame(tree),card=home.CpuCard({w:f.overview?.wrt,history:f.histories.cpu.cpu??[],running:f.running}),breakdown=home.CpuBreakdown(nodes(card,home.CpuBreakdown)[0].props);return nodes(breakdown,home.MetricNumber).at(-1).props.value}
const equal=(a,b)=>assert.equal(JSON.stringify(a),JSON.stringify(b))
const failures=[]
async function check(title,fn){try{await test(title,fn)}catch(e){failures.push(title);console.error('FAIL',title,e.message)}}
async function scenario(kind,negative){
 user=100;idle=900;uptime=100;batches=0;mode='normal';responder=fixture
 const device={id:'resume-fixture-'+(++serial),name:'Fixture',kind:'openwrt',url:'http://resume-'+serial+'.invalid',username:'root'}
 let props={active:device,version:0,selected:true,onSwitch(){}}
 const page=owner(app.OverviewPage),canvas=owner(plot.MountedCanvasPlot)
 let tree=page.render(props);await settle();tree=page.render(props);await settle();tree=page.render(props)
 const poll=()=>[...intervals.values()].filter(t=>t.ms===1000)
 async function draw(){tree=page.render(props);canvas.render(hostProps(tree));await settle();return tree}
 async function tick(percent){sample(percent);assert.equal(poll().length,1);poll()[0].fn();await settle();await draw()}
 try{
  assert.equal(cpuValue(tree),undefined,'first-ever baseline is not a sample')
  await tick(20);await tick(40);await tick(60)
  assert.equal(cpuValue(tree),60);equal(frame(tree).histories.cpu.cpu,[20,40,60])
  canvas.render(hostProps(tree));await settle();const host=hosts.at(-1);host.handlers.plotReady();await settle()
  const before=frame(tree),history=before.histories.cpu.cpu,cpus=before.overview.wrt.cpus,priorReads=batches
  if(kind==='background')emitScene('background')
  if(kind==='tab')props={...props,selected:false}
  if(kind==='settings')tree.props.onDisappear()
  await draw();assert.equal(poll().length,0);assert.equal(frame(tree).running,false);equal(frame(tree).histories.cpu.cpu,history);assert.equal(cpuValue(tree),60)
  assert.equal(host.messages.at(-1).running,false)
  // A long gap and changed counters must not become a fabricated live point.
  uptime+=120;user+=9000;idle+=1000;now+=120000
  await settle();assert.equal(batches,priorReads,'no hidden/background RPC polling')
  if(negative==='reboot'){uptime=1;user=1;idle=9}
  if(negative==='missing')mode='missing'
  if(negative==='hotplug')mode='hotplug'
  if(negative==='source')props={...props,active:{...device,url:'http://different-source.invalid'}}
  if(kind==='background')emitScene('active')
  if(kind==='tab')props={...props,selected:true}
  if(kind==='settings'){tree.props.onAppear();props={...props,version:1}}
  tree=page.render(props)
  if(negative==='source'){assert.equal(frame(tree).overview,null);equal(frame(tree).histories.cpu,{})}
  await settle();await draw()
  assert.equal(batches,priorReads+1);assert.equal(poll().length,1)
  if(negative){
    assert.equal(cpuValue(tree),undefined,'changed/missing CPU data remains genuinely unknown')
    assert.ok(!(frame(tree).histories.cpu.cpu??[]).length)
  }else{
    assert.equal(cpuValue(tree),60,'baseline on resume must not erase latest displayed CPU')
    equal(frame(tree).overview.wrt.cpus,cpus);assert.equal(frame(tree).histories.cpu.cpu,history,'resume baseline neither appends nor clears CPU history')
    equal(host.messages.at(-1).samples,history);assert.equal(host.messages.at(-1).running,true)
    await tick(30)
    assert.equal(cpuValue(tree),30);equal(frame(tree).histories.cpu.cpu,[20,40,60,30]);equal(host.messages.at(-1).samples,[20,40,60,30])
    for(const c of frame(tree).overview.wrt.cpus)assert.equal(c.usage,30,'new delta excludes paused interval')
    // A genuine later counter rollback still breaks history; preservation is
    // strictly one resume-baseline frame, not a blanket last-value fallback.
    user=0;idle=0;uptime++;now+=1000;poll()[0].fn();await settle();await draw()
    assert.equal(cpuValue(tree),undefined);equal(frame(tree).histories.cpu.cpu,[])
  }
  assert.equal(host.loads,1,'retained Canvas host must not reload its document');assert.equal(host.disposed,0)
 }finally{page.close();canvas.close();await settle();assert.equal(intervals.size,0);assert.equal(sceneListeners.size,0);assert.equal(timeouts.size,0)}
}
;(async()=>{
 for(const kind of ['background','tab','settings'])await check(kind+': real API baseline retains CPU history/value, then continues with real live delta',()=>scenario(kind))
 for(const negative of ['source','reboot','missing','hotplug'])await check('resume does not conceal '+negative,()=>scenario('settings',negative))
 if(failures.length)throw Error(failures.length+' failed groups: '+failures.join('; '))
 console.log('All '+count+' CPU resume API/host integration groups passed (mock RPC/native lifecycle, not device).')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
