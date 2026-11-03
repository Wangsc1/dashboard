import { AppEvents, Button, Form, Section, Text, ScrollView, useEffect, useState } from "scripting"
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
      setView(v=>({...v,source,busy:true,status:"读取中…"}))
      try{
        const result=await readNikkiLog(c,kind,()=>valid(at))
        if(valid(at))setView({source,text:result.text,loaded:true,busy:false,status:result.text?"已读取日志快照":"日志文件为空",mtime:result.mtime})
      }catch{
        if(valid(at))setView(v=>({...v,source,busy:false,status:"读取失败：文件不存在、无权限、超过2MiB或响应无效。已有内容（如有）是旧快照，未生成或清理日志。"}))
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
  return <Form navigationTitle={nikkiLogTitles[kind]} navigationBarTitleDisplayMode="inline" onAppear={page.onAppear} onDisappear={page.onDisappear}>
    <Section footer={<Text>{kind==="debug"?"仅读取已有 debug.log，不生成调试包；可能陈旧或不存在。官方生成操作可能改配置并重启服务，故不调用。":"读取设备 Nikki 日志快照，不是本脚本应用日志；手动刷新或恢复页面时更新。"} 日志可能包含域名和敏感配置，仅在当前页面内存显示，不保存、不自动复制。</Text>}>
      <Text>{c.name} · {supported?`/var/log/nikki/${kind}.log`:"当前来源不支持"}</Text>
      <Text>{shown?.status??"尚未读取"}</Text>
      {shown?.mtime!==null&&shown?.mtime!==undefined?<Text>文件修改时间：{new Date(shown.mtime*1000).toLocaleString()}</Text>:null}
      <Button title="刷新" disabled={!supported||!!shown?.busy} action={()=>owner.refresh()}/>
    </Section>
    <Section><ScrollView><Text font={12}>{shown?.loaded?shown.text||"（空日志）":"尚无可显示的日志"}</Text></ScrollView></Section>
  </Form>
}
