import { Button } from "scripting"

// 仅在选中Tab业务页根挂一次；共享导航栈与Tab容器不另注册toolbar。
export function rootToolbar(_page: "home" | "proxies" | "rules" | "connections" | "more", onClose?: () => void, menu?: any) {
  return {
    topBarLeading: onClose ? <Button title="" systemImage="xmark" action={onClose} /> : undefined,
    topBarTrailing: menu,
  }
}
