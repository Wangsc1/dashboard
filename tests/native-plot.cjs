// Pure differential oracle: execute unchanged Web algorithm, compare native geometry and draw commands.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),ts=require('/tmp/chk/node_modules/typescript')
function moduleAt(name){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(__dirname+'/../'+name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:m.exports,module:m});return m.exports}
const native=moduleAt('native-plot'),web=moduleAt('plot-canvas')
const clone=x=>JSON.parse(JSON.stringify(x))
let now=10000,raf=new Map(),next=0,ops=[]
const ctx=new Proxy({}, {set(o,k,v){o[k]=v;ops.push([k,v]);return true},get(o,k){if(k in o)return o[k];return (...a)=>ops.push([k,...a])}})
const canvas={getContext:()=>ctx,getBoundingClientRect:()=>({width:145,height:76}),width:145,height:76,addEventListener(){}}
const document={querySelector:()=>canvas,body:{style:{}},hidden:false,addEventListener(){}}
const window={devicePixelRatio:1,addEventListener(){}}
const sandbox={window,document,performance:{now:()=>now},innerWidth:145,innerHeight:76,ResizeObserver:class{observe(){}},setTimeout:()=>1,requestAnimationFrame:f=>{raf.set(++next,f);return next},cancelAnimationFrame:n=>raf.delete(n)}
const html=web.plotCanvasHTML();vm.runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1],sandbox)
const state=native.createNativePlot();let seq=0,total=0
function commands(a){const i=a.findIndex(x=>x[0]==='strokeStyle');return a.slice(i).map(x=>x.map(v=>typeof v==='string'?v.replace(',.22)',',0.22)'):v))}
function compare(){
 const old=window.plotCanvas.inspect();assert.deepEqual(clone(state.shown),clone(old.shown));assert.equal(state.scale,old.scale);assert.deepEqual(clone(state.history),clone(old.history))
 const webOps=ops.slice();ops=[];native.drawNativePlot(ctx,{width:145,height:76},state,'#1c1c1e');const nativeOps=ops.slice();ops=[]
 assert.deepEqual(clone(commands(nativeOps)),clone(commands(webOps)),'native path/grid/area commands match Web oracle');total++
}
function tick(t){now=t;ops=[];const callbacks=[...raf.values()];raf.clear();for(const f of callbacks)f(now);native.advanceNativePlot(state,now);if(callbacks.length)compare()}
function update(samples,extra={}){now+=1000;const input={samples,tone:'#3485eb',area:true,percent:true,running:true,sampleAt:now,...extra};ops=[];window.plotCanvas.update({...input,seq:++seq});native.updateNativePlot(state,input,now);if(state.animating)tick(now);else compare()}
update([]);update([10]);update([10,20]);tick(now+500);tick(now+500)
const sixty=Array.from({length:60},(_,i)=>i+10)
update(sixty);tick(now+250);update(sixty.map(x=>x+1));tick(now+400);assert.equal(state.shown.length,61);assert.ok(state.shown[0].x<state.from[0].x)
// Interrupt before the old transition ends; origin is last painted, not unfinished target.
update(sixty.map(x=>x+4));tick(now+350);tick(state.start+state.duration);assert.equal(state.animating,false);assert.ok(Math.abs(state.shown[0].x+1/59)<1e-14)
update([20,40,60],{percent:false,running:false});assert.equal(state.scale,1024)
update([1024,9000,12000],{percent:false});tick(now+500);tick(now+500);assert.equal(state.scale,12000)
update([3,4,5],{running:false});assert.equal(state.animating,false)
update([5,6,7],{running:true,resume:true});assert.equal(state.animating,false)
update([10,NaN,Infinity,20],{area:false});tick(now+500);tick(now+500)
update(sixty,{sampleAt:now+9000});assert.equal(state.duration,2500);tick(now+1250);tick(now+1250)
native.restoreNativePlot(state);assert.deepEqual(clone(state.shown),clone(native.canonicalPlot(state.history)))
ops=[];native.drawNativePlot(ctx,{width:0,height:0},state,'#fff');assert.equal(ops.length,0)
for(const background of ['#f2f2f7','#1c1c1e','#2c2c2e'])for(const height of [66,76,96]){ops=[];native.drawNativePlot(ctx,{width:329,height},state,background);assert.deepEqual(ops[0],['fillStyle',background]);assert.deepEqual(ops[1],['fillRect',0,0,329,height])}
console.log('PASS '+total+' oracle geometry/scale/path comparisons: empty/growing/60-point shift/interruption/adaptive scale/area/pause/resume/invalid input/duration; theme/size and zero-size commands')
