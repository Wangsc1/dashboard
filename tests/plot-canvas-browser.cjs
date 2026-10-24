// Real browser Canvas/rAF verification, not iPhone WKWebView FPS certification.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const ts=require('/tmp/chk/node_modules/typescript'),vm=require('node:vm')
const js=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../plot-canvas.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
const mod={exports:{}};vm.runInNewContext(js,{exports:mod.exports});const html=mod.exports.plotCanvasHTML()
const {chromium,webkit}=require(process.env.PLAYWRIGHT_PATH||'/tmp/neko-editor-build/node_modules/playwright')
;(async()=>{
 for(const [name,type] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await type.launch({headless:true,args:name==='chromium'?['--no-sandbox']:[]})
  try{
   const page=await browser.newPage({viewport:{width:329,height:96},deviceScaleFactor:3}),errors=[],requests=[]
   page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));await page.route('**/*',r=>r.abort())
   const bridge='<script>window.readyCalls=0;window.paintedCalls=0;window.diagnostics=[];window.webkit={messageHandlers:{plotDiagnostic:{postMessage(value){window.diagnostics.push(value);return Promise.resolve(true)}},plotReady:{postMessage(){window.readyCalls++;return Promise.resolve(true)}},plotPainted:{postMessage(){window.paintedCalls++;return Promise.resolve(true)}}}};</script>'
   const doc=html.replace('<script>',bridge+'<script>')
   await page.setContent(doc);await page.waitForFunction(()=>window.plotCanvas&&window.readyCalls===1);await page.waitForFunction(()=>window.paintedCalls===1,null,{timeout:3000});assert.equal(await page.evaluate(()=>window.paintedCalls),1,'plotPainted is sent exactly once after a real frame')
   const send=(seq,samples,running=true)=>page.evaluate(m=>window.plotCanvas.update(m),{seq,samples,running,tone:'#3485eb',percent:true,area:false})
   await send(1,[10,20]);const base=await page.evaluate(()=>window.plotCanvas.inspect())
   await send(2,[10,20,80]);await page.waitForTimeout(400)
   const mid=await page.evaluate(()=>window.plotCanvas.inspect());assert.ok(mid.stats.frames-base.stats.frames>8,'browser animation must not be limited to native 20fps');assert.ok(mid.shown.at(-1).y>20&&mid.shown.at(-1).y<80)
   // Arrival interrupts an unfinished frame: no immediate snap to the old target.
   const pair=await page.evaluate(()=>{const before=window.plotCanvas.inspect();window.plotCanvas.update({seq:3,samples:[10,20,80,40],running:true,tone:'#3485eb',percent:true});return [before,window.plotCanvas.inspect()]})
   assert.deepEqual(pair[0].shown,pair[1].shown)
   await page.waitForTimeout(1100);const end=await page.evaluate(()=>window.plotCanvas.inspect());assert.equal(end.shown.at(-1).y,40);assert.equal(end.stats.liveLoops,0);assert.equal(end.seq,3)
   assert.equal(await send(2,[999]),false,'stale update rejected');assert.deepEqual((await page.evaluate(()=>window.plotCanvas.inspect())).history,[10,20,80,40])
   await send(4,[0,10,20,30]);await page.waitForTimeout(100);await send(5,[0,10,20,30],false)
   const paused=await page.evaluate(()=>window.plotCanvas.inspect());await page.waitForTimeout(200);assert.equal((await page.evaluate(()=>window.plotCanvas.inspect())).stats.frames,paused.stats.frames)
   // Return from details: latest history must be painted in full immediately,
   // for both a growing history and a full window with many replaced samples.
   let sequence=6
   for(const length of [12,60]){
    await send(sequence++,Array(length).fill(10),false)
    const latest=Array.from({length},(_,i)=>20+i)
    await send(sequence++,latest,true)
    const resumed=await page.evaluate(()=>window.plotCanvas.inspect())
    assert.deepEqual(resumed.shown,latest.map((y,i)=>({x:(60-length+i)/59,y})))
    assert.equal(resumed.stats.liveLoops,0,'resume never schedules catch-up frames')
    await page.waitForTimeout(150)
    assert.equal((await page.evaluate(()=>window.plotCanvas.inspect())).stats.frames,resumed.stats.frames)
    const next=[...latest,95].slice(-60)
    await send(sequence++,next,true);await page.waitForTimeout(250)
    const live=await page.evaluate(()=>window.plotCanvas.inspect())
    assert.ok(live.stats.frames>resumed.stats.frames+3,'next live sample still animates')
    assert.ok(live.shown.at(-1).y>latest.at(-1)&&live.shown.at(-1).y<95)
    await send(sequence++,next,false)
   }
   // Explicit pause uses the same resume contract (e.g. document visibility).
   await page.evaluate(()=>window.plotCanvas.pause())
   await send(sequence++,[5,60],true)
   const explicitResume=await page.evaluate(()=>window.plotCanvas.inspect())
   assert.equal(explicitResume.shown.at(-1).y,60);assert.equal(explicitResume.stats.liveLoops,0)
   // A background stay may leave no bitmap while DOM layout and data remain
   // unchanged. Model that loss explicitly; this is not an iPhone diagnosis.
   const pixelsNow=()=>page.evaluate(()=>{const c=document.querySelector('canvas'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return d.some((v,i)=>i%4===3&&v>0)})
   const beforeRestore=await page.evaluate(()=>window.plotCanvas.inspect())
   await page.evaluate(()=>{window.dispatchEvent(new Event('pagehide'));const c=document.querySelector('canvas');c.width=c.width})
   assert.equal(await pixelsNow(),false)
   await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')))
   assert.equal(await pixelsNow(),true,'pageshow repaints without samples, resize or native render')
   let restored=await page.evaluate(()=>window.plotCanvas.inspect())
   assert.deepEqual(restored.history,beforeRestore.history);assert.equal(restored.seq,beforeRestore.seq);assert.equal(restored.stats.liveLoops,0)
   await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));const c=document.querySelector('canvas');c.width=c.width})
   assert.equal(await pixelsNow(),false)
   await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))})
   assert.equal(await pixelsNow(),true,'visible restores the retained curve and grid')
   await page.evaluate(()=>{const c=document.querySelector('canvas');c.width=c.width;c.dispatchEvent(new Event('contextrestored'))})
   assert.equal(await pixelsNow(),true,'restored context repaints without a new sample')
   // Explicit native resume also recovers when DOM visibility events are absent.
   await page.evaluate(()=>{const c=document.querySelector('canvas');c.width=c.width})
   await page.evaluate(seq=>window.plotCanvas.update({seq,samples:[5,60],running:true,tone:'#3485eb',percent:true,resume:true}),sequence++)
   assert.equal(await pixelsNow(),true);assert.equal((await page.evaluate(()=>window.plotCanvas.inspect())).stats.liveLoops,0)
   // Zero -> positive geometry restores even for paused charts. No timer-driven draw.
   await send(sequence++,[5,60],false)
   await page.evaluate(()=>{document.querySelector('canvas').style.display='none'})
   await page.waitForTimeout(80)
   await page.evaluate(()=>window.dispatchEvent(new Event('pageshow')))
   await page.evaluate(()=>{const c=document.querySelector('canvas');c.width=c.width;c.style.display='block'})
   await page.waitForFunction(()=>{const c=document.querySelector('canvas');return c.width===Math.round(c.getBoundingClientRect().width*Math.min(3,devicePixelRatio))&&c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4===3&&v>0)})
   restored=await page.evaluate(()=>window.plotCanvas.inspect());assert.equal(restored.stats.liveLoops,0);assert.deepEqual(restored.history,[5,60])
   await send(sequence++,[5,60,90],true);await send(sequence++,[5,60,90,30],true);await page.waitForTimeout(150)
   assert.ok((await page.evaluate(()=>window.plotCanvas.inspect())).stats.liveLoops<=1)
   await send(sequence++,[5,60,90,30],false)
   // Actual canvas pixels exist, not merely a recorded drawing call.
   const pixels=await page.evaluate(()=>{const c=document.querySelector('canvas'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i])n++;return n});assert.ok(pixels>0)
   assert.equal(await page.evaluate(()=>window.diagnostics.length),0,'production/default runtime sends no diagnostic messages')
   // A newly mounted document paints its inline data before the ready callback,
   // with no native update/evaluate call needed for the first curve.
   const initial={seq:101,samples:[10,30,20],running:true,tone:'#3485eb',percent:true}
   const firstDoc=mod.exports.plotCanvasHTML(initial,true).replace('<script>',bridge+'<script>')
   await page.setContent(firstDoc);await page.waitForFunction(()=>window.readyCalls===1&&window.plotCanvas?.inspect().seq===101)
   const first=await page.evaluate(()=>{const c=document.querySelector('canvas'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;return {state:window.plotCanvas.inspect(),pixels:d.some((v,i)=>i%4===3&&v>0)}})
   assert.deepEqual(first.state.history,initial.samples);assert.equal(first.state.shown.at(-1).y,20);assert.equal(first.state.stats.liveLoops,0);assert.ok(first.pixels)
   await page.waitForFunction(()=>window.diagnostics.length>=2)
   const report=await page.evaluate(()=>window.diagnostics.at(-1))
   assert.equal(report.seq,101);assert.equal(report.samples,3);assert.equal(report.width,329);assert.equal(report.height,96);assert.ok(report.grids>0);assert.ok(report.frames>0);assert.equal(report.context,true);assert.equal(report.error,'')
   await page.waitForTimeout(1100)
   const unchanged=await page.evaluate(()=>window.diagnostics.at(-1))
   assert.equal(unchanged.frames,report.frames,'diagnostic timer does not paint');assert.equal(unchanged.updates,report.updates)
   await page.evaluate(()=>{document.querySelector('canvas').style.display='none'})
   await page.waitForFunction(()=>window.diagnostics.at(-1)?.width===0)
   const zero=await page.evaluate(()=>window.diagnostics.at(-1));assert.equal(zero.height,0);assert.equal(zero.grids,unchanged.grids);assert.ok(zero.attempts>=unchanged.attempts)
   // 32 isolated chart documents use the exact same runtime. Native lazy appearance
   // determines how many are mounted on iPhone, which cannot be proven here.
   await page.setContent('<body></body>');await page.evaluate(doc=>{for(let i=0;i<32;i++){const f=document.createElement('iframe');f.style='width:140px;height:76px';f.srcdoc=doc;document.body.append(f)}},doc)
   await page.waitForFunction(()=>document.querySelectorAll('iframe').length===32&&[...document.querySelectorAll('iframe')].every(f=>f.contentWindow.plotCanvas))
   const multi=await page.evaluate(async()=>{const views=[...document.querySelectorAll('iframe')].map(f=>f.contentWindow.plotCanvas);for(const p of views){p.update({seq:1,samples:Array(60).fill(10),running:true,tone:'#2dbf82',percent:true});p.update({seq:2,samples:[...Array(59).fill(10),80],running:true,tone:'#2dbf82',percent:true})}await new Promise(r=>setTimeout(r,1200));return views.map(p=>p.inspect())})
   assert.equal(multi.length,32);for(const p of multi){assert.equal(p.stats.liveLoops,0);assert.equal(p.history.length,60);assert.equal(p.shown.at(-1).y,80);assert.ok(p.stats.frames>2)}
   assert.deepEqual(errors,[]);assert.deepEqual(requests,[])
   console.log(JSON.stringify({browser:name,readyHandshake:1,framesIn400ms:mid.stats.frames-base.stats.frames,visiblePixels:pixels,coreDocuments:32,networkRequests:requests.length,errors:errors.length}))
  }finally{await browser.close()}
 }
})().catch(e=>{console.error(e);process.exitCode=1})
