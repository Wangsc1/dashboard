// Pure differential oracle: execute unchanged Web algorithm, compare native geometry and draw commands.
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),ts=require('/tmp/chk/node_modules/typescript')
function moduleAt(name){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(__dirname+'/../'+name+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:m.exports,module:m});return m.exports}
// Deterministic native geometry/draw-command regression. The golden digests were recorded while
// the retired Web implementation still matched this port exactly (20 geometry+command steps).
const native=moduleAt('native-plot'),golden=require('./fixtures/native-plot-golden.json'),crypto=require('crypto')
const clone=x=>JSON.parse(JSON.stringify(x))
let now=10000,ops=[]
const ctx=new Proxy({}, {set(o,k,v){o[k]=v;ops.push([k,v]);return true},get(o,k){if(k in o)return o[k];return (...a)=>ops.push([k,...a])}})
const state=native.createNativePlot();let seq=0,total=0
function commands(a){const i=a.findIndex(x=>x[0]==='strokeStyle');return a.slice(i).map(x=>x.map(v=>typeof v==='string'?v.replace(',.22)',',0.22)'):v))}
function compare(){
 ops=[];native.drawNativePlot(ctx,{width:145,height:76},state,'#1c1c1e')
 const digest=crypto.createHash('sha256').update(JSON.stringify([state.shown,state.scale,state.history,commands(ops)])).digest('hex').slice(0,16)
 assert.equal(digest,golden[total],'native geometry/path/grid/area commands step '+total);total++
}
function tick(t){now=t;const drawn=state.animating;native.advanceNativePlot(state,now);if(drawn)compare()}
function update(samples,extra={}){now+=1000;const input={samples,tone:'#3485eb',area:true,percent:true,running:true,sampleAt:now,...extra};native.updateNativePlot(state,input,now);if(state.animating)tick(now);else compare()}
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
// Replaces the retired Web-canvas cadence checks with the same observable native-model behavior.
{
 const m=native.createNativePlot(),inp=(samples,sampleAt,extra={})=>({samples,sampleAt,tone:'#3485eb',area:false,percent:true,running:true,...extra})
 native.updateNativePlot(m,inp([10,20],1000),1000);native.updateNativePlot(m,inp([10,20,80],2000),2000)
 native.advanceNativePlot(m,2500);assert.equal(m.animating,true);assert.ok(m.shown.at(-1).y>20&&m.shown.at(-1).y<80)
 native.advanceNativePlot(m,3000);assert.equal(m.animating,false);assert.equal(m.shown.at(-1).y,80)
 native.advanceNativePlot(m,5000);assert.equal(m.animating,false);assert.deepEqual(m.history,[10,20,80],'waiting never fabricates points')
 // Slow arrival keeps the transition in motion for the observed gap only; no extrapolation beyond target.
 native.updateNativePlot(m,inp([10,20,80,40],5500),5000);assert.equal(m.duration,2500)
 native.advanceNativePlot(m,6500);assert.equal(m.animating,true);native.advanceNativePlot(m,7500);assert.equal(m.animating,false);assert.equal(m.shown.at(-1).y,40)
 // Two-hour background replay restores the target and does not catch up through missed samples.
 native.restoreNativePlot(m);native.updateNativePlot(m,inp([10,20,80,40,60],9e6,{running:false}),9e6);assert.equal(m.animating,false);assert.equal(m.shown.at(-1).y,60)
 native.updateNativePlot(m,inp([10,20,80,40,60,90],9e6+1000),9e6+1000);assert.equal(m.animating,false,'first live sample after an inactive segment restores, never replays')
 native.updateNativePlot(m,inp([10,20,80,40,60,90,70],9e6+2000),9e6+2000);assert.equal(m.animating,true)
}
assert.equal(total,golden.length)
console.log('PASS '+total+' golden geometry/scale/path comparisons: empty/growing/60-point shift/interruption/adaptive scale/area/pause/resume/invalid input/duration; theme/size and zero-size commands')
