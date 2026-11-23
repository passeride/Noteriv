const day = {
  bgPrimary: "#fffcf5", bgSecondary: "#f1ece2", bgTertiary: "#eee9df",
  border: "#d9d1c2", textPrimary: "#25302a", textSecondary: "#435147", textMuted: "#505c53",
  accent: "#a53e29", green: "#28634d", red: "#a13531", yellow: "#7c521d",
  blue: "#2d5e73", mauve: "#624f77", peach: "#9c4929", teal: "#276c62", pink: "#8b4260",
};

const night = {
  bgPrimary: "#1c2420", bgSecondary: "#26312b", bgTertiary: "#2e3b34",
  border: "#536259", textPrimary: "#f2ece0", textSecondary: "#d4ded5", textMuted: "#b9c5bd",
  accent: "#f0aa8b", green: "#a9d7b4", red: "#ffa797", yellow: "#ebcf88",
  blue: "#a0ccde", mauve: "#cbb6ec", peach: "#ffc3a5", teal: "#8bd8c4", pink: "#ebaac9",
};

export const WORKSPACE_THEMES = [
  { id: "noteriv-day", name: "Noteriv Day", type: "light", colors: day },
  { id: "noteriv-night", name: "Noteriv Night", type: "dark", colors: night },
] as const;

export const DEFAULT_WORKSPACE_THEME = "noteriv-night";

export const WORKSPACE_METRICS = {
  controlRadius: 8,
  panelRadius: 16,
  rowRadius: 8,
  contentPadding: 22,
  toolbarHeight: 52,
  drawerWidth: 340,
  launcherWidth: 560,
};
