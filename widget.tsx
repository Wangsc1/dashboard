import { HStack, Spacer, Text, VStack, Widget } from "scripting"
import { getActive, loadOverview, loadCache, saveCache, fmtSpeed, fmtBytes, getRefreshMinutes, Overview } from "./api"

async function load(): Promise<{ name: string; o: Overview | null; stale: boolean; err: string }> {
  const c = getActive()
  if (!c) return { name: "", o: null, stale: false, err: "请先在脚本内添加控制器" }
  try {
    const o = await loadOverview(c)
    saveCache(c.id, o)
    return { name: c.name, o, stale: false, err: "" }
  } catch (e: any) {
    const cache = loadCache(c.id)
    return { name: c.name, o: cache?.o ?? null, stale: !!cache, err: String(e?.message ?? e) }
  }
}

function Row({ label, value, size = 13 }: { label: string; value: string; size?: number }) {
  return <HStack><Text font={size} foregroundStyle="secondaryLabel">{label}</Text><Spacer /><Text font={size} fontWeight="semibold">{value}</Text></HStack>
}

function View({ d }: { d: Awaited<ReturnType<typeof load>> }) {
  const fam = String(Widget.family ?? "")
  const o = d.o
  if (fam.startsWith("accessory")) {
    return <VStack alignment="leading" spacing={1}>
      <Text font={12}>{`↑ ${o ? fmtSpeed(o.traffic.up) : "-"}`}</Text>
      <Text font={12}>{`↓ ${o ? fmtSpeed(o.traffic.down) : "-"}`}</Text>
      {fam === "accessoryRectangular" ? <Text font={11}>{`连接 ${o?.connCount ?? "-"}`}</Text> : null}
    </VStack>
  }
  return <VStack alignment="leading" spacing={6} padding>
    <HStack><Text font={14} fontWeight="bold">{d.name || "Neko Dash"}</Text><Spacer />
      {o?.mode ? <Text font={11} foregroundStyle="secondaryLabel">{o.mode}</Text> : null}</HStack>
    {o ? <>
      <Row label="↑ 上传" value={fmtSpeed(o.traffic.up)} size={15} />
      <Row label="↓ 下载" value={fmtSpeed(o.traffic.down)} size={15} />
      <Row label="连接数" value={String(o.connCount)} />
      {fam !== "systemSmall" ? <>
        <Row label="累计上传" value={fmtBytes(o.upTotal)} />
        <Row label="累计下载" value={fmtBytes(o.downTotal)} />
      </> : null}
    </> : null}
    {d.err ? <Text font={11} foregroundStyle="systemRed">{d.stale ? "连接失败，显示缓存" : d.err}</Text> : null}
  </VStack>
}

async function main() {
  const d = await load()
  Widget.present(<View d={d} />, { reloadPolicy: { policy: "after", date: new Date(Date.now() + getRefreshMinutes() * 60 * 1000) } })
}
main()
