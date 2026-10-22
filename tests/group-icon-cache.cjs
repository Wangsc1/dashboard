// Real GroupIcon/preferences with mocked native UI, Storage and network (no device claim).
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const harness=fs.readFileSync(path.join(__dirname,'run.cjs'),'utf8').split(';(async () => {')[0]
const checks=String.raw`
const fallback='point.3.connected.trianglepath.dotted'
const key=u=>'dashboard_image_v140_'+encodeURIComponent(u)
const group=icon=>({name:'Cache regression',type:'Selector',all:[],now:'',delays:{},icon})
const draw=(url,reset=false)=>render(pages.GroupIcon,{g:group(url)},reset)
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}
let decodes=0
context.UIImage.fromData=data=>{decodes++;return data==='corrupt'?null:{data}}
;(async()=>{
 await test('Storage-warm remount uses UIImage on first frame and after effects; stable identity, no fetch/redecode',async()=>{
  pref.clearImageCache();pref.savePreferences({customIcons:true,groupIcons:{}});calls.length=0
  const url='https://icons.invalid/storage-warm.png';store.set(key(url),'stored');store.set('dashboard_image_index_v140',[key(url)])
  const before=decodes,first=draw(url,true);assert.equal(first.props.image.data,'stored');assert.equal(first.props.systemName,undefined);assert.equal(decodes,before+1)
  await flush();assert.equal(draw(url).props.image,first.props.image)
  for(let i=0;i<3;i++){const tree=draw(url,true);assert.equal(tree.props.image,first.props.image);await flush();assert.equal(draw(url).props.image,first.props.image)}
  assert.equal(await pref.cachedIcon(url),first.props.image);assert.equal(calls.length,0);assert.equal(decodes,before+1);unmount()
 })
 await test('download-warm remount first frame never falls back or sends extra requests',async()=>{
  pref.clearImageCache();calls.length=0;responder=()=>({contentType:'image/png',data:'downloaded'})
  const url='https://icons.invalid/download-warm.png',image=await pref.cachedIcon(url);assert.equal(calls.length,1)
  assert.equal(draw(url,true).props.image,image);await flush();assert.equal(draw(url).props.image,image)
  unmount();assert.equal(draw(url,true).props.image,image);await flush();assert.equal(calls.length,1);unmount()
 })
 await test('URL switches never show old image before effects; cached target synchronous, cold target and late response isolated',async()=>{
  pref.clearImageCache();calls.length=0
  const a='https://icons.invalid/switch-a.png',b='https://icons.invalid/switch-b.png',c='https://icons.invalid/switch-c.png'
  responder=()=>({contentType:'image/png',data:'A'});const imageA=await pref.cachedIcon(a)
  responder=()=>({contentType:'image/png',data:'B'});const imageB=await pref.cachedIcon(b)
  assert.equal(draw(a,true).props.image,imageA);await flush();assert.equal(draw(b).props.image,imageB);await flush()
  const wait=deferred();responder=()=>({contentType:'image/png',data:'C',imageWait:wait.promise})
  assert.equal(draw(c).props.systemName,fallback);await flush();assert.equal(draw(c).props.image,undefined)
  assert.equal(draw(b).props.image,imageB);await flush();wait.resolve();await flush();assert.equal(draw(b).props.image,imageB)
  assert.equal(draw(c).props.image.data,'C');await flush();assert.equal(calls.length,3)
  assert.equal(draw(undefined).props.systemName,fallback);await flush();unmount()
 })
 await test('symbol/customIcons changes suppress cached or late old images immediately and reuse cache when restored',async()=>{
  pref.clearImageCache();pref.savePreferences({customIcons:true,groupIcons:{}});calls.length=0
  const url='https://icons.invalid/settings.png';responder=()=>({contentType:'image/png',data:'settings'});const image=await pref.cachedIcon(url)
  assert.equal(draw(url,true).props.image,image);await flush()
  pref.savePreferences({groupIcons:{'Cache regression':'globe'}});assert.equal(draw(url).props.systemName,'globe');await flush();assert.equal(draw(url).props.image,undefined)
  pref.savePreferences({groupIcons:{'Cache regression':'star'}});assert.equal(draw(url).props.systemName,'star');await flush()
  pref.savePreferences({groupIcons:{}});assert.equal(draw(url).props.image,image);await flush()
  pref.savePreferences({customIcons:false});assert.equal(draw(url),null);await flush()
  pref.savePreferences({customIcons:true});assert.equal(draw(url).props.image,image);await flush();assert.equal(calls.length,1)
  const cold='https://icons.invalid/settings-late.png',wait=deferred();responder=()=>({contentType:'image/png',data:'late',imageWait:wait.promise})
  draw(cold);await flush();pref.savePreferences({groupIcons:{'Cache regression':'globe'}});assert.equal(draw(cold).props.systemName,'globe');await flush()
  wait.resolve();await flush();assert.equal(draw(cold).props.systemName,'globe')
  pref.savePreferences({customIcons:false,groupIcons:{}});assert.equal(draw(cold),null);await flush()
  pref.savePreferences({customIcons:true});assert.equal(draw(cold).props.image.data,'late');await flush();assert.equal(calls.length,2);unmount()
 })
 await test('sync and async readers preserve URL restrictions even with preseeded bytes; non-image response not cached',async()=>{
  pref.clearImageCache();calls.length=0
  for(const url of ['http://icons.invalid/a.png','https://icons.invalid/a.png?q=1','https://icons.invalid/a.png#f','https://user:pw@icons.invalid/a.png']){
   store.set(key(url),'unsafe');assert.equal(pref.readCachedIcon(url),null);assert.equal(await pref.cachedIcon(url),null);assert.equal(draw(url,true).props.systemName,fallback);await flush();store.delete(key(url))
  }
  assert.equal(calls.length,0)
  responder=()=>({contentType:'text/plain',data:'not-image'});const url='https://icons.invalid/not-image';assert.equal(await pref.cachedIcon(url),null);assert.equal(pref.readCachedIcon(url),null);assert.equal(store.has(key(url)),false);unmount()
 })
 await test('clear invalidates decoded and stored images; pre-clear download cannot repopulate or replace a new generation',async()=>{
  pref.clearImageCache();calls.length=0;responder=()=>({contentType:'image/png',data:'warm'})
  const warm='https://icons.invalid/clear-warm.png';await pref.cachedIcon(warm);assert.ok(pref.readCachedIcon(warm))
  assert.equal(pref.clearImageCache(),1);assert.equal(pref.readCachedIcon(warm),null);assert.equal(store.has(key(warm)),false);assert.equal(draw(warm,true).props.systemName,fallback);unmount()
  const url='https://icons.invalid/clear-pending.png',old=deferred(),fresh=deferred()
  responder=()=>({contentType:'image/png',data:'old',imageWait:old.promise});const prior=pref.cachedIcon(url);await flush()
  pref.clearImageCache();responder=()=>({contentType:'image/png',data:'new',imageWait:fresh.promise});const next=pref.cachedIcon(url),joined=pref.cachedIcon(url);await flush();assert.equal(calls.length,3)
  old.resolve();await prior;assert.equal(pref.readCachedIcon(url),null);assert.equal(store.has(key(url)),false)
  fresh.resolve();const image=await next;assert.equal(await joined,image);assert.equal(pref.readCachedIcon(url),image);assert.equal(image.data,'new');assert.equal(store.get(key(url)),'new')
  // Also reject a stale completion arriving AFTER the new generation was cached.
  pref.clearImageCache();const last=deferred();responder=()=>({contentType:'image/png',data:'stale-last',imageWait:last.promise});const stale=pref.cachedIcon(url);await flush()
  pref.clearImageCache();responder=()=>({contentType:'image/png',data:'newest'});const newest=await pref.cachedIcon(url);last.resolve();await stale
  assert.equal(pref.readCachedIcon(url),newest);assert.equal(store.get(key(url)),'newest');pref.clearImageCache();assert.equal(pref.readCachedIcon(url),null)
 })
 await test('memory-only image after failed persistence is usable but still cleared',async()=>{
  pref.clearImageCache();const url='https://icons.invalid/memory-only.png';responder=()=>({contentType:'image/png',data:'memory-only'});failStorage=true
  let image;try{image=await pref.cachedIcon(url)}finally{failStorage=false}
  assert.equal(store.has(key(url)),false);assert.equal(pref.readCachedIcon(url),image);assert.equal(draw(url,true).props.image,image);await flush();unmount();pref.clearImageCache();assert.equal(pref.readCachedIcon(url),null)
 })
 await test('current-node name and delay retain requested spacing 10',async()=>{
  const g={...group(undefined),now:'SpacingNode',all:['SpacingNode'],delays:{SpacingNode:25}},c={id:'spacing',name:'Spacing',kind:'clash',url:'http://spacing.invalid'}
  const tree=render(pages.GroupSection,{c,g,onChanged(){}},true)
  const row=nodes(tree,'HStack').find(n=>text(n)==='SpacingNode 25ms');assert.ok(row);assert.equal(row.props.spacing,10);unmount()
 })
 console.log('All '+count+' GroupIcon cache regression groups passed (mock native UI/storage/network; first-frame assertions precede effects).')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
