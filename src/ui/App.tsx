import { useTerminalDimensions } from "@opentui/react"
import { useEffect } from "react"
import { CmdLine, StatusLine, Suggestions, WhichKey } from "./Bottom"
import { Inspector } from "./Inspector"
import { useApp } from "./kit"
import { useGlobalKeys } from "./keys"
import { Help, Splash, ThemePicker } from "./Overlays"
import { Actions, Sources } from "./Panels"
import { Header, Track } from "./Top"

export { AppContext } from "./kit"

export function App() {
  const s = useApp()
  const t = s.theme
  const { width, height } = useTerminalDimensions()
  useGlobalKeys(s)

  const splash = Date.now() < s.splashUntil
  useEffect(() => {
    if (!splash) return
    const id = setTimeout(() => s.emit(), s.splashUntil - Date.now() + 10)
    return () => clearTimeout(id)
  }, [splash])

  if (splash) return <Splash />
  if (!s.greeted) {
    s.greeted = true
    s.notify("openstate · ? keys · : commands · q quit")
  }

  s.screenW = width
  const w = s.widths()
  return (
    <box width={width} height={height} flexDirection="column" backgroundColor={t.bg}>
      <Header width={width} />
      <Track width={width} />
      <box flexDirection="row" flexGrow={1}>
        <Sources width={w.sources} />
        <Actions width={w.actions} />
        <Inspector width={w.inspector} />
      </box>
      <StatusLine width={width} />
      <CmdLine width={width} />
      <Suggestions width={width} />
      <WhichKey />
      <ThemePicker />
      <Help width={width} height={height} />
    </box>
  )
}
