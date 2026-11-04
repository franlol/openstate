export type Theme = {
  id: string
  name: string
  bg: string
  panel: string
  fg: string
  muted: string
  dim: string
  border: string
  borderActive: string
  accent: string
  selBg: string
  add: string
  remove: string
  warn: string
  flash: string
  // The light that runs across the header title once at start; picked to stand out on the theme's background.
  shine: string
  sources: string[]
}

export const themes: Theme[] = [
  {
    id: "openstate",
    name: "openstate",
    bg: "#0d0f14",
    panel: "#0d0f14",
    fg: "#d7dae0",
    muted: "#7d8590",
    dim: "#3b414c",
    border: "#232832",
    borderActive: "#7c6cff",
    accent: "#7c6cff",
    selBg: "#1b1f2a",
    add: "#3fd68f",
    remove: "#ff6b81",
    warn: "#ffc857",
    flash: "#2e2a5c",
    shine: "#e4e0ff",
    sources: ["#7c6cff", "#3fd6c8", "#ff9f5a", "#ff6bb5", "#9ad64f"],
  },
  {
    id: "catppuccin",
    name: "catppuccin mocha",
    bg: "#1e1e2e",
    panel: "#1e1e2e",
    fg: "#cdd6f4",
    muted: "#9399b2",
    dim: "#45475a",
    border: "#313244",
    borderActive: "#cba6f7",
    accent: "#cba6f7",
    selBg: "#313244",
    add: "#a6e3a1",
    remove: "#f38ba8",
    warn: "#f9e2af",
    flash: "#45385c",
    shine: "#f5e0dc",
    sources: ["#cba6f7", "#94e2d5", "#fab387", "#f5c2e7", "#a6e3a1"],
  },
  {
    id: "tokyonight",
    name: "tokyo night",
    bg: "#1a1b26",
    panel: "#1a1b26",
    fg: "#c0caf5",
    muted: "#737aa2",
    dim: "#3b4261",
    border: "#292e42",
    borderActive: "#7aa2f7",
    accent: "#7aa2f7",
    selBg: "#283457",
    add: "#9ece6a",
    remove: "#f7768e",
    warn: "#e0af68",
    flash: "#2f3f6e",
    shine: "#c0caf5",
    sources: ["#7aa2f7", "#7dcfff", "#ff9e64", "#bb9af7", "#9ece6a"],
  },
  {
    id: "gruvbox",
    name: "gruvbox dark",
    bg: "#282828",
    panel: "#282828",
    fg: "#ebdbb2",
    muted: "#a89984",
    dim: "#504945",
    border: "#3c3836",
    borderActive: "#fabd2f",
    accent: "#fabd2f",
    selBg: "#3c3836",
    add: "#b8bb26",
    remove: "#fb4934",
    warn: "#fe8019",
    flash: "#5a4a1c",
    shine: "#fbf1c7",
    sources: ["#fabd2f", "#8ec07c", "#fe8019", "#d3869b", "#b8bb26"],
  },
  {
    id: "nord",
    name: "nord",
    bg: "#2e3440",
    panel: "#2e3440",
    fg: "#e5e9f0",
    muted: "#9aa5b8",
    dim: "#4c566a",
    border: "#3b4252",
    borderActive: "#88c0d0",
    accent: "#88c0d0",
    selBg: "#3b4252",
    add: "#a3be8c",
    remove: "#bf616a",
    warn: "#ebcb8b",
    flash: "#3e5a66",
    shine: "#eceff4",
    sources: ["#88c0d0", "#8fbcbb", "#d08770", "#b48ead", "#a3be8c"],
  },
]

export function findTheme(id: string): Theme {
  return themes.find((t) => t.id === id || t.name === id) ?? themes[0]!
}

// Linear blend between two #rrggbb colors, t in [0, 1].
// The name's two halves: "open" in the accent, "state" a shade lighter. Header, splash, waiting screen and help.
export const titleShades = (t: Theme) => ({ open: t.accent, state: mix(t.accent, t.fg, 0.35) })

// How much of the theme's shine a letter of the name takes, with the shine's centre at letter `at`.
export const shineGlow = (i: number, at: number) => Math.max(0, 1 - Math.abs(i - at) / 2)

export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (shift: number) => {
    const x = (pa >> shift) & 255
    const y = (pb >> shift) & 255
    return Math.round(x + (y - x) * t)
  }
  return "#" + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")
}
