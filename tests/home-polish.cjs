// Shared Canvas slots/native shape contracts; not native appearance or FPS.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
function geo(n,width){return n.props.children[0]({size:{width}})}
function expand(n,width=144){if(!n||typeof n!=='object')return n;if(n.type===load('plot-view').InlineCanvasPlot)return n;if(typeof n.type==='function')return expand(render(n.type,n.props,true),width);if(n.type==='GeometryReader')return expand(geo(n,width),width);return {...n,props:{...n.props,children:(n.props?.children??[]).map(x=>expand(x,width))}}}
function lum(c){const a=[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return a[0]*0.2126+a[1]*0.7152+a[2]*0.0722}
function contrast(a,b){return (Math.max(lum(a),lum(b))+0.05)/(Math.min(lum(a),lum(b))+0.05)}
;(async()=>{
 await test('完全展开主页/16核详情：Canvas曲线槽+原生形状，保留全部16核',()=>{
   const h={up:[10,20],down:[20,30],cpu:{cpu:[10,20],...Object.fromEntries(Array.from({length:16},(_,i)=>['cpu'+i,[10,20]]))}},o={traffic:{up:10,down:20},wrt:{cpus:[{id:'cpu'},...Array.from({length:16},(_,i)=>({id:'cpu'+i}))],load:[0.09,0.06,0.02],memTotal:100,memFree:50,disk:{used:1,size:100,avail:99},cpuMeta:{}}}
   const main=expand(home.HomeDashboard({overview:o,histories:h,running:false,onCpu(){}})),detail=expand(home.CpuDetails({overview:o,histories:h,running:false}))
   for(const n of [main,detail]){assert.equal(nodes(n,'WebView').length,0);for(const c of ['Chart','LineChart','AreaChart'])assert.equal(nodes(n,c).length,0)}
   assert.equal(nodes(main,load('plot-view').InlineCanvasPlot).length,3);assert.equal(nodes(detail,load('plot-view').InlineCanvasPlot).length,17);assert.ok(nodes(main,'RoundedRectangle').length>0);unmount();assert.equal(intervals.size,0)
 })
 await test('RAM条仍按段计数',()=>{
   const ram=home.CapacityBars({fraction:0.04,tone:'#a179d1'});assert.equal(nodes(ram,'RoundedRectangle').length,24);assert.equal(nodes(ram,'RoundedRectangle').filter(n=>n.props.fill.opacity===0.85).length,1)
 })
 await test('磁盘青色50段圆角条：24%为12段；零/部分段/满/未知保留真实比例',()=>{
   for(const width of [25,120,336])for(const r of [0,0.001,0.012345,0.24,0.333333,1,1.5]){
     const row=geo(home.DiskCapacityBar({used:r*10000,size:10000}),width)
     assert.equal(row.type,'HStack');assert.equal(row.props.frame.height,10);assert.equal(row.props.children.length,50)
     const b=nodes(row,'RoundedRectangle'),base=b.filter(n=>typeof n.props.fill==='object'),active=b.filter(n=>n.props.fill==='#00bdc8')
     assert.equal(base.length,50);assert.ok(base.every(n=>n.props.fill.color==='#00bdc8'&&n.props.fill.opacity===0.12&&n.props.frame.height===10))
     const fullWidth=base.reduce((n,b)=>n+b.props.frame.width,0),filled=active.reduce((n,b)=>n+b.props.frame.width,0)
     assert.ok(Math.abs(filled/fullWidth-Math.min(1,r))<1e-10)
     assert.ok(Math.abs(fullWidth+row.props.spacing*49-width)<1e-8)
     if(r===0.24)assert.equal(active.length,12)
     if(r===0)assert.equal(active.length,0)
     for(const cell of row.props.children){const shapes=nodes(cell,'RoundedRectangle');if(shapes.length===2)assert.ok(shapes[1].props.frame.width<=shapes[0].props.frame.width)}
   }
   for(const size of [undefined,0,-1,NaN,Infinity]){const b=nodes(geo(home.DiskCapacityBar({used:5,size}),336),'RoundedRectangle');assert.equal(b.length,50);assert.ok(b.every(n=>typeof n.props.fill==='object'))}
   for(const used of [undefined,-1,NaN,Infinity]){const b=nodes(geo(home.DiskCapacityBar({used,size:100}),336),'RoundedRectangle');assert.equal(b.length,50);assert.ok(b.every(n=>typeof n.props.fill==='object'))}
   const d=home.DiskCard({w:{disk:{used:123,size:10000,avail:9877,mount:'/',device:'/dev/root'}}});assert.equal(nodes(d,home.DiskCapacityBar).length,1);assert.equal(nodes(d,home.CapacityBars).length,0);assert.ok(text(d).includes('/dev/root'))
 })
 await test('负载日夜对应三色对比提高且不篡改高度，灰卡取样对比>=3',()=>{
   const old=['#77c59a','#dcaf7d','#79aee3'],results=[]
   for(const theme of ['light','dark']){mockColorScheme=theme;const c=home.LoadCard({w:{load:[0.09,0.06,0.02],cpus:[{id:'cpu0'},{id:'cpu1'}]}}),bars=nodes(c.props.bars,home.LoadBars),bg=theme==='light'?'#f2f2f7':'#1c1c1e';assert.equal(new Set(bars.map(n=>n.props.tone)).size,3)
     bars.forEach((b,i)=>{const ratio=contrast(b.props.tone,bg);assert.ok(ratio>=3);if(theme==='light')assert.ok(ratio>contrast(old[i],bg));const f=nodes(home.LoadBars(b.props).props.children[0].props.children[0]({size:{width:43}}),'RoundedRectangle').find(n=>n.props.fill.opacity===undefined);assert.ok(Math.abs(f.props.frame.height-24*[0.09,0.06,0.02][i]/2)<1e-12);results.push({theme,color:b.props.tone,contrast:Number(ratio.toFixed(2))})})
   }mockColorScheme='light';console.log(JSON.stringify(results))
 })
 // CPU三项紧凑布局的契约在 home-layout.cjs 中检查。
 console.log(count+' native home polish groups passed; iOS layout/performance need device checks')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
