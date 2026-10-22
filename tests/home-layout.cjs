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
 await test('home-ui和Canvas槽AST: 无混合frame；固定高度/宽度，无原生逐帧timer',async()=>{
   const source=fs.readFileSync(path.join(root,'home-ui.tsx'),'utf8');deep(mixedFrames(source),[])
   deep(mixedFrames(fs.readFileSync(path.join(root,'plot-view.tsx'),'utf8')),[])
   for(const plotWidth of [undefined,329,140.5])for(const height of [96,66,76])for(const samples of [[],[2],[1,2],[NaN,Infinity],Array(60).fill(100)]){
     const forwarded=home.GridPlot({samples,tone:'#3485eb',plotHeight:height,running:true,plotWidth})
     assert.equal(forwarded.type,load('plot-view').InlineCanvasPlot)
     const out=render(forwarded.type,forwarded.props,true);await flush()
     deep(out.props.frame,plotWidth===undefined?{height}:{width:plotWidth,height})
     assert.equal(nodes(out,load('plot-view').MountedCanvasPlot).length,1)
     assert.equal(intervals.size,0)
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
 // Continuous geometry and native bridge lifecycle are exercised by plot-canvas-browser.cjs and plot-host.cjs.
 await test('契约(非实机): 负载条 GeometryReader 外有单次固定24pt容器，空值保留灰底条',()=>{
   for(const f of [undefined,NaN,-1,0,0.001,1,2]){
     const c=home.LoadBars({fraction:f,tone:'#17965b'});assert.equal(c.type,'ZStack');deep(c.props.frame,{height:24});assert.equal(c.props.modifiers,undefined)
     const g=c.props.children[0];assert.equal(g.type,'GeometryReader');const row=g.props.children[0]({size:{width:100}});assert.equal(row.props.children.length,24)
     const known=f!==undefined&&Number.isFinite(f)&&f>=0,rects=nodes(row,'RoundedRectangle')
     assert.equal(rects.filter(r=>r.props.fill.opacity===0.12).length,24);assert.equal(rects.filter(r=>r.props.fill.opacity===undefined).length,known&&f>0?24:0)
     for(const r of rects)assert.ok(r.props.frame.height<=24&&r.props.frame.height>0&&r.props.frame.width>0)
   }
 })
 await test('详情页普通VStack承载与全部核心；无整卡快照/memo，数值/元数据每次使用最新',()=>{
   const mk=n=>({cpu:{cpu:[1,2],...Object.fromEntries(Array.from({length:32},(_,i)=>['cpu'+i,[n,n+1]]))}})
   const cpus=Array.from({length:32},(_,i)=>({id:'cpu'+i,usage:i}))
   const tree=home.CpuDetails({overview:{wrt:{cpus:[{id:'cpu'},...cpus],cpuMeta:{}}},histories:mk(1),running:true})
   assert.equal(nodes(tree,'LazyVStack').length,0);assert.equal(nodes(tree,'ScrollView').length,1);const container=nodes(tree,'ScrollView')[0].props.children[0];assert.equal(container.type,'VStack');assert.equal(container.props.spacing,16);deep(container.props.padding,{horizontal:16,top:12,bottom:24});assert.equal(nodes(tree,'Button').length,0)
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
