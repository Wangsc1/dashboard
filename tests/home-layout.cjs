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
 await test('home-ui AST: JSX及modifiers链无固定/弹性混合frame，反例确实会失败',()=>{
   const source=fs.readFileSync(path.join(root,'home-ui.tsx'),'utf8');deep(mixedFrames(source),[])
   // The four pre-fix shapes, plus a mixed chain. Guards against a no-op scanner.
   assert.equal(mixedFrames('<><Chart frame={{minWidth:0,maxWidth:"infinity",height:plotHeight}}/><GeometryReader frame={{minWidth:0,maxWidth:"infinity",height:28}}/><GeometryReader frame={{minWidth:0,maxWidth:"infinity",height:28}}/><GeometryReader frame={{minWidth:0,maxWidth:"infinity",height:8}}/><VStack modifiers={modifiers().frame({height:28,maxWidth:"infinity"})}/></>').length,5)
   assert.equal(mixedFrames('<VStack modifiers={modifiers().frame({height:28}).frame({minWidth:0,maxWidth:"infinity"})}/>').length,0)
   assert.ok(!source.includes('maxHeight:"infinity"'),'home path must not regain unbounded vertical card stretch')
 })
 await test('Chart与外占位同步明确96/66/76pt；未知/首样本/连续样本不改变槽',()=>{
   const cpu=home.CpuCard({history:[],running:false}),traffic=home.TrafficCard({heading:'上传',history:[],tone:'blue',running:false}),core=home.SampledCpuPlot({samples:[]})
   assert.equal(nodes(cpu,home.GridPlot)[0].props.plotHeight,undefined) // default 96
   assert.equal(nodes(traffic,home.GridPlot)[0].props.plotHeight,66);assert.equal(core.props.plotHeight,76)
   for(const height of [96,66,76])for(const samples of [[],[12],[12,18,32]]){
     const outer=render(home.GridPlot,{samples,tone:'blue',plotHeight:height,running:false},true)
     assert.equal(outer.type,'VStack');assert.equal(outer.props.spacing,0);slot(outer,height)
     const charts=nodes(outer,'Chart');assert.equal(charts.length,1);slot(charts[0],height)
     assert.equal(nodes(charts[0],'LineChart')[0].props.marks.length,samples.length)
   }unmount()
 })
 await test('空/单样本/全零/常量/满窗: JS侧Date与数值域有限、递增且非零区间',()=>{
   for(const percent of [true,false])for(const samples of [[],[0],[100],[0,0],Array(60).fill(0),Array(60).fill(100),Array.from({length:60},(_,i)=>i*1024)]){
     const chart=nodes(render(home.GridPlot,{samples,tone:'blue',percent,running:false},true),'Chart')[0]
     const x=chart.props.chartXScale,y=chart.props.chartYScale
     assert.equal(x.type,'date');assert.equal(y.type,'linear');assert.equal(x.domain.from.getTime(),0);assert.equal(x.domain.to.getTime(),59000)
     assert.ok(Number.isFinite(y.domain.from)&&Number.isFinite(y.domain.to));assert.ok(y.domain.from<y.domain.to);assert.ok(y.domain.to>0)
     const dates=chart.props.chartXAxis.values.values.map(d=>d.getTime()),ys=chart.props.chartYAxis.values.values
     for(const ticks of [dates,ys]){assert.ok(ticks.every(Number.isFinite));assert.ok(ticks.every((v,i)=>i===0||v>ticks[i-1]))}
     const marks=nodes(chart,'LineChart')[0].props.marks;assert.ok(marks.every(m=>Number.isFinite(m.value)&&Number.isFinite(m.label.getTime())&&m.label.getTime()>=0&&m.label.getTime()<=59000))
     assert.ok(marks.every((m,i)=>i===0||m.label.getTime()>marks[i-1].label.getTime()))
   }unmount()
   // This verifies JS objects BEFORE the native bridge, not its Date serialization.
 })
 await test('原生条图明确28/8pt占位，内部绘制不超槽，未知及窄宽保持比例',()=>{
   for(const width of [25,43,144,336])for(const fraction of [undefined,0,0.001,0.5,1,2]){
     for(const build of [()=>home.CapacityBars({fraction,tone:'blue'}),()=>home.LoadBars({fraction,tone:'green'}),()=>home.DiskCapacityBar({used:fraction===undefined?undefined:fraction*100,size:100})]){
       const geometry=build(),height=geometry.props.modifiers.steps[0][1].height
       assert.equal(geometry.type,'GeometryReader');assert.ok(height===28||height===8);slot(geometry,height)
       const contents=geometry.props.children[0]({size:{width,height}})
       assert.equal(contents.props.frame.height,height);assert.equal(contents.props.frame.width,width)
       for(const shape of nodes(contents,'RoundedRectangle')){assert.ok(shape.props.frame.height<=height);assert.ok(shape.props.frame.height>=0)}
     }
   }
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
       assert.ok(readers.length===1||readers.length===3);readers.forEach(n=>slot(n,28))
       // A finite 28pt sibling plus stack spacing separates chart and footer.
       // Text remains intrinsic/unclipped; native Dynamic Type bounds need device verification.
       for(const value of nodes(footer,home.MetricFooterValue))assert.ok(nodes(home.MetricFooterValue(value.props),'Text').every(t=>t.props.lineLimit===undefined))
     }
   }
 })
 console.log(count+' home layout contract groups passed; no native pixel/crash claim')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
