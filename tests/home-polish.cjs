// Official native Charts/shape tree contracts; not native appearance or FPS.
const fs=require('node:fs'),vm=require('node:vm')
const harness=fs.readFileSync(__dirname+'/run.cjs','utf8').split(';(async () => {')[0]
const checks=String.raw`
function geo(n,width){return n.props.children[0]({size:{width}})}
function expand(n,width=144){if(!n||typeof n!=='object')return n;if(typeof n.type==='function')return expand(render(n.type,n.props,true),width);if(n.type==='GeometryReader')return expand(geo(n,width),width);return {...n,props:{...n.props,children:(n.props?.children??[]).map(x=>expand(x,width))}}}
function lum(c){const a=[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return a[0]*0.2126+a[1]*0.7152+a[2]*0.0722}
function contrast(a,b){return (Math.max(lum(a),lum(b))+0.05)/(Math.min(lum(a),lum(b))+0.05)}
;(async()=>{
 await test('完全展开主页/16核详情：SVG曲线+原生形状，无Chart/GeometryReader曲线/WebView',()=>{
   const h={up:[10,20],down:[20,30],cpu:{cpu:[10,20],...Object.fromEntries(Array.from({length:16},(_,i)=>['cpu'+i,[10,20]]))}},o={traffic:{up:10,down:20},wrt:{cpus:[{id:'cpu'},...Array.from({length:16},(_,i)=>({id:'cpu'+i}))],load:[0.09,0.06,0.02],memTotal:100,memFree:50,disk:{used:1,size:100,avail:99},cpuMeta:{}}}
   const main=expand(home.HomeDashboard({overview:o,histories:h,running:false,onCpu(){}})),detail=expand(home.CpuDetails({overview:o,histories:h,running:false}))
   for(const n of [main,detail]){assert.equal(nodes(n,'WebView').length,0);for(const c of ['Chart','LineChart','AreaChart'])assert.equal(nodes(n,c).length,0)}
   assert.equal(nodes(main,'SVG').length,3);assert.equal(nodes(detail,'SVG').length,17);assert.ok(nodes(main,'RoundedRectangle').length>0);unmount();assert.equal(intervals.size,0)
 })
 await test('负载条契约(非实机): 与RAM同类HStack+RoundedRectangle，每格轨道+填充高度和为24，空值保留灰轨',()=>{
   for(const f of [0,0.09/16,0.06/16,0.02/16,0.333,1,2,undefined,NaN,-1]){
     const row=home.LoadBars({fraction:f,tone:'#17965b'}),known=f!==undefined&&Number.isFinite(f)&&f>=0,fillH=known?24*Math.min(1,f):0
     assert.equal(row.type,'HStack');assert.equal(row.props.children.length,24);assert.equal(nodes(row,'GeometryReader').length,0);assert.equal(nodes(row,'ZStack').length,0)
     for(const cell of row.props.children){
       assert.equal(cell.type,'VStack');assert.equal(cell.props.spacing,0);const rs=nodes(cell,'RoundedRectangle');assert.ok(rs.length>=1&&rs.length<=2)
       const track=rs.filter(r=>r.props.fill.opacity===0.12),fg=rs.filter(r=>r.props.fill.opacity===0.85),sum=rs.reduce((a,r)=>a+r.props.frame.minHeight,0)
       assert.ok(Math.abs(sum-24)<1e-9);assert.equal(fg.length,fillH>0?1:0);if(fillH>0)assert.ok(Math.abs(fg[0].props.frame.minHeight-fillH)<1e-9)
       assert.equal(track.length,fillH<24?1:0);for(const r of rs)assert.equal(r.props.frame.minHeight,r.props.frame.maxHeight)
     }
   }
   const ram=home.CapacityBars({fraction:0.04,tone:'#a179d1'});assert.equal(nodes(ram,'RoundedRectangle').length,24);assert.equal(nodes(ram,'RoundedRectangle').filter(n=>n.props.fill.opacity===0.85).length,1)
 })
 await test('磁盘原生连续细条：0/低于一段/非整百分比/满/未知/非法size，不造最小值',()=>{
   for(const width of [120,336])for(const r of [0,0.001,0.012345,0.333333,1,1.5]){const b=nodes(geo(home.DiskCapacityBar({used:r*10000,size:10000}),width),'RoundedRectangle');assert.equal(b.length,2);assert.ok(Math.abs(b[1].props.frame.width-Math.min(1,r)*width)<1e-10);assert.equal(b[1].props.frame.height,8)}
   for(const size of [undefined,0,-1,NaN,Infinity])assert.equal(nodes(geo(home.DiskCapacityBar({used:5,size}),336),'RoundedRectangle').length,1)
   for(const used of [undefined,-1,NaN,Infinity])assert.equal(nodes(geo(home.DiskCapacityBar({used,size:100}),336),'RoundedRectangle').length,1)
   const d=home.DiskCard({w:{disk:{used:123,size:10000,avail:9877,mount:'/',device:'/dev/root'}}});assert.equal(nodes(d,home.DiskCapacityBar).length,1);assert.equal(nodes(d,home.CapacityBars).length,0);assert.ok(text(d).includes('/dev/root'))
 })
 await test('负载日夜对应三色对比提高且不篡改高度，灰卡取样对比>=3',()=>{
   const old=['#77c59a','#dcaf7d','#79aee3'],results=[]
   for(const theme of ['light','dark']){mockColorScheme=theme;const c=home.LoadCard({w:{load:[0.09,0.06,0.02],cpus:[{id:'cpu0'},{id:'cpu1'}]}}),bars=nodes(c.props.bars,home.LoadBars),bg=theme==='light'?'#f2f2f7':'#1c1c1e';assert.equal(new Set(bars.map(n=>n.props.tone)).size,3)
     bars.forEach((b,i)=>{const ratio=contrast(b.props.tone,bg);assert.ok(ratio>=3);if(theme==='light')assert.ok(ratio>contrast(old[i],bg));const f=nodes(home.LoadBars(b.props),'RoundedRectangle').find(n=>n.props.fill.opacity===0.85);assert.ok(Math.abs(f.props.frame.minHeight-24*[0.09,0.06,0.02][i]/2)<1e-12);results.push({theme,color:b.props.tone,contrast:Number(ratio.toFixed(2))})})
   }mockColorScheme='light';console.log(JSON.stringify(results))
 })
 // CPU三项紧凑布局的契约在 home-layout.cjs 中检查。
 console.log(count+' native home polish groups passed; iOS layout/performance need device checks')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
