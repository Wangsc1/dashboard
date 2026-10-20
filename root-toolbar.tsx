import { Button, Toolbar, ToolbarItem } from "scripting"

// 仅供Tab根页：X与菜单在同一个页面toolbar中注册，导航栈外层不再声明toolbar。
// 只使用官方文档已声明的placement；key仅作为脚本视图身份，不声称原生item id。
export function rootToolbar(page: "home" | "proxies" | "rules" | "connections" | "more", onClose?: () => void, menu?: any) {
  return <Toolbar>
    {onClose ? <ToolbarItem key={`dashboard.${page}.close`} placement="topBarLeading">
      <Button title="" systemImage="xmark" action={onClose} />
    </ToolbarItem> : null}
    {menu ? <ToolbarItem key={`dashboard.${page}.menu`} placement="topBarTrailing">{menu}</ToolbarItem> : null}
  </Toolbar>
}
