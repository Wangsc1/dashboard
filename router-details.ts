// Router-details snapshots are process-local only (may include private config).
// Two concurrent resource chains max; no mutations are ever scheduled here.
import * as api from './api'
import { AppEvents, useEffect, useState } from 'scripting'
type Controller = api.Controller
export const detailReads = {
  interfaces: (c:Controller) => api.loadWrtInterfaces(c), leases: (c:Controller) => api.loadWrtLeases(c),
  docker: (c:Controller) => api.loadDockerOverview(c), containers: (c:Controller) => api.loadDockerContainers(c),
  images: (c:Controller) => api.loadDockerImages(c), dockerSettings: (c:Controller) => api.loadDockerSettings(c),
  frp: (c:Controller) => api.loadFrp(c), installed: (c:Controller) => api.loadInstalledPkgs(c),
  available: (c:Controller) => api.loadAvailablePkgs(c,true), disk: (c:Controller) => api.loadDiskUsage(c),
}
export type DetailKey = keyof typeof detailReads | `container:${string}`
type Entry = { value?: any; pending?: Promise<any>; epoch:number; readers?: Set<()=>boolean>; requestPhase?:number }
const snapshots = new Map<string, Map<string,Entry>>()
const invalidations=new Set<(source:string,key:string)=>void>()
let foreground = true, selectedSource = '', phaseEpoch = 0, working = 0, owners = 0
const queue: Array<{run:()=>Promise<void>;cancel:()=>void;valid:()=>boolean}> = []
function entry(c:Controller,key:string):Entry {
  const source=api.overviewSource(c)
  let resources=snapshots.get(source)
  if(!resources){resources=new Map();snapshots.set(source,resources)}
  let e=resources.get(key)
  if(!e){e={epoch:0};resources.set(key,e)}
  return e
}
export function selectDetailsSource(c:Controller|null){
  const source=c?api.overviewSource(c):''
  if(selectedSource!==source){selectedSource=source;phaseEpoch++;pump()}
  return source
}
function pump(){
  for(let i=queue.length-1;i>=0;i--)if(!queue[i].valid()){queue.splice(i,1)[0].cancel()}
  while(foreground&&working<2&&queue.length){
    const job=queue.shift()!;working++
    void job.run().finally(()=>{working--;pump()})
  }
}
const stale=()=>new Error('路由器详情来源或读取代次已改变')
export function peekDetail<T>(c:Controller,key:DetailKey):T|undefined{return entry(c,key).value}
export function invalidateDetails(c:Controller,group:'docker'|'frp'|'software',source=api.overviewSource(c)){
  const resources=snapshots.get(source);if(!resources)return
  const keys=group==='docker'?['docker','containers','images','dockerSettings']:group==='frp'?['frp']:['installed','available','disk']
  for(const [key,e]of resources)if(keys.includes(key)||(group==='docker'&&key.startsWith('container:'))){e.epoch++;e.value=undefined;e.pending=undefined;for(const notify of invalidations)notify(source,key)}
  pump()
}
export function readDetail<T>(c:Controller,key:DetailKey,read:()=>Promise<T>,validOwner:()=>boolean=()=>true):Promise<T>{
  const source=api.overviewSource(c),e=entry(c,key)
  if(e.pending){
    // A destination can adopt a still-running settings prefetch when the
    // settings owner unmounts. Paused/old-generation work must settle first.
    e.readers?.add(validOwner)
    if(e.requestPhase!==phaseEpoch){
      return e.pending.catch(error=>{
        if(foreground&&selectedSource===source&&validOwner())return readDetail(c,key,read,validOwner)
        throw error
      })
    }
    return e.pending
  }
  const epoch=e.epoch,phase=phaseEpoch,readers=new Set([validOwner]);e.readers=readers;e.requestPhase=phase
  const valid=()=>foreground&&selectedSource===source&&api.overviewSource(c)===source&&phaseEpoch===phase&&e.epoch===epoch&&[...readers].some(alive=>alive())
  let resolve!:(v:T)=>void,reject!:(e:any)=>void
  const pending=new Promise<T>((yes,no)=>{resolve=yes;reject=no});e.pending=pending
  const finish=()=>{if(e.pending===pending){e.pending=undefined;e.readers=undefined}}
  queue.push({valid,cancel:()=>{finish();reject(stale())},run:async()=>{
    try{if(!valid())throw stale();const value=await read();if(!valid())throw stale();e.value=value;resolve(value)}catch(error){reject(error)}finally{finish()}
  }})
  pump();return pending
}
function scene(phase:'active'|'inactive'|'background'){
  const next=phase==='active'
  if(foreground!==next){foreground=next;phaseEpoch++;pump()}
}
// Root observes phase without starting any prefetch. This keeps background
// state accurate even while settings and all detail destinations are unmounted.
export function observeDetailsPhase(){
  if(owners++===0)AppEvents.scenePhase.addListener(scene)
  return ()=>{if(--owners===0)AppEvents.scenePhase.removeListener(scene)}
}
function own(c:Controller){selectDetailsSource(c);return observeDetailsPhase()}

export function prefetchRouterDetails(c:Controller){
  if(c.kind!=='openwrt')return ()=>{}
  const release=own(c);let alive=true
  const valid=()=>alive
  const schedule=()=>{
    if(!alive||!foreground)return
    for(const key of Object.keys(detailReads) as (keyof typeof detailReads)[]){
      const read=()=>detailReads[key](c) as Promise<any>
      void readDetail(c,key,read,valid).then(value=>{
        if(key==='containers'&&alive&&foreground)for(const container of value as api.DockerContainer[]){
          void readDetail(c,`container:${container.id}`,()=>api.loadContainerDetail(c,container.id),valid).catch(()=>{})
        }
      }).catch(()=>{})
    }
  }
  const changed=(phase:'active'|'inactive'|'background')=>{if(phase==='active')schedule()}
  AppEvents.scenePhase.addListener(changed)
  schedule()
  return ()=>{alive=false;AppEvents.scenePhase.removeListener(changed);release();pump()}
}
// Native navigation can retain a mounted destination while it is covered or
// being popped. Visibility, not eventual component disposal, owns page reads.
export function useDetailPage(){
  const [page]=useState(()=>{
    const listeners=new Set<(visible:boolean)=>void>()
    const state={visible:true,alive:true,listeners,onAppear:()=>{},onDisappear:()=>{}}
    const change=(visible:boolean)=>{if(!state.alive||state.visible===visible)return;state.visible=visible;for(const fn of listeners)fn(visible)}
    state.onAppear=()=>change(true);state.onDisappear=()=>change(false)
    return state
  })
  useEffect(()=>{
    return()=>{page.onDisappear();page.alive=false;page.listeners.clear()}
  },[page])
  return page
}
type DetailPage=ReturnType<typeof useDetailPage>
// Cached first frame is immediate. Hidden pages retain that frame but detach
// timers/subscriptions/readers synchronously, before native transitions finish.
export function useRouterDetail<T>(c:Controller,key:DetailKey,read:()=>Promise<T>,revision=0,ms=0,page?:DetailPage){
  const source=api.overviewSource(c)
  const [state,setState]=useState(()=>({source,key,value:peekDetail<T>(c,key),error:''}))
  useEffect(()=>{
    let stop=()=>{}
    const start=()=>{
      stop()
      const release=own(c),resource=entry(c,key);let alive=true,busy=false
      const valid=()=>alive
      setState({source,key,value:peekDetail<T>(c,key),error:''})
      const refresh=async()=>{
        if(!alive||busy||!foreground)return
        busy=true
        const began=phaseEpoch,version=resource.epoch
        try{const value=await readDetail(c,key,read,valid);if(alive&&api.overviewSource(c)===source)setState({source,key,value,error:''})}
        catch(error){if(alive&&api.overviewSource(c)===source)setState(s=>({...s,error:String((error as any)?.message??error)}))}
        finally{busy=false;if(alive&&foreground&&(began!==phaseEpoch||version!==resource.epoch))void refresh()}
      }
      const changed=(phase:'active'|'inactive'|'background')=>{if(phase==='active')void refresh()}
      const invalidated=(changedSource:string,changedKey:string)=>{
        if(changedSource===source&&changedKey===key){setState({source,key,value:undefined,error:''});void refresh()}
      }
      AppEvents.scenePhase.addListener(changed);invalidations.add(invalidated)
      void refresh();const timer=ms?setInterval(refresh,ms):undefined
      stop=()=>{
        if(!alive)return
        alive=false;resource.readers?.delete(valid)
        invalidations.delete(invalidated);if(timer!==undefined)clearInterval(timer)
        AppEvents.scenePhase.removeListener(changed);release();pump()
      }
    }
    const visible=(shown:boolean)=>{if(shown)start();else stop()}
    page?.listeners.add(visible)
    if(!page||page.visible)start()
    return()=>{page?.listeners.delete(visible);stop()}
  },[source,key,revision,page])
  return state.source===source&&state.key===key?state:{source,key,value:peekDetail<T>(c,key),error:''}
}
// Invalidating after the existing confirmed write completes (even a partially
// failed mutation) leaves its
// confirmation/cancellation/error behavior unchanged and rejects older readers.
export async function detailWrite<T>(c:Controller,group:'docker'|'frp'|'software',write:()=>Promise<T>):Promise<T>{
  const source=api.overviewSource(c)
  try{return await write()}finally{invalidateDetails(c,group,source)}
}
