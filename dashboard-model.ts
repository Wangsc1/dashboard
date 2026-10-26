import { Conn, Controller, Group } from "./api"
import { getPreferences } from "./preferences"
export function sourceKey(c: Controller) { return [c.id, c.url, c.plugin, c.auto, c.cport].join("|") }
export function selectable(g: Group) { return ["Selector","URLTest","Fallback"].includes(g.type) }
export function sortedNodes(g: Group, delays = g.delays) {
  const xs = [...g.all], sort = getPreferences().nodeSort
  if (sort === "name" || sort === "nameDesc") xs.sort((a,b) => sort === "name" ? a.localeCompare(b) : b.localeCompare(a))
  if (sort === "delay" || sort === "delayDesc") xs.sort((a,b) => {
    const da = delays[a], db = delays[b], va = Number.isFinite(da) && da > 0, vb = Number.isFinite(db) && db > 0
    if (!va || !vb) return va ? -1 : vb ? 1 : 0
    return sort === "delay" ? da - db : db - da
  })
  return xs
}

export class ConnectionHistory {
  active: Conn[] = []; closed: Conn[] = []; private at = 0
  sample(xs: Conn[], at: number) {
    const prev = new Map(this.active.map(x => [x.id, x])), ids = new Set(xs.map(x => x.id)), dt = (at - this.at) / 1000
    // Head insertion used to move the whole history once per disappeared row.
    // Read backwards to preserve that order and materialize only retained rows.
    const closed: Conn[] = []
    for (let i = this.active.length - 1; i >= 0 && closed.length < 300; i--) {
      const old = this.active[i]
      if (!ids.has(old.id)) closed.push({ ...old, upSpeed: 0, downSpeed: 0, closedAt: at })
    }
    for (const old of this.closed) {
      if (closed.length >= 300) break
      if (at - (old.closedAt ?? at) < 3600000) closed.push(old)
    }
    this.active = xs.map(x => { const p = prev.get(x.id); return { ...x, upSpeed: p && dt > 0 ? Math.max(0, x.up-p.up)/dt : 0, downSpeed: p && dt > 0 ? Math.max(0, x.down-p.down)/dt : 0 } })
    this.closed = closed; this.at = at
  }

  resume() { this.active = []; this.at = 0 }
  clear() { this.closed = [] }
}
// Native views can report onDisappear for app lock/background without a matching
// onAppear on return. Distinguish that from navigation pushes by scene ordering,
// so a retained selected page does not stay logically hidden until a tab change.
export class SceneVisibility {
  static readonly ORDER_WINDOW = 500
  private sceneActive = true; private leftAt = -Infinity; private hiddenAt = -Infinity; private sceneHidden = false
  /** Returns whether the page should become hidden. */
  disappear(at: number): boolean {
    if (!this.sceneActive || at - this.leftAt <= SceneVisibility.ORDER_WINDOW) { this.sceneHidden = true; return false }
    this.hiddenAt = at; return true
  }
  appear() { this.sceneHidden = false; this.hiddenAt = -Infinity }
  /** Returns true when a scene-caused logical hide must be restored. */
  scene(active: boolean, at: number): boolean {
    if (!active) {
      if (this.sceneActive) { this.leftAt = at; if (at - this.hiddenAt <= SceneVisibility.ORDER_WINDOW) this.sceneHidden = true }
      this.sceneActive = false; return false
    }
    this.sceneActive = true
    const restore = this.sceneHidden; this.sceneHidden = false; this.hiddenAt = -Infinity; return restore
  }
}
const histories = new Map<string, ConnectionHistory>()
export function historyFor(c: Controller) {
  const k = sourceKey(c); let h = histories.get(k)
  if (!h) { h = new ConnectionHistory(); if (histories.size >= 8) histories.delete(histories.keys().next().value!); histories.set(k,h) }
  h.closed = h.closed.filter(x => Date.now()-(x.closedAt ?? 0)<3600000)
  return h
}
export function clientLabels(c: Controller): Record<string,string> { return Storage.get<Record<string,string>>("dashboard_clients_"+sourceKey(c)) ?? {} }
export function saveClientLabel(c: Controller, ip: string, label: string) {
  if (!ip || ip.length > 100 || label.length > 80) throw new Error("来源地址或标签无效")
  const labels = clientLabels(c); if (label.trim()) labels[ip] = label.trim(); else delete labels[ip]
  if (!Storage.set("dashboard_clients_"+sourceKey(c), labels)) throw new Error("本地标签保存失败")
}
export function filterConnections(xs: Conn[], q: string, ip: string, labels: Record<string,string>) {
  const needle = q.toLowerCase()
  return xs.filter(x => (!ip || x.sourceIP === ip) && (!needle || [x.host,x.src,x.rule,x.chain,labels[x.sourceIP ?? ""]].join(" ").toLowerCase().includes(needle)))
}
export async function confirmed(target: string, effect: string, action: () => Promise<any>): Promise<boolean> {
  if (!await Dialog.confirm({ title: "确认操作", message: `目标：${target}\n影响：${effect}`, confirmLabel: "继续", cancelLabel: "取消" })) return false
  await action(); return true
}

// Temporary connection refresh observation. Only fixed labels and primitive counters
// enter the bounded memory ring; no controller/connection objects are serialized.
type RefreshEvent = "view"|"scene"|"appear"|"disappear"|"source-change"|"effect-start"|"effect-skip"|"effect-stop"|"request-start"|"request-end"|"publish"|"drop"|"schedule"|"join"|"expire"|"render"
type RefreshReason = "ok"|"owner-stopped"|"scene-inactive"|"epoch-changed"|"request-replaced"|"request-expired"|"no-source"|"not-selected"|"not-visible"|"not-foreground"|"cleanup"|"error"
let refreshOwnerSerial=0
export class ConnectionRefreshDiagnostic {
  private rows:Record<string,string|number|boolean>[]=[]
  private at=Date.now();private seq=0;private view="";private rendered=""
  private snapshots=new WeakMap<Conn[],number>()
  owner=0
  start(){this.owner=++refreshOwnerSerial;this.add("effect-start");return this.owner}
  add(event:RefreshEvent,fields:{owner?:number;request?:number;snapshot?:number;selected?:boolean;visible?:boolean;foreground?:boolean;scene?:boolean;epoch?:number;count?:number;up?:number;down?:number;shown?:number;fresh?:number;afterMs?:number;reason?:RefreshReason;status?:number}={}){
    if(!["view","scene","appear","disappear","source-change","effect-start","effect-skip","effect-stop","request-start","request-end","publish","drop","schedule","join","expire","render"].includes(event))return
    const row:Record<string,string|number|boolean>={seq:++this.seq,ms:Math.max(0,Date.now()-this.at),event,owner:this.owner}
    // Runtime whitelist too: even malformed callers cannot append arbitrary text.
    for(const key of ["owner","request","snapshot","epoch","count","up","down","shown","fresh","afterMs","status"] as const){const v=fields[key];if(typeof v==="number"&&Number.isFinite(v))row[key]=v}
    for(const key of ["selected","visible","foreground","scene"] as const)if(typeof fields[key]==="boolean")row[key]=fields[key]!
    if(fields.reason&&["ok","owner-stopped","scene-inactive","epoch-changed","request-replaced","request-expired","no-source","not-selected","not-visible","not-foreground","cleanup","error"].includes(fields.reason))row.reason=fields.reason
    this.rows.push(row);if(this.rows.length>160)this.rows.shift()
  }
  observe(selected:boolean,visible:boolean,foreground:boolean,scene:boolean,epoch:number){const key=[selected,visible,foreground,scene,epoch].join();if(key!==this.view){this.view=key;this.add("view",{selected,visible,foreground,scene,epoch})}}
  received(xs:Conn[],request:number,owner:number){let up=0,down=0;for(const x of xs){up+=x.up;down+=x.down}const totals={count:xs.length,up,down};this.add("request-end",{owner,request,reason:"ok",...totals});return totals}
  publish(xs:Conn[],request:number,owner:number,totals:{count:number;up:number;down:number}){const snapshot=this.seq+1;this.snapshots.set(xs,snapshot);this.add("publish",{owner,request,snapshot,...totals})}
  render(xs:Conn[],shown:number,fresh:number){const snapshot=this.snapshots.get(xs)??0,key=[snapshot,shown,fresh].join();if(key!==this.rendered){this.rendered=key;this.add("render",{snapshot,count:xs.length,shown,fresh})}}
  copy(){return JSON.stringify({format:"connections-refresh-v1",limit:160,events:this.rows})}
}
