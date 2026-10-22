// Real browsers validate the safe draw trace, not actual iPhone lifecycle/compositing.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const ts=require('/tmp/chk/node_modules/typescript')
const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'../plot-canvas.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
const mod={exports:{}};vm.runInNewContext(code,{exports:mod.exports})
const {chromium,webkit}=require(process.env.PLAYWRIGHT_PATH||'/tmp/neko-editor-build/node_modules/playwright')
;(async()=>{
 for(const [name,type] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await type.launch({headless:true,args:name==='chromium'?['--no-sandbox']:[]})
  try{
   const page=await browser.newPage({viewport:{width:329,height:96}}),errors=[],requests=[]
   page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));await page.route('**/*',r=>r.abort())
   const bridge='<script>window.traces=[];window.webkit={messageHandlers:{plotTrace:{postMessage(v){window.traces.push(v);return Promise.resolve(true)}},plotReady:{postMessage(){return Promise.resolve(true)}},plotPainted:{postMessage(){return Promise.resolve(true)}}}};</script>'
   const initial={seq:1,samples:[123450001,234560002,345670003],tone:'#3485eb',running:true,percent:false}
   await page.setContent(mod.exports.plotCanvasHTML(initial,false,true).replace('<script>',bridge+'<script>'))
   await page.waitForFunction(()=>window.traces.length>0)
   let trace=await page.evaluate(()=>window.traces.at(-1));assert.deepEqual(trace,{seq:1,samples:3,sized:true,line:true})
   assert.equal(await page.evaluate(()=>window.plotCanvas.inspect().stats.liveLoops),0,'restored initial history is drawn immediately, not replayed')
   await page.evaluate(()=>window.plotCanvas.update({seq:2,samples:[],running:false,percent:false,tone:'#3485eb'}));trace=await page.evaluate(()=>window.traces.at(-1));assert.equal(trace.samples,0);assert.equal(trace.line,false)
   await page.evaluate(v=>window.plotCanvas.update({...v,seq:3}),initial);trace=await page.evaluate(()=>window.traces.at(-1));assert.equal(trace.samples,3);assert.equal(trace.line,true)
   const count=await page.evaluate(()=>window.traces.length)
   await page.evaluate(()=>window.plotCanvas.update({seq:4,samples:[123450001,234560002,345670003,456780004],running:true,percent:false,tone:'#3485eb'}));await page.waitForTimeout(350)
   assert.equal(await page.evaluate(()=>window.traces.length),count+1,'rAF frames do not emit per-frame trace messages')
   await page.evaluate(()=>document.querySelector('canvas').style.display='none');await page.waitForFunction(()=>window.traces.at(-1).sized===false)
   trace=await page.evaluate(()=>window.traces.at(-1));assert.equal(trace.samples,0);assert.equal(trace.line,false)
   await page.evaluate(()=>document.querySelector('canvas').style.display='block');await page.waitForFunction(()=>window.traces.at(-1).sized===true)
   const traces=await page.evaluate(()=>window.traces)
   for(const t of traces){assert.deepEqual(Object.keys(t).sort(),['line','samples','seq','sized']);assert.ok(t.samples>=0&&t.samples<=60)}
   assert.ok(!JSON.stringify(traces).includes('123450001'));assert.deepEqual(errors,[]);assert.equal(requests.length,0)
   console.log(name+': safe trace distinguishes restored/empty/zero-size/drawn history; no sample values, network or per-frame reports')
  }finally{await browser.close()}
 }
})().catch(e=>{console.error(e);process.exitCode=1})
