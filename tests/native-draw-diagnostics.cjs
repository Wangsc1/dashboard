// Numeric instrumentation only: no device FPS/visibility assertion.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('/tmp/chk/node_modules/typescript')
let now=10000
const m={exports:{}}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(__dirname+'/../cadence-diagnostics.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module:m,exports:m.exports,Date:class extends Date{static now(){return now}},setTimeout(){throw Error('no timer')},setInterval(){throw Error('no timer')},console:{log(){throw Error('no log')}}})
const d=m.exports
const owner=d.createPlotTrace('home'),t=d.createNativeDrawTrack(owner)
function frame(native,js,cost=2,start=10000,progress=.1,animated=true){now=js;d.recordNativeDraw(t,native,js,js+cost,animated,start,progress)}
function metric(role,key){const s=d.nativeDrawSummary().split('\n').find(l=>l.startsWith(role+'.'+key+':'));return s}
frame(0,10000);frame(.03,10030);frame(.06,10060)
assert.match(metric('home','native'),/n=2 total=60.0ms max=30.0ms/)
assert.match(metric('home','js'),/n=2 total=60.0ms max=30.0ms/)
// Delayed JS vs native scheduler timestamp are separate observations.
frame(.09,10260,60,11000,.2);assert.match(metric('home','native'),/max=30.0ms/);assert.match(metric('home','js'),/max=200.0ms/);assert.match(metric('home','cost'),/max=60.0ms/)
frame(.29,10290,2,12000,.3);assert.match(metric('home','native'),/max=200.0ms/)
assert.match(d.nativeDrawSummary(),/home: animated-draw=5 restart=2/)
// Real sample/model starts do not break continuous interval accounting.
for(let i=1;i<=40;i++)frame(.29+i*.03,10290+i*30,2,12000+i*1000,.5)
assert.match(metric('home','js'),/n=44 /)
// Static draws, explicit lifecycle boundaries, and corrected clocks break segments.
let before=metric('home','js').match(/n=(\d+)/)[1]
frame(50,90000,2,50000,1,false);frame(100,190000,2,50000,.1);assert.match(metric('home','js'),new RegExp('n='+before+' '))
d.resetNativeDrawTrack(t);frame(150,290000);assert.match(metric('home','js'),new RegExp('n='+before+' '))
frame(0,100);assert.match(metric('home','js'),new RegExp('n='+before+' '))
// Same-start progress backstep is observable; changing start is a restart, not a backstep.
frame(.03,130,2,10000,.05);assert.match(d.nativeDrawSummary(),/progress-backstep=1/)
for(let i=0;i<30;i++)frame(.23+i*.2,330+i*200,90,10000,.5)
assert.match(d.nativeDrawSummary(),/慢记录=12\/12/)
assert.equal(d.nativeDrawSummary().split('\n').filter(l=>l.startsWith('-')).length,12)
// Geometry summary contains only normalized delta, never point/sample values.
const geometryOwner=d.createPlotTrace('detail'),g=d.createNativeDrawTrack(geometryOwner),points=[{x:0,y:10},{x:1,y:20}]
d.recordNativeDraw(g,0,1000,1001,true,1000,0,points,100)
points[0].x=.1;points[1].y=25
d.recordNativeDraw(g,.03,1030,1031,true,1000,.03,points,100)
d.recordNativeDraw(g,.06,1060,1061,true,1000,.06,points,100)
assert.match(d.nativeDrawSummary(),/max-normalized-geometry-step=0.10000 stationary-geometry-pairs=1/)
d.disposeNativeDrawTrack(geometryOwner,g)
// Bounded host registry and per-role independent counters, no timers/setters/logs.
const hosts=[];for(let i=0;i<70;i++){const o=d.createPlotTrace('detail');hosts.push([o,d.createNativeDrawTrack(o)])}
assert.match(d.nativeDrawSummary(),/跟踪宿主=64\/64/)
for(const [o,h] of hosts){d.recordNativeDraw(h,0,1000,1001,true,1000,0);d.recordNativeDraw(h,.03,1030,1031,true,1000,.03)}
assert.match(metric('detail','native'),/n=72 total=2160.0ms/)
for(const [o,h] of hosts)d.disposeNativeDrawTrack(o,h)
d.disposeNativeDrawTrack(owner,t);assert.match(d.nativeDrawSummary(),/跟踪宿主=0\/64/)
const summary=d.cadenceSummary();assert.ok(summary.includes('原生连续绘制 v1'));assert.ok(summary.includes('采样/绘图计时摘要'));assert.ok(summary.includes('原生图表生命周期'));assert.ok(summary.includes('不是屏幕FPS'))
console.log('PASS stable 30ms / independent 200ms native+JS gaps / slow draw / sample continuity / lifecycle+static+clock reset / bounded rings and hosts / existing summary integration; no timers or logging')
// v2 A-D have distinct observable signatures, independent of native time/v1.
function stateRow(owner){return d.nativePlotStateSummary().split('\n').find(l=>l.startsWith('id='+owner.id+' '))}
function makeState(){const o=d.createPlotTrace('detail');return [o,d.createNativeDrawTrack(o)]}
const [a,at]=makeState();d.nativePlotUpdate(at,true,true,false,0,false,0,8)
for(let i=0;i<5;i++)d.nativePlotRawDraw(at,undefined,20000+i*30,30)
assert.match(stateRow(a),/updates=1 newRefs=1/);assert.match(stateRow(a),/animStarts=0/);assert.match(stateRow(a),/raw=5 rawAnimating=0 timeMissing=5/)
const [b,bt]=makeState();for(let i=0;i<3;i++)d.nativePlotUpdate(bt,true,true,false,0,false,0,8+i)
assert.match(stateRow(b),/updates=3 newRefs=3 runningTrue=3 runningFalse=0 animStarts=0 updateNotAnimating=3/)
const [c,ct]=makeState();d.nativePlotUpdate(ct,true,true,false,0,true,1000,8)
assert.match(stateRow(c),/animStarts=1/);assert.match(stateRow(c),/raw=0 rawAnimating=0/);assert.match(stateRow(c),/pendingStart=1/)
d.nativePlotUpdate(ct,true,true,true,1000,true,2000,9);assert.match(stateRow(c),/startsWithoutDraw=1/)
const [e,et]=makeState();d.nativePlotUpdate(et,true,true,false,0,true,1000,8)
const gapBefore=Number(d.nativePlotStateSummary().match(/detail.raw-js-active-gap: n=(\d+)/)[1])
for(let i=0;i<3;i++){
 const time=i===1?NaN:undefined,js=30000+i*30
 d.nativePlotRawDraw(et,time,js,31);d.recordNativeDraw(et,time,js,js+1,true,1000,.1+i*.03)
}
assert.match(stateRow(e),/raw=3 rawAnimating=3 timeMissing=2 timeInvalid=1/);assert.match(stateRow(e),/pendingStart=0/)
assert.equal(Number(d.nativePlotStateSummary().match(/detail.raw-js-active-gap: n=(\d+)/)[1]),gapBefore+2,'v1 invalid time cannot erase JS-only gap')
d.nativePlotRawDraw(et,undefined,30100,0)
assert.match(stateRow(e),/notAnimating=1 notRunning=1 notTicking=1 notForeground=1 zeroSize=1/)
// Lifecycle reset/static waiting creates no false cross-segment JS gap.
d.resetNativeDrawTrack(et);d.nativePlotRawDraw(et,undefined,90000,31)
assert.equal(Number(d.nativePlotStateSummary().match(/detail.raw-js-active-gap: n=(\d+)/)[1]),gapBefore+2)
for(let i=0;i<20;i++){d.nativePlotStateEvent(et,'restoreKick');d.nativePlotStateEvent(et,'park')}
d.nativePlotStateEvent(et,'setPausedTrue');d.nativePlotRenderedPause(et,false)
assert.match(stateRow(e),/park=20/);assert.match(stateRow(e),/restoreKick=20/);assert.match(stateRow(e),/expectedPause=1 renderedPause=0/)
const lines=d.nativePlotStateSummary().split('\n'),rowIndex=lines.findIndex(l=>l.startsWith('id='+e.id+' '));assert.equal(lines[rowIndex+1].split(' ').length,8,'only last eight state boundaries')
for(const [o,h] of [[a,at],[b,bt],[c,ct],[e,et]])d.disposeNativeDrawTrack(o,h)
assert.ok(d.cadenceSummary().includes('原生绘制状态 v2'));assert.ok(d.nativePlotStateSummary().split('\n').filter(l=>l.startsWith('id=')).length<=64)
console.log('PASS v2 distinct A/no later refs B/updates but no animation C/animation without draw D/raw draw rejected by time or gates; bounded boundaries, pause mismatch and independent JS gap')
