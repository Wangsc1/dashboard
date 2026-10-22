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
   const source=fs.readFileSync(path.join(root,'home-ui.tsx'),'utf8');const mixed=mixedFrames(source);// the only allowed mix is the SVG plot frame, verbatim from 1.5.161 which displayed on the device
   assert.equal(mixed.length,1);assert.ok(source.split('\n')[mixed[0]-1].includes('<SVG code={code} resizable frame={{maxWidth:"infinity",height:plotHeight}}/>'))
   // The four pre-fix shapes, plus a mixed chain. Guards against a no-op scanner.
   assert.equal(mixedFrames('<><Chart frame={{minWidth:0,maxWidth:"infinity",height:plotHeight}}/><GeometryReader frame={{minWidth:0,maxWidth:"infinity",height:28}}/><GeometryReader frame={{minWidth:0,maxWidth:"infinity",height:28}}/><GeometryReader frame={{minWidth:0,maxWidth:"infinity",height:8}}/><VStack modifiers={modifiers().frame({height:28,maxWidth:"infinity"})}/></>').length,5)
   assert.equal(mixedFrames('<VStack modifiers={modifiers().frame({height:28}).frame({minWidth:0,maxWidth:"infinity"})}/>').length,0)
   assert.ok(!source.includes('maxHeight:"infinity"'),'home path must not regain unbounded vertical card stretch')
 })
 await test('契约(非实机): GridPlot无Chart/Date/计时器/禁用动画，固定高度，窗口右对齐，线宽一致',()=>{
   for(const plotWidth of [undefined,393-64,(393-48)/2-32])for(const height of [96,66,76])for(const area of [false,true])for(const samples of [[],[5],[1,2],[0,0,0],Array(60).fill(100),Array.from({length:80},(_,i)=>i*1024)]){
     const out=render(home.GridPlot,{samples,tone:'#3485eb',plotHeight:height,area,percent:samples.length!==80,running:true,plotWidth},true)
     assert.equal(intervals.size,0)
     for(const x of ['Chart','LineChart','AreaChart','GeometryReader'])assert.equal(nodes(out,x).length,0)
     const svgs=out.type==='SVG'?[out]:nodes(out,'SVG');assert.ok(svgs.length>=1)
     const data=svgs.at(-1).props.code;assert.ok(!data.includes('NaN')&&!data.includes('Infinity'))
     if(plotWidth===undefined){assert.equal(out.type,'SVG');deep(out.props.frame,{maxWidth:'infinity',height})}
     else{assert.equal(out.type,'ZStack');assert.equal(out.props.clipped,true);deep(out.props.frame,{width:plotWidth,height});assert.equal(svgs.length,2)
       const mover=svgs[1],step=plotWidth/59;assert.equal(mover.props.frame.width,plotWidth+step);assert.equal(typeof mover.props.animation.value,'number');assert.equal(mover.props.rotationEffect,undefined)
       assert.ok(data.includes('viewBox="'+(-step)+' 0 '));assert.equal(svgs[0].props.frame.width,plotWidth)}
     const line=/<path d="(M [^"]+)" fill="none" stroke="#3485eb"/.exec(data)
     if(samples.length<2)assert.equal(line,null)
     else{assert.ok(data.includes('stroke-width="1.5"'));assert.equal(data.includes('fill-opacity="0.10"'),area)
       const xs=[...line[1].matchAll(/ ([\d.]+),[\d.-]+/g)].map(m=>Number(m[1])),w=plotWidth??336;assert.ok(Math.abs(xs.at(-1)-w)<0.02)}
   }
   unmount()
   const source=fs.readFileSync(path.join(root,'home-ui.tsx'),'utf8');for(const banned of ['<Chart','LineChart','AreaChart','new Date','CHART_ANIMATION','withAnimation','rotationEffect','Transition.move'])assert.ok(!source.includes(banned),banned)
   assert.equal(home.PLOT_STROKE,1.5);assert.ok(source.includes('stroke-width="\x24{PLOT_STROKE}"'))
 })
 await test('契约(非实机): 滑动 — 新样本到来时偏移从0经原生animation到-一格；无定时器',async()=>{
   const W=329,props={samples:[1,2,3],tone:'blue',percent:true,running:true,plotWidth:W},mover=o=>nodes(o,'SVG')[1]
   let out=render(home.GridPlot,props,true);assert.equal(mover(out).props.offset.x,-W/59) // mount: no slide
   await flush();out=render(home.GridPlot,props);assert.equal(mover(out).props.offset.x,-W/59);const v0=mover(out).props.animation.value
   const next={...props,samples:[1,2,3,4]};out=render(home.GridPlot,next);assert.equal(mover(out).props.offset.x,0)
   await flush();out=render(home.GridPlot,next);assert.equal(mover(out).props.offset.x,-W/59);assert.notEqual(mover(out).props.animation.value,v0)
   assert.equal(intervals.size,0);unmount()
   const idle={...props,running:false};render(home.GridPlot,idle,true);await flush();assert.equal(mover(render(home.GridPlot,idle)).props.offset.x,-W/59);assert.equal(intervals.size,0);unmount()
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
 await test('契约(非实机): 详情页 LazyVStack+每行可见性：屏外行冻结快照、可见行取最新，无关闭按钮',()=>{
   const mk=n=>({cpu:{cpu:[1,2],...Object.fromEntries(Array.from({length:4},(_,i)=>['cpu'+i,[n,n+1]]))}}),cpus=[{id:'cpu0'},{id:'cpu1'}]
   const tree=home.CpuDetails({overview:{wrt:{cpus:[{id:'cpu'},...Array.from({length:4},(_,i)=>({id:'cpu'+i}))],cpuMeta:{}}},histories:mk(1),running:true})
   assert.equal(nodes(tree,'ScrollView').length,1);assert.equal(nodes(tree,'LazyVStack').length,1);assert.equal(nodes(tree,home.CoreRow).length,2);assert.equal(nodes(tree,'Button').length,0)
   const h1=mk(1),h2=mk(50),props={cpus,w:{cpuMeta:{}},histories:h1,running:true}
   let row=render(home.CoreRow,props,true);const hist=r=>nodes(r,home.CoreCard).map(c=>c.props.history[0])
   assert.deepEqual(hist(row),[1,1]);assert.ok(nodes(row,home.CoreCard).every(c=>c.props.running===true))
   row.props.onDisappear();row=render(home.CoreRow,{...props,histories:h2});assert.deepEqual(hist(row),[1,1]);assert.ok(nodes(row,home.CoreCard).every(c=>c.props.running===false))
   const frozen=row.props.children[0];row=render(home.CoreRow,{...props,histories:mk(70)});assert.equal(row.props.children[0],frozen) // identical elements: nothing to rebuild
   row.props.onAppear();row=render(home.CoreRow,{...props,histories:h2});assert.deepEqual(hist(row),[50,50]);unmount()
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
