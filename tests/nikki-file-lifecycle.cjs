// Product hooks + official Editor contract model; no native pixels or remote effects.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const harness=fs.readFileSync(path.join(__dirname,'run.cjs'),'utf8').split(';(async () => {')[0]
const setup=fs.readFileSync(path.join(__dirname,'nikki-management.cjs'),'utf8').split('const checks = String.raw`')[1].split(';(async()=>{')[0]
const checks=String.raw`
async function opened(extra={}){fixture();const base=await api.loadNikkiManagement(n),props={c:n,base,file:base.files[0],done(){},...extra};return {...await openFile(props),props}}
function rerender(props){return render(pages.NikkiFileEditor,props)}
;(async()=>{
  await test('official content is current before the 100ms change event; immediate first-character save reads controller',async()=>{
    let saved=0;const {props,tree,editor}=await opened({done:()=>saved++}),initial=editor.content
    assert.equal(nodes(tree,'WebView').length,0);assert.equal(nodes(tree,'Editor').length,1);assert.equal(nodes(tree,'Editor')[0].props.showAccessoryView,true);assert.equal(editor.ext,'txt');assert.equal(editor.readOnly,false);assert.ok(!text(tree).includes('编辑器：'))
    assert.equal(fileSave(tree,false).props.children[0].props.systemName,'checkmark.circle');calls.length=0;const prior=confirms.length;await fileSave(tree).props.action();assert.equal(calls.length,0);assert.equal(confirms.length,prior,'initial content is clean')
    let changed=0;const callback=editor.onContentChanged;editor.onContentChanged=(...args)=>{changed++;callback(...args)}
    const latest=initial+'# last character 中文🧪\r\n';editor.input(latest);assert.equal(changed,0);context.EditorController.advance(99);assert.equal(changed,0)
    await fileSave(tree).props.action();assert.equal(remoteFiles.get('/etc/nikki/profiles/local.yaml'),latest);assert.equal(saved,1);assert.equal(changed,0,'save cannot wait on callback');context.EditorController.advance(1);assert.equal(changed,1)
    editor.input(latest+'next');await fileSave(rerender(props)).props.action();assert.equal(saved,2);assert.equal(editor.content,latest+'next');assert.ok(!writes().some(c=>JSON.parse(c.init.body).params[1]==='rc'));await tree.props.onDisappear();unmount();assert.equal(editor.disposeCount,1)
  })
  await test('return and cleanup in either order never save, synchronously retain final character and dispose once',async()=>{
    for(const cleanupFirst of [false,true]){let exits=0;const {props,tree,editor}=await opened({onExit:()=>exits++}),draft=editor.content+'# last before back';editor.input(draft);calls.length=0;const confirmations=confirms.length
      if(cleanupFirst)unmount();await tree.props.onDisappear();await tree.props.onDisappear();unmount();assert.equal(exits,1);assert.equal(editor.disposeCount,1);assert.equal(calls.length,0);assert.equal(confirms.length,confirmations)
      const reopened=await openFile(props);assert.equal(reopened.editor.content,draft);assert.ok(text(reopened.tree).includes('已恢复'));await reopened.tree.props.onDisappear();unmount()
      const other=await openFile({...props,c:{...n,id:n.id+'-other'}});assert.notEqual(other.editor.content,draft);await other.tree.props.onDisappear();unmount()
    }
  })
  await test('cancel/failure/retry keeps controller content and draft; external conflict never overwrites',async()=>{
    const {props,tree,editor}=await opened(),initial=editor.content,draft=initial+'# changed';editor.input(draft);context.confirmResult=false;calls.length=0;await fileSave(tree).props.action();assert.equal(calls.length,0);assert.equal(editor.content,draft);context.confirmResult=true
    fail=(obj,m)=>obj==='file'&&m==='write'?{throw:'write failed'}:null;await fileSave(rerender(props)).props.action();assert.equal(editor.content,draft);assert.ok(text(rerender(props)).includes('部分内容'));fail=null;await fileSave(rerender(props)).props.action();assert.equal(remoteFiles.get('/etc/nikki/profiles/local.yaml'),draft)
    editor.input(draft+'# local');remoteFiles.set('/etc/nikki/profiles/local.yaml',draft+'# remote');calls.length=0;await fileSave(rerender(props)).props.action();assert.equal(writes().length,0);assert.ok(text(rerender(props)).includes('已改变'));await tree.props.onDisappear();unmount();const reopened=await openFile(props);assert.equal(reopened.editor.content,draft+'# local');await reopened.tree.props.onDisappear();unmount()
  })
  await test('pending confirmation canceled by back/unmount cannot authorize a late write',async()=>{
    for(const cleanupFirst of [false,true]){const {props,tree,editor}=await opened();editor.input(editor.content+'# pending');const confirm=context.Dialog.confirm;let release;context.Dialog.confirm=()=>new Promise(r=>release=r);calls.length=0
      try{const saving=fileSave(tree).props.action();await waitUntil(()=>!!release);if(cleanupFirst)unmount();else await tree.props.onDisappear();release(true);await saving;assert.equal(editor.disposed,true);assert.equal(writes().length,0);unmount()}finally{context.Dialog.confirm=confirm}
    }
  })
  await test('confirmed write completes once after close; success/failure keeps recoverable baseline without controller access',async()=>{
    for(const failed of [false,true]){let saved=0;const {props,tree,editor}=await opened({done:()=>saved++}),draft=editor.content+'# inflight';editor.input(draft);let release;const gate=new Promise(r=>release=r);fail=(obj,m)=>obj==='file'&&m==='write'?{wait:gate,body:{result:[failed?6:0]}}:null
      const saving=fileSave(tree).props.action();await waitUntil(()=>writes().some(c=>JSON.parse(c.init.body).params[2]==='write'));await tree.props.onDisappear();unmount();assert.equal(editor.disposed,true);if(!failed)remoteFiles.set('/etc/nikki/profiles/local.yaml',draft);release();await saving;assert.equal(saved,0);assert.equal(writes().filter(c=>JSON.parse(c.init.body).params[2]==='write').length,1);fail=null
      const reopened=await openFile(props);assert.equal(reopened.editor.content,draft);if(failed)assert.ok(alerts.some(a=>a.title==='保存未完成'));await reopened.tree.props.onDisappear();unmount()
    }
  })
  await test('source change disposes and blocks stale actions/callbacks, including pending read completion',async()=>{
    const {props,tree,editor}=await opened();editor.input(editor.content+'# isolated');const late=editor.onContentChanged,staleSave=fileSave(tree);const other={...props,c:{...n,url:'http://other.invalid'}};render(pages.NikkiFileEditor,other);await settle();assert.equal(editor.disposed,true);calls.length=0;late();await staleSave.props.action();assert.equal(calls.length,0);assert.equal(nodes(rerender(other),'Editor').length,0);unmount()
    fixture();const base=await api.loadNikkiManagement(n),slow={c:n,base,file:base.files[0],done(){}};let release;downloadWait=new Promise(r=>release=r);let t=render(pages.NikkiFileEditor,slow,true);await settle();t.props.onAppear();render(pages.NikkiFileEditor,slow);await settle();const count=context.EditorController.instances.length;const switched={...slow,c:{...n,url:'http://new.invalid'}};render(pages.NikkiFileEditor,switched);await settle();release();await settle();assert.equal(context.EditorController.instances.length,count);assert.equal(nodes(rerender(switched),'Editor').length,0);unmount()
  })
  await test('back before full read completes never constructs a late controller even before unmount',async()=>{
    fixture();const base=await api.loadNikkiManagement(n),props={c:n,base,file:base.files[0],done(){}};let release;downloadWait=new Promise(r=>release=r);let tree=render(pages.NikkiFileEditor,props,true);await settle();tree.props.onAppear();render(pages.NikkiFileEditor,props);await settle();const count=context.EditorController.instances.length;await tree.props.onDisappear();release();await settle();assert.equal(context.EditorController.instances.length,count);assert.equal(writes().length,0);unmount()
  })
  await test('loaded file switch disposes old controller and rejects stale file save action',async()=>{
    const {props,tree,editor}=await opened(),staleSave=fileSave(tree);remoteFiles.set('/etc/nikki/profiles/next.yml','next: value\r\n');const next={...props,file:{...props.file,key:'file:next.yml',filename:'next.yml'},entryKey:'new-entry'};render(pages.NikkiFileEditor,next);await settle();let t=rerender(next);const current=nodes(t,'Editor')[0].props.controller;assert.equal(editor.disposeCount,1);current.input('next: edited\r\n');calls.length=0;await staleSave.props.action();assert.equal(writes().length,0);assert.equal(remoteFiles.get('/etc/nikki/profiles/local.yaml').includes('next:'),false);await fileSave(t).props.action();assert.equal(remoteFiles.get('/etc/nikki/profiles/next.yml'),'next: edited\r\n');await t.props.onDisappear();unmount();assert.equal(current.disposeCount,1)
  })
  await test('file switch ignores late old body and creates one correctly typed controller for the new file',async()=>{
    fixture();remoteFiles.set('/etc/nikki/profiles/next.yml','{"safe":true}\r\n');const base=await api.loadNikkiManagement(n),props={c:n,base,file:base.files[0],done(){}};let release;downloadWait=new Promise(r=>release=r);let tree=render(pages.NikkiFileEditor,props,true);await settle();tree.props.onAppear();render(pages.NikkiFileEditor,props);await settle();downloadWait=null
    const next={...props,file:{...props.file,key:'file:next.yml',filename:'next.yml'}};render(pages.NikkiFileEditor,next);await settle();tree=rerender(next);const editor=nodes(tree,'Editor')[0].props.controller;assert.equal(editor.ext,'txt');assert.equal(editor.content,'{"safe":true}\r\n');release();await settle();assert.equal(nodes(rerender(next),'Editor')[0].props.controller,editor);assert.equal(editor.content,'{"safe":true}\r\n');await tree.props.onDisappear();unmount();assert.equal(editor.disposeCount,1)
  })
  await test('empty/large mixed-ending files remain exact; loaded empty is valid and latest empty can be explicitly saved',async()=>{
    for(const initial of ['', '  key: "</script>🧪"\r\n'+('row: 中文\r\n'.repeat(40000))+'\r\n']){fixture();remoteFiles.set('/etc/nikki/profiles/local.yaml',initial);const base=await api.loadNikkiManagement(n),props={c:n,base,file:base.files[0],done(){}};const {tree,editor}=await openFile(props);assert.equal(editor.content,initial);const latest=initial? '': '# nonempty\r\n';editor.input(latest);await fileSave(tree).props.action();assert.equal(remoteFiles.get('/etc/nikki/profiles/local.yaml'),latest);assert.equal(editor.content,latest);await tree.props.onDisappear();unmount()}
  })
  await test('read failure/timeout never creates an empty writable editor; retry and late reads are safe',async()=>{
    fixture();const base=await api.loadNikkiManagement(n),props={c:n,base,file:base.files[0],done(){}};downloadStatus=403;let tree=render(pages.NikkiFileEditor,props,true);await settle();tree.props.onAppear();render(pages.NikkiFileEditor,props);await settle();tree=rerender(props);assert.equal(nodes(tree,'Editor').length,0);assert.equal(fileSave(tree,true).props.disabled,true);assert.ok(text(tree).includes('完整文件读取失败'));calls.length=0;await fileSave(tree).props.action();assert.equal(writes().length,0);downloadStatus=200;button(tree,'重试读取').props.action();render(pages.NikkiFileEditor,props);await settle();tree=rerender(props);assert.ok(nodes(tree,'Editor').length);await tree.props.onDisappear();unmount()
    fixture();const b=await api.loadNikkiManagement(n),p={c:n,base:b,file:b.files[0],done(){}};let release;downloadWait=new Promise(r=>release=r);const realSet=context.setTimeout,realClear=context.clearTimeout;let expire;context.setTimeout=(fn,ms)=>{if(ms===20000){expire=fn;return 1}return realSet(fn,ms)};context.clearTimeout=()=>{}
    try{tree=render(pages.NikkiFileEditor,p,true);await settle();tree.props.onAppear();render(pages.NikkiFileEditor,p);await settle();expire();await settle();tree=rerender(p);assert.ok(text(tree).includes('读取超时'));assert.equal(nodes(tree,'Editor').length,0);fileSave(tree,true);release();await settle();assert.equal(nodes(rerender(p),'Editor').length,0);assert.equal(writes().length,0);await tree.props.onDisappear();unmount()}finally{context.setTimeout=realSet;context.clearTimeout=realClear}
  })
  await test('official undo/redo and selection-based search/replace use controller APIs',async()=>{
    const {props,tree,editor}=await opened();editor.input('alpha beta ALPHA\r\n');button(tree,'撤销').props.action();assert.notEqual(editor.content,'alpha beta ALPHA\r\n');button(tree,'重做').props.action();assert.equal(editor.content,'alpha beta ALPHA\r\n');button(tree,'查找 / 替换').props.action();let t=rerender(props);nodes(t,'TextField')[0].props.onChanged('alpha');nodes(t,'TextField')[1].props.onChanged('new');t=rerender(props);await button(t,'搜索').props.action();t=rerender(props);assert.ok(text(t).includes('1 / 2'));button(t,'下一个').props.action();t=rerender(props);await button(t,'替换').props.action();assert.equal(editor.content,'alpha beta new\r\n');await fileSave(rerender(props)).props.action();assert.equal(remoteFiles.get('/etc/nikki/profiles/local.yaml'),'alpha beta new\r\n');await tree.props.onDisappear();unmount()
  })
  console.log('All '+count+' official Editor lifecycle groups passed (SDK contract mock, not device).')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+setup+checks,{require,__dirname,console,process,Buffer},{filename:__filename})
