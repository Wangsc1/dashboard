// Real Linux-format fixture remapped to 16 IDs; all IO/ACL are mocked.
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path')
const harness=fs.readFileSync(path.join(__dirname,'run.cjs'),'utf8').split(';(async () => {')[0]
const checks=String.raw`
const full=fs.readFileSync(path.join(__dirname,'fixtures/cpuinfo-16.txt'),'utf8')
let seq=0,tick=0,mode='ok',downloads=0,cancelled=0,gate=null,release
const requests=[],original=context.fetch
responder=(_url,init)=>{const q=JSON.parse(init.body),[,obj,method,args]=q.params;requests.push({obj,method,args});const ok=x=>({body:{id:q.id,result:[0,x]}})
 if(obj==='session')return ok({ubus_rpc_session:'cpu-fixture-session'})
 if(obj==='system'&&method==='info')return ok({uptime:100+tick,load:[],memory:{total:100,free:50}})
 if(obj==='system'&&method==='board')return ok({model:'Fixture Board',kernel:'6.6.80',release:{description:'OpenWrt fixture'}})
 if(obj==='file'&&args?.path==='/proc/stat'){tick++;return ok({data:['cpu',...Array.from({length:16},(_,i)=>'cpu'+i)].map(id=>id+' '+(100+tick*10)+' 0 20 '+(880+tick*10)+' 0 0 0 0\n').join('')})}
 if(obj==='file'&&['stat','lstat'].includes(method))throw Error('Must not treat virtual stat size=0 as EOF')
 return ok(obj==='network.interface'?{interface:[]}:obj==='file'&&method==='list'?{entries:[]}:{})
}
context.fetch=async(url,init)=>{
 if(!url.endsWith('/cgi-bin/cgi-download'))return original(url,init)
 downloads++;assert.ok(init.body.endsWith('&path=%2Fproc%2Fcpuinfo'));assert.equal(init.method,'POST')
 const current=mode,wait=gate,text=current==='truncated'?full.slice(0,4096):current==='html'?'<html>login</html>\n':full
 const bytes=current==='oversized'?new Uint8Array(2097153):current==='invalid-utf8'?new Uint8Array([255]):new Uint8Array(require('node:buffer').Buffer.from(text));let offset=0
 return {ok:!['403','404','500'].includes(current),headers:{get:()=>current==='length-mismatch'?String(bytes.length+100):'0'},body:{getReader:()=>({async read(){if(wait)await wait;if(current==='stream-error')throw Error('reset');if(offset>=bytes.length)return {done:true};const value=bytes.slice(offset,offset+3000);offset+=value.length;return {done:false,value}},async cancel(){cancelled++},releaseLock(){}})}}
}
function device(){return {id:'cpu-complete-'+(++seq),kind:'openwrt',url:'http://cpu-'+seq+'.invalid',username:'root'}}
async function sample(c){const a=await api.loadOverview(c);await flush();return a}
async function ready(c){await sample(c);return sample(c)}
;(async()=>{
 await test('大于4KiB真实格式16核：旧4096字节读取丢后续核，完整读取各核字段独立',async()=>{
   assert.ok(full.length>4096);assert.equal(Object.keys(metrics.parseCpuInfo(full).cores).length,16);const short=metrics.parseCpuInfo(full.slice(0,4096));assert.equal(short.cores.cpu15,undefined);console.log('fixture bytes='+full.length+', old IDs='+Object.keys(short.cores).join(','))
   const a=await ready(device());assert.equal(a.wrt.cpuMeta.cpu15.mhz,1755.125);assert.equal(a.wrt.cpuMeta.cpu15.cacheKB,1472);assert.equal(a.wrt.cpuMeta.cpu7.mhz,undefined);assert.equal(a.wrt.cpuMeta.cpu7.cacheKB,undefined);assert.equal(Object.keys(a.wrt.cpuMeta).length,16);assert.ok(a.wrt.cpu!==undefined)
   assert.ok(!requests.some(q=>q.obj==='file'&&q.args?.path==='/proc/cpuinfo'))
 })
 await test('虚拟size0/流EOF、5秒缓存与单飞：慢元数据不阻塞1秒使用率，失败退避',async()=>{
   const c=device(),before=downloads;await ready(c);for(let i=0;i<4;i++){now+=1000;await sample(c)}assert.equal(downloads-before,1);now+=1000;await sample(c);assert.equal(downloads-before,2)
   gate=new Promise(r=>release=r);const slow=device(),start=downloads;await sample(slow);for(let i=0;i<8;i++){now+=1000;assert.ok((await sample(slow)).wrt.cpu!==undefined)}assert.equal(downloads-start,1);release();gate=null;await flush();assert.equal((await sample(slow)).wrt.cpuMeta.cpu15.mhz,1755.125)
   mode='403';const denied=device(),n=downloads;await ready(denied);now+=10000;await sample(denied);assert.equal(downloads-n,1);now+=5000;await sample(denied);assert.equal(downloads-n,2)
 })
 await test('截断/权限/失败/超限/编码错误：舍弃元数据，不回退短读取或伪造后续核',async()=>{
   for(const bad of ['truncated','403','404','500','stream-error','oversized','length-mismatch','invalid-utf8','html']){mode=bad;const a=await ready(device());assert.equal(Object.keys(a.wrt.cpuMeta).length,0,bad);assert.equal(a.wrt.cpuModel,undefined);assert.ok(a.wrt.cpu!==undefined,bad)}
   assert.ok(cancelled>=4);assert.ok(!requests.some(q=>['write','exec'].includes(q.method)))
 })
 await test('地址/认证变化和暂停取消：旧流不污染新源且不泄漏单飞',async()=>{
   mode='ok';gate=new Promise(r=>release=r);const old=device();await sample(old);const next={...old,url:'http://new-cpu-source.invalid'};assert.notEqual(api.overviewSource(next),api.overviewSource(old));api.resetOverviewSampling(old)
   const resume=release;gate=null;assert.equal((await ready(next)).wrt.cpuMeta.cpu15.cacheKB,1472);resume();await flush();assert.equal((await sample(next)).wrt.cpuMeta.cpu15.mhz,1755.125)
   const c=device();await ready(c);secrets.set('neko_secret_'+c.id,'fixture-auth-change');assert.equal((await sample(c)).wrt.cpuMeta.cpu15,undefined);await flush();assert.equal((await sample(c)).wrt.cpuMeta.cpu15.mhz,1755.125)
 })
 await test('删除详情注释但保留未知/错误、主控系统信息label修复',()=>{
   const s=home.CpuDetails({overview:null,histories:metrics.newHistory(),running:false,onDismiss(){}});assert.ok(!text(s).includes('频率/缓存为内核'));assert.ok(text(s).includes('/proc/stat未提供'))
   const source=fs.readFileSync(path.join(root,'home-ui.tsx'),'utf8');assert.ok(source.includes('foregroundStyle="label">{title}'));assert.ok(source.includes('foregroundStyle="label" multilineTextAlignment="trailing">{value}'))
 })
 console.log(count+' complete cpuinfo groups passed; mock IO only')
})().catch(e=>{console.error(e);process.exitCode=1})
`
vm.runInNewContext(harness+checks,{require,__dirname,console,process},{filename:__filename})
