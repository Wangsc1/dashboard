import { AppEvents, Button, Form, Section, Text, ScrollView, RoundedRectangle, useEffect, useState } from "scripting"
import { Controller, NikkiLogKind, readNikkiLog } from "./api"
import { useDetailPage } from "./router-details"

export const nikkiLogTitles:Record<NikkiLogKind,string>={app:"插件日志",core:"核心日志",debug:"调试日志"}
export function NikkiLogPage({c,kind}:{c:Controller;kind:NikkiLogKind}){
  const page=useDetailPage(),source=JSON.stringify(c)+kind
  const [view,setView]=useState({source,text:"",status:"尚未读取",loaded:false,busy:false,mtime:null as number|null})
  const [owner]=useState({source,refresh:()=>{}})
  owner.source=source
  const supported=c.kind==="openwrt"&&c.plugin==="nikki"
  useEffect(()=>{
    let alive=true,foreground=true,busy=false,epoch=0,pending=false
    const valid=(at:number)=>alive&&page.alive&&page.visible&&foreground&&owner.source===source&&at===epoch
    const refresh=async()=>{
      if(!alive||!page.alive||!page.visible||!foreground||!supported)return
      if(busy){pending=true;return}
      busy=true;pending=false;const at=epoch
      setView(v=>({...v,source,busy:true,status:""}))
      try{
        const result=await readNikkiLog(c,kind,()=>valid(at))
        if(valid(at))setView({source,text:result.text,loaded:true,busy:false,status:result.text?"":"日志文件为空",mtime:result.mtime})
      }catch{
        if(valid(at))setView(v=>({...v,source,busy:false,status:"暂无日志"}))
      }finally{
        busy=false
        if(alive&&owner.source===source&&page.visible&&foreground&&(pending||at!==epoch))void refresh()
      }
    }
    const visibility=(shown:boolean)=>{epoch++;if(shown)void refresh();else pending=false}
    const phase=(p:string)=>{foreground=p==="active";epoch++;if(foreground)void refresh();else pending=false}
    owner.refresh=()=>{void refresh()}
    setView({source,text:"",status:supported?"尚未读取":"仅支持 OpenWrt Nikki，当前来源不支持",loaded:false,busy:false,mtime:null})
    page.listeners.add(visibility);AppEvents.scenePhase.addListener(phase);void refresh()
    return()=>{alive=false;epoch++;page.listeners.delete(visibility);AppEvents.scenePhase.removeListener(phase)}
  },[source,page,supported])
  const shown=view.source===source?view:null
  return <Form background="systemBackground" scrollContentBackground="hidden" navigationTitle={nikkiLogTitles[kind]} navigationBarTitleDisplayMode="inline" onAppear={page.onAppear} onDisappear={page.onDisappear}>
    <Section listRowBackground={<RoundedRectangle cornerRadius={0} fill="secondarySystemBackground"/>}>
      {shown?.status?<Text>{shown.status}</Text>:null}
      {shown?.mtime!==null&&shown?.mtime!==undefined?<Text>更新时间：{new Date(shown.mtime*1000).toLocaleString()}</Text>:null}
      <Button title="刷新" disabled={!supported||!!shown?.busy} action={()=>owner.refresh()}/>
    </Section>
    <Section listRowBackground={<RoundedRectangle cornerRadius={0} fill="secondarySystemBackground"/>}>{shown?.loaded&&shown.text?<ScrollView><Text font={12}>{shown.text}</Text></ScrollView>:<Text font={12} frame={{maxWidth:"infinity",minHeight:32,alignment:"leading"}}>{shown?.loaded?"（空日志）":"尚无可显示的日志"}</Text>}</Section>
  </Form>
}
