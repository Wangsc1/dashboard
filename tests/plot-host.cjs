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
 await test('主页和每核共用绘制组件，不存在详情专用动画实现',()=>{
  const front=nodes(home.CpuCard({history:[10,20],running:true}),home.GridPlot)[0]
  const detail=home.SampledCpuPlot({samples:[10,20],running:true})
  assert.equal(detail.type,home.GridPlot);assert.equal(home.GridPlot(front.props).type,plot.InlineCanvasPlot);assert.equal(home.GridPlot(detail.props).type,plot.InlineCanvasPlot)
 })
 await test('绘制层就绪前WebView透明，避免白块闪现；就绪后显示',async()=>{
  let node=render(plot.MountedCanvasPlot,props,true);await flush();const host=hosts.at(-1)
  assert.equal(nodes(node,'WebView')[0].props.opacity,0)
  const grid=nodes(node,'Canvas')[0];assert.ok(grid,'native grid shown before the WebView is ready');assert.equal(grid.props.opaque,false,'opaque Canvas paints black')
  const ops=[],ctx={setLineDash:a=>ops.push(['dash',a]),beginPath(){},moveTo:(x,y)=>ops.push(['m',x,y]),lineTo:(x,y)=>ops.push(['l',x,y]),stroke:()=>ops.push(['s'])}
  grid.props.draw(ctx,{width:70,height:40});assert.equal(ctx.strokeStyle,'rgba(146,149,163,0.22)');assert.equal(ops.filter(o=>o[0]==='m').length,13);assert.equal(ops.filter(o=>o[0]==='l').length,13);assert.equal(JSON.stringify(ops[0]),'["dash",[3,3]]');assert.equal(JSON.stringify(ops.filter(o=>o[0]==='l')[7]),'["l",70,40]');assert.equal(JSON.stringify(ops.filter(o=>o[0]==='l')[12]),'["l",70,40]')
  host.handlers.plotReady();await flush();node=render(plot.MountedCanvasPlot,props)
  assert.equal(nodes(node,'WebView')[0].props.opacity,1);assert.equal(nodes(node,'Canvas').length,0)
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
 await test('正式界面无诊断区、无额外高度、无报告处理器且默认关闭报告',async()=>{
  for(const height of [66,76,96]){
   const slot=render(plot.InlineCanvasPlot,{...props,plotHeight:height},true);assert.equal(slot.props.frame.height,height)
   const out=render(plot.MountedCanvasPlot,{...props,plotHeight:height},true);assert.equal(out.type,'ZStack');assert.equal(out.props.frame.minHeight,height);assert.equal(out.props.frame.maxHeight,height);const web=nodes(out,'WebView')[0];assert.equal(web.props.frame.minHeight,height);assert.equal(web.props.frame.maxHeight,height)
   assert.equal(out.props.overlay,undefined);assert.equal(out.props.onAppear,undefined)
   await flush();const host=hosts.at(-1);assert.equal(host.handlers.plotDiagnostic,undefined);assert.ok(host.html.includes('diagnosticEnabled=false'));unmount()
  }
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
 await test('组件卸载销毁控制器而非等待消失事件，不启动原生逐帧timer',async()=>{
  const tree=render(plot.InlineCanvasPlot,props,true);assert.equal(nodes(tree,plot.MountedCanvasPlot).length,1)
  await mount();const host=hosts.at(-1);unmount();assert.equal(host.disposed,1);assert.equal(intervals.size,0);assert.equal(timeouts.size,0)
 })
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process})
