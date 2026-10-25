// Deterministic JS work/command accounting; deliberately NOT a device FPS benchmark.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('/tmp/chk/node_modules/typescript')
const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(__dirname+'/../native-plot.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module:m,exports:m.exports});const n=m.exports
const clone=x=>JSON.parse(JSON.stringify(x))
// Exact pre-optimization hot loop, retained to measure point allocations and compare geometry.
function originalAdvance(s,now){if(!s.animating)return;const p=Math.max(0,Math.min(1,(now-s.start)/s.duration)),mix=(a,b)=>a+(b-a)*p;s.shown=s.from.map((a,i)=>({x:mix(a.x,s.to[i].x),y:mix(a.y,s.to[i].y)}));s.scale=mix(s.scaleFrom,s.scaleTo);if(p>=1)s.animating=false}
function input(samples,sampleAt,area=false){return {samples,sampleAt,tone:'#3485eb',area,percent:true,running:true}}
function model(area=false){const s=n.createNativePlot();n.updateNativePlot(s,input(Array.from({length:60},(_,i)=>10+i),10000,area),10000);n.updateNativePlot(s,input(Array.from({length:60},(_,i)=>20+i),11000,area),11000);return s}
function ops(s,grid=false){const a=[],ctx=new Proxy({}, {get:(_,k)=>(...args)=>a.push([k,...args]),set:(_,k,v)=>{a.push([k,v]);return true}});if(grid)n.drawNativeGrid(ctx,{width:145,height:76});else n.drawNativePlot(ctx,{width:145,height:76},s,'#f2f2f7');return a}
const originals=[],current=[],oldPoints=new WeakSet(),newPoints=new WeakSet(),oldArrays=new WeakSet(),newArrays=new WeakSet();let oldPointAllocations=0,newPointAllocations=0,oldArrayAllocations=0,newArrayAllocations=0
for(let i=0;i<20;i++){const s=model(i>17);current.push(s);originals.push(clone(s));s.shown.forEach(p=>newPoints.add(p));newArrays.add(s.shown)}
for(let frame=0;frame<60;frame++)for(let i=0;i<20;i++){
 const old=originals[i],s=current[i],at=11000+(frame+1)*1000/60;originalAdvance(old,at);n.advanceNativePlot(s,at)
 for(const p of old.shown)if(!oldPoints.has(p)){oldPoints.add(p);oldPointAllocations++}
 for(const p of s.shown)if(!newPoints.has(p)){newPoints.add(p);newPointAllocations++}
 if(!oldArrays.has(old.shown)){oldArrays.add(old.shown);oldArrayAllocations++}
 if(!newArrays.has(s.shown)){newArrays.add(s.shown);newArrayAllocations++}
 assert.deepEqual(clone(s.shown),old.shown);assert.equal(s.scale,old.scale)
}
assert.equal(oldPointAllocations,73200);assert.equal(newPointAllocations,0);assert.equal(oldArrayAllocations,1200);assert.equal(newArrayAllocations,0)
// Interrupt a full-window transition after a drawn frame. Mutating shown must never mutate from.
const s=model(),from=clone(s.from);n.advanceNativePlot(s,11300);assert.deepEqual(clone(s.from),from);const painted=clone(s.shown);n.updateNativePlot(s,input(Array.from({length:60},(_,i)=>30+i),11400),11400);const expected=painted.slice(1);expected.push({...expected.at(-1)});assert.deepEqual(clone(s.from),expected);const restartFrom=clone(s.from);n.advanceNativePlot(s,11600);assert.deepEqual(clone(s.from),restartFrom)
// Only exact geometry+scale equality can skip the loop. A new timestamp is still ingested.
for(const length of [2,12,59]){
 const s=n.createNativePlot(),samples=Array(length).fill(0);n.updateNativePlot(s,input(samples,10000),10000);const before=clone(ops(s));n.updateNativePlot(s,input(samples.slice(),11000),11000);assert.equal(s.animating,false);assert.equal(s.lastSampleAt,11000)
 const old=clone(s);old.animating=true
 for(const p of [0,.25,.5,1]){n.advanceNativePlot(s,11000+p*1000);originalAdvance(old,11000+p*1000);assert.deepEqual(clone(s.shown),old.shown);assert.deepEqual(clone(ops(s)),before)}
}
// Do NOT classify full-window zero history as equal geometry: its x coordinates still move.
const zero=n.createNativePlot();n.updateNativePlot(zero,input(Array(60).fill(0),10000),10000);n.updateNativePlot(zero,input(Array(60).fill(0),11000),11000);assert.equal(zero.animating,true)
const line=ops(model()),area=ops(model(true)),grid=ops(model(),true),commandsPerFrame=18*line.length+2*area.length
console.log(JSON.stringify({frames:60,hosts:20,baselinePointAllocations:oldPointAllocations,optimizedPointAllocations:newPointAllocations,baselineShownArrays:oldArrayAllocations,optimizedShownArrays:newArrayAllocations,gridCommands:grid.length,fullWindowLineCommands:line.length,fullWindowAreaCommands:area.length,commandsPerFrame20Hosts:commandsPerFrame,commandsPerSecondAt60Draws:commandsPerFrame*60,bridgeRoundTripsPerSecondIfAll20DrawAt60:1200,note:'Command counts unchanged; theoretical load, not native visibility/FPS measurement'}))
console.log('PASS allocation-free interpolation, 1200 exact frame comparisons, independent interruption origin, exact stationary geometry only; no native performance claim')
