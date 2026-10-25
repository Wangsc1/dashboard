// Real-format Linux/OpenWrt fixtures, all IO and native hooks mocked. No router access.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const harness=fs.readFileSync(path.join(__dirname,'run.cjs'),'utf8').split(';(async () => {')[0]
const checks=String.raw`
// Each simulated component owns its hook slots, including asynchronous setters.
scripting.useState=function(v){const slots=hooks,i=hookIndex++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]}
function owner(fn){const state={hooks:[],cleanups:new Map()};return {render(props){const savedHooks=hooks,savedEffects=effects,savedCleanups=cleanups,savedIndex=hookIndex;hooks=state.hooks;cleanups=state.cleanups;effects=[];hookIndex=0;const tree=fn(props),queued=effects;hooks=savedHooks;effects=savedEffects;cleanups=savedCleanups;hookIndex=savedIndex;queued.forEach(f=>{const previous=cleanups;cleanups=state.cleanups;f();cleanups=previous});return tree},close(){for(const f of state.cleanups.values())f();state.cleanups.clear()}}}
async function settle(){for(let i=0;i<120;i++)await Promise.resolve()}
const deep=(a,b)=>assert.equal(JSON.stringify(a),JSON.stringify(b))
function plotNode(tree,width=336){return tree.props.children[0]({size:{width}})}
function parseRects(svg){return [...svg.matchAll(/<rect ([^>]+)\/>/g)].map(m=>Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(a=>[a[1],a[2]])))}
const {CpuSampler,parseCpuStat,parseCpuInfo,thermalCelsius,newHistory,appendHistory}=metrics
const stat0='cpu  100 0 20 880 0 0 0 0 0 0\ncpu0 50 0 10 440 0 0 0 0 0 0\ncpu2 40 0 10 450 0 0 0 0 0 0\ncpu12 10 0 0 490 0 0 0 0 0 0\n'
const stat1='cpu  140 0 30 930 0 0 0 0 0 0\ncpu0 70 0 15 465 0 0 0 0 0 0\ncpu2 50 0 20 480 0 0 0 0 0 0\ncpu12 20 0 5 525 0 0 0 0 0 0\n'
const cpuinfo='processor : 0\nmodel name : Intel(R) Core(TM) i5 CPU\ncpu MHz : 2194.916\ncache size : 4096 KB\n\nprocessor : 2\nmodel name : Intel(R) Core(TM) i5 CPU\ncpu MHz : 1200.000\ncache size : 4096 KB\n\nprocessor : 12\nmodel name : Intel(R) Core(TM) i5 CPU\n'
let stat=stat0,uptime=100,denied=false,bytes=1000
const device={id:'home-fixture',name:'Fixture router',kind:'openwrt',url:'http://home-fixture.invalid',username:'root'}
function fixture(url,init){if(url.endsWith('/cgi-bin/cgi-download'))return {status:denied?403:200,text:cpuinfo};const req=JSON.parse(init.body),[,object,method,args]=req.params;const ok=x=>({body:{id:req.id,result:[0,x]}})
 if(object==='session')return ok({ubus_rpc_session:'fixture-session'})
 if(object==='system'&&method==='info')return ok({uptime,load:[65536,131072,32768],memory:{total:8589934592,free:2147483648,available:4294967296}})
 if(object==='system'&&method==='board')return ok({kernel:'6.6.80',model:'Fixture Board',release:{description:'OpenWrt 24.10.2',target:'x86/64'}})
 if(object==='network.interface')return ok({interface:[{interface:'wan',l3_device:'eth0',up:true,route:[{target:'0.0.0.0'}]}]})
 if(object==='network.device')return ok({eth0:{statistics:{rx_bytes:bytes,tx_bytes:bytes*2}}})
 if(object==='luci'&&method==='getMountPoints')return ok({result:[{device:'/dev/root',mount:'/',size:10737418240,avail:5368709120}]})
 if(object==='file'&&method==='list')return ok({entries:[{name:'thermal_zone0',type:'link'},{name:'thermal_zone1',type:'link'},{name:'not_a_zone',type:'file'}]})
 if(object==='file'&&method==='read'){
   if(denied)return {body:{id:req.id,result:[6]}}
   const texts={'/proc/stat':stat,'/proc/cpuinfo':cpuinfo,'/proc/sys/net/netfilter/nf_conntrack_count':'123\n','/etc/openwrt_release':"DISTRIB_ARCH='x86_64'\n",'/sys/class/thermal/thermal_zone0/type':'x86_pkg_temp\n','/sys/class/thermal/thermal_zone0/temp':'55000\n','/sys/class/thermal/thermal_zone1/type':'gpu\n','/sys/class/thermal/thermal_zone1/temp':'99000\n'}
   return texts[args.path]!==undefined?ok({data:texts[args.path]}):{body:{id:req.id,result:[4]}}
 }
 return ok({})
}
;(async()=>{
 await test('Linux jiffies: guest不重复、USER含nice、SYS含irq/softirq、STEAL与iowait定义',()=>{
   const cpu=new CpuSampler();assert.equal(cpu.sample('cpu 100 10 20 800 30 5 5 30 40 1\n',10)[0].usage,undefined)
   const r=cpu.sample('cpu 120 15 30 840 35 10 10 40 50 2\n',11)[0]
   assert.equal(parseCpuStat('cpu 100 10 20 800 30 5 5 30 40 1').cpu.total,1000)
   assert.ok(Math.abs(r.usage-55)<1e-9);assert.equal(r.user,25);assert.equal(r.system,20);assert.equal(r.steal,10)
 })
 await test('CPU首次未知、counter/reset/reboot/缺失/热插拔及非连续逻辑ID不伪造',()=>{
   const cpu=new CpuSampler();assert.ok(cpu.sample(stat0,100).every(c=>c.usage===undefined));const r=cpu.sample(stat1,101)
   deep(r.map(c=>c.id),['cpu','cpu0','cpu2','cpu12']);assert.equal(r[0].usage,50);assert.equal(r[1].usage,50);assert.equal(r[2].usage,40)
   assert.ok(cpu.sample(stat0,2).every(c=>c.usage===undefined));assert.ok(cpu.sample(stat0,3).every(c=>c.usage===undefined))
   cpu.sample('',4);assert.ok(cpu.sample(stat1,5).every(c=>c.usage===undefined))
   cpu.sample(stat0,6);const hot=cpu.sample(stat1.replace(/cpu2 [^\n]+\n/,''),7);assert.equal(hot[0].usage,undefined);assert.ok(!hot.some(c=>c.id==='cpu2'))
   const bad=cpu.sample('cpu NaN 0 0 0\ncpu0 -1 0 0 0\n',8);assert.equal(bad.length,0)
 })
 await test('cpuinfo频率缓存只用真实字段，ARM/MIPS不推断；温度必须有CPU/SOC类型',()=>{
   const meta=parseCpuInfo(cpuinfo);assert.ok(meta.model.includes('Intel'));assert.equal(meta.cores.cpu0.mhz,2194.916);assert.equal(meta.cores.cpu2.cacheKB,4096);assert.equal(meta.cores.cpu12.mhz,undefined)
   const arm=parseCpuInfo('processor : 0\nBogoMIPS : 48.00\nCPU architecture : 8\nHardware : Real SoC\n');assert.equal(arm.cores.cpu0.mhz,undefined);assert.equal(arm.cores.cpu0.cacheKB,undefined)
   assert.equal(thermalCelsius('x86_pkg_temp','55000\n'),55);assert.equal(thermalCelsius('gpu','99000'),undefined);assert.equal(thermalCelsius('unknown','55000'),undefined);assert.equal(thermalCelsius('cpu','9999999'),undefined)
 })
 await test('真实格式ubus batch: 1次主采样得到CPU/温度/RAM/挂载点；纯只读且来源隔离',async()=>{
   responder=fixture;calls.length=0;let a=await api.loadOverview(device);assert.equal(a.wrt.cpu,undefined);assert.equal(a.wrt.cpus.length,4);assert.equal(a.wrt.arch,'x86_64');assert.equal(a.wrt.disk.mount,'/');assert.equal(a.wrt.disk.device,'/dev/root');assert.equal(a.wrt.disk.used,5368709120)
   await flush();stat=stat1;uptime++;now+=1000;bytes+=1000;a=await api.loadOverview(device);assert.equal(a.wrt.cpu,50);assert.equal(a.wrt.temperature,55);assert.equal(a.wrt.memFree,4294967296);deep(a.wrt.load,[1,2,0.5]);assert.equal(a.wrt.cpuMeta.cpu0.cacheKB,4096)
   const b={...device,url:'http://changed-home.invalid'};assert.notEqual(api.overviewSource(b),api.overviewSource(device));const other=await api.loadOverview(b);assert.equal(other.wrt.cpu,undefined);assert.equal(other.traffic.down,0)
   const old=api.overviewSource(device);secrets.set('neko_secret_'+device.id,'home-secret-never-log');assert.notEqual(api.overviewSource(device),old);const changed=await api.loadOverview(device);assert.equal(changed.wrt.cpu,undefined)
   for(const call of calls){if(call.url.endsWith('/cgi-bin/cgi-download')){assert.ok(call.init.body.includes('path=%2Fproc%2Fcpuinfo'));continue}const req=JSON.parse(call.init.body);for(const x of Array.isArray(req)?req:[req])assert.ok(['read','list','info','board','status','dump','getMountPoints','login'].includes(x.params[2]))}
   assert.ok(!pref.exportLogs().includes('home-secret-never-log'));assert.ok(!JSON.stringify([...store]).includes('home-secret-never-log'))
 })
 await test('缺失/ACL不允许: CPU/温度/频率未知而不是0，不增加权限',async()=>{
   denied=true;const a=await api.loadOverview({...device,id:'missing-fixture'});assert.equal(a.wrt.cpu,undefined);assert.equal(a.wrt.cpus.length,0);assert.equal(a.wrt.cpuModel,undefined);assert.equal(a.wrt.temperature,undefined);assert.equal(a.wrt.arch,undefined);assert.equal(a.wrt.cpuMeta.cpu0,undefined);denied=false
 })
 await test('慢响应不重叠，暂停代次与同id换URL的旧响应不能写新来源',async()=>{
   const original=context.fetch;let release;const wait=new Promise(r=>{release=r});let batches=0
   context.fetch=async(url,init)=>{const response=await original(url,init);if(init.body.startsWith('[')&&Array.isArray(JSON.parse(init.body))){batches++;await wait}return response}
   const p=api.loadOverview(device),q=api.loadOverview(device);await flush();assert.equal(batches,1);api.resetOverviewSampling(device);release();await assert.rejects(()=>p);await assert.rejects(()=>q);context.fetch=original
   let release2;const wait2=new Promise(r=>{release2=r});context.fetch=async(url,init)=>{const response=await original(url,init);if(url===device.url+'/ubus'&&init.body.startsWith('[')&&Array.isArray(JSON.parse(init.body)))await wait2;return response}
   const pending=api.loadOverview(device);await flush();const next={...device,url:'http://new-source-home.invalid'};const nextSample=await api.loadOverview(next);release2();await pending;assert.equal(nextSample.wrt.cpu,undefined);assert.equal(api.overviewSource(next),api.overviewSource({...next}));context.fetch=original
 })
 await test('histories只保留真实采样且有界，未知/热插拔断开曲线，源切换不复用',()=>{
   let h=newHistory();for(let i=0;i<80;i++)h=appendHistory(h,i,i,[{id:'cpu',usage:i},{id:'cpu2',usage:10}]);assert.equal(h.up.length,60);assert.equal(h.cpu.cpu.length,60)
   h=appendHistory(h,1,1,[{id:'cpu'},{id:'cpu12',usage:30}]);assert.equal(h.cpu.cpu.length,0);assert.equal(h.cpu.cpu2,undefined);deep(h.cpu.cpu12,[30]);assert.equal(newHistory().up.length,0)
 })
 await test('主页设计元素和最新RAM/负载/磁盘布局：无Swap或重复全宽负载',()=>{
   const view=render(home.HomeDashboard,{overview:null,histories:newHistory(),running:true,onCpu(){}},true)
   const cards=view.props.children;assert.equal(cards[0].type,home.CpuCard);deep(nodes(cards[1],home.TrafficCard).map(n=>n.props.heading),['上传','下载']);assert.equal(cards[2].props.children[0].type,home.RamCard);assert.equal(cards[2].props.children[1].type,home.LoadCard);assert.equal(cards[3].type,home.DiskCard)
   assert.equal(nodes(view,home.LoadCard).length,1);assert.ok(!fs.readFileSync(path.join(root,'home-ui.tsx'),'utf8').includes('Swap'))
 })
 await test('RAM/负载共同三槽等高约束、两列受限宽且双行底栏可随字体扩高',()=>{
   const row=home.HomeDashboard({overview:null,histories:newHistory(),running:false,onCpu(){}}).props.children[2]
   assert.equal(row.props.fixedSize,undefined);assert.equal(row.props.spacing,16)
   const backgrounds=row.props.background.props.children;assert.equal(backgrounds.length,2);assert.equal(row.props.background.props.spacing,16)
   for(const bg of backgrounds){assert.equal(bg.type,'RoundedRectangle');assert.equal(bg.props.fill,'secondarySystemBackground');assert.equal(bg.props.cornerRadius,14);deep(bg.props.frame,{minWidth:0,maxWidth:'infinity'})}
   const ram=home.RamCard({w:{memTotal:16*1024**3,memFree:15*1024**3}}),load=home.LoadCard({w:{load:[0.09,0.06,0.02]}})
   for(const card of [ram,load]){
     assert.equal(card.type,home.CompactMetricCard)
     const slots=home.CompactMetricCard(card.props);assert.equal(slots.type,'VStack');assert.equal(slots.props.fixedSize,undefined);assert.equal(slots.props.children.length,3);assert.equal(slots.props.children[0].type,'HStack');assert.equal(nodes(slots.props.children[0],'Text')[0].props.font,16)
     const steps=slots.props.modifiers.steps,frame=steps.find(s=>s[0]==='frame')[1]
     deep(frame,{minWidth:0,maxWidth:'infinity',alignment:'leading'});deep(steps.map(s=>s[0]),['frame','padding']);assert.equal(steps[1][1],16);assert.equal(slots.props.spacing,12);assert.equal(slots.props.background,undefined)
     for(const footer of nodes(card.props.footer,home.MetricFooterValue)){
       const n=home.MetricFooterValue(footer.props);deep(n.props.frame,{minWidth:0,maxWidth:'infinity',alignment:footer.props.valueEdge??'center'});deep(n.props.fixedSize,{horizontal:false,vertical:true});assert.equal(n.props.spacing,3);deep(nodes(n,'Text').map(t=>t.props.font),[12,10]);assert.ok(nodes(n,'Text').every(t=>t.props.lineLimit===undefined))
     }
   }
   assert.equal(ram.props.bars.type,home.CapacityBars);assert.equal(home.CapacityBars(ram.props.bars.props).props.frame.maxHeight,24);assert.ok(nodes(load.props.bars,home.LoadBars).every(n=>home.LoadBars(n.props).props.frame.height===24))
   // Verifies native constraints, not actual iOS bounds or Dynamic Type rendering.
 })
 await test('CPU整卡点击面覆盖绘制层和留白，入口只触发一次；其他卡片不拦截',()=>{
   let opens=0;const onOpen=()=>opens++
   const cpu=home.CpuCard({history:[10,20],running:true,onOpen})
   assert.equal(cpu.props.onOpen,onOpen)
   const card=home.HomeCard(cpu.props),steps=card.props.modifiers.steps
   deep(steps.map(s=>s[0]),['frame','padding','background','overlay'])
   const hit=steps.at(-1)[1]
   assert.equal(hit.type,'RoundedRectangle');assert.equal(hit.props.fill,'clear');assert.equal(hit.props.contentShape,'rect')
   assert.equal(hit.props.frame,undefined,'overlay uses the complete padded base bounds, not a title-sized frame')
   assert.equal(hit.props.onTapGesture,onOpen);assert.equal(card.props.onTapGesture,undefined,'no duplicate parent gesture')
   hit.props.onTapGesture();assert.equal(opens,1)
   assert.equal(hit.props.onDragGesture,undefined)
   for(const other of [home.HomeCard({children:[]}),home.HomeCard(home.CpuCard({history:[],running:true,detail:true}).props)])assert.ok(!other.props.modifiers.steps.some(s=>s[0]==='overlay'))
 })
 await test('主页/CPU详情与其他页面同款系统白底灰卡，移除渐变和阴影',()=>{
   assert.equal(home.HOME_BG,'systemBackground');const card=home.HomeCard({children:[]}),bg=card.props.modifiers.steps.find(s=>s[0]==='background')[1];assert.equal(bg.props.fill,'secondarySystemBackground');assert.equal(card.props.foregroundStyle,'label');assert.equal(card.props.shadow,undefined)
   const detail=home.CpuDetails({overview:null,histories:newHistory(),running:false,onDismiss(){}});assert.equal(detail.props.children[0].props.background,'systemBackground')
   const source=fs.readFileSync(path.join(root,'home-ui.tsx'),'utf8');assert.ok(!source.includes('gradient('));assert.ok(!source.includes('shadow='));assert.ok(source.includes('#17965b'));assert.ok(source.includes('#3485eb'))
 })
 await test('临时非滚动sheet保留全部唯一逻辑核，左上X调用原生关闭且保留下拉关闭',()=>{
   const overview={wrt:{release:'OpenWrt',uptime:100,arch:'x86_64',kernel:'6.6.80',model:'Board',cpus:[{id:'cpu',usage:10},...Array.from({length:17},(_,i)=>({id:'cpu'+i,usage:i}))],cpuMeta:{}}}
   let closed=0;const savedDismiss=scripting.Navigation.useDismiss;scripting.Navigation.useDismiss=()=>()=>{closed++};const sheet=home.CpuDetails({overview,histories:newHistory(),running:false});scripting.Navigation.useDismiss=savedDismiss;assert.equal(sheet.type,'NavigationStack');deep(sheet.props.presentationDetents,['large']);assert.equal(nodes(sheet,'ScrollView').length,0);assert.equal(sheet.props.children[0].type,'VStack');const rowNodes=nodes(sheet,home.CoreRow);assert.equal(rowNodes.length,9);const ids=rowNodes.flatMap(r=>r.props.cpus.map(c=>c.id));assert.equal(ids.length,17);assert.equal(new Set(ids).size,17)
   for(const label of ['Uptime','Arch','Cpu','Kernel','Board']) {const n=nodes(sheet,'Text').find(n=>text(n)===label);assert.ok(n,label);assert.equal(n.props.foregroundStyle,'label')}
   // TEMP non-scrolling sheet isolation; restore ScrollView lookup after device feedback.
   const sc=sheet.props.children[0];const close=sc.props.toolbar.topBarLeading;assert.equal(close.type,'Button');assert.equal(close.props.systemImage,'xmark');assert.equal(close.props.accessibilityLabel,'关闭CPU详情');close.props.action();assert.equal(closed,1);assert.equal(sc.props.toolbar.topBarTrailing,undefined);assert.equal(sheet.props.presentationDragIndicator,'visible')
   const core=home.CoreCard({cpu:{id:'cpu2'},history:[],running:false});assert.ok(text(core).includes('-- MHz'));assert.ok(text(core).includes('-- KB'))
 })
 await test('所有数值逐采样直接显示，无数字timer；曲线共用Canvas槽',async()=>{
   for(const running of [true,false])for(const value of [10,20,0,undefined,NaN]){
     const n=render(home.MetricNumber,{value,unit:'%',digits:1,running},true);await flush()
     assert.equal(text(n),(value===undefined||!Number.isFinite(value)?'--':value.toFixed(1))+'%');assert.equal(intervals.size,0);unmount()
   }
   const chart=render(home.GridPlot,{samples:[10,20,40],tone:'#3485eb',percent:true,running:true},true);await flush();assert.equal(intervals.size,0);assert.equal(chart.type,load('plot-view').InlineCanvasPlot);unmount()
 })
 await test('CPU sheet开关/后台/切Tab: Root单采样链、详情共享样本、旧来源不覆盖',async()=>{
   responder=fixture;store.set('neko_controllers_v1',[device]);store.set('neko_active_v1',device.id)
   const rootOwner=owner(app.Root),page=owner(app.OverviewPage);rootOwner.render({});await settle();rootOwner.render({});await settle()
   const props={active:device,version:0,selected:true,onSwitch(){}};let view=page.render(props);await settle();view=page.render(props);await flush()
   const polling=()=>[...intervals.values()].filter(x=>x.ms===1000);assert.equal(polling().length,1)
   nodes(view,home.HomeDashboard)[0].props.onCpu();view=page.render(props);await flush();assert.equal(view.props.sheet.isPresented,true);assert.equal(polling().length,1);assert.equal(nodes(view,home.HomeDashboard)[0].props.running,false);assert.equal(view.props.sheet.content.props.feed.value.running,true)
   const before=calls.length;view.props.onDisappear();view=page.render(props);await flush();assert.equal(polling().length,1);assert.equal(calls.length,before)
   emitScene('background');view=page.render(props);await flush();assert.equal(polling().length,0);assert.equal(view.props.sheet.content.props.feed.value.running,false)
   emitScene('active');view=page.render(props);await flush();assert.equal(polling().length,1)
   view.props.sheet.onChanged(false);view=page.render(props);await flush();assert.equal(view.props.sheet.isPresented,false);assert.equal(polling().length,1);assert.equal(nodes(view,home.HomeDashboard)[0].props.running,true)
   page.render({...props,selected:false});await flush()
   const next={...props,active:{...device,url:'http://fresh-home.invalid'}};store.set('neko_controllers_v1',[next.active]);rootOwner.render({});await settle();rootOwner.render({});await settle();view=page.render(next);await flush();view=page.render(next);await flush();view=page.render(next);await flush();view=page.render(next);assert.equal(nodes(view,home.HomeDashboard)[0].props.histories.up.length,0)
   page.close();rootOwner.close();await settle();assert.equal(intervals.size,0);assert.equal(sceneListeners.size,0)
 })
 console.log(count+' home dashboard regression groups passed; no real IO/native rendering')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
