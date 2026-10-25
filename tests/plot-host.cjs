// Native hook/controller contract tests. No claim about iPhone appearance/FPS.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
scripting.useState=function(v){const slots=hooks,i=hookIndex++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]}
let hosts=[],timeouts=new Map(),nextTimeout=0
context.setTimeout=(fn)=>{const n=++nextTimeout;timeouts.set(n,fn);return n};context.clearTimeout=n=>timeouts.delete(n)
context.WebViewController=class {
 constructor(){this.handlers={};this.sent=[];this.disposed=0;this.loads=0;hosts.push(this)}
 async addScriptMessageHandler(name,fn){this.handlers[name]=fn}
 async loadHTML(html){this.loads++;this.html=html;return true}
 evaluateJavaScript(code){this.sent.push(code);return new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject})}
 dispose(){this.disposed++}
}
const plot=load('plot-view')
const props={samples:[10,20],tone:'#3485eb',percent:true,running:true}
async function mount(){const node=render(plot.MountedCanvasPlot,props,true);await flush();return node}
;(async()=>{
 await test('reveal保留Canvas/WebView两兄弟身份、位置、frame和controller：首次/详情尺寸/重复painted/恢复/重载',async()=>{
  for(const plotHeight of [66,76,96]){
   timeouts.clear();const p={...props,plotHeight};let out=render(plot.MountedCanvasPlot,p,true);await flush();const h=hosts.at(-1)
   const layers=t=>(t.props.children??[]).filter(Boolean)
   const initial=layers(out);assert.deepEqual(initial.map(n=>n.type),['Canvas','WebView'])
   const stable=()=>{out=render(plot.MountedCanvasPlot,p);const next=layers(out);assert.deepEqual(next.map(n=>[n.type,n.props.key,n.props.frame]),initial.map(n=>[n.type,n.props.key,n.props.frame]));assert.equal(next[1].props.controller,h);return next}
   assert.equal(initial[0].props.opacity??1,1);assert.equal(initial[1].props.opacity,0)
   h.handlers.plotReady({generation:1});h.handlers.plotPainted({generation:1,w:145,h:plotHeight});await flush()
   let next=stable();assert.deepEqual(next.map(n=>n.props.key),['plot-grid','plot-web']);assert.equal(next[0].props.opacity,0);assert.equal(next[1].props.opacity,1);assert.equal(timeouts.size,0)
   h.handlers.plotPainted({generation:1,w:145,h:plotHeight});await flush();stable();assert.equal(timeouts.size,0)
   plot.requestPlotKick('selected');for(const fn of [...timeouts.values()])fn();timeouts.clear();await flush();next=stable();assert.equal(next[1].props.opacity,1,'selected repaint never nudges opacity');h.resolve(true);await flush()
   emitScene('background');emitScene('active');await flush();stable();h.resolve('missing');await flush();assert.equal(h.loads,2)
   next=stable();assert.equal(next[0].props.opacity,1);assert.equal(next[1].props.opacity,0)
   h.handlers.plotReady({generation:2});h.handlers.plotPainted({generation:2,w:145,h:plotHeight});await flush();stable();unmount();assert.equal(timeouts.size,0)
  }
 })

 await test('主页保留+详情摘要/32核同时挂载：同名局部key不共享JS controller、消息和显示状态，关闭详情不销毁主页',async()=>{
  unmount();timeouts.clear();const oldTheme=mockColorScheme;mockColorScheme="dark"
  function owner(p){
   const state={hooks:[],cleanups:new Map()}
   return {draw(){
    const saved={hooks,cleanups,effects,hookIndex};hooks=state.hooks;cleanups=state.cleanups;effects=[];hookIndex=0
    const out=plot.MountedCanvasPlot(p),queued=effects;effects=[];queued.forEach(f=>f())
    hooks=saved.hooks;cleanups=saved.cleanups;effects=saved.effects;hookIndex=saved.hookIndex;return out
   },close(){for(const f of state.cleanups.values())f();state.cleanups.clear()}}
  }
  const main=[96,66,66].map(plotHeight=>owner({...props,plotHeight,elevated:false})),details=[96,...Array(32).fill(76)].map(plotHeight=>owner({...props,plotHeight,elevated:true}))
  const owners=[...main,...details],start=hosts.length
  const trees=owners.map(o=>o.draw());await flush();const ctrls=hosts.slice(start)
  assert.equal(ctrls.length,36);assert.equal(new Set(ctrls).size,36)
  for(let i=0;i<36;i++){
   const layers=trees[i].props.children;assert.deepEqual(layers.map(n=>n.props.key),['plot-grid','plot-web']);assert.equal(layers[1].props.controller,ctrls[i]);assert.equal(ctrls[i].loads,1)
  }
  // One detail's ready/painted must reveal only that instance, not a home or sibling host.
  ctrls[3].handlers.plotReady({generation:1});ctrls[3].handlers.plotPainted({generation:1,w:338,h:96});await flush()
  for(let i=0;i<36;i++){const t=owners[i].draw();assert.equal(nodes(t,'WebView')[0].props.opacity,i===3?1:0)}
  for(let i=0;i<36;i++)if(i!==3){ctrls[i].handlers.plotReady({generation:1});ctrls[i].handlers.plotPainted({generation:1,w:i<3?145:145,h:i<3?(i===0?96:66):76})}
  await flush()
  for(let i=0;i<36;i++){
   const t=owners[i].draw();assert.equal(nodes(t,'Canvas')[0].props.opacity,0);assert.equal(nodes(t,'WebView')[0].props.opacity,1)
   assert.equal(nodes(t,'WebView')[0].props.controller,ctrls[i]);assert.equal(nodes(t,'WebView')[0].props.disabled,true)
   assert.ok(ctrls[i].html.includes('\"background\":\"'+(i<3?'#1c1c1e':'#2c2c2e')+'\"'),'home/detail background payload')
  }
  assert.equal(timeouts.size,0,'no shown-kick timers even with sheet + 32 cores')
  details.forEach(o=>o.close());for(let i=0;i<36;i++)assert.equal(ctrls[i].disposed,i<3?0:1)
  main.forEach(o=>{assert.equal(nodes(o.draw(),'WebView')[0].props.opacity,1);o.close()});assert.equal(timeouts.size,0);mockColorScheme=oldTheme
 })
 await test('详情首次在native appear前已load/painted、关闭切tab再开：id/role/sheet关联生命周期，不改变宿主行为',async()=>{
  const diag=load('cadence-diagnostics'),sheet=diag.createSheetTrace()
  for(let attempt=0;attempt<2;attempt++){
   const p={...props,role:'detail',sheetTrace:sheet,elevated:true};let t=render(plot.MountedCanvasPlot,p,true);await flush();const h=hosts.at(-1)
   assert.equal(h.loads,1,'load does not wait for native attachment')
   h.handlers.plotReady({generation:1});h.handlers.plotPainted({generation:1,w:145,h:76});await flush();t=render(plot.MountedCanvasPlot,p)
   assert.equal(nodes(t,'WebView')[0].props.opacity,1)
   let summary=diag.plotLifecycleSummary(),rows=summary.split('宿主最近里程碑')[1].split('CPU sheet')[0].split('\n').filter(x=>x.includes('role=detail')&&x.includes('sheet='+sheet+' ')),row=rows.at(-1)
   const id=/id=(\d+)/.exec(row)[1];assert.ok(row.includes('load=')&&row.includes('painted=')&&!row.includes('web-appear='),'document paint is distinguishable from native appear')
   const before=h.sent.length;t.props.onAppear();nodes(t,'WebView')[0].props.onAppear();await flush();assert.equal(h.sent.length,before,'diagnostics never trigger bridge/reload')
   t.props.onDisappear();nodes(t,'WebView')[0].props.onDisappear();t.props.onAppear();nodes(t,'WebView')[0].props.onAppear();await flush()
   unmount();summary=diag.plotLifecycleSummary();row=summary.split('\n').find(x=>x.startsWith('id='+id+' '));for(const e of ['host-appear=','host-disappear=','web-appear=','web-disappear=','dispose='])assert.ok(row.includes(e),e)
   assert.equal(timeouts.size,0)
  }
  // Bounded records; different ids must never be merged merely because generation/event match.
  for(let i=0;i<100;i++){const o=diag.createPlotTrace('detail',sheet);diag.plotLifecycle('web-appear',1,undefined,o);diag.sheetLifecycle('appear',sheet);diag.sheetLifecycle('disappear',sheet)}
  const summary=diag.plotLifecycleSummary();assert.ok(summary.split('宿主最近里程碑')[1].split('CPU sheet')[0].split('\n').filter(x=>x.startsWith('id=')).length<=64)
  assert.ok(summary.split('CPU sheet')[1].split('\n').length<=26);assert.ok(!summary.includes('10,20')&&!summary.includes('http'))
 })
 await test('主页和每核共用绘制组件，不存在详情专用动画实现',()=>{
  const front=nodes(home.CpuCard({history:[10,20],running:true}),home.GridPlot)[0]
  const detail=home.SampledCpuPlot({samples:[10,20],running:true})
  assert.equal(detail.type,home.GridPlot);assert.equal(home.GridPlot(front.props).type,plot.InlineCanvasPlot);assert.equal(home.GridPlot(detail.props).type,plot.InlineCanvasPlot)
  assert.equal(front.props.role,'home');assert.equal(detail.props.role,'detail')
  const summary=home.CpuCard({history:[10,20],running:true,detail:true,sheetTrace:71});assert.equal(nodes(summary,home.GridPlot)[0].props.role,'detail');assert.equal(nodes(summary,home.GridPlot)[0].props.sheetTrace,71)
 })
 await test('WebView在页面确认已绘制前保持透明且网格垫底；painted后才显示，丢消息时定时兜底',async()=>{
  let node=render(plot.MountedCanvasPlot,props,true);await flush();let host=hosts.at(-1)
  assert.equal(nodes(node,'WebView')[0].props.opacity,0)
  const grid=nodes(node,'Canvas')[0];assert.ok(grid,'native grid shown before the WebView is ready');assert.equal(grid.props.opaque,false,'opaque Canvas paints black')
  const ops=[],ctx={setLineDash:a=>ops.push(['dash',a]),beginPath(){},moveTo:(x,y)=>ops.push(['m',x,y]),lineTo:(x,y)=>ops.push(['l',x,y]),stroke:()=>ops.push(['s'])}
  grid.props.draw(ctx,{width:70,height:40});assert.equal(ctx.strokeStyle,'rgba(146,149,163,0.22)');assert.equal(ops.filter(o=>o[0]==='m').length,13);assert.equal(ops.filter(o=>o[0]==='l').length,13);assert.equal(JSON.stringify(ops[0]),'["dash",[3,3]]');assert.equal(JSON.stringify(ops.filter(o=>o[0]==='l')[7]),'["l",70,40]');assert.equal(JSON.stringify(ops.filter(o=>o[0]==='l')[12]),'["l",70,40]')
  assert.equal(typeof host.handlers.plotPainted,'function')
  host.handlers.plotReady();await flush();node=render(plot.MountedCanvasPlot,props)
  assert.equal(nodes(node,'WebView')[0].props.opacity,0,'ready alone must not reveal an unpainted WebView');assert.equal(nodes(node,'Canvas').length,1)
  host.handlers.plotPainted();await flush();node=render(plot.MountedCanvasPlot,props)
  assert.equal(nodes(node,'WebView')[0].props.opacity,1);assert.equal(nodes(node,'Canvas').length,1);assert.equal(nodes(node,'Canvas')[0].props.opacity,0)
  node=render(plot.MountedCanvasPlot,props,true);await flush();host=hosts.at(-1);host.handlers.plotReady();await flush()
  for(const fn of [...timeouts.values()])fn();await flush();node=render(plot.MountedCanvasPlot,props)
  assert.equal(nodes(node,'WebView')[0].props.opacity,0,'timer alone never reveals; the document must confirm a painted canvas')
  assert.ok(host.sent.at(-1).includes('plotCanvas?.painted'));host.resolve(true);await flush();node=render(plot.MountedCanvasPlot,props)
  assert.equal(nodes(node,'WebView')[0].props.opacity,1,'lost painted message is recovered only after confirmed paint')
 })
 await test('首次挂载/非启动页首次切入：ready后尺寸未稳定(未绘制)不揭示空WebView，保留原生网格，尺寸到达后painted才揭示',async()=>{
  for(const label of ['启动页首次打开','非启动页首次切入']){
   timeouts.clear();let node=render(plot.MountedCanvasPlot,props,true);await flush();const host=hosts.at(-1)
   host.handlers.plotReady({generation:1});await flush()
   for(let round=0;round<8;round++){
    const fns=[...timeouts.values()];timeouts.clear();fns.forEach(fn=>fn());await flush()
    if(host.resolve){const r=host.resolve;host.resolve=null;r(false);await flush()}
    node=render(plot.MountedCanvasPlot,props)
    assert.equal(nodes(node,'WebView')[0].props.opacity,0,label+': zero-size document stays hidden');assert.equal(nodes(node,'Canvas').length,1,label+': native grid remains')
   }
   host.handlers.plotPainted({generation:1});await flush();node=render(plot.MountedCanvasPlot,props)
   assert.equal(nodes(node,'WebView')[0].props.opacity,1);assert.equal(nodes(node,'Canvas').length,1);assert.equal(nodes(node,'Canvas')[0].props.opacity,0);unmount()
  }
 })
 await test('已painted显示后不得被隐藏：loadHTML迟到false/reject、普通桥接单次失败、过期update、首载期间inactive→active均不重载不撤下',async()=>{
  const shownNow=()=>{const o=render(plot.MountedCanvasPlot,props);return nodes(o,'WebView')[0]?.props.opacity===1&&nodes(o,'Canvas')[0]?.props.opacity===0&&!text(o).includes('失败')}
  for(const how of ['loadFalse','loadReject','bridgeReject','staleFalse','sceneDuringLoad']){
   timeouts.clear();const holdLoad=how.startsWith('load');let finish
   const orig=context.WebViewController.prototype.loadHTML
   if(holdLoad)context.WebViewController.prototype.loadHTML=function(h){this.loads++;this.html=h;return new Promise((res,rej)=>{finish=()=>how==='loadFalse'?res(false):rej(Error('x'))})}
   render(plot.MountedCanvasPlot,props,true);await flush();const host=hosts.at(-1)
   if(how==='sceneDuringLoad'){emitScene('inactive');emitScene('active');await flush();assert.equal(host.loads,1,'in-flight first load is not restarted by scene churn')}
   host.handlers.plotReady({generation:1});host.handlers.plotPainted({generation:1,w:329,h:96});await flush()
   if(holdLoad){finish();await flush()}
   if(how==='bridgeReject'||how==='staleFalse'){render(plot.MountedCanvasPlot,{...props,samples:[1,2,3]});await flush();how==='bridgeReject'?host.reject(Error('transient')):host.resolve(false);await flush()}
   assert.equal(host.loads,1,how+': no reload');assert.ok(shownNow(),how+': painted chart stays visible');
   if(holdLoad)context.WebViewController.prototype.loadHTML=orig
   unmount()
  }
  // Unpainted/failed first load is bounded: one retry, then a visible error (never an endless reload loop).
  timeouts.clear();render(plot.MountedCanvasPlot,props,true);await flush();const h2=hosts.at(-1)
  for(let i=0;i<4;i++){const fns=[...timeouts.values()];timeouts.clear();fns.forEach(f=>f());await flush()}
  assert.ok(h2.loads<=2,'at most one automatic reload');unmount()
 })
 await test('图表生命周期诊断：挂载计数/代次/尺寸/显示进入“复制停顿诊断”，且不含来源或样本',async()=>{
  const diag=load('cadence-diagnostics');render(plot.MountedCanvasPlot,{...props,samples:[11,22,33]},true);await flush();const host=hosts.at(-1)
  host.handlers.plotReady({generation:1});host.handlers.plotPainted({generation:1,w:329,h:96});await flush()
  const t=diag.cadenceSummary();for(const k of ['mount gen=0','load gen=1','ready gen=1','painted gen=1','329x96','shown gen=1','累计挂载=','当前存活='])assert.ok(t.includes(k),k)
  assert.ok(!t.includes('11,22,33')&&!t.includes('http'));unmount();assert.ok(diag.cadenceSummary().includes('dispose gen=1'))
 })
 await test('3.3兼容：脚本消息参数被包装(JSON串/数组/body)仍按代次接受；evaluate返回1/"true"/undefined不触发失败或撤下',async()=>{
  const shownNow=()=>{const o=render(plot.MountedCanvasPlot,props);return nodes(o,'WebView')[0]?.props.opacity===1&&!text(o).includes('失败')}
  for(const wrap of [v=>v,v=>JSON.stringify(v),v=>[v],v=>({body:v})]){
   timeouts.clear();render(plot.MountedCanvasPlot,props,true);await flush();const host=hosts.at(-1)
   assert.equal(host.handlers.plotReady(wrap({generation:99})),false,'wrong generation still rejected')
   assert.equal(host.handlers.plotReady(wrap({generation:1})),true);assert.equal(host.handlers.plotPainted(wrap({generation:1,w:300,h:96})),true);await flush()
   for(const r of [1,'true',undefined]){render(plot.MountedCanvasPlot,{...props,samples:[Math.random()*50,2]});await flush();host.resolve(r);await flush()}
   assert.equal(host.loads,1);assert.ok(shownNow());unmount()
  }
 })
 await test('3.3兼容：消息通道缺失时由文档自检确认就绪(不依赖plotReady)，且仍只在确认painted后揭示',async()=>{
  timeouts.clear();let node=render(plot.MountedCanvasPlot,props,true);await flush();const host=hosts.at(-1)
  assert.equal(nodes(node,'WebView')[0].props.opacity,0)
  ;[...timeouts.values()].at(-1)();await flush();assert.ok(host.sent.at(-1).includes('plotCanvas.alive'));host.resolve(1);await flush()
  assert.ok(timeouts.size>=1,'ready-by-probe schedules the painted confirmation check')
  node=render(plot.MountedCanvasPlot,props);assert.equal(nodes(node,'WebView')[0].props.opacity,0,'ready-by-probe alone does not reveal')
  assert.ok(load('cadence-diagnostics').cadenceSummary().includes('ready-by-probe'));unmount()
 })
 await test('3.3兼容：恢复探针返回值不明时由plotAck确认，不重载；无ack才在超时后重载',async()=>{
  for(const acked of [true,false]){
   timeouts.clear();await mount();const host=hosts.at(-1);host.handlers.plotReady({generation:1});host.handlers.plotPainted({generation:1});await flush();const baseTimers=timeouts.size
   emitScene('inactive');emitScene('active');await flush();const seq=Number(/"seq":(\d+)/.exec(host.sent.at(-1))[1]);host.resolve(undefined);await flush()
   assert.equal(host.loads,1)
   if(acked){host.handlers.plotAck({generation:1,seq});await flush();assert.equal(timeouts.size,baseTimers,'ack clears the probe');assert.equal(host.loads,1)}
   else{const probe=[...timeouts.values()].at(-1);probe();await flush();assert.equal(host.loads,2,'no ack: bounded reload')}
   unmount()
  }
 })
 await test('稳定宿主：shown无额外kick；选中/出现请求合并，保持原生opacity，与后台恢复协同',async()=>{
  const diag=load('cadence-diagnostics'),fire=()=>{const fns=[...timeouts.values()];timeouts.clear();fns.forEach(f=>f())}
  const sentUpdates=h=>h.sent.filter(c=>c.includes('plotCanvas.update')).length
  timeouts.clear();render(plot.MountedCanvasPlot,props,true);await flush();const host=hosts.at(-1)
  assert.equal(sentUpdates(host),0)
  host.handlers.plotReady({generation:1});host.handlers.plotPainted({generation:1,w:329,h:96});await flush()
  // A painted document no longer receives ineffective delayed shown-kicks or native opacity nudges.
  assert.equal(timeouts.size,0,'painted leaves no shown-kick timers')
  assert.equal(sentUpdates(host),0)
  let node=render(plot.MountedCanvasPlot,props);assert.equal(nodes(node,'WebView')[0].props.opacity,1)
  // selected/appear: duplicates coalesce into a single timer and a single update
  const before=sentUpdates(host),t0=timeouts.size
  plot.requestPlotKick('selected');plot.requestPlotKick('appear');plot.requestPlotKick('selected');assert.equal(timeouts.size,t0+1,'duplicate events do not stack timers')
  fire();await flush();assert.equal(sentUpdates(host),before+1);host.resolve(true);await flush()
  // background/resume cooperation: a kick during background is skipped; resume path still owns the repaint
  emitScene('background');plot.requestPlotKick('appear');fire();await flush();assert.equal(sentUpdates(host),before+1,'no bridge while backgrounded')
  now+=7200000;emitScene('active');await flush();assert.equal(sentUpdates(host),before+2);assert.equal(host.loads,1);host.resolve(true);await flush()
  const t=diag.cadenceSummary();assert.ok(t.includes('kick-selected')&&t.includes('kick-skipped'));assert.ok(!t.includes('http'))
  plot.requestPlotKick('selected');unmount();assert.equal(timeouts.size,0,'dispose clears kick timers');plot.requestPlotKick('selected');assert.equal(timeouts.size,0,'unmounted charts unsubscribe')
 })
 await test('reload后仍保持固定宿主，新文档shown无额外定时器',async()=>{
  timeouts.clear();render(plot.MountedCanvasPlot,props,true);await flush();const host=hosts.at(-1)
  host.handlers.plotReady({generation:1});host.handlers.plotPainted({generation:1,w:300,h:96});await flush()
  emitScene('inactive');emitScene('active');await flush();host.resolve('missing');await flush();assert.equal(host.loads,2)
  host.handlers.plotReady({generation:2});host.handlers.plotPainted({generation:2,w:300,h:96});await flush()
  assert.equal(timeouts.size,0);unmount();assert.equal(timeouts.size,0)
 })
 await test('完全不发送原生出现事件：首屏仍创建并加载且只加载一次，首帧携带样本',async()=>{
  const slot=render(plot.InlineCanvasPlot,props,true)
  assert.equal(nodes(slot,plot.MountedCanvasPlot).length,1)
  assert.equal(slot.props.onAppear,undefined);assert.equal(slot.props.onDisappear,undefined)
  const node=render(plot.MountedCanvasPlot,props,true),host=hosts.at(-1)
  assert.equal(nodes(node,'WebView').length,1)
  await flush()
  assert.equal(host.loads,1);assert.ok(host.html.includes('const initial={'));assert.ok(host.html.includes('"samples":[10,20]'))
  render(plot.MountedCanvasPlot,props);await flush();assert.equal(host.loads,1)
  host.handlers.plotReady();await flush();assert.equal(host.sent.length,0,'initial paint needs no evaluateJavaScript round trip')
  unmount();assert.equal(host.disposed,1);assert.equal(timeouts.size,0)
 })
 await test('临时诊断默认可见但不增加图槽高度，仅启用安全绘制状态报告',async()=>{
  for(const height of [66,76,96]){
   const slot=render(plot.InlineCanvasPlot,{...props,plotHeight:height},true);assert.equal(slot.props.frame.height,height)
   const out=render(plot.MountedCanvasPlot,{...props,plotHeight:height},true);assert.equal(out.type,'ZStack');assert.equal(out.props.frame.minHeight,height);assert.equal(out.props.frame.maxHeight,height);const web=nodes(out,'WebView')[0];assert.equal(web.props.frame.minHeight,height);assert.equal(web.props.frame.maxHeight,height)
   assert.equal(out.props.overlay,undefined);assert.equal(typeof out.props.onAppear,'function');assert.equal(typeof nodes(out,'WebView')[0].props.onAppear,'function')
   await flush();const host=hosts.at(-1);assert.equal(host.handlers.plotDiagnostic,undefined);assert.ok(host.html.includes('diagnosticEnabled=false'));assert.ok(!host.html.includes('traceEnabled=true'));assert.ok(!text(out).includes('图诊断 '));unmount()
  }
 })
 await test('详情sheet图表背景：dark用抬升卡片色#2c2c2e，主页保持#1c1c1e，light一致',async()=>{
  const pv=plot.plotBackground
  assert.equal(pv('dark',false),'#1c1c1e');assert.equal(pv('dark',true),'#2c2c2e');assert.equal(pv('light',false),'#f2f2f7');assert.equal(pv('light',true),'#f2f2f7')
  const grid=(tree)=>nodes(tree,home.GridPlot)[0]
  assert.equal(grid(home.CpuCard({history:[],running:false})).props.elevated,false)
  assert.equal(grid(home.CpuCard({history:[],running:false,detail:true})).props.elevated,true)
  assert.equal(home.SampledCpuPlot({samples:[1,2],running:false}).props.elevated,true)
  for(const [theme,elevated,want] of [['dark',false,'#1c1c1e'],['dark',true,'#2c2c2e'],['light',true,'#f2f2f7']]){
   mockColorScheme=theme;const node=render(plot.MountedCanvasPlot,{...props,elevated},true);await flush();const host=hosts.at(-1)
   assert.ok(host.html.includes('"background":"'+want+'"'),theme+' '+elevated);host.handlers.plotReady();await flush();unmount()
  }
  mockColorScheme='light'
 })
 await test('准备好前合并采样；桥接串行；最新值接续；running=false同步',async()=>{
  await mount();const host=hosts.at(-1);assert.ok(host.html.includes('requestAnimationFrame'));assert.equal(host.sent.length,0)
  render(plot.MountedCanvasPlot,{...props,samples:[10,20,30]});await flush();host.handlers.plotReady();await flush();assert.equal(host.sent.length,1);assert.ok(host.sent[0].includes('[10,20,30]'))
  render(plot.MountedCanvasPlot,{...props,samples:[10,20,30,40]});await flush();render(plot.MountedCanvasPlot,{...props,samples:[10,20,30,40,50]});await flush();assert.equal(host.sent.length,1)
  host.resolve(true);await flush();assert.equal(host.sent.length,2);assert.ok(host.sent[1].includes('[10,20,30,40,50]'));host.resolve(true);await flush()
  render(plot.MountedCanvasPlot,{...props,running:false});await flush();assert.ok(host.sent.at(-1).includes('"running":false'));host.resolve(true);await flush();unmount();assert.equal(host.disposed,1);assert.equal(timeouts.size,0)
 })
 await test('卸载拒绝迟到ready、挂起调用完成与后续采样；错误可见',async()=>{
  render(plot.MountedCanvasPlot,props,true);await flush();let host=hosts.at(-1);unmount();host.handlers.plotReady();await flush();assert.equal(host.sent.length,0);assert.equal(host.disposed,1)
  await mount();host=hosts.at(-1);host.handlers.plotReady();await flush();render(plot.MountedCanvasPlot,{...props,samples:[1,2,3]});await flush();unmount();host.resolve(true);await flush();assert.equal(host.sent.length,1);assert.equal(host.disposed,1)
  await mount();host=hosts.at(-1);host.handlers.plotReady();await flush();render(plot.MountedCanvasPlot,{...props,samples:[10,30]});await flush();host.reject(Error('bridge failed'));await flush();const out=render(plot.MountedCanvasPlot,props);assert.ok(text(out).includes('曲线绘制层加载失败'));unmount()
 })
 await test('停顿摘要接收真实桥接/rAF异常，暂停前迟到消息不能污染新代次',async()=>{
  const diag=load('cadence-diagnostics'),session=diag.beginCadenceDiagnostics('private-source-canary');session.resume()
  await mount();const host=hosts.at(-1);host.handlers.plotReady();await flush()
  render(plot.MountedCanvasPlot,{...props,samples:[10,20,30]});await flush();const old=diag.timingToken()
  assert.ok(host.sent[0].includes('"timingEpoch":'+old.epoch))
  session.pause();session.resume();const cut=t=>t.split('图表文档生命周期')[0],before=cut(diag.cadenceSummary())
  host.handlers.plotLag({ms:3000,epoch:old.epoch});now+=3000;host.resolve(true);await flush()
  assert.equal(cut(diag.cadenceSummary()),before,'old span and old rAF message are dropped')
  render(plot.MountedCanvasPlot,{...props,samples:[10,20,30,40]});await flush()
  host.handlers.plotLag({ms:2100,epoch:diag.timingToken().epoch});now+=2200;host.resolve(true);await flush()
  const summary=diag.cadenceSummary();assert.ok(summary.includes('图表文档生命周期'));assert.ok(summary.includes('canvas-gap'));assert.ok(summary.includes('bridge'));assert.ok(!summary.includes('private-source-canary'))
  unmount();session.close();assert.equal(intervals.size,0);assert.equal(timeouts.size,0)
 })
 await test('长后台恢复不依赖父memo/新样本：同一文档重放完整历史且只占一个有效桥接slot',async()=>{
  await mount();const host=hosts.at(-1);host.handlers.plotReady();await flush();host.handlers.plotPainted()
  render(plot.MountedCanvasPlot,{...props,samples:[10,20,30]});await flush();const oldResolve=host.resolve
  const oldSent=host.sent.length
  emitScene('background');now+=7200000
  // No component render between lifecycle events: parent memo can stay identical.
  emitScene('active');await flush();assert.equal(host.loads,1);assert.equal(host.sent.length,oldSent+1)
  assert.ok(host.sent.at(-1).includes('"resume":true'));assert.ok(host.sent.at(-1).includes('[10,20,30]'))
  const resumedResolve=host.resolve
  emitScene('active');await flush();assert.equal(host.sent.length,oldSent+1,'duplicate active creates no second probe')
  oldResolve(false);await flush();assert.equal(host.loads,1,'stale failed evaluate cannot reload the healthy document')
  render(plot.MountedCanvasPlot,{...props,samples:[10,20,30,40]});await flush();assert.equal(host.sent.length,oldSent+1,'new sample waits for current bridge')
  resumedResolve(true);await flush();assert.equal(host.sent.length,oldSent+2);assert.ok(host.sent.at(-1).includes('[10,20,30,40]'))
  host.resolve(true);await flush();unmount();assert.equal(sceneListeners.size,0);assert.equal(intervals.size,0);assert.equal(timeouts.size,0)
 })
 await test('恢复探针发现文档不可用时仅重载图表，旧ready/painted不能揭示新文档',async()=>{
  await mount();const host=hosts.at(-1);host.handlers.plotReady();await flush();host.handlers.plotPainted()
  emitScene('inactive');emitScene('active');await flush();host.resolve('missing');await flush()
  assert.equal(host.loads,2);assert.ok(host.html.includes('"samples":[10,20]'));assert.ok(host.html.includes('"resume":true'))
  assert.equal(host.handlers.plotReady({generation:1}),false);assert.equal(host.handlers.plotPainted({generation:1}),false)
  let out=render(plot.MountedCanvasPlot,props);assert.equal(nodes(out,'WebView')[0].props.opacity,0);assert.equal(nodes(out,'Canvas').length,1)
  host.handlers.plotReady({generation:2});host.handlers.plotPainted({generation:2});await flush();out=render(plot.MountedCanvasPlot,props)
  assert.equal(nodes(out,'WebView')[0].props.opacity,1);assert.equal(host.loads,2)
  unmount();assert.equal(host.disposed,1);assert.equal(sceneListeners.size,0);assert.equal(timeouts.size,0)
 })
 await test('恢复探针本身悬挂时只重载一次当前图表文档并清理超时owner',async()=>{
  await mount();const host=hosts.at(-1);host.handlers.plotReady();host.handlers.plotPainted();await flush()
  emitScene('background');now+=86400000;emitScene('active');await flush();const staleResolve=host.resolve
  assert.equal(timeouts.size,1,'only resume probe');[...timeouts.values()].at(-1)();await flush();assert.equal(host.loads,2);assert.equal(timeouts.size,2,'reload cancels old kicks; only new load deadline and ready-poll remain')
  staleResolve(false);await flush();assert.equal(host.loads,2)
  host.handlers.plotReady({generation:2});const timersAfterReady=timeouts.size;host.handlers.plotReady({generation:2});assert.equal(timeouts.size,timersAfterReady,'ready is idempotent');host.handlers.plotPainted({generation:2});await flush();assert.equal(timeouts.size,0,'painted cancels reveal check; no shown-kick timers')
  unmount();assert.equal(sceneListeners.size,0);assert.equal(timeouts.size,0)
 })
 await test('后台合并样本不发送桥接，恢复保持显式running=false且卸载后无恢复动作',async()=>{
  await mount();const host=hosts.at(-1);host.handlers.plotReady();await flush()
  emitScene('background');render(plot.MountedCanvasPlot,{...props,samples:[30,40],running:false});await flush();assert.equal(host.sent.length,0)
  now+=3600000;emitScene('active');await flush();assert.equal(host.sent.length,1);assert.ok(host.sent[0].includes('"running":false'));assert.ok(host.sent[0].includes('[30,40]'))
  const resolve=host.resolve;unmount();emitScene('background');emitScene('active');resolve(true);await flush();assert.equal(host.sent.length,1);assert.equal(timeouts.size,0)
 })
 await test('组件卸载销毁控制器而非等待消失事件，不启动原生逐帧timer',async()=>{
  const tree=render(plot.InlineCanvasPlot,props,true);assert.equal(nodes(tree,plot.MountedCanvasPlot).length,1)
  await mount();const host=hosts.at(-1);unmount();assert.equal(host.disposed,1);assert.equal(intervals.size,0);assert.equal(timeouts.size,0)
 })
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process})
