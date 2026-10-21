// 业务检查桩，不是完整 Scripting UI 类型；新增签名按官方文档核对。
declare module "scripting" {
  const x: any
  export const GeometryReader: any, gradient: any;
  export const AppEvents: { scenePhase: { addListener(fn: (phase: "active" | "inactive" | "background") => void): void; removeListener(fn: (phase: "active" | "inactive" | "background") => void): void } }, Safari: any, LazyVStack: any, TabView: any, Tab: any, Slider: any, Transition: any, Circle: any, Animation: any, ProgressView: any, RoundedRectangle: any, ScrollView: any, SVG: any, ZStack: any, modifiers: any, Image: any, Menu: any, Button: any, ForEach: any, Form: any, HStack: any, Label: any, Navigation: any, NavigationLink: any, NavigationStack: any, Picker: any, Script: any, Section: any, SecureField: any, Spacer: any, Text: any, TextField: any, Toggle: any, VStack: any
  export function useObservable<T>(v: T | (() => T)): { value: T; setValue(v: T): void; subscribe(fn: (v: T, old: T) => void): void; unsubscribe(fn: (v: T, old: T) => void): void }
  export function useMemo<T>(fn: () => T, deps: any[]): T
  export function useEffect(f: any, d?: any): void
  export function useState<T>(v: T | (() => T)): [T, (v: T | ((p: T) => T)) => void]
}
declare var Storage: { get<T = any>(k: string): T | null; set(k: string, v: any): boolean; remove(k: string): void; getData(k: string): any; setData(k: string, v: any): void };
declare function setTimeout(f: any, ms?: number): any; declare function setInterval(f: any, ms?: number): any; declare function clearInterval(t: any): void; declare var Keychain: any; declare var Dialog: any
declare function fetch(u: string, o?: any): Promise<any>
declare class WebSocket { constructor(u: string); addEventListener(e: string, f: any): void; close(c?: number): void }
declare namespace JSX { interface IntrinsicElements { [k: string]: any } interface ElementChildrenAttribute { children: {} } interface IntrinsicAttributes { key?: any } }
declare function clearTimeout(t: any): void;
declare class AbortController { signal: any; abort(): void }
declare class TextDecoder { decode(b: any, o?: any): string }

declare var HapticFeedback: { selection(): void };
declare var Pasteboard: { setString(s: string): Promise<void> };
declare var UIImage: { fromData(d: any): any; fromBase64String(s: string): any };
declare var FileManager: { isiCloudEnabled: boolean; iCloudDocumentsDirectory: string; downloadFileFromiCloud(p: string): Promise<boolean>; readAsString(p: string): Promise<string>; writeAsString(p: string, text: string): Promise<void> };

declare var console: { log(...args: any[]): void }
