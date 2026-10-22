// Scoped official frame/layout contracts. This does NOT execute the iOS layout engine.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
const deep=(a,b)=>assert.equal(JSON.stringify(a),JSON.stringify(b))
function mixedFrames(source){
  const ast=ts.createSourceFile('home-ui.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),bad=[]
  assert.equal(ast.parseDiagnostics.length,0)
  function inspect(n){
    let obj
    if(ts.isJsxAttribute(n)&&n.name.text==='frame'&&n.initializer&&ts.isJsxExpression(n.initializer))obj=n.initializer.expression
    if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='frame')obj=n.arguments[0]
    if(obj&&ts.isObjectLiteralExpression(obj)){
      const keys=obj.properties.map(p=>p.name?.getText(ast).replace(/["']/g,''))
      if(keys.some(k=>k==='width'||k==='height')&&keys.some(k=>/^(min|max|ideal)(Width|Height)$/.test(k??'')))bad.push(ast.getLineAndCharacterOfPosition(obj.pos).line+1)
    }
    ts.forEachChild(n,inspect)
  }
  inspect(ast);return bad
}
function slot(n,height){
  assert.equal(n.props.frame,undefined)
  deep(n.props.modifiers.steps,[['frame',{height}],['frame',{minWidth:0,maxWidth:'infinity'}]])
  assert.equal(n.props.fixedSize,undefined)
}
;(async()=>{
 await test('home-ui AST: 无混合frame；单SVG始终保留高度/网格，无Chart/双阶段offset动画',async()=>{
   const source=fs.readFileSync(path.join(root,'home-ui.tsx'),'utf8');deep(mixedFrames(source),[])
   assert.equal(mixedFrames('<VStack frame={{height:28,maxWidth:"infinity"}}/>').length,1)
   const plotSource=source.slice(source.indexOf('export function GridPlot'),source.indexOf('export function CpuBreakdown'))
   for(const bad of ['<ZStack','offset=','clipped','Animation.','armed','setInterval','new Date','<Chart'])assert.ok(!plotSource.includes(bad),bad)
   assert.ok(plotSource.includes('useMemo(()=>{'))
   for(const plotWidth of [undefined,329,140.5])for(const height of [96,66,76])for(const samples of [[],[2],[1,2],[NaN,Infinity],Array(60).fill(100)]){
     const out=render(home.GridPlot,{samples,tone:'#3485eb',plotHeight:height,running:true,plotWidth},true);await flush()
     assert.equal(out.type,'SVG');deep(out.props.frame,plotWidth===undefined?{height}:{width:plotWidth,height})
     assert.equal(out.props.animation,undefined);assert.equal(out.props.offset,undefined);assert.equal(out.props.modifiers,undefined)
     assert.ok(out.props.code.includes('stroke-dasharray="3 3"'));assert.ok(!out.props.code.includes('NaN'));assert.ok(!out.props.code.includes('Infinity'))
     assert.equal(intervals.size,0,'offscreen curve never subscribes')
   }unmount()
 })
 await test('共享调度: 所有订阅仅一个50ms timer，最后取消/到期即停止，无独立timer',()=>{
   const chart=load('chart');let a=0,b=0
   const offA=chart.animateChart(()=>{a++;return true}),offB=chart.animateChart(()=>{b++;return true})
   assert.equal(intervals.size,1);assert.ok([...intervals.values()][0].ms>=34)
   for(const t of intervals.values())t.fn();assert.equal(a,1);assert.equal(b,1)
   offA();assert.equal(intervals.size,1);offB();assert.equal(intervals.size,0)
   chart.animateChart(()=>false);for(const t of [...intervals.values()])t.fn();assert.equal(intervals.size,0)
 })
 await test('局部平滑: 可见后新样本连续左移、满60点保留previous，无伪造第61源点；停用/屏外/卸载取消',async()=>{
   const line=o=>/<path d="(M [^"]+)" fill="none" stroke="#3485eb"/.exec(o.props.code)?.[1]
   const start=o=>Number(/M ([\d.-]+),/.exec(line(o))[1])
   let props={samples:Array.from({length:60},(_,i)=>i),tone:'#3485eb',percent:true,running:true,plotWidth:329,area:true}
   let out=render(home.GridPlot,props,true);await flush();out.props.onAppear();out=render(home.GridPlot,props);await flush()
   assert.equal(intervals.size,0,'becoming visible catches up without animating stale history')
   const previousCode=out.props.code,grid=o=>o.props.code.split('</g>')[0]
   now+=1000;props={...props,samples:[...props.samples.slice(1),60]};out=render(home.GridPlot,props);await flush();out=render(home.GridPlot,props)
   assert.equal(intervals.size,1);assert.ok(Math.abs(start(out))<0.02)
   const staticGrid=grid(out),first=line(out)
   now+=500;for(const t of [...intervals.values()])t.fn();out=render(home.GridPlot,props);assert.ok(Math.abs(start(out)+329/59/2)<0.02);assert.notEqual(line(out),first);assert.equal(grid(out),staticGrid)
   now+=500;for(const t of [...intervals.values()])t.fn();out=render(home.GridPlot,props);assert.equal(intervals.size,0);assert.ok(Math.abs(start(out)+329/59)<0.02)
   const stable=render(home.GridPlot,props);assert.equal(stable.props.code,out.props.code)
   now+=1000;props={...props,samples:[...props.samples.slice(1),61]};render(home.GridPlot,props);await flush();assert.equal(intervals.size,1)
   out=render(home.GridPlot,props);out.props.onDisappear();render(home.GridPlot,props);await flush();assert.equal(intervals.size,0)
   now+=1000;props={...props,samples:[...props.samples.slice(1),62]};render(home.GridPlot,props);await flush();assert.equal(intervals.size,0)
   out=render(home.GridPlot,props);out.props.onAppear();render(home.GridPlot,props);await flush()
   now+=1000;props={...props,samples:[...props.samples.slice(1),63]};render(home.GridPlot,props);await flush();assert.equal(intervals.size,1)
   render(home.GridPlot,{...props,running:false});await flush();assert.equal(intervals.size,0)
   render(home.GridPlot,props);await flush();now+=1000;props={...props,samples:[...props.samples.slice(1),64]};render(home.GridPlot,props);await flush();assert.equal(intervals.size,1);unmount();assert.equal(intervals.size,0)
 })
 await test('契约(非实机): 负载条 GeometryReader 外有单次固定24pt容器，空值保留灰底条',()=>{
   for(const f of [undefined,NaN,-1,0,0.001,1,2]){
     const c=home.LoadBars({fraction:f,tone:'#17965b'});assert.equal(c.type,'ZStack');deep(c.props.frame,{height:24});assert.equal(c.props.modifiers,undefined)
     const g=c.props.children[0];assert.equal(g.type,'GeometryReader');const row=g.props.children[0]({size:{width:100}});assert.equal(row.props.children.length,24)
     const known=f!==undefined&&Number.isFinite(f)&&f>=0,rects=nodes(row,'RoundedRectangle')
     assert.equal(rects.filter(r=>r.props.fill.opacity===0.12).length,24);assert.equal(rects.filter(r=>r.props.fill.opacity===undefined).length,known&&f>0?24:0)
     for(const r of rects)assert.ok(r.props.frame.height<=24&&r.props.frame.height>0&&r.props.frame.width>0)
   }
 })
 await test('详情页保留LazyVStack与全部核心；无整卡快照/memo，数值/元数据每次使用最新',()=>{
   const mk=n=>({cpu:{cpu:[1,2],...Object.fromEntries(Array.from({length:32},(_,i)=>['cpu'+i,[n,n+1]]))}})
   const cpus=Array.from({length:32},(_,i)=>({id:'cpu'+i,usage:i}))
   const tree=home.CpuDetails({overview:{wrt:{cpus:[{id:'cpu'},...cpus],cpuMeta:{}}},histories:mk(1),running:true})
   assert.equal(nodes(tree,'LazyVStack').length,1);assert.equal(nodes(tree,'ScrollView').length,1);assert.equal(nodes(tree,'Button').length,0)
   const rs=nodes(tree,home.CoreRow);assert.equal(rs.length,16);assert.equal(rs.flatMap(r=>r.props.cpus).length,32)
   let r=home.CoreRow({cpus:cpus.slice(0,2),w:{cpuMeta:{}},histories:mk(1),running:true});assert.equal(nodes(r,home.CoreCard)[0].props.history[0],1)
   r=home.CoreRow({cpus:[{id:'cpu0',usage:99}],w:{cpuMeta:{cpu0:{mhz:2222}}},histories:mk(50),running:true})
   const card=nodes(r,home.CoreCard)[0];assert.equal(card.props.history[0],50);assert.equal(card.props.cpu.usage,99);assert.equal(card.props.w.cpuMeta.cpu0.mhz,2222)
   const source=fs.readFileSync(path.join(root,'home-ui.tsx'),'utf8'),row=source.slice(source.indexOf('export function CoreRow'),source.indexOf('// Per-core plots'))
   assert.ok(!row.includes('useMemo'));assert.ok(!row.includes('useState'));assert.ok(!row.includes('snap'))
 })
 await test('契约(非实机): RAM条不用GeometryReader，24根等宽柔性条、单一固定24pt行高、2pt间距',()=>{
   for(const fraction of [undefined,0,0.001,0.5,1,2,NaN])for(const [name,build] of [['ram',()=>home.CapacityBars({fraction,tone:'blue'})]]){
     const row=build();assert.equal(row.type,'HStack');assert.equal(row.props.spacing,2);deep(row.props.frame,{minWidth:0,maxWidth:'infinity',minHeight:24,maxHeight:24});assert.equal(row.props.children.length,24)
     assert.equal(nodes(row,'GeometryReader').length,0)
     for(const cell of row.props.children){const f=name==='ram'?cell.props.frame:cell.props.frame;deep(f,{minWidth:0,maxWidth:'infinity',minHeight:24,maxHeight:24})}
     for(const shape of nodes(row,'RoundedRectangle')){const f=shape.props.frame;assert.equal(f.width,undefined);assert.equal(f.height,undefined);assert.ok(f.minHeight<=24&&f.maxHeight===f.minHeight);assert.ok(f.minHeight>=0)}
   }
   for(const width of [25,43,144,336])for(const fraction of [undefined,0,0.001,0.5,1,2]){
     const geometry=home.DiskCapacityBar({used:fraction===undefined?undefined:fraction*100,size:100});assert.equal(geometry.type,'GeometryReader');slot(geometry,8)
     const contents=geometry.props.children[0]({size:{width,height:8}});assert.equal(contents.props.frame.height,8);assert.equal(contents.props.frame.width,width)
   }
 })
 await test('契约(非实机): CPU三项为左侧紧凑组22pt间距，无等分frame，总占用独立靠右；详情同组件',()=>{
   const b=home.CpuBreakdown({cpu:{id:'cpu',usage:1,system:1,user:1,steal:1},running:false}),[group,spacer,total]=b.props.children
   assert.equal(group.props.spacing,22);assert.equal(group.props.frame,undefined);assert.equal(group.props.children.length,3);assert.equal(spacer.type,'Spacer');assert.equal(total.props.alignment,'lastTextBaseline')
   for(const col of group.props.children){assert.equal(col.props.frame,undefined);assert.equal(col.props.alignment,'leading')}
   for(const detail of [false,true])assert.equal(nodes(home.CpuCard({w:{cpus:[{id:'cpu'}]},history:[],running:false,detail}),home.CpuBreakdown).length,1)
 })
 await test('RAM/负载完整路径:有限内容行决定等高背景；header/28pt槽/footer为顺序兄弟，不靠padding猜高度',()=>{
   for(const w of [undefined,{memTotal:16*1024**3,memFree:15*1024**3,load:[0.09,0.06,0.02],cpus:[{id:'cpu0'}]}]){
     const row=home.HomeDashboard({overview:w?{wrt:w,traffic:{}}:null,histories:metrics.newHistory(),running:false,onCpu(){}}).props.children[2]
     assert.equal(row.props.fixedSize,undefined);assert.equal(row.props.frame,undefined);assert.equal(row.props.alignment,'top')
     const bg=row.props.background;assert.equal(bg.type,'HStack');assert.equal(bg.props.children.length,2);assert.equal(bg.props.spacing,row.props.spacing)
     for(const shape of bg.props.children){assert.equal(shape.type,'RoundedRectangle');deep(shape.props.frame,{minWidth:0,maxWidth:'infinity'});assert.equal(shape.props.fill,'secondarySystemBackground')}
     for(const cardNode of row.props.children){
       const card=cardNode.type(cardNode.props),content=card.type(card.props)
       assert.equal(content.type,'VStack');assert.equal(content.props.spacing,12);assert.equal(content.props.fixedSize,undefined)
       deep(content.props.modifiers.steps,[['frame',{minWidth:0,maxWidth:'infinity',alignment:'leading'}],['padding',16]])
       const [header,bars,footer]=content.props.children;assert.equal(header.type,'HStack');assert.equal(footer.type,'HStack')
       const readers=bars.type===home.CapacityBars?[home.CapacityBars(bars.props)]:nodes(bars,home.LoadBars).map(n=>home.LoadBars(n.props))
       assert.ok(readers.length===1||readers.length===3);readers.forEach(n=>{if(bars.type===home.CapacityBars){assert.equal(n.type,'HStack');deep(n.props.frame,{minWidth:0,maxWidth:'infinity',minHeight:24,maxHeight:24})}else{assert.equal(n.type,'ZStack');deep(n.props.frame,{height:24})}})
       assert.equal(content.props.spacing,12) // >=8pt gap below the fixed 24pt row
       // A finite 24pt sibling plus stack spacing separates chart and footer.
       // Text remains intrinsic/unclipped; native Dynamic Type bounds need device verification.
       for(const value of nodes(footer,home.MetricFooterValue))assert.ok(nodes(home.MetricFooterValue(value.props),'Text').every(t=>t.props.lineLimit===undefined))
     }
   }
 })
 console.log(count+' home layout contract groups passed; no native pixel/crash claim')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
