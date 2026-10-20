import { ControllerInput, listControllers, saveController, getSecret, getClashSecret, PLUGINS } from "./api"
import { getPreferences, normalizePreferences, savePreferences } from "./preferences"
// 手动 iCloud 文档备份，不是原 App 的自动同步；不复制任何 Keychain 内容。
export function makeBackup() {
  return { version: 1, preferences: getPreferences(), controllers: listControllers().filter(c => c.kind === "openwrt").map(c => ({
    id: c.id, name: c.name, host: c.host, port: c.port, https: !!c.https, username: c.username,
    plugin: c.plugin, auto: c.auto !== false, cport: c.cport,
  })) }
}
export function validateBackup(data: any): { preferences: ReturnType<typeof getPreferences>; controllers: ControllerInput[] } {
  if (data?.version !== 1 || !data.preferences || typeof data.preferences !== "object" || !Array.isArray(data.controllers) || data.controllers.length > 100) throw new Error("备份格式无效")
  const controllers = data.controllers.map((c: any): ControllerInput => {
    if (!c || typeof c.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(c.id) || typeof c.name !== "string" || c.name.length > 200 || typeof c.host !== "string" || !/^[a-zA-Z0-9.:[\]_-]+$/.test(c.host) || !Number.isInteger(c.port) || c.port < 1 || c.port > 65535 || !Number.isInteger(c.cport) || c.cport < 1 || c.cport > 65535 || typeof c.username !== "string" || typeof c.https !== "boolean" || typeof c.auto !== "boolean" || !PLUGINS.some(([p]) => p === c.plugin)) throw new Error("控制器备份字段无效")
    // 显式重建，不接收远端混入的密码、secret、URL、session、其他 Storage 键。
    return { id: c.id, name: c.name, host: c.host, port: c.port, https: c.https, username: c.username, plugin: c.plugin, auto: c.auto, cport: c.cport }
  })
  if (new Set(controllers.map((c: ControllerInput) => c.id)).size !== controllers.length) throw new Error("控制器 ID 重复")
  return { preferences: normalizePreferences(data.preferences), controllers }
}
export function restoreBackup(data: any) {
  const backup = validateBackup(data)
  // 合并而非删除本地控制器，已有控制器的 Keychain 凭据保留；新增控制器需重新填写密码。
  const local = new Set(listControllers().map(c => c.id))
  for (const c of backup.controllers) saveController(c, local.has(c.id!) ? getSecret(c.id!) : "", local.has(c.id!) ? getClashSecret(c.id!) : "")
  savePreferences(backup.preferences)
}
