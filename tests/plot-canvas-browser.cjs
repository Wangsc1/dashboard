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
   const bridge='<script>window.readyCalls=0;window.webkit={messageHandlers:{plotReady:{postMessage(){window.readyCalls++;return Promise.resolve(true)}}}};</script>'
   const doc=html.replace('<script>',bridge+'<script>')
   await page.setContent(doc);await page.waitForFunction(()=>window.plotCanvas&&window.readyCalls===1)
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
   // Actual canvas pixels exist, not merely a recorded drawing call.
   const pixels=await page.evaluate(()=>{const c=document.querySelector('canvas'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i])n++;return n});assert.ok(pixels>0)
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
