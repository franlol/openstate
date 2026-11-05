import { useTerminalDimensions } from "@opentui/react"
import { useEffect } from "react"
import { CmdLine, StatusLine, Suggestions, WhichKey } from "./Bottom"
import { DispatchCard } from "./Dispatch"
import { Inspector } from "./Inspector"
import { useApp } from "./kit"
import { useGlobalKeys } from "./keys"
import { ConnectCard, Help, UpdateCard, SettingsCard, Splash, ThemePicker, Waiting } from "./Overlays"
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
    const errs = s.configErrors
    if (errs.length) s.notify(`E: ${errs[0]}${errs.length > 1 ? ` (+${errs.length - 1} more)` : ""} · :set to fix`, true)
    else s.notify("openstate · ? keys · : commands · :set settings · q quit")
  }

  s.screenW = width
  const w = s.widths()
  return (
    <box width={width} height={height} flexDirection="column" backgroundColor={t.bg}>
      {s.store() ? (
        <>
          <Header width={width} />
          <Track width={width} />
          <box flexDirection="row" flexGrow={1}>
            <Sources width={w.sources} />
            <Actions width={w.actions} />
            <Inspector width={w.inspector} />
          </box>
        </>
      ) : (
        <Waiting />
      )}
      <StatusLine width={width} />
      <CmdLine width={width} />
      <Suggestions width={width} />
      <WhichKey />
      <DispatchCard width={width} />
      <SettingsCard width={width} />
      <ThemePicker />
      <ConnectCard width={width} />
      <UpdateCard width={width} />
      <Help width={width} height={height} />
    </box>
  )
}
