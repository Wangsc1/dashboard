// 仅绘制真实采样之间的几何插值，不写入历史、不改变读数、不外推未采到的数据。
export const CHART_HISTORY = 60
export const CHART_FRAME_MS = 50 // 共用 20fps 调度器，非每个 SVG 一个定时器
export interface PlotPoint { x: number; value: number }
const mix = (a: number, b: number, p: number) => a + (b - a) * p
export function scrollPoints(previous: number[], current: number[], progress: number, width: number): PlotPoint[] {
  const p = Math.max(0, Math.min(1, progress)), step = width / (CHART_HISTORY - 1)
  if (!current.length) return []
  if (previous === current || !previous.length || current.length === 1) return current.map((v, i) => ({ x: (CHART_HISTORY - current.length + i) * step, value: v }))
  const points = previous.map((v, i) => ({ x: (CHART_HISTORY - previous.length + i - p) * step, value: v }))
  points.push({ x: width, value: mix(previous[previous.length - 1], current[current.length - 1], p) })
  return points
}
export function plotScale(previous: number[][], current: number[][], progress: number, floor: number) {
  return mix(Math.max(floor, ...previous.flat()), Math.max(floor, ...current.flat()), Math.max(0, Math.min(1, progress)))
}
// 每段控制点的 y 坐标只取两端实际值，不会像自由样条那样过冲出负值或制造峰值。
export function smoothPath(points: PlotPoint[], height: number, scale: number, inset = 0): string {
  if (points.length < 2) return ""
  const y = (v: number) => height - inset - v / scale * (height - inset * 2)
  let path = `M ${points[0].x.toFixed(2)},${y(points[0].value).toFixed(2)}`
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], middle = ((a.x + b.x) / 2).toFixed(2)
    path += ` C ${middle},${y(a.value).toFixed(2)} ${middle},${y(b.value).toFixed(2)} ${b.x.toFixed(2)},${y(b.value).toFixed(2)}`
  }
  return path
}

const subscribers = new Set<(at: number) => boolean>()
let timer: any = null
export function animateChart(callback: (at: number) => boolean) {
  subscribers.add(callback)
  if (timer === null) timer = setInterval(() => {
    const now = Date.now()
    for (const cb of subscribers) if (!cb(now)) subscribers.delete(cb)
    if (!subscribers.size && timer !== null) { clearInterval(timer); timer = null }
  }, CHART_FRAME_MS)
  return () => {
    subscribers.delete(callback)
    if (!subscribers.size && timer !== null) { clearInterval(timer); timer = null }
  }
}
