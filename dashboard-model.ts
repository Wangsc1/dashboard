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
    for (const old of this.active) if (!ids.has(old.id)) this.closed.unshift({ ...old, upSpeed: 0, downSpeed: 0, closedAt: at })
    this.active = xs.map(x => { const p = prev.get(x.id); return { ...x, upSpeed: p && dt > 0 ? Math.max(0, x.up-p.up)/dt : 0, downSpeed: p && dt > 0 ? Math.max(0, x.down-p.down)/dt : 0 } })
    this.closed = this.closed.filter(x => at-(x.closedAt ?? at)<3600000).slice(0,300); this.at = at
  }

  resume() { this.active = []; this.at = 0 }
  clear() { this.closed = [] }
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
