// Real Chromium DOM/input tests, NOT WKWebView, iOS keyboard or native navigation.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict')
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'../editor/node_modules/playwright')
const harness=fs.readFileSync(path.join(__dirname,'run.cjs'),'utf8').split(';(async () => {')[0]
const html=vm.runInNewContext(harness+'\npages.nikkiEditorHTML(41)',{require,__dirname,console,process})
;(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']})
  try{
    const page=await browser.newPage({viewport:{width:393,height:790},isMobile:true,hasTouch:true,deviceScaleFactor:2})
    const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));await page.route('**/*',route=>route.abort())
    const original='port: 7890\r\nallow-lan: true\nname: "中文🧪"\r\n# 注释\r\nproxies:\r\n  - name: Test\r\n    type: ss\r\n    server: example.invalid\r\nlong: '+('abcdefghij'.repeat(50))+'\r\n'
    await page.addInitScript(()=>{})
    // Install the private native bridge before the inline document executes.
    const bridge=`<script>window.messages=[];window.webkit={messageHandlers:new Proxy({}, {get:(_,name)=>({postMessage:value=>{window.messages.push({name,value});if(name==='editorReady')return Promise.resolve({generation:41,text:${JSON.stringify(original)},theme:'dark'})}})})};</script>`
    await page.setContent(html.replace('<script>window.__nikkiGeneration',bridge+'<script>window.__nikkiGeneration'))
    await page.waitForFunction(()=>window.nikkiEditor?.view)
    const snapshot=()=>page.evaluate(()=>{const s=window.nikkiEditor.snapshot();window.nikkiEditor.unlock();return s.text})
    assert.equal(await snapshot(),original)
    for(const selector of ['.cm-content','.cm-lineNumbers'])assert.equal(await page.locator(selector).evaluate(e=>getComputedStyle(e).fontSize),'12px')
    assert.equal(await page.locator('.cm-scroller').evaluate(e=>getComputedStyle(e).lineHeight),'18px')
    // HTML has no bottom footer/margin and tracks the actual available viewport.
    // A smaller viewport models resize only, NOT iOS keyboard/safe-area behavior.
    const fillsBottom=()=>page.evaluate(()=>({editor:document.querySelector('#editor').getBoundingClientRect().bottom,code:document.querySelector('.cm-editor').getBoundingClientRect().bottom,height:window.innerHeight}))
    for(const height of [790,390]){await page.setViewportSize({width:393,height});const box=await fillsBottom();assert.ok(Math.abs(box.editor-box.height)<1);assert.ok(Math.abs(box.code-box.height)<1)}
    await page.setViewportSize({width:393,height:790})
    assert.equal(await page.locator('textarea').count(),0);assert.equal(await page.locator('.cm-editor').count(),1)
    assert.ok(await page.locator('.cm-gutterElement').count()>2);assert.ok(await page.locator('.cm-foldGutter').count())
    assert.ok(await page.locator('.cm-activeLine').count());assert.ok(await page.locator('.cm-indent-markers').count())
    const tokenColor=async text=>page.locator('.cm-line span').filter({hasText:new RegExp('^'+text+'$')}).first().evaluate(e=>getComputedStyle(e).color)
    assert.equal(await tokenColor('port'),'rgb(121, 184, 255)');assert.equal(await tokenColor('7890'),'rgb(240, 164, 93)');assert.equal(await tokenColor('true'),'rgb(242, 119, 122)');assert.equal(await tokenColor('"中文🧪"'),'rgb(152, 195, 121)');assert.equal(await tokenColor('# 注释'),'rgb(127, 137, 155)')
    await page.locator('#fold').click();assert.ok(await page.locator('.cm-foldPlaceholder').count());assert.equal(await snapshot(),original)
    // Editing visible text while children are folded must still save hidden text.
    await page.evaluate(()=>window.nikkiEditor.view.dispatch({changes:{from:6,to:10,insert:'7891'}}));assert.equal(await snapshot(),original.replace('7890','7891'));await page.locator('#undo').click();assert.equal(await snapshot(),original)
    await page.locator('#unfold').click();assert.equal(await page.locator('.cm-foldPlaceholder').count(),0)
    // Horizontal scrolling belongs to the editor; sticky gutters stay pinned.
    const left=await page.locator('.cm-gutters').evaluate(e=>e.getBoundingClientRect().left)
    const scroll=await page.locator('.cm-scroller').evaluate(e=>{e.scrollLeft=230;return {left:e.scrollLeft,overflow:e.scrollWidth-e.clientWidth}})
    assert.ok(scroll.left>0&&scroll.overflow>0);assert.equal(await page.locator('.cm-gutters').evaluate(e=>e.getBoundingClientRect().left),left)
    await page.locator('.cm-content').focus();await page.keyboard.press('Control+End');await page.keyboard.insertText('# 输入中文🧪');const edited=original+'# 输入中文🧪';assert.equal(await snapshot(),edited)
    await page.locator('#undo').click();assert.equal(await snapshot(),original);await page.locator('#redo').click();assert.equal(await snapshot(),edited)
    await page.locator('#find').click();const search=page.locator('.cm-search input[name="search"]');await search.fill('Test');await page.locator('.cm-search button[name="next"]').click();assert.equal(await page.evaluate(()=>{const v=window.nikkiEditor.view,s=v.state.selection.main;return v.state.sliceDoc(s.from,s.to)}),'Test')
    await page.keyboard.press('Escape')
    // Synthetic composition tests guard the save protocol. They cannot certify
    // the iOS IME itself: actual keyboard/marked-text behavior is a device gate.
    await page.evaluate(()=>{const v=window.nikkiEditor.view;v.focus();v.contentDOM.dispatchEvent(new CompositionEvent('compositionstart',{data:'中',bubbles:true}));window.nikkiEditor.sendSnapshot(99)})
    assert.equal(await page.evaluate(()=>window.messages.some(m=>m.name==='editorSnapshot'&&m.value.request===99)),false)
    await page.evaluate(()=>{const v=window.nikkiEditor.view;v.contentDOM.textContent=v.state.doc.toString()+'组合测试';v.contentDOM.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:'组合测试',isComposing:true}));v.contentDOM.dispatchEvent(new CompositionEvent('compositionend',{data:'组合测试',bubbles:true}))})
    await page.waitForFunction(()=>window.messages.some(m=>m.name==='editorSnapshot'&&m.value.request===99))
    const committed=await page.evaluate(()=>window.messages.find(m=>m.name==='editorSnapshot'&&m.value.request===99).value.text);assert.equal(committed,edited+'组合测试');assert.equal(await page.evaluate(()=>window.nikkiEditor.view.state.readOnly),true);await page.evaluate(()=>window.nikkiEditor.unlock())
    // Multiple typing transactions merge into one undo event. Raw-history effects
    // must restore the oldest inverse, not a partial intermediate buffer.
    await page.evaluate(()=>{const e=window.nikkiEditor;e.setText('a: x\r\nb: y\nc: z\r',50,'dark');for(const text of ['1','2','3']){const v=e.view;v.dispatch({changes:{from:4,to:4,insert:text},userEvent:'input.type'})}})
    const grouped=await snapshot();await page.locator('#undo').click();assert.equal(await snapshot(),'a: x\r\nb: y\nc: z\r');await page.locator('#redo').click();assert.equal(await snapshot(),grouped)
    await page.evaluate(()=>{const v=window.nikkiEditor.view;v.dispatch({changes:[{from:0,to:1,insert:'A'},{from:v.state.doc.length-1,to:v.state.doc.length-1,insert:'尾'}],userEvent:'input'})});const multi=await snapshot();assert.ok(multi.startsWith('A:'));assert.ok(multi.endsWith('尾\r'));await page.locator('#undo').click();assert.equal(await snapshot(),grouped)
    // An expired composition snapshot must never relock a later edit.
    await page.evaluate(()=>{const v=window.nikkiEditor.view;v.focus();v.contentDOM.dispatchEvent(new CompositionEvent('compositionstart',{data:'中',bubbles:true}));window.nikkiEditor.sendSnapshot(100);window.nikkiEditor.unlock();v.contentDOM.dispatchEvent(new CompositionEvent('compositionend',{data:'',bubbles:true}))})
    await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>window.messages.some(m=>m.name==='editorSnapshot'&&m.value.request===100)),false);assert.equal(await page.evaluate(()=>window.nikkiEditor.view.state.readOnly),false)
    // Large document still has a complete underlying snapshot despite viewport
    // virtualization and folded/hidden text. No DOM scrape can be used for save.
    const large=Array.from({length:40000},(_,i)=>'item'+i+': 中文🧪').join('\r\n')+'\r\n'
    await page.evaluate(text=>window.nikkiEditor.setText(text,42,'light'),large);assert.equal(await snapshot(),large);assert.equal(await page.locator('.cm-content .cm-line').count()<40000,true)
    await page.evaluate(()=>{const v=window.nikkiEditor.view;v.dispatch({changes:{from:v.state.doc.length,to:v.state.doc.length,insert:'tail'}})})
    assert.equal(await snapshot(),large+'tail');await page.locator('#undo').click();assert.equal(await snapshot(),large)
    await page.evaluate(()=>window.nikkiEditor.setText('key: value\n',43,'light'));assert.equal(await tokenColor('key'),'rgb(9, 105, 218)');assert.equal(await page.locator('#editor').evaluate(e=>getComputedStyle(e).borderRadius),'0px')
    if(process.env.EDITOR_SCREENSHOT)await page.screenshot({path:process.env.EDITOR_SCREENSHOT})
    assert.deepEqual(requests,[]);assert.deepEqual(errors,[])
    console.log('PASS actual bundled CodeMirror: mobile-sized Chromium, YAML token colors, fixed gutters, horizontal scroll, active line, indentation, fold/full snapshots, undo/redo, search, Unicode and synthetic composition barrier, 40k lines, light/dark, zero network')
  }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
