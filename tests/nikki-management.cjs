// Targeted in-memory integration tests. No real router, credentials or network.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const harness = fs.readFileSync(path.join(__dirname, 'run.cjs'), 'utf8').split(';(async () => {')[0]
const checks = String.raw`
const management=pages
const nativeTimers=require('node:timers');context.setTimeout=(fn,ms)=>ms>=5000?nativeTimers.setTimeout(fn,ms):fn();context.clearTimeout=nativeTimers.clearTimeout
const n={id:'management-mock',name:'Mock Nikki',kind:'openwrt',plugin:'nikki',url:'http://management.invalid',username:'root'}
let state,staged=null,dirty=[],remoteFiles,fail=null,downloadStatus=200,truncated=false,links=false,dirDenied=false,downloadWait=null,autoReloads=0,canonicalOverride=null,lstatUnsupported=false,lstatTypes=new Map(),execAllowed=false
let fixtureID=0
function fixture(){
  n.id="management-mock-"+(++fixtureID)
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
function assertEditorActionsAbsent(tree){assert.equal(tree.props.toolbar,undefined);assert.ok(!nodes(tree,'Button').some(b=>['保存','取消','保存中…'].includes(b.props.title)))}
function fileSave(tree,disabled){const save=tree.props.toolbar.topBarTrailing;assert.equal(save.type,'Button');assert.equal(save.props.accessibilityLabel,'保存');assert.equal(save.props.buttonStyle,'plain');assert.equal(save.props.title,undefined);assert.equal(save.props.systemImage,undefined);assert.equal(save.props.children.length,1);const icon=save.props.children[0];assert.equal(icon.type,'Image');assert.equal(icon.props.systemName,'checkmark.circle');assert.equal(icon.props.frame,undefined);assert.equal(icon.props.background,undefined);assert.equal(nodes(save,'Text').length,0);if(disabled!==undefined)assert.equal(save.props.disabled,disabled);return save}
async function openFile(props){let tree=render(management.NikkiFileEditor,props,true);fileSave(tree,true);await settle();tree.props.onAppear();tree=render(management.NikkiFileEditor,props);await settle();tree=render(management.NikkiFileEditor,props);return {tree,editor:nodes(tree,'WebView')[0].props.controller}}
async function waitUntil(fn){for(let i=0;i<60&&!fn();i++)await new Promise(r=>nativeTimers.setTimeout(r,10));assert.ok(fn(),'wait condition')}

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
  await test('subscription preflight distinguishes dirty/unknown changes from permission failure, with zero writes',async()=>{
    for(const response of [{changes:[['set','s1','name','foreign']]},{changes:{}},{},{changes:null}]){
      fixture();const base=await api.loadNikkiManagement(n);calls.length=0
      fail=(obj,m)=>obj==='uci'&&m==='changes'?{body:{result:[0,response]}}:null
      const expected=Array.isArray(response.changes)?/当前会话有未提交的 Nikki 改动/:/无法核验当前会话的 Nikki 暂存状态/
      await assert.rejects(()=>api.saveNikkiSubscription(n,base,'s1',sub),expected);assert.equal(writes().length,0);assert.equal(state.s1.name,'Mock subscription')
    }
    fixture();const base=await api.loadNikkiManagement(n);calls.length=0
    fail=(obj,m)=>obj==='uci'&&m==='changes'?{body:{result:[6]}}:null
    await assert.rejects(()=>api.saveNikkiSubscription(n,base,'s1',sub),/没有权限访问 uci.changes/);assert.equal(writes().length,0)
  })
  await test('commit accepts status-only [0]; lost acknowledgement verifies clean persisted target, never replays writes',async()=>{
    for(const lost of [false,true]){
      fixture();const base=await api.loadNikkiManagement(n);let commits=0
      fail=(obj,m)=>{if(obj!=='uci'||m!=='commit')return null;commits++;state=staged;staged=null;dirty=[];autoReloads++;return lost?{throw:'lost reply after commit'}:{body:{result:[0]}}}
      await api.saveNikkiSubscription(n,base,null,sub);assert.equal(commits,1);assert.equal(autoReloads,1);assert.equal(Object.values(state).filter(v=>v.name===sub.name).length,1)
      const methods=writes().map(c=>JSON.parse(c.init.body).params[2]);assert.deepEqual(methods,['add','commit']);assert.ok(!calls.some(c=>c.url.endsWith('/ubus')&&JSON.parse(c.init.body).params[1]==='rc'))
    }
  })
  await test('lost commit with matching staged values or conflicting persisted state remains unknown, no revert/retry',async()=>{
    for(const mode of ['staged','conflict','unreadable']){
      fixture();const base=await api.loadNikkiManagement(n);let committed=false
      fail=(obj,m)=>{
        if(obj==='uci'&&m==='commit'){committed=true;if(mode==='conflict'){state=staged;state.s1.name='external';staged=null;dirty=[]}return {throw:'lost reply'}}
        if(committed&&mode==='unreadable'&&obj==='uci')return {throw:'offline'}
        return null
      }
      await assert.rejects(()=>api.saveNikkiSubscription(n,base,'s1',sub),/提交结果未确认/)
      assert.deepEqual(writes().map(c=>JSON.parse(c.init.body).params[2]),['set','commit']);if(mode==='staged'){assert.equal(staged.s1.name,sub.name);assert.ok(dirty.length)}
    }
  })
  await test('verification pins the write session, retries reads only and rejects newly staged data/expired session',async()=>{
    for(const mode of ['recover','new-staging','expired']){
      fixture();const base=await api.loadNikkiManagement(n);let committed=false,reads=0,writeSid='',logins=0
      fail=(obj,m)=>{
        const sid=JSON.parse(calls.at(-1).init.body).params[0]
        if(committed&&obj==='session')logins++
        if(obj==='uci'&&m==='commit'){writeSid=sid;committed=true;state=staged;staged=null;dirty=[];return {throw:'lost reply'}}
        if(committed&&obj==='uci'){
          assert.equal(sid,writeSid);reads++
          if(mode==='expired')return {body:{result:[6]}}
          if(mode==='recover'&&reads===1)return {throw:'temporarily offline'}
          if(mode==='new-staging'&&m==='get')dirty=[['set','s1','name','foreign']]
        }
        return null
      }
      const saving=api.saveNikkiSubscription(n,base,'s1',sub)
      if(mode==='recover')await saving;else await assert.rejects(()=>saving,/提交结果未确认/)
      assert.equal(logins,0);assert.ok(reads<=9);assert.deepEqual(writes().map(c=>JSON.parse(c.init.body).params[2]),['set','commit'])
    }
  })
  await test('unverified commit exposes safe protocol status only, never private transport details',async()=>{
    for(const [reply,expected] of [[{body:{result:[6]}},/ubus状态6/],[{body:{result:[9]}},/代码 9/],[{status:503},/HTTP 503/],[{throw:'https://private.invalid/sub?token=secret'},/未取得有效提交响应/]]){
      fixture();const base=await api.loadNikkiManagement(n);fail=(obj,m)=>obj==='uci'&&m==='commit'?reply:null
      await assert.rejects(()=>api.saveNikkiSubscription(n,base,'s1',sub),e=>{assert.match(e.message,expected);assert.ok(!e.message.includes('private.invalid')&&!e.message.includes('token='));return true})
      assert.deepEqual(writes().map(c=>JSON.parse(c.init.body).params[2]),['set','commit']);assert.ok(staged);assert.ok(dirty.length)
    }
  })
  await test('duplicate disappear callbacks share uncertain save, retain original error and draft without a second mutation',async()=>{
    fixture();const base=await api.loadNikkiManagement(n),props={c:n,base,value:null,done(){throw Error('must not report saved')}}
    let tree=render(management.NikkiSubscriptionEditor,props,true);await settle();nodes(tree,'TextField')[0].props.onChanged('New draft');nodes(tree,'TextField')[1].props.onChanged(sub.url)
    fail=(obj,m)=>obj==='uci'&&m==='commit'?{throw:'lost reply'}:null
    const first=tree.props.onDisappear(),second=tree.props.onDisappear();assert.equal(first,second);await first
    tree=render(management.NikkiSubscriptionEditor,props);assert.ok(text(tree).includes('提交结果未确认'));assert.equal(nodes(tree,'TextField')[0].props.value,'New draft');await tree.props.onDisappear()
    assert.deepEqual(writes().map(c=>JSON.parse(c.init.body).params[2]),['add','commit']);assert.ok(dirty.length)
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
  await test('two subscriptions: only clicked id updates/spins; completion rereads management without updating the other',async()=>{
    for(const mode of ['success','failure','source-change']){
      fixture();state.s2={...state.s1,'.index':5,name:'Second subscription',url:'https://second.invalid/sub'}
      const before=clone(state),props={c:n,kind:'subscription'};let tree=render(pages.ManagementPage,props,true);await settle();tree=render(pages.ManagementPage,props)
      const buttons=t=>nodes(t,'Button').filter(b=>b.props.accessibilityLabel==='更新订阅');assert.equal(buttons(tree).length,2)
      let release;const gate=new Promise(r=>release=r);fail=(obj,m)=>obj==='luci.nikki'&&m==='update_subscription'?{wait:gate,body:{result:[0,{success:mode!=='failure'}]}}:null
      calls.length=0;const confirmsBefore=confirms.length,alertsBefore=alerts.length,pending=buttons(tree)[0].props.action();await settle();tree=render(pages.ManagementPage,props)
      assert.equal(nodes(buttons(tree)[0],'ProgressView').length,1);assert.equal(nodes(buttons(tree)[1],'ProgressView').length,0);assert.ok(buttons(tree).every(b=>b.props.disabled))
      await buttons(tree)[1].props.action();const requests=()=>calls.filter(c=>c.url.endsWith('/ubus')).map(c=>JSON.parse(c.init.body).params)
      assert.deepEqual(requests().filter(p=>p[1]==='luci.nikki').map(p=>[p[2],p[3]]),[['update_subscription',{section_id:'s1'}]])
      assert.deepEqual(requests().filter(p=>p[1]==='uci'&&p[2]==='get').map(p=>p[3]),[{config:'nikki',section:'s1'}])
      const count=calls.length,active=mode==='source-change'?{...props,c:{...n,url:'http://other.invalid'}}:props
      if(mode==='source-change')tree=render(pages.ManagementPage,active)
      release();await pending;tree=render(pages.ManagementPage,active);await settle();tree=render(pages.ManagementPage,active)
      assert.equal(nodes(tree,'ProgressView').length,0);assert.equal(confirms.length,confirmsBefore);assert.equal(alerts.length,alertsBefore);assert.deepEqual(state,before)
      assert.equal(requests().filter(p=>p[1]==='luci.nikki').length,1)
      const after=requests().slice(requests().length-(calls.length-count))
      if(mode==='success'){
        assert.deepEqual(after.map(p=>[p[1],p[2],p[3]]),[['uci','get',{config:'nikki'}],['file','list',{path:'/etc/nikki/profiles'}],['file','list',{path:'/etc/nikki/subscriptions'}]])
        assert.ok(buttons(tree).every(b=>!b.props.disabled))
      }else{assert.equal(calls.length,count);if(mode==='failure'){assert.ok(text(tree).includes('订阅更新失败'));assert.ok(buttons(tree).every(b=>!b.props.disabled))}else assert.ok(text(tree).includes('来源已改变'))}
    }
  })
  await test('subscription update verifies section type; configuration selection commits with upstream reload event, no extra rc reload',async()=>{
    fixture();await api.updateNikkiSubscription(n,'s1');assert.ok(writes().some(c=>JSON.parse(c.init.body).params[2]==='update_subscription'));calls.length=0;await assert.rejects(()=>api.updateNikkiSubscription(n,'r1'),/类型不符/);assert.equal(writes().length,0)
    const d=await api.loadNikkiManagement(n);await api.selectNikkiProfile(n,d,'subscription:s1');assert.equal(state.config.profile,'subscription:s1');assert.equal(autoReloads,1);assert.ok(!writes().some(c=>JSON.parse(c.init.body).params[1]==='rc'))
  })
  await test('native pages: neutral cards, plain navigation destination, rule empty state/menu, no config body previews',async()=>{
    fixture();let props={c:n,kind:'profile'},tree=render(pages.ManagementPage,props,true);await settle();tree=render(pages.ManagementPage,props);assert.equal(tree.props.background,'systemBackground');assert.ok(!text(tree).includes('当前选用'));assert.equal(nodes(tree,'Image').filter(i=>i.props.systemName==='checkmark.circle.fill').length,1);assert.ok(!text(tree).includes('勾选来自 Nikki'));assert.ok(!text(tree).includes('左右滑动'));assert.equal(nodes(tree,'TabView').length,0);assert.equal(nodes(tree,'ScrollView').length,1);assert.equal(nodes(tree,'TextField').length,0);assert.equal(calls.filter(c=>c.url.includes('cgi-download')).length,0)
    assert.ok(!nodes(tree,'Button').some(b=>b.props.title?.includes('LuCI')||b.props.title?.includes('官方')));assert.ok(nodes(tree,'RoundedRectangle').every(r=>['secondarySystemBackground','tertiarySystemBackground'].includes(r.props.fill)))
    state={config:state.config,mixin:state.mixin};props={c:n,kind:'subscription'};render(pages.ManagementPage,props,true);await settle();tree=render(pages.ManagementPage,props);assert.ok(text(tree).includes('暂无订阅，请点击右上角 + 添加'));assert.ok(!text(tree).includes('\uFFFD'));props={c:n,kind:'rule'};tree=render(pages.ManagementPage,props,true);await settle();tree=render(pages.ManagementPage,props);assert.ok(text(tree).includes('没有规则'));assert.ok(text(tree).includes('点击右上角菜单添加规则'));const menu=trailing(tree.props.toolbar);assert.equal(menu.type,'Menu');assert.equal(menu.props.accessibilityLabel,'操作');assert.equal(menu.props.title,undefined);assert.equal(menu.props.label.type,'Image');assert.equal(menu.props.label.props.systemName,'ellipsis');assert.equal(menu.props.label.props.background,undefined);assert.deepEqual(nodes(menu,'Button').map(b=>b.props.title),['排序列表','禁用规则','添加规则']);for(const item of nodes(menu,'Button')){assert.equal(item.props.systemImage,undefined);assert.equal(nodes(item,'Image').length,0)}for(const title of ['排序列表','禁用规则','添加规则'])assert.ok(button(trailing(tree.props.toolbar),title));button(trailing(tree.props.toolbar),'添加规则').props.action();tree=render(pages.ManagementPage,props);assert.equal(tree.props.navigationDestination.isPresented,true);assert.equal(tree.props.navigationDestination.content.type,management.NikkiRuleEditor)
    const src=fs.readFileSync(path.join(root,'dashboard-pages.tsx'),'utf8').split('// Native Nikki management:')[1];assert.ok(!/Animation|Transition|withAnimation|rotationEffect|sheet=/.test(src));assert.ok(!src.includes('Safari'));assert.ok(!src.includes('\uFFFD'))
  })
  await test('profile cards flow vertically in source order with subscription panel scale and no height constraints',async()=>{
    fixture();const longName='这是一个需要两行显示的很长的本地配置文件名称_'.repeat(2)+'.yaml';remoteFiles.set('/etc/nikki/profiles/'+longName,'mode: rule\n');state.s2={'.type':'subscription','.index':20,name:'Added subscription',url:'https://added.invalid/config'}
    const props={c:n,kind:'profile'};render(pages.ManagementPage,props,true);await settle();let tree=render(pages.ManagementPage,props);const snapshot=await api.loadNikkiManagement(n),cards=nodes(tree,'VStack').filter(v=>v.props.background?.props?.cornerRadius===18)
    assert.equal(cards.length,4);assert.equal(nodes(tree,'TabView').length,0);assert.equal(nodes(tree,'ScrollView').length,1);assert.ok(!text(tree).includes('左右滑动'));assert.equal(nodes(tree,'Image').filter(i=>i.props.systemName==='checkmark.circle.fill').length,1)
    assert.deepEqual(cards.map(card=>nodes(card,'Text').find(t=>t.props.font===24).props.children[0]),clone(snapshot.files.map(f=>f.name)));assert.equal(snapshot.files.at(-1).name,'Added subscription')
    for(const [index,card] of cards.entries()){assert.equal(card.props.padding,18);assert.equal(card.props.spacing,14);assert.deepEqual(clone(card.props.frame),{maxWidth:'infinity',alignment:'leading'});const name=nodes(card,'Text').find(t=>t.props.font===24);assert.equal(name.props.lineLimit,2);assert.equal(name.props.children[0],snapshot.files[index].name);const select=nodes(card,'Button')[0],body=select.props.children[0];assert.equal(select.props.buttonStyle,'plain');assert.equal(body.props.frame.height,undefined);assert.equal(body.props.frame.minHeight,undefined);assert.equal(body.props.frame.alignment,'topLeading');assert.equal(body.props.spacing,10);assert.equal(button(card,'编辑').props.disabled,snapshot.files[index].size===null);assert.ok(text(card).includes('更新于'));assert.ok(nodes(card,'Image').some(i=>i.props.systemName==='pencil'))}
    const refresh=button(trailing(tree.props.toolbar),'刷新');assert.equal(refresh.props.title,undefined);assert.equal(refresh.props.systemImage,undefined);assert.equal(refresh.props.children.length,1);assert.equal(refresh.props.children[0].type,'Image');assert.equal(nodes(refresh,'Text').length,0);assert.equal(nodes(refresh,'Image')[0].props.systemName,'arrow.triangle.2.circlepath');assert.equal(nodes(refresh,'Image')[0].props.background,undefined);assert.equal(refresh.props.buttonStyle,undefined)
    calls.length=0;refresh.props.action();tree=render(pages.ManagementPage,props);await settle();tree=render(pages.ManagementPage,props);assert.ok(calls.some(c=>JSON.parse(c.init.body).params[2]==='list'));assert.equal(writes().length,0)
    props.kind='subscription';render(pages.ManagementPage,props,true);await settle();const subscription=nodes(render(pages.ManagementPage,props),'VStack').find(v=>v.props.background?.props?.cornerRadius===18);assert.equal(cards[0].props.padding,subscription.props.padding);assert.equal(cards[0].props.spacing,subscription.props.spacing);assert.deepEqual(cards[0].props.frame,subscription.props.frame);assert.equal(writes().length,0)
  })
  await test('all delete/update/enable/switch confirmations cancel without mutation; enable confirms upstream reload and does not reload twice',async()=>{
    fixture();context.confirmResult=false;let props={c:n,kind:'subscription'};render(pages.ManagementPage,props,true);await settle();let tree=render(pages.ManagementPage,props);calls.length=0;await button(tree,'删除订阅').props.action();assert.equal(calls.length,0);const dlg=confirms.at(-1);assert.equal(dlg.title,'删除订阅');assert.equal(dlg.confirmLabel,'确认删除');assert.ok(!dlg.message.includes('目标'))
    const before=confirms.length;await button(tree,'更新订阅').props.action();assert.equal(confirms.length,before);assert.ok(calls.length>0)
    props={c:n,kind:'rule'};render(pages.ManagementPage,props,true);await settle();tree=render(pages.ManagementPage,props);calls.length=0;await button(tree,'删除规则').props.action();await button(trailing(tree.props.toolbar),'禁用规则').props.action();assert.equal(calls.length,0)
    props={c:n,kind:'profile'};render(pages.ManagementPage,props,true);await settle();tree=render(pages.ManagementPage,props);const target=nodes(tree,'Button').find(b=>text(b).includes('Mock subscription')&&b.props.buttonStyle==='plain');assert.ok(target);calls.length=0;await target.props.action();assert.equal(calls.length,0)
    context.confirmResult=true;await target.props.action();assert.equal(state.config.profile,'subscription:s1');const list=writes().map(c=>JSON.parse(c.init.body).params);assert.equal(list.at(-1)[1],'uci');assert.equal(list.at(-1)[2],'commit');assert.equal(autoReloads,1);assert.ok(!list.some(p=>p[1]==='rc'));assert.ok(confirms.at(-1).message.includes('重载'))
  })
  await test('subscription editor has no actions; returning saves actual values and failures retain draft',async()=>{
    fixture();const base=await api.loadNikkiManagement(n);let saved=false;const props={c:n,base,value:base.subscriptions[0],done:v=>saved=v};let tree=render(management.NikkiSubscriptionEditor,props,true);await settle();tree=render(management.NikkiSubscriptionEditor,props);assertEditorActionsAbsent(tree);assert.ok(!text(tree).includes('返回时保存修改'));assert.ok(!text(tree).includes('提交设置可能自动重载'));assert.equal(nodes(tree,'Section').length,3);assert.equal(nodes(tree,'Picker')[0].props.value,'clash.meta');assert.equal(nodes(tree,'Picker')[1].props.value,'local');calls.length=0;const confirmations=confirms.length;await tree.props.onDisappear();assert.equal(calls.length,0);assert.equal(confirms.length,confirmations);tree.props.onAppear()
    nodes(tree,'TextField')[0].props.onChanged('Draft kept');calls.length=0;context.confirmResult=false;fail=(obj,m)=>obj==='uci'&&m==='set'?{body:{result:[6]}}:null;await tree.props.onDisappear();tree=render(management.NikkiSubscriptionEditor,props);assert.equal(nodes(tree,'TextField')[0].props.value,'Draft kept');assert.equal(saved,false);assert.ok(text(tree).includes('草稿'))
    fail=null;tree.props.onAppear();await tree.props.onDisappear();assert.equal(saved,true);assert.equal(confirms.length,confirmations,'subscription back-save never confirms, even when confirmation result is false');context.confirmResult=true;const written=writes().length;await tree.props.onDisappear();assert.equal(writes().length,written);assert.equal(state.s1.name,'Draft kept');assert.equal(state.s1.user_agent,'clash.meta');assert.equal(state.s1.prefer,'local')
    saved=false;tree=render(management.NikkiSubscriptionEditor,props,true);assertEditorActionsAbsent(tree);calls.length=0;await settle();assert.equal(calls.length,0);assert.equal(saved,false)
  })
  await test('native editor phase remains outside the WebView stack before appear, while reading, ready and failed',async()=>{
    const phase=t=>{const label=t.props.children.find(x=>x?.type==='Text'&&x.props.accessibilityLabel==='编辑器阶段');assert.ok(label,'phase must be a direct native sibling, not inside the WebView stack');assert.deepEqual(JSON.parse(JSON.stringify(label.props.frame)),{maxWidth:'infinity',minHeight:24,maxHeight:24,alignment:'leading'});return text(label)}
    for(const failed of [false,true]){
      fixture();const base=await api.loadNikkiManagement(n),props={c:n,base,file:base.files[0],done(){}}
      let release;downloadWait=new Promise(r=>release=r);if(failed)downloadStatus=403
      let tree=render(management.NikkiFileEditor,props,true);assert.match(phase(tree),/等待页面出现/);const controller=nodes(tree,'WebView')[0].props.controller
      await settle();tree.props.onAppear();tree=render(management.NikkiFileEditor,props);await settle();tree=render(management.NikkiFileEditor,props);assert.match(phase(tree),failed?/加载失败/:/正在读取正文/);assert.equal(nodes(tree,'WebView')[0].props.controller,controller)
      release();for(let i=0;i<20;i++){await new Promise(r=>nativeTimers.setTimeout(r,10));await settle();tree=render(management.NikkiFileEditor,props);if((failed?/加载失败/:/本地文档已就绪/).test(phase(tree)))break}assert.match(phase(tree),failed?/加载失败/:/本地文档已就绪/);assert.equal(nodes(tree,'WebView')[0].props.controller,controller);assert.equal(fileSave(tree,true).props.disabled,true);assert.equal(writes().length,0)
      if(failed){assert.equal(nodes(tree,'WebView')[0].props.opacity,0);assert.ok(text(tree).includes('完整文件读取失败'))}else assert.equal(nodes(tree,'WebView')[0].props.opacity,1)
      await tree.props.onDisappear();unmount();await settle()
    }
    fixture();const base=await api.loadNikkiManagement(n),props={c:n,base,file:base.files[0],done(){}},realSet=context.setTimeout,realClear=context.clearTimeout,timers=new Map();let id=0
    context.setTimeout=(fn,ms)=>{timers.set(++id,{fn,ms});return id};context.clearTimeout=id=>timers.delete(id);context.WebViewController.initialization='silent'
    try{let tree=render(management.NikkiFileEditor,props,true);await settle();tree.props.onAppear();tree=render(management.NikkiFileEditor,props);await settle();tree=render(management.NikkiFileEditor,props);assert.match(phase(tree),/正文已读取，正在初始化/);[...timers.values()].find(t=>t.ms===10000).fn();await settle();tree=render(management.NikkiFileEditor,props);assert.match(phase(tree),/加载失败/);assert.ok(text(tree).includes('只读恢复'));assert.equal(fileSave(tree,true).props.disabled,true);assert.equal(writes().length,0);await tree.props.onDisappear();unmount();await settle()}finally{context.setTimeout=realSet;context.clearTimeout=realClear;context.WebViewController.initialization=undefined}
  })
  await test('editor initialization cannot depend on loadHTML promise settling after document script',async()=>{
    fixture();context.WebViewController.loadMode='pendingAfterDocument';const base=await api.loadNikkiManagement(n),props={c:n,base,file:base.files[0],done(){}};let tree=render(management.NikkiFileEditor,props,true);await settle();tree.props.onAppear();tree=render(management.NikkiFileEditor,props);await settle();tree=render(management.NikkiFileEditor,props);context.WebViewController.loadMode=undefined;const editor=nodes(tree,'WebView')[0].props.controller;assert.equal(editor.page.elements.body.value,remoteFiles.get('/etc/nikki/profiles/local.yaml').replace(/\r\n/g,'\n'));assert.ok(!text(tree).includes('正在完整读取配置与加载本地行号编辑器'))
  })
  await test('prebuilt editor waits for native appearance; loadHTML resolution before DOM does not lose body',async()=>{
    fixture();context.WebViewController.loadMode='beforeDocument';const base=await api.loadNikkiManagement(n),props={c:n,base,file:base.files[0],done(){}};let tree=render(management.NikkiFileEditor,props,true);const firstHost=nodes(tree,'WebView')[0];assert.equal(firstHost.props.opacity,0);assert.equal(firstHost.props.disabled,true);assert.ok(text(tree).includes('正在完整读取配置正文'));const loadingStack=nodes(tree,'ZStack')[0];assert.equal(loadingStack.props.children[0].type,'WebView');assert.equal(loadingStack.props.children[1].props.background,'secondarySystemBackground');assert.equal(nodes(loadingStack.props.children[1],'ProgressView').length,1);calls.length=0;await settle();const editor=nodes(tree,'WebView')[0].props.controller;assert.equal(editor.loads,0);assert.equal(calls.length,0);tree.props.onDisappear();tree.props.onAppear();tree=render(management.NikkiFileEditor,props);await settle();tree=render(management.NikkiFileEditor,props);assert.ok(text(tree).includes('正文已完整读取'));fileSave(tree);assert.equal(editor.page.elements.body.value,'');assert.equal(nodes(tree,'WebView')[0].props.opacity,0);assert.equal(nodes(tree,'WebView')[0].props.controller,firstHost.props.controller);editor.runDocument();await settle();tree=render(management.NikkiFileEditor,props);assert.equal(editor.page.elements.body.value,remoteFiles.get('/etc/nikki/profiles/local.yaml').replace(/\r\n/g,'\n'));assert.equal(nodes(tree,'WebView')[0].props.opacity,1);assert.equal(nodes(tree,'WebView')[0].props.disabled,false);assert.equal(nodes(tree,'WebView')[0].props.controller,firstHost.props.controller);assert.equal(nodes(tree,'ProgressView').length,0);assert.ok(!text(tree).includes('当前选用'));assert.ok(!text(tree).includes('保存不会自动应用'));assert.equal(tree.props.navigationTitle,'local.yaml');editor.input('mode: rule\n# edit');tree=render(management.NikkiFileEditor,props);fileSave(tree);context.WebViewController.loadMode=undefined;assert.equal(writes().length,0)
  })
  await test('initialization timeout shows verified full read-only body, no save, and retry recovers handshake',async()=>{
    fixture();const realSet=context.setTimeout,realClear=context.clearTimeout,pending=new Map();let id=1;context.setTimeout=(fn,ms)=>{const key=id++;pending.set(key,{fn,ms});return key};context.clearTimeout=key=>pending.delete(key);context.WebViewController.initialization='silent';const base=await api.loadNikkiManagement(n),props={c:n,base,file:base.files[0],done(){}};let tree=render(management.NikkiFileEditor,props,true);await settle();tree.props.onAppear();tree=render(management.NikkiFileEditor,props);await settle();tree=render(management.NikkiFileEditor,props);const editor=nodes(tree,'WebView')[0].props.controller;assert.ok(text(tree).includes('正文已完整读取'));const timeout=[...pending.values()].find(v=>v.ms===10000);assert.ok(timeout);timeout.fn();await settle();tree=render(management.NikkiFileEditor,props);assert.ok(text(tree).includes('初始化超时'));assert.ok(text(tree).includes('只读恢复显示'));assert.ok(text(tree).includes(remoteFiles.get('/etc/nikki/profiles/local.yaml')));assert.equal(nodes(tree,'WebView').length,1);assert.equal(nodes(tree,'WebView')[0].props.controller,editor);assert.equal(nodes(tree,'WebView')[0].props.opacity,0);fileSave(tree);assert.equal(writes().length,0)
    context.setTimeout=realSet;context.clearTimeout=realClear;context.WebViewController.initialization=undefined;editor.initialization=undefined;button(tree,'重试读取').props.action();tree=render(management.NikkiFileEditor,props);await settle();tree=render(management.NikkiFileEditor,props);assert.equal(nodes(tree,'WebView').length,1);assert.equal(editor.loads,2);assert.ok(!text(tree).includes('初始化超时'));assert.equal(editor.page.elements.body.value,remoteFiles.get('/etc/nikki/profiles/local.yaml').replace(/\r\n/g,'\n'));editor.input('mode: rule\n# recovered');tree=render(management.NikkiFileEditor,props);fileSave(tree);assert.equal(writes().length,0)
  })
  await test('full-body read timeout is explicit and does not claim a complete body or permit writes',async()=>{
    fixture();const realSet=context.setTimeout,realClear=context.clearTimeout,pending=new Map();let id=1;context.setTimeout=(fn,ms)=>{const key=id++;pending.set(key,{fn,ms});return key};context.clearTimeout=key=>pending.delete(key);downloadWait=new Promise(()=>{});const base=await api.loadNikkiManagement(n),props={c:n,base,file:base.files[0],done(){}};let tree=render(management.NikkiFileEditor,props,true);await settle();tree.props.onAppear();tree=render(management.NikkiFileEditor,props);await settle();[...pending.values()].find(v=>v.ms===20000).fn();await settle();tree=render(management.NikkiFileEditor,props);assert.ok(text(tree).includes('完整正文读取超时'));assert.ok(!text(tree).includes('只读恢复显示'));fileSave(tree);assert.equal(writes().length,0);assert.ok(button(tree,'重试读取'));context.setTimeout=realSet;context.clearTimeout=realClear
  })
  await test('explicit circular file save: disabled until ready/dirty, stays open, updates baseline, saves again and never reloads',async()=>{
    fixture();let saved=0,closed=0;const base=await api.loadNikkiManagement(n),props={c:n,base,file:base.files[0],done:()=>saved++,onExit:()=>closed++};let {tree,editor}=await openFile(props);const unchangedConfirms=confirms.length;calls.length=0;await fileSave(tree,true).props.action();assert.equal(confirms.length,unchangedConfirms);assert.equal(calls.length,0);const initial=editor.page.window.nikkiEditor.snapshot().text;editor.page.window.nikkiEditor.unlock();assert.equal(editor.page.document.querySelectorAll('textarea').length,0)
    editor.input(initial+'# edit\r\n');tree=render(management.NikkiFileEditor,props);const save=fileSave(tree,false);const task=save.props.action();await save.props.action();tree=render(management.NikkiFileEditor,props);fileSave(tree,true);await task;tree=render(management.NikkiFileEditor,props);fileSave(tree,true);assert.equal(saved,1);assert.equal(closed,0);assert.equal(editor.disposed,false);assert.ok(text(tree).includes('已保存'));assert.equal(remoteFiles.get('/etc/nikki/profiles/local.yaml'),initial+'# edit\r\n');assert.equal(editor.page.elements.body.readOnly,false)
    editor.input(initial+'# edit\r\n# second\r\n');tree=render(management.NikkiFileEditor,props);await fileSave(tree,false).props.action();tree=render(management.NikkiFileEditor,props);fileSave(tree,true);assert.equal(saved,2);assert.equal(closed,0);assert.ok(remoteFiles.get('/etc/nikki/profiles/local.yaml').endsWith('# second\r\n'));assert.ok(!writes().some(c=>JSON.parse(c.init.body).params[1]==='rc'))
    calls.length=0;const count=confirms.length;await tree.props.onDisappear();assert.equal(calls.length,0);assert.equal(confirms.length,count);assert.equal(closed,1)
  })
  await test('file button cancellation/failure keeps editable dirty draft; source change and stale callbacks cannot write',async()=>{
    fixture();let saved=0;const base=await api.loadNikkiManagement(n),props={c:n,base,file:base.files[0],done:()=>saved++};let {tree,editor}=await openFile(props);const initial=remoteFiles.get('/etc/nikki/profiles/local.yaml'),draft=initial+'# canceled\r\n';editor.input(draft);tree=render(management.NikkiFileEditor,props);context.confirmResult=false;calls.length=0;await fileSave(tree,false).props.action();context.confirmResult=true;assert.equal(calls.length,0);assert.equal(editor.page.elements.body.readOnly,false);tree=render(management.NikkiFileEditor,props);fileSave(tree,false);assert.equal(saved,0)
    fail=(obj,m)=>obj==='file'&&m==='write'?{throw:'fail'}:null;await fileSave(tree).props.action();tree=render(management.NikkiFileEditor,props);assert.ok(text(tree).includes('部分内容'));assert.equal(editor.page.window.nikkiEditor.snapshot().text,draft);editor.page.window.nikkiEditor.unlock();fileSave(tree,false);assert.equal(saved,0);fail=null;await fileSave(tree).props.action();tree=render(management.NikkiFileEditor,props);fileSave(tree,true);assert.equal(saved,1)
    editor.input(draft+'# changed source');tree=render(management.NikkiFileEditor,props);const stale=fileSave(tree,false);tree=render(management.NikkiFileEditor,{...props,c:{...n,url:'http://changed.invalid'}});fileSave(tree,true);calls.length=0;await stale.props.action();await tree.props.onDisappear();assert.equal(calls.length,0)
  })
  await test('native back/right-swipe uses cached Changed only, zero bridge/confirmation/write, restores source draft',async()=>{
    fixture();const base=await api.loadNikkiManagement(n),props={c:n,base,file:base.files[0],done(){}};let {tree,editor}=await openFile(props);const initial=remoteFiles.get('/etc/nikki/profiles/local.yaml'),draft=initial+'# back-only 中文🧪\r\n';editor.input(draft);let exitEvaluations=0;const evaluate=editor.evaluateJavaScript.bind(editor);editor.evaluateJavaScript=code=>{exitEvaluations++;return evaluate(code)};const confirmations=confirms.length;calls.length=0;const first=tree.props.onDisappear(),second=tree.props.onDisappear();assert.equal(first,second);unmount();assert.equal(editor.disposed,false);await first;await settle();assert.equal(editor.disposed,true);assert.equal(calls.length,0);assert.equal(confirms.length,confirmations);assert.equal(remoteFiles.get('/etc/nikki/profiles/local.yaml'),initial);assert.equal(exitEvaluations,0)
    let reopened=await openFile(props);assert.equal(reopened.editor.page.window.nikkiEditor.snapshot().text,draft);reopened.editor.page.window.nikkiEditor.unlock();assert.ok(text(reopened.tree).includes('已恢复'));fileSave(reopened.tree,false);await reopened.tree.props.onDisappear();unmount();reopened=await openFile({...props,c:{...n,id:n.id+'-other'}});assert.equal(reopened.editor.page.window.nikkiEditor.snapshot().text,initial);reopened.editor.page.window.nikkiEditor.unlock();await reopened.tree.props.onDisappear();unmount()
    remoteFiles.set('/etc/nikki/profiles/local.yaml',initial+'# remote\n');reopened=await openFile(props);calls.length=0;await fileSave(reopened.tree,false).props.action();assert.equal(writes().length,0);assert.ok(text(render(management.NikkiFileEditor,props)).includes('已改变'));await reopened.tree.props.onDisappear();unmount()
  })
  await test('button uses authoritative full snapshot despite delayed messages; expression mode, injection and snapshot timeout remain safe',async()=>{
    fixture();const initial='  key: "</script><img src=x>"\r\n# 模拟🧪\r\n';remoteFiles.set('/etc/nikki/profiles/local.yaml',initial);const base=await api.loadNikkiManagement(n),props={c:n,base,file:base.files[0],done(){}};let {tree,editor}=await openFile(props);assert.ok(!editor.html.includes(initial));assert.ok(editor.html.includes("default-src 'none'"));assert.equal(editor.options.ephemeral,true)
    editor.input(initial+'# enable');tree=render(management.NikkiFileEditor,props);const save=fileSave(tree,false);editor.deferMessages=true;const latest=initial+'# latest\r\n';editor.input(latest);const loads=editor.loads;await save.props.action();assert.equal(remoteFiles.get('/etc/nikki/profiles/local.yaml'),latest);assert.equal(editor.loads,loads);editor.flushMessages();tree=render(management.NikkiFileEditor,props);fileSave(tree,true)
    editor.deferMessages=false;editor.evaluationMode='expression';const expression=latest+'# expression\r\n';editor.input(expression);tree=render(management.NikkiFileEditor,props);await fileSave(tree,false).props.action();assert.equal(remoteFiles.get('/etc/nikki/profiles/local.yaml'),expression)
    const realTimer=context.setTimeout,snapshotHandler=editor.handlers.editorSnapshot;editor.handlers.editorSnapshot=()=>{};context.setTimeout=fn=>{Promise.resolve().then(fn);return 0};editor.input(expression+'# unsaved\r\n');tree=render(management.NikkiFileEditor,props);calls.length=0;await fileSave(tree,false).props.action();context.setTimeout=realTimer;editor.handlers.editorSnapshot=snapshotHandler;tree=render(management.NikkiFileEditor,props);assert.ok(text(tree).includes('未收到本地编辑器快照'));assert.equal(writes().length,0);assert.equal(editor.page.elements.body.readOnly,false);fileSave(tree,false);await tree.props.onDisappear();unmount();await settle();assert.equal(editor.disposed,true)
  })
  await test('return during snapshot or pending confirmation cancels authorization; disposed controller never starts remote write',async()=>{
    for(const phase of ['snapshot','confirmation','unmount']){fixture();let saved=0;const base=await api.loadNikkiManagement(n),props={c:n,base,file:base.files[0],done:()=>saved++};let {tree,editor}=await openFile(props);editor.input(remoteFiles.get('/etc/nikki/profiles/local.yaml')+'# pending');tree=render(management.NikkiFileEditor,props);const confirm=context.Dialog.confirm;let release;context.Dialog.confirm=()=>new Promise(r=>release=r);calls.length=0;const prior=confirms.length
      try{const saving=fileSave(tree,false).props.action();if(phase!=='snapshot')await waitUntil(()=>!!release);const exiting=phase==='unmount'?null:tree.props.onDisappear();unmount();assert.equal(editor.disposed,false);if(release)release(true);await saving;await exiting;await waitUntil(()=>editor.disposed);assert.equal(writes().length,0);assert.equal(saved,0);assert.equal(editor.disposed,true);if(phase==='snapshot')assert.equal(confirms.length,prior)}finally{context.Dialog.confirm=confirm}
    }
  })
  await test('already confirmed write finishes once before disposal on return; failure is not reported as saved; later drafts use saved baseline',async()=>{
    for(const failed of [false,true]){fixture();let saved=0,closed=0;const base=await api.loadNikkiManagement(n),props={c:n,base,file:base.files[0],done:()=>saved++,onExit:()=>closed++};let {tree,editor}=await openFile(props);const initial=remoteFiles.get('/etc/nikki/profiles/local.yaml'),draft=initial+'# in-flight';editor.input(draft);tree=render(management.NikkiFileEditor,props);let release;const wait=new Promise(r=>release=r);fail=(obj,m)=>obj==='file'&&m==='write'?{wait,...(failed?{body:{result:[6]}}:{body:{result:[0]}})}:null;calls.length=0
      const saving=fileSave(tree,false).props.action();await waitUntil(()=>writes().some(c=>JSON.parse(c.init.body).params[2]==='write'));const exiting=tree.props.onDisappear();assert.equal(closed,1,'closing navigation must not wait for already confirmed I/O');unmount();assert.equal(editor.disposed,false);if(!failed)remoteFiles.set('/etc/nikki/profiles/local.yaml',draft);release();await saving;await exiting;await settle();assert.equal(saved,0);assert.equal(editor.disposed,true);assert.equal(writes().filter(c=>JSON.parse(c.init.body).params[2]==='write').length,1);fail=null
      const reopened=await openFile(props);assert.equal(reopened.editor.page.window.nikkiEditor.snapshot().text,draft);reopened.editor.page.window.nikkiEditor.unlock();fileSave(reopened.tree,failed?false:true);if(failed)assert.ok(alerts.some(a=>a.title==='保存未完成'));await reopened.tree.props.onDisappear();unmount()
    }
  })
  await test('sorting is draft-only until returning; source change and pending confirmations cannot send writes',async()=>{
    fixture();const base=await api.loadNikkiManagement(n);let canceled=false;const props={c:n,base,done:()=>canceled=true};let tree=render(management.NikkiRuleSort,props,true);await settle();calls.length=0;button(tree,'下移').props.action();tree=render(management.NikkiRuleSort,props);assertEditorActionsAbsent(tree);assert.equal(calls.length,0);assertEditorActionsAbsent(tree);assert.equal(calls.length,0)
    let release;const originalConfirm=context.Dialog.confirm;context.Dialog.confirm=()=>new Promise(r=>release=r)
    const pageProps={c:n,kind:'subscription'};render(pages.ManagementPage,pageProps,true);await settle();tree=render(pages.ManagementPage,pageProps);calls.length=0;const pending=button(tree,'删除订阅').props.action();render(pages.ManagementPage,{...pageProps,c:{...n,id:'new-source'}});release(true);await pending;assert.equal(calls.length,0);context.Dialog.confirm=originalConfirm
  })
  await test('rule editor and sorting bind real fields; commit cancel has zero requests, successful save preserves unknowns',async()=>{
    fixture();let base=await api.loadNikkiManagement(n),saved=false;const props={c:n,base,value:base.rules[0],done:v=>saved=v};let tree=render(management.NikkiRuleEditor,props,true);await settle();nodes(tree,'Picker')[0].props.onChanged('IP-CIDR');tree=render(management.NikkiRuleEditor,props);nodes(tree,'TextField')[1].props.onChanged('192.0.2.0/24');nodes(tree,'TextField')[2].props.onChanged('REJECT');nodes(tree,'Toggle')[0].props.onChanged(false);nodes(tree,'Toggle')[1].props.onChanged(true);tree=render(management.NikkiRuleEditor,props)
    context.confirmResult=false;calls.length=0;await tree.props.onDisappear();assert.equal(calls.length,0);assert.equal(saved,false);context.confirmResult=true;tree.props.onAppear();await tree.props.onDisappear();assert.equal(saved,true);assert.equal(state.r1.type,'IP-CIDR');assert.equal(state.r1.matcher,'192.0.2.0/24');assert.equal(state.r1.node,'REJECT');assert.equal(state.r1.enabled,'0');assert.equal(state.r1.no_resolve,'1');assert.equal(state.r1.unknown,'rule-kept');assert.ok(confirms.at(-1).message.includes('自动触发 Nikki 重载'))
    base=await api.loadNikkiManagement(n);const sortProps={c:n,base,done(){}};tree=render(management.NikkiRuleSort,sortProps,true);await settle();button(tree,'下移').props.action();tree=render(management.NikkiRuleSort,sortProps);await tree.props.onDisappear();assert.equal(state.r2['.index'],1);assert.equal(state.r1['.index'],3);assert.equal(state.s1['.index'],2)
  })
  await test('read-only login recovery reuses the existing auth path; no content or URL reaches persistence',async()=>{
    fixture();await api.loadNikkiManagement(n);let denied=true;fail=(obj,m)=>{if(obj==='uci'&&m==='get'&&denied){denied=false;return {body:{result:[6]}}}return null};calls.length=0;await api.loadNikkiManagement(n);assert.equal(calls.filter(c=>c.url.endsWith('/ubus')&&JSON.parse(c.init.body).params[1]==='session').length,1)
    const persisted=JSON.stringify([...store]);for(const secret of ['fixture-only','中文🧪','Draft kept','config-unknown'])assert.ok(!persisted.includes(secret))
  })
  unmount();console.log('All '+count+' Nikki management groups passed (mock only; no native layout/device validation).')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness + checks, { require, __dirname, console, process, Buffer }, { filename: __filename })
