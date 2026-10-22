// Linux /proc/stat: guest/guest_nice已包含在user/nice，不再次计入total。
export interface CpuTimes { total: number; user: number; system: number; steal: number; idle: number; fields: number[] }
export interface CpuUsage { id: string; usage?: number; user?: number; system?: number; steal?: number }
export interface CpuMeta { model?: string; mhz?: number; cacheKB?: number }
export function parseCpuStat(raw: string): Record<string, CpuTimes> {
  const result: Record<string,CpuTimes> = {}
  for (const line of raw.split("\n")) {
    const m = /^(cpu(?:\d+)?)\s+(.+)$/.exec(line.trim()); if (!m) continue
    const v = m[2].trim().split(/\s+/).map(Number)
    if (v.length < 4 || v.some(x=>!Number.isFinite(x)||x<0)) continue
    while(v.length<8)v.push(0)
    result[m[1]]={total:v.slice(0,8).reduce((a,b)=>a+b,0),user:v[0]+v[1],system:v[2]+v[5]+v[6],steal:v[7],idle:v[3]+v[4],fields:v.slice(0,8)}
  }
  return result
}
export class CpuSampler {
  private previous: Record<string,CpuTimes> = {}; private uptime: number | undefined
  reset() { this.previous={};this.uptime=undefined }
  sample(raw: string, uptime?: number): CpuUsage[] {
    const next=parseCpuStat(raw), reboot=uptime!==undefined&&this.uptime!==undefined&&uptime<this.uptime
    const old=reboot?{}:this.previous
    const topologyChanged=Object.keys(old).filter(k=>k!=='cpu').sort().join(',')!==Object.keys(next).filter(k=>k!=='cpu').sort().join(',')
    const result=Object.keys(next).sort((a,b)=>a==='cpu'?-1:b==='cpu'?1:Number(a.slice(3))-Number(b.slice(3))).map(id=>{
      const n=next[id],p=old[id],dt=p?n.total-p.total:0
      if(!p||(id==='cpu'&&topologyChanged)||dt<=0||n.fields.some((v,i)=>v<p.fields[i]))return {id}
      const pct=(value:number)=>Math.max(0,Math.min(100,value/dt*100))
      return {id,usage:pct(dt-(n.idle-p.idle)),user:pct(n.user-p.user),system:pct(n.system-p.system),steal:pct(n.steal-p.steal)}
    })
    this.previous=next;this.uptime=uptime;return result
  }
}
export function parseCpuInfo(raw:string):{model?:string; cores:Record<string,CpuMeta>} {
  const cores:Record<string,CpuMeta>={};let model:string|undefined
  for(const block of raw.split(/\n\s*\n/)) {
    const fields:Record<string,string>={}
    for(const line of block.split('\n')){const m=/^([^:]+):\s*(.*)$/.exec(line);if(m)fields[m[1].trim().toLowerCase()]=m[2].trim()}
    const title=fields['model name']||fields['cpu model']||fields['hardware'];if(title&&!model)model=title
    const id=fields['processor'];if(!/^\d+$/.test(id??''))continue
    const mhz=Number(fields['cpu mhz']),cache=/^(\d+(?:\.\d+)?)\s*(kB|KB)$/i.exec(fields['cache size']??'')
    cores['cpu'+id]={model:title,mhz:Number.isFinite(mhz)&&mhz>0?mhz:undefined,cacheKB:cache?Number(cache[1]):undefined}
  }
  return {model,cores}
}
export function thermalCelsius(type:string,raw:string):number|undefined {
  if(!/(cpu|x86_pkg|soc|package)/i.test(type)||/gpu/i.test(type))return undefined
  if(!/^-?\d+(?:\.\d+)?\s*$/.test(raw))return undefined
  const n=Number(raw)/1000;return Number.isFinite(n)&&n>=-40&&n<=150?n:undefined
}
export interface OverviewHistory { down:number[];up:number[];cpu:Record<string,number[]> }
export function newHistory():OverviewHistory{return {down:[],up:[],cpu:{}}}
export function appendHistory(h:OverviewHistory,down:number,up:number,cpus:CpuUsage[],limit=60):OverviewHistory {
  const cpu:Record<string,number[]>={}
  for(const c of cpus)cpu[c.id]=c.usage===undefined?[]:[...(h.cpu[c.id]??[]),c.usage].slice(-limit)
  return {down:[...h.down,down].slice(-limit),up:[...h.up,up].slice(-limit),cpu}
}
