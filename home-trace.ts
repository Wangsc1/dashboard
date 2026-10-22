// Temporary, default-visible home diagnostics. Numbers are local correlation
// counters, never controller IDs/source tokens, sample values or credentials.
import { HomeDiagnostic, recordEvent } from "./preferences"
export const homeTraceRun = Math.floor(Math.random() * 1000000)
let serial = 0
const sources = new Map<string, number>()
export function nextHomeTraceId() { return ++serial }
export function homeTraceSource(source: string) {
  if (!source) return 0
  if (!sources.has(source)) sources.set(source, sources.size + 1)
  return sources.get(source)!
}
export function traceHome(home: HomeDiagnostic, ok = true) {
  try { recordEvent("homeDiagnostic", ok, { home: { ...home, run: homeTraceRun } }) } catch {}
}
