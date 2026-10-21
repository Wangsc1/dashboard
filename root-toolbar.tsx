import { Button } from "scripting"

export function rootToolbar(_page: "home" | "proxies" | "rules" | "connections" | "more", onClose?: () => void, menu?: any) {
  return {
    topBarLeading: onClose ? <Button title="" systemImage="xmark" action={onClose} /> : undefined,
    topBarTrailing: menu,
  }
}
