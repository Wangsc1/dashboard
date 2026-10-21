import { useEffect, useState } from "scripting"
import { CHART_HISTORY, animateChart, plotScale, scrollPoints, smoothPath } from "./chart"
const EMPTY: number[] = []
// 高频 state 仅存在于三个图表组件，不让整页/网络请求随帧刷新。
export function useSmoothPlot(a: number[], b: number[] = EMPTY, enabled = true, width = 100, height = 40, floor = 1024, inset = 0, zeroStart = false) {
  const [track] = useState({ previous: [a, b], current: [a, b], at: Date.now(), duration: 1000 })
  const [tick, setTick] = useState(Date.now())
  useEffect(() => {
    const now = Date.now()
    if (track.current[0] === a && track.current[1] === b) { track.previous = track.current; setTick(now); return }
    const reset = a.length < track.current[0].length || !a.length
    track.previous = reset || !enabled ? [a, b] : track.current
    track.current = [a, b]
    track.duration = Math.max(250, Math.min(2500, now - track.at)) // 跟随实际到样间隔，链路偶发变慢时曲线不停住
    track.at = now
    setTick(now)
    if (!enabled || reset || a.length < 2) return
    return animateChart(at => {
      setTick(at)
      return at < track.at + track.duration
    })
  }, [a, b, enabled])
  const p = !enabled ? 1 : Math.max(0, Math.min(1, (tick - track.at) / track.duration))
  const scale = plotScale(track.previous, track.current, p, floor)
  const step = width / (CHART_HISTORY - 1)
  // 仅视觉：历史未填满时，在最左真实点前补一个0起点，让曲线从底部升起；不写入历史、不改读数。
  const points = track.current.map((arr, i) => {
    const ps = scrollPoints(track.previous[i], arr, p, width)
    return zeroStart && ps.length && ps[0].x > 0 ? [{ x: ps[0].x - step, value: 0 }, ...ps] : ps
  })
  return { scale, points, paths: points.map(ps => smoothPath(ps, height, scale, inset)) }
}
