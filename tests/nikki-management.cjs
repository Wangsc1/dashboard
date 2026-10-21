// Targeted in-memory integration tests. No real router, credentials or network.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const harness = fs.readFileSync(path.join(__dirname, 'run.cjs'), 'utf8').split(';(async () => {')[0]
const checks = String.raw`
const management=pages
const n={id:'management-mock',name:'Mock Nikki',kind:'openwrt',plugin:'nikki',url:'http://management.invalid',username:'root'}
let state,staged=null,dirty=[],remoteFiles,fail=null,downloadStatus=200,truncated=false,links=false,dirDenied=false,downloadWait=null,autoReloads=0,canonicalOverride=null,lstatUnsupported=false,lstatTypes=new Map(),execAllowed=false
function fixture(){
  state={config:{'.type':'config','.index':0,profile:'file:local.yaml',untouched:'config-unknown'},r1:{'.type':'rule','.index':1,type:'DOMAIN',matcher:'example.invalid',node:'DIRECT',enabled:'1',no_resolve:'0',unknown:'rule-kept'},s1:{'.type':'subscription','.index':2,name:'Mock subscription',url:'https://subscription.invalid/config?token=fixture-only',user_agent:'clash.meta',prefer:'local',info_url:'https://info.invalid',update:'2026-01-01',unknown:'subscription-kept'},r2:{'.type':'rule','.index':3,type:'MATCH',node:'REJECT',enabled:'0'},mixin:{'.type':'mixin','.index':4,rule:'1',unknown:'mixin-kept'}}
  staged=null;dirty=[];remoteFiles=new Map([['/etc/nikki/profiles/local.yaml','mode: rule\r\n# 模拟🧪\r\n'],['/etc/nikki/subscriptions/s1.yaml','mode: global\n']]);fail=null;downloadStatus=200;truncated=false;links=false;dirDenied=false;downloadWait=null;autoReloads=0;canonicalOverride=null;lstatUnsupported=false;lstatTypes=new Map();execAllowed=false;calls.length=0
  responder=(url,init)=>{
    if(url.endsWith('/cgi-bin/cgi-download')){const m=init.body.match(/(?:^|&)path=([^&]*)/);const value=remoteFiles.get(decodeURIComponent(m[1]));return {status:downloadStatus,text:truncated?value.slice(0,4096):value,wait:downloadWait}}
    assert.ok(url.endsWith('/ubus'));const req=JSON.parse(init.body),[_sid,obj,method,args]=req.params
    if(fail){const result=fail(obj,method,args);if(result)return result}
    const ok=body=>({body:{result:[0,body??{}]}}),error=()=>({body:{result:[6]}})
    if(obj==='session')return ok({ubus_rpc_session:'mock-session'})
    if(obj==='file'&&method==='list'){
      if(dirDenied&&args.path==='/etc/nikki/subscriptions')return error()
      return ok({entries:[...remoteFiles].filter(([p])=>p.slice(0,p.lastIndexOf('/'))===args.path).map(([p,t])=>({name:p.slice(p.lastIndexOf('/')+1),size:Buffer.byteLength(t),mtime:1700000000,type:links?'link':'file',mode:0o100640}))})
    }
    if(obj==='file'&&method==='lstat'){if(lstatUnsupported)return {body:{result:[3]}};const t=remoteFiles.get(args.path);return ok({path:args.path,type:lstatTypes.get(args.path)??(t===undefined?'directory':'file'),size:t===undefined?0:Buffer.byteLength(t),mtime:1700000000,mode:0o100640})}
    if(obj==='file'&&method==='exec'){if(!execAllowed)return error();assert.equal(args.command,'/bin/busybox');assert.equal(args.params[0],'readlink');assert.equal(args.params[1],'-f');assert.ok(args.params[2].startsWith('/etc/nikki/'));return ok({code:0,stdout:(canonicalOverride??args.params[2])+'\n'})}
    if(obj==='file'&&method==='write'){assert.ok(Buffer.byteLength(args.data)<=8192);remoteFiles.set(args.path,(args.append?remoteFiles.get(args.path):'')+args.data);return ok()}
    if(obj==='uci'){
      if(method==='changes')return ok({changes:clone(dirty)})
      if(method==='get'){const vs=staged??state;return ok({values:clone(args.section?{...vs[args.section],'.name':args.section}:vs)})}
      if(method==='revert'){staged=null;dirty=[];return ok()}
      if(method==='commit'){if(staged)state=staged;staged=null;dirty=[];autoReloads++;return ok()}
      staged??=clone(state);dirty.push([method,args.section??''])
      if(method==='set'){assert.ok(staged[args.section]);Object.assign(staged[args.section],args.values)}
      else if(method==='add'){const id='added'+Object.keys(staged).length;staged[id]={'.type':args.type,'.index':Object.keys(staged).length,...args.values};return ok({section:id})}
      else if(method==='delete')delete staged[args.section]
      else if(method==='order'){assert.equal(new Set(args.sections).size,Object.keys(staged).length);args.sections.forEach((id,i)=>staged[id]['.index']=i)}
      else throw Error('unexpected uci method '+method)
      return ok()
    }
    if(obj==='luci.nikki'&&method==='update_subscription'){assert.equal((staged??state)[args.section_id]['.type'],'subscription');return ok({success:true})}
    if(obj==='rc'&&method==='init')return ok()
    throw Error('Unexpected mock endpoint '+obj+'.'+method)
  }
}
function writes(){return calls.filter(c=>{if(!c.url.endsWith('/ubus'))return false;const p=JSON.parse(c.init.body).params;return (p[1]==='uci'&&['set','add','delete','order','commit','revert'].includes(p[2]))||(p[1]==='file'&&p[2]==='write')||p[1]==='rc'||p[1]==='luci.nikki'})}
function topButton(tree,title){return button(h('VStack',{},tree.props.toolbar.topBarLeading,tree.props.toolbar.topBarTrailing),title)}
async function settle(){for(let i=0;i<5;i++)await flush()}
const sub={name:'Edited',url:'https://new-subscription.invalid/file',userAgent:'mihomo',prefer:'remote'}
;(async()=>{
  await test('list metadata includes local/subscription origins, no file contents or persistence',async()=>{
    fixture();const d=await api.loadNikkiManagement(n)
    assert.equal(d.files.length,2);assert.equal(d.files[1].key,'subscription:s1');assert.equal(d.files[0].size,Buffer.byteLength(remoteFiles.get('/etc/nikki/profiles/local.yaml')));assert.equal(d.files[1].mtime,1700000000)
    assert.equal(d.subscriptions[0].userAgent,'clash.meta');assert.equal(d.subscriptions[0].prefer,'local');assert.equal(d.rules[0].noResolve,false)
    assert.equal(calls.filter(c=>c.url.includes('cgi-download')).length,0);assert.equal(writes().length,0);assert.ok(!JSON.stringify([...store]).includes('fixture-only'));assert.ok(!JSON.stringify([...store]).includes('模拟'));assert.ok(!JSON.stringify(d).includes('config-unknown'))
    dirDenied=true;assert.equal((await api.loadNikkiManagement(n)).filesError,true)
  })
  await test('subscription edit/add/delete use actual UCI values and preserve unrelated/unknown fields',async()=>{
    fixture();let d=await api.loadNikkiManagement(n);const before=clone(state)
    await api.saveNikkiSubscription(n,d,'s1',sub);assert.equal(state.s1.user_agent,'mihomo');assert.equal(state.s1.prefer,'remote');assert.equal(state.s1.info_url,before.s1.info_url);assert.equal(state.s1.unknown,before.s1.unknown);assert.deepEqual(state.r1,before.r1);assert.deepEqual(state.config,before.config)
    d=await api.loadNikkiManagement(n);await api.saveNikkiSubscription(n,d,null,sub);const added=Object.keys(state).find(k=>k.startsWith('added'));assert.ok(added);assert.equal(state[added]['.type'],'subscription');assert.equal(state[added].url,sub.url)
    d=await api.loadNikkiManagement(n);await api.deleteNikkiSubscription(n,d,added);assert.ok(!state[added]);assert.equal(remoteFiles.size,2);assert.ok(!writes().some(c=>JSON.parse(c.init.body).params[1]==='rc'))
    state.config.profile='subscription:s1';d=await api.loadNikkiManagement(n);await assert.rejects(()=>api.deleteNikkiSubscription(n,d,'s1'),/不能删除/);assert.ok(state.s1);assert.equal(writes().filter(c=>JSON.parse(c.init.body).params[2]==='delete').length,1)
  })
  await test('rule edit/add/delete/switch/reorder preserve unknown fields and non-rule slots',async()=>{
    fixture();let d=await api.loadNikkiManagement(n);await api.saveNikkiRule(n,d,'r1',{type:'IP-CIDR',matcher:'192.0.2.0/24',node:'DIRECT',enabled:false,noResolve:true});assert.equal(state.r1.no_resolve,'1');assert.equal(state.r1.unknown,'rule-kept')
    d=await api.loadNikkiManagement(n);await api.setNikkiRulesEnabled(n,d,false);assert.equal(state.mixin.rule,'0');assert.equal(state.mixin.unknown,'mixin-kept')
    d=await api.loadNikkiManagement(n);await api.reorderNikkiRules(n,d,['r2','r1']);assert.equal(state.r2['.index'],1);assert.equal(state.r1['.index'],3);assert.equal(state.s1['.index'],2);assert.equal(state.config['.index'],0)
    d=await api.loadNikkiManagement(n);await api.saveNikkiRule(n,d,null,{type:'MATCH',matcher:'',node:'DIRECT',enabled:true,noResolve:false});const added=Object.keys(state).find(k=>k.startsWith('added'));d=await api.loadNikkiManagement(n);await api.deleteNikkiRule(n,d,added);assert.ok(!state[added]);assert.equal(state.s1.name,'Mock subscription')
  })
  await test('invalid source/path/section/field/type-specific input fails before writes',async()=>{
    fixture();const d=await api.loadNikkiManagement(n);calls.length=0
    for(const key of ['file:../outside.yaml','file:a/b.yaml','file:a\\b.yaml','file:a\n.yaml','file:ambiguous:name.yaml','subscription:../x','file:not-a-config','/etc/config/nikki'])assert.throws(()=>api.nikkiFilePath(key))
    for(const key of ['file:a.yaml','file:空 格.yml','subscription:s1'])assert.ok(api.nikkiFilePath(key).startsWith('/etc/nikki/'))
    await assert.rejects(()=>api.loadNikkiManagement({...n,plugin:'openclash'}));await assert.rejects(()=>api.saveNikkiFile({...n,kind:'clash'},'file:local.yaml','',''))
    await assert.rejects(()=>api.saveNikkiSubscription(n,d,'s1',{...sub,userAgent:'Clash Meta'}));await assert.rejects(()=>api.saveNikkiSubscription(n,d,'s1',{...sub,url:'file:///tmp/config'}));await assert.rejects(()=>api.deleteNikkiRule(n,d,'a;reboot'))
    for(const r of [{type:'IP-CIDR',matcher:'999.1.1.1/24'},{type:'IP-CIDR6',matcher:'gg::/64'},{type:'IP-CIDR6',matcher:':1::2/64'},{type:'DST-PORT',matcher:'65536'},{type:'SRC-PORT',matcher:'90-10'},{type:'DOMAIN',matcher:'invalid domain'}])assert.throws(()=>api.validateNikkiRule({...r,node:'DIRECT',enabled:true,noResolve:false}))
    api.validateNikkiRule({type:'DST-PORT',matcher:'80/443/1000-2000',node:'DIRECT',enabled:true,noResolve:false});api.validateNikkiRule({type:'MATCH',matcher:'',node:'DIRECT',enabled:true,noResolve:false});api.validateNikkiRule({type:'IP-CIDR6',matcher:'::ffff:192.0.2.1/128',node:'DIRECT',enabled:true,noResolve:false})
    assert.equal(calls.length,0)
  })
  await test('stale UCI snapshot, cross-source snapshot and dirty session never modify or clear foreign changes',async()=>{
    fixture();let d=await api.loadNikkiManagement(n);state.config.untouched='external';calls.length=0;await assert.rejects(()=>api.saveNikkiSubscription(n,d,'s1',sub),/已改变/);assert.equal(writes().length,0)
    d=await api.loadNikkiManagement(n);calls.length=0;await assert.rejects(()=>api.saveNikkiSubscription({...n,url:'http://other.invalid'},d,'s1',sub),/来源/);assert.equal(calls.length,0)
    dirty=[['set','s1','name','foreign']];await assert.rejects(()=>api.saveNikkiSubscription(n,d,'s1',sub),/未提交/);assert.equal(writes().length,0);assert.equal(dirty.length,1)
  })
  await test('permission denial does not retry mutations, cleanup own staging; lost commit is uncertain not replayed',async()=>{
    fixture();let d=await api.loadNikkiManagement(n);fail=(obj,m)=>obj==='uci'&&m==='set'?{body:{result:[6]}}:null
    await assert.rejects(()=>api.saveNikkiSubscription(n,d,'s1',sub),/保存未完成/);assert.equal(state.s1.name,'Mock subscription');assert.equal(writes().filter(c=>JSON.parse(c.init.body).params[2]==='set').length,1);assert.equal(staged,null)
    fail=(obj,m)=>obj==='uci'&&m==='commit'?{throw:'lost reply'}:null;calls.length=0;await assert.rejects(()=>api.saveNikkiSubscription(n,d,'s1',sub),/提交结果未确认/);assert.equal(writes().filter(c=>JSON.parse(c.init.body).params[2]==='commit').length,1);assert.ok(staged);assert.equal(writes().filter(c=>JSON.parse(c.init.body).params[2]==='revert').length,0)
  })
  await test('large UTF-8 configuration reads via CGI not file.read; CRLF, Unicode and tail retained',async()=>{
    fixture();const text='# 模拟🧪\r\n'.repeat(40000)+'# end-of-file\n';remoteFiles.set('/etc/nikki/profiles/local.yaml',text);const value=await api.readNikkiFile(n,'file:local.yaml');assert.equal(value,text);assert.ok(Buffer.byteLength(value)>256*1024);assert.ok(calls.some(c=>c.url.endsWith('/cgi-bin/cgi-download')));assert.ok(!calls.some(c=>c.url.endsWith('/ubus')&&JSON.parse(c.init.body).params[2]==='read'))
    truncated=true;await assert.rejects(()=>api.readNikkiFile(n,'file:local.yaml'),/未完整/);truncated=false;downloadStatus=403;await assert.rejects(()=>api.readNikkiFile(n,'file:local.yaml'),/cgi-download/);downloadStatus=200;links=true;await assert.rejects(()=>api.readNikkiFile(n,'file:local.yaml'),/普通文件/)
  })
  await test('lstat checks all ancestors concurrently; exec denied does not block full edit or profile selection',async()=>{
    fixture();const key='subscription:s1',p='/etc/nikki/subscriptions/s1.yaml',original=remoteFiles.get(p),base=await api.loadNikkiManagement(n)
    let release;const wait=new Promise(r=>release=r);fail=(obj,m,args)=>obj==='file'&&m==='lstat'?{body:{result:[0,{type:args.path===p?'file':'directory'}]},wait}:null
    calls.length=0;const reading=api.readNikkiFile(n,key);await settle();const paths=calls.filter(c=>c.url.endsWith('/ubus')&&JSON.parse(c.init.body).params[2]==='lstat').map(c=>JSON.parse(c.init.body).params[3].path);assert.deepEqual([...new Set(paths)].sort(),['/etc','/etc/nikki','/etc/nikki/subscriptions',p].sort());assert.equal(calls.filter(c=>c.url.includes('cgi-download')).length,0);release();assert.equal(await reading,original)
    fail=null;await api.saveNikkiFile(n,key,original,original+'# saved\n');assert.equal(remoteFiles.get(p),original+'# saved\n');await api.selectNikkiProfile(n,base,key);assert.equal(state.config.profile,key);assert.equal(calls.filter(c=>c.url.endsWith('/ubus')&&JSON.parse(c.init.body).params[2]==='exec').length,0)
  })
  await test('lstat rejects any ancestor or leaf symlink/non-file even when list follows it and exec is allowed',async()=>{
    for(const origin of ['profiles/local.yaml','subscriptions/s1.yaml'])for(const bad of ['/etc','/etc/nikki','/etc/nikki/'+origin.split('/')[0],'/etc/nikki/'+origin]){
      fixture();execAllowed=true;lstatTypes.set(bad,'link');const key=origin.startsWith('profiles')?'file:local.yaml':'subscription:s1';await assert.rejects(()=>api.readNikkiFile(n,key),/符号链接/);assert.equal(writes().length,0);assert.equal(calls.filter(c=>c.url.includes('cgi-download')).length,0);assert.ok(!calls.some(c=>c.url.endsWith('/ubus')&&JSON.parse(c.init.body).params[2]==='exec'))
    }
    fixture();lstatTypes.set('/etc/nikki/profiles/local.yaml','directory');await assert.rejects(()=>api.readNikkiFile(n,'file:local.yaml'),/普通文件/)
  })
  await test('legacy fallback only for wholly absent lstat; canonical mismatch or denied exec fails closed',async()=>{
    fixture();lstatUnsupported=true;execAllowed=true;assert.equal(await api.readNikkiFile(n,'file:local.yaml'),remoteFiles.get('/etc/nikki/profiles/local.yaml'));assert.ok(calls.some(c=>c.url.endsWith('/ubus')&&JSON.parse(c.init.body).params[2]==='exec'))
    canonicalOverride='/etc/config/sensitive';calls.length=0;await assert.rejects(()=>api.readNikkiFile(n,'file:local.yaml'),/符号链接/);assert.equal(calls.filter(c=>c.url.includes('cgi-download')).length,0);assert.equal(writes().length,0)
    canonicalOverride=null;execAllowed=false;await assert.rejects(()=>api.readNikkiFile(n,'file:local.yaml'),/路径核验权限/);assert.equal(writes().length,0)
    for(const status of [3,4,6,8]){
      fixture();execAllowed=true;fail=(obj,m,args)=>obj==='file'&&m==='lstat'&&args.path==='/etc/nikki'?{body:{result:[status]}}:null;await assert.rejects(()=>api.readNikkiFile(n,'file:local.yaml'),/lstat/);assert.equal(calls.filter(c=>c.url.includes('cgi-download')).length,0);assert.ok(!calls.some(c=>c.url.endsWith('/ubus')&&JSON.parse(c.init.body).params[2]==='exec'))
    }
    fixture();execAllowed=true;fail=(obj,m)=>obj==='file'&&m==='lstat'?{body:{result:[0,{}]}}:null;await assert.rejects(()=>api.readNikkiFile(n,'file:local.yaml'),/普通文件/);assert.ok(!calls.some(c=>c.url.endsWith('/ubus')&&JSON.parse(c.init.body).params[2]==='exec'))
  })
  await test('large save chunks by UTF-8 bytes, preserves mode, checks full read-back and never reloads',async()=>{
    fixture();const original=remoteFiles.get('/etc/nikki/profiles/local.yaml'),next='# config\r\n'+('中文🧪 newline\r\n'.repeat(25000))+'# tail\n';await api.saveNikkiFile(n,'file:local.yaml',original,next);assert.equal(remoteFiles.get('/etc/nikki/profiles/local.yaml'),next)
    const chunks=writes().map(c=>JSON.parse(c.init.body).params).filter(p=>p[1]==='file');assert.ok(chunks.length>50);assert.equal(chunks[0][3].append,false);assert.ok(chunks.slice(1).every(p=>p[3].append));assert.ok(chunks.every(p=>p[3].mode===0o640));assert.equal(chunks.map(p=>p[3].data).join(''),next);assert.ok(!writes().some(c=>JSON.parse(c.init.body).params[1]==='rc'))
    calls.length=0;await assert.rejects(()=>api.saveNikkiFile(n,'file:local.yaml',original,'new'),/已改变/);assert.equal(writes().length,0)
  })
  await test('partial write failure is explicit; no append replay and local per-source concurrent writes rejected',async()=>{
    fixture();const original=remoteFiles.get('/etc/nikki/profiles/local.yaml');let seen=0
    fail=(obj,m)=>obj==='file'&&m==='write'&&++seen===2?{throw:'connection lost'}:null
    await assert.rejects(()=>api.saveNikkiFile(n,'file:local.yaml',original,'x'.repeat(25000)),/部分内容/);assert.equal(seen,2);assert.equal(remoteFiles.get('/etc/nikki/profiles/local.yaml').length,8192)
    fixture();let release;downloadWait=new Promise(r=>release=r);const pending=api.saveNikkiFile(n,'file:local.yaml',original,'different');await settle();await assert.rejects(()=>api.saveNikkiFile(n,'file:local.yaml',original,'overlap'),/正在执行/);release();downloadWait=null;await pending
  })
  await test('subscription update verifies section type; configuration selection commits with upstream reload event, no extra rc reload',async()=>{
    fixture();await api.updateNikkiSubscription(n,'s1');assert.ok(writes().some(c=>JSON.parse(c.init.body).params[2]==='update_subscription'));calls.length=0;await assert.rejects(()=>api.updateNikkiSubscription(n,'r1'),/类型不符/);assert.equal(writes().length,0)
    const d=await api.loadNikkiManagement(n);await api.selectNikkiProfile(n,d,'subscription:s1');assert.equal(state.config.profile,'subscription:s1');assert.equal(autoReloads,1);assert.ok(!writes().some(c=>JSON.parse(c.init.body).params[1]==='rc'))
  })
  await test('native pages: neutral cards, plain navigation destination, rule empty state/menu, no config body previews',async()=>{
    fixture();let props={c:n,kind:'profile'},tree=render(pages.ManagementPage,props,true);await settle();tree=render(pages.ManagementPage,props);assert.equal(tree.props.background,'systemBackground');assert.ok(text(tree).includes('左右滑动'));assert.equal(nodes(tree,'TabView')[0].props.tabViewStyle,'page');assert.equal(nodes(tree,'TextField').length,0);assert.equal(calls.filter(c=>c.url.includes('cgi-download')).length,0)
    assert.ok(!nodes(tree,'Button').some(b=>b.props.title?.includes('LuCI')||b.props.title?.includes('官方')));assert.ok(nodes(tree,'RoundedRectangle').every(r=>['secondarySystemBackground','tertiarySystemBackground'].includes(r.props.fill)))
    state={config:state.config,mixin:state.mixin};props={c:n,kind:'subscription'};render(pages.ManagementPage,props,true);await settle();tree=render(pages.ManagementPage,props);assert.ok(text(tree).includes('暂无订阅，请点击右上角 + 添加'));assert.ok(!text(tree).includes('\uFFFD'));props={c:n,kind:'rule'};tree=render(pages.ManagementPage,props,true);await settle();tree=render(pages.ManagementPage,props);assert.ok(text(tree).includes('没有规则'));assert.ok(text(tree).includes('点击右上角菜单添加规则'));for(const title of ['排序列表','禁用规则','添加规则'])assert.ok(button(trailing(tree.props.toolbar),title));button(trailing(tree.props.toolbar),'添加规则').props.action();tree=render(pages.ManagementPage,props);assert.equal(tree.props.navigationDestination.isPresented,true);assert.equal(tree.props.navigationDestination.content.type,management.NikkiRuleEditor)
    const src=fs.readFileSync(path.join(root,'dashboard-pages.tsx'),'utf8').split('// Native Nikki management:')[1];assert.ok(!/Animation|Transition|withAnimation|rotationEffect|sheet=/.test(src));assert.ok(!src.includes('Safari'));assert.ok(!src.includes('\uFFFD'))
  })
  await test('all delete/update/enable/switch confirmations cancel without mutation; enable confirms upstream reload and does not reload twice',async()=>{
    fixture();context.confirmResult=false;let props={c:n,kind:'subscription'};render(pages.ManagementPage,props,true);await settle();let tree=render(pages.ManagementPage,props);calls.length=0;await button(tree,'删除订阅').props.action();await button(tree,'更新订阅').props.action();assert.equal(calls.length,0)
    props={c:n,kind:'rule'};render(pages.ManagementPage,props,true);await settle();tree=render(pages.ManagementPage,props);calls.length=0;await button(tree,'删除规则').props.action();await button(trailing(tree.props.toolbar),'禁用规则').props.action();assert.equal(calls.length,0)
    props={c:n,kind:'profile'};render(pages.ManagementPage,props,true);await settle();tree=render(pages.ManagementPage,props);const target=nodes(tree,'Button').find(b=>text(b).includes('Mock subscription')&&b.props.buttonStyle==='plain');assert.ok(target);calls.length=0;await target.props.action();assert.equal(calls.length,0)
    context.confirmResult=true;await target.props.action();assert.equal(state.config.profile,'subscription:s1');const list=writes().map(c=>JSON.parse(c.init.body).params);assert.equal(list.at(-1)[1],'uci');assert.equal(list.at(-1)[2],'commit');assert.equal(autoReloads,1);assert.ok(!list.some(p=>p[1]==='rc'));assert.ok(confirms.at(-1).message.includes('重载'))
  })
  await test('subscription editor saves actual values; cancellation zero side effect; failure retains draft',async()=>{
    fixture();const base=await api.loadNikkiManagement(n);let saved=false;const props={c:n,base,value:base.subscriptions[0],done:v=>saved=v};let tree=render(management.NikkiSubscriptionEditor,props,true);await settle();tree=render(management.NikkiSubscriptionEditor,props);assert.equal(topButton(tree,'保存').props.disabled,true);assert.equal(nodes(tree,'Picker')[0].props.value,'clash.meta');assert.equal(nodes(tree,'Picker')[1].props.value,'local')
    nodes(tree,'TextField')[0].props.onChanged('Draft kept');tree=render(management.NikkiSubscriptionEditor,props);calls.length=0;fail=(obj,m)=>obj==='uci'&&m==='set'?{body:{result:[6]}}:null;await topButton(tree,'保存').props.action();tree=render(management.NikkiSubscriptionEditor,props);assert.equal(nodes(tree,'TextField')[0].props.value,'Draft kept');assert.equal(saved,false);assert.ok(text(tree).includes('草稿'))
    fail=null;await topButton(tree,'保存').props.action();assert.equal(saved,true);assert.equal(state.s1.name,'Draft kept');assert.equal(state.s1.user_agent,'clash.meta');assert.equal(state.s1.prefer,'local')
    saved=false;tree=render(management.NikkiSubscriptionEditor,props,true);calls.length=0;await topButton(tree,'取消').props.action();assert.equal(calls.length,0);assert.equal(saved,undefined)
  })
  await test('file editor full draft, unchanged save disabled, cancel/failed overwrite preserves text; changed source blocked',async()=>{
    fixture();const original='# text\r\n'.repeat(1000);remoteFiles.set('/etc/nikki/profiles/local.yaml',original);const base=await api.loadNikkiManagement(n);const props={c:n,base,file:base.files[0],done(){}};let tree=render(management.NikkiFileEditor,props,true);await settle();tree=render(management.NikkiFileEditor,props);assert.equal(topButton(tree,'保存').props.disabled,true);assert.equal(nodes(tree,'TextField')[0].props.value,original);assert.equal(nodes(tree,'TextField')[0].props.axis,'vertical');assert.equal(nodes(tree,'TextField')[0].props.fontDesign,'monospaced')
    const draft=original+'# changed\r\n';nodes(tree,'TextField')[0].props.onChanged(draft);tree=render(management.NikkiFileEditor,props);context.confirmResult=false;calls.length=0;await topButton(tree,'保存').props.action();assert.equal(calls.length,0);context.confirmResult=true;fail=(obj,m)=>obj==='file'&&m==='write'?{throw:'fail'}:null;await topButton(tree,'保存').props.action();tree=render(management.NikkiFileEditor,props);assert.equal(nodes(tree,'TextField')[0].props.value,draft);assert.ok(text(tree).includes('部分内容'));assert.equal(topButton(tree,'保存').props.disabled,false)
    tree=render(management.NikkiFileEditor,{...props,c:{...n,url:'http://changed.invalid'}});calls.length=0;await topButton(tree,'保存').props.action();assert.equal(calls.length,0)
  })
  await test('sorting is draft-only until save; source change and pending confirmations cannot send writes',async()=>{
    fixture();const base=await api.loadNikkiManagement(n);let canceled=false;const props={c:n,base,done:()=>canceled=true};let tree=render(management.NikkiRuleSort,props,true);await settle();calls.length=0;button(tree,'下移').props.action();tree=render(management.NikkiRuleSort,props);assert.equal(topButton(tree,'保存').props.disabled,false);assert.equal(calls.length,0);await topButton(tree,'取消').props.action();assert.ok(canceled);assert.equal(calls.length,0)
    let release;const originalConfirm=context.Dialog.confirm;context.Dialog.confirm=()=>new Promise(r=>release=r)
    const pageProps={c:n,kind:'subscription'};render(pages.ManagementPage,pageProps,true);await settle();tree=render(pages.ManagementPage,pageProps);calls.length=0;const pending=button(tree,'删除订阅').props.action();render(pages.ManagementPage,{...pageProps,c:{...n,id:'new-source'}});release(true);await pending;assert.equal(calls.length,0);context.Dialog.confirm=originalConfirm
  })
  await test('rule editor and sorting bind real fields; commit cancel has zero requests, successful save preserves unknowns',async()=>{
    fixture();let base=await api.loadNikkiManagement(n),saved=false;const props={c:n,base,value:base.rules[0],done:v=>saved=v};let tree=render(management.NikkiRuleEditor,props,true);await settle();nodes(tree,'Picker')[0].props.onChanged('IP-CIDR');tree=render(management.NikkiRuleEditor,props);nodes(tree,'TextField')[1].props.onChanged('192.0.2.0/24');nodes(tree,'TextField')[2].props.onChanged('REJECT');nodes(tree,'Toggle')[0].props.onChanged(false);nodes(tree,'Toggle')[1].props.onChanged(true);tree=render(management.NikkiRuleEditor,props)
    context.confirmResult=false;calls.length=0;await topButton(tree,'保存').props.action();assert.equal(calls.length,0);assert.equal(saved,false);context.confirmResult=true;await topButton(tree,'保存').props.action();assert.equal(saved,true);assert.equal(state.r1.type,'IP-CIDR');assert.equal(state.r1.matcher,'192.0.2.0/24');assert.equal(state.r1.node,'REJECT');assert.equal(state.r1.enabled,'0');assert.equal(state.r1.no_resolve,'1');assert.equal(state.r1.unknown,'rule-kept');assert.ok(confirms.at(-1).message.includes('自动触发 Nikki 重载'))
    base=await api.loadNikkiManagement(n);const sortProps={c:n,base,done(){}};tree=render(management.NikkiRuleSort,sortProps,true);await settle();button(tree,'下移').props.action();tree=render(management.NikkiRuleSort,sortProps);await topButton(tree,'保存').props.action();assert.equal(state.r2['.index'],1);assert.equal(state.r1['.index'],3);assert.equal(state.s1['.index'],2)
  })
  await test('read-only login recovery reuses the existing auth path; no content or URL reaches persistence',async()=>{
    fixture();await api.loadNikkiManagement(n);let denied=true;fail=(obj,m)=>{if(obj==='uci'&&m==='get'&&denied){denied=false;return {body:{result:[6]}}}return null};calls.length=0;await api.loadNikkiManagement(n);assert.equal(calls.filter(c=>c.url.endsWith('/ubus')&&JSON.parse(c.init.body).params[1]==='session').length,1)
    const persisted=JSON.stringify([...store]);for(const secret of ['fixture-only','中文🧪','Draft kept','config-unknown'])assert.ok(!persisted.includes(secret))
  })
  unmount();console.log('All '+count+' Nikki management groups passed (mock only; no native layout/device validation).')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness + checks, { require, __dirname, console, process, Buffer }, { filename: __filename })
