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
 await test('GridPlot契约(仅检查传给宿主的props，非实机证明): 单次frame、<2点只留占位、无Date域/手工axis values/animation',()=>{
   const cpu=home.CpuCard({history:[],running:false}),traffic=home.TrafficCard({heading:'上传',history:[],tone:'blue',running:false}),core=home.SampledCpuPlot({samples:[]})
   assert.equal(nodes(cpu,home.GridPlot)[0].props.plotHeight,undefined) // default 96
   assert.equal(nodes(traffic,home.GridPlot)[0].props.plotHeight,66);assert.equal(core.props.plotHeight,76)
   for(const height of [96,66,76])for(const samples of [[],[12],NaN]){
     const slotNode=render(home.GridPlot,{samples:samples===samples?samples:[NaN,1],tone:'blue',plotHeight:height,running:false},true)
     assert.equal(slotNode.type,'VStack');deep(slotNode.props.frame,{height});assert.equal(slotNode.props.modifiers,undefined);assert.equal(nodes(slotNode,'Chart').length,0)
   }
   for(const height of [96,66,76])for(const percent of [true,false])for(const samples of [[1,2],[0,0,0],Array(60).fill(100),Array.from({length:80},(_,i)=>i*1024)]){
     const c=render(home.GridPlot,{samples,tone:'blue',plotHeight:height,percent,area:height===66,running:true},true)
     assert.equal(c.type,'Chart');deep(c.props.frame,{height});assert.equal(c.props.modifiers,undefined)
     for(const k of ['animation','chartXScale','chartYAxis.values'])assert.equal(k.includes('.')?c.props.chartYAxis.values:c.props[k],undefined,k)
     assert.equal(c.props.chartXAxis,'hidden');assert.equal(c.props.chartYAxis.valueLabel,false)
     assert.equal(c.props.chartYScale.type,'linear');const y=c.props.chartYScale.domain;assert.ok(Number.isFinite(y.from)&&Number.isFinite(y.to)&&y.from===0&&y.to>0)
     const marks=nodes(c,'LineChart')[0].props.marks;assert.equal(marks.length,Math.min(60,samples.length))
     assert.ok(marks.every(m=>typeof m.label==='string'&&Number.isFinite(m.value)));assert.equal(new Set(marks.map(m=>m.label)).size,marks.length)
     assert.equal(nodes(c,'AreaChart').length,height===66?1:0)
   }unmount()
   const source=fs.readFileSync(path.join(root,'home-ui.tsx'),'utf8');for(const banned of ['new Date','Array.from({length:8}','chartXScale','animation=','Animation'])assert.ok(!source.includes(banned),banned)
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
