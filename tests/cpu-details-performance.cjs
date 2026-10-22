// Shared Canvas slot contracts; not native scroll FPS.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
;(async()=>{
 await test('屏外16/32核按1秒样本更新：每核无16ms数字计时器、无曲线订阅',async()=>{
   for(const cores of [16,32]){
     let charts=0,marks=0
     for(let sample=0;sample<3;sample++)for(let i=0;i<cores;i++){
       const card=home.CoreCard({cpu:{id:'cpu'+i,usage:10+sample},history:[10,20,30+sample],running:true});assert.equal(nodes(card,home.MetricNumber).length,0)
       const p=nodes(card,home.SampledCpuPlot)[0],child=home.SampledCpuPlot(p.props);assert.equal(child.type,home.GridPlot);assert.equal(child.props.running,true)
       const chart=render(home.GridPlot,child.props,true);await flush();assert.equal(chart.type,load('plot-view').InlineCanvasPlot);charts++
     }
     assert.equal(intervals.size,0);const before=intervals.size;now+=1000;for(const timer of intervals.values())timer.fn();assert.equal(intervals.size,before)
     console.log(JSON.stringify({cores,realSampleUpdates:3,canvasSlotsBuilt:charts,jsAnimationTimers:intervals.size,betweenSampleJsChartCallbacks:0}));unmount()
   }
 })
 await test('摘要可见才允许曲线订阅，离屏/后台停止；详情数字无插值定时器，卸载释放',async()=>{
   const props={history:[10,20],running:true};let s=render(home.DetailCpuSummary,props,true);assert.equal(nodes(s,home.CpuCard)[0].props.running,true)
   assert.equal(s.props.onAppear,undefined);assert.equal(s.props.onDisappear,undefined)
   s=render(home.DetailCpuSummary,{...props,running:false});assert.equal(nodes(s,home.CpuCard)[0].props.running,false)
   const card=home.CpuCard({history:[10,20],running:true,detail:true});assert.equal(nodes(card,home.CpuBreakdown)[0].props.running,false);assert.equal(nodes(card,home.GridPlot)[0].props.running,true)
   let c=render(home.GridPlot,{samples:[10,20],tone:'#3485eb',running:true,percent:true},true);await flush();assert.equal(c.type,load('plot-view').InlineCanvasPlot);assert.equal(intervals.size,0)
   now+=1000;c=render(home.GridPlot,{samples:[10,20,30],tone:'#3485eb',running:false,percent:true});await flush();assert.equal(c.type,load('plot-view').InlineCanvasPlot);assert.equal(intervals.size,0);unmount();assert.equal(intervals.size,0)
 })
 await test('sheet实时采样时主页节点/数据冻结，下拉关闭立即接最新样本，无额外轮询',async()=>{
   const raw=(n,type)=>{if(n?.type===type)return n;for(const child of n?.props?.children??[]){const found=raw(child,type);if(found)return found}};let t=0;responder=(url,init)=>{if(url.endsWith('/cgi-bin/cgi-download'))return {status:403};const q=JSON.parse(init.body),[,obj,method,args]=q.params;let body={};if(obj==='session')body={ubus_rpc_session:'performance-fixture'};if(obj==='system'&&method==='info')body={uptime:100+t,memory:{total:100,free:50},load:[]};if(obj==='system'&&method==='board')body={release:{description:'Fixture'}};if(args?.path==='/proc/stat'){t++;body={data:'cpu '+(100+t*10)+' 0 20 '+(880+t*10)+' 0 0 0 0\n'+'cpu0 '+(100+t*10)+' 0 20 '+(880+t*10)+' 0 0 0 0\n'}}return {body:{id:q.id,result:[0,body]}}}
   const props={active:{id:'frozen-home',kind:'openwrt',url:'http://frozen-home.invalid'},version:0,selected:true,onSwitch(){}};render(app.OverviewPage,props,true);await flush();let view=render(app.OverviewPage,props);nodes(view,home.HomeDashboard)[0].props.onCpu();view=render(app.OverviewPage,props);await flush();view=render(app.OverviewPage,props);const frozen=raw(view,home.HomeDashboard),stableContent=view.props.sheet.content
   for(let i=0;i<4;i++){now+=1000;for(const timer of [...intervals.values()])if(timer.ms===1000)timer.fn();await flush();view=render(app.OverviewPage,props);assert.equal(raw(view,home.HomeDashboard),frozen);assert.equal(view.props.sheet.content,stableContent,'sheet content identity stays fixed across actual polling updates')}
   assert.ok(view.props.sheet.content.props.feed.value.histories.cpu.cpu.length>frozen.props.histories.cpu.cpu.length);assert.equal([...intervals.values()].filter(x=>x.ms===1000).length,1)
   view.props.sheet.onChanged(false);view=render(app.OverviewPage,props);assert.notEqual(raw(view,home.HomeDashboard),frozen);assert.equal(view.props.sheet.isPresented,false);unmount();assert.equal(intervals.size,0)
 })
 console.log(count+' native CPU performance groups passed; no device FPS claim')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
