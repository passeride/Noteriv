import type { PluginApi } from "@noteriv/plugin-api";

/** Same convention both apps used before 2.3: `Daily/YYYY-MM-DD.md`, created with a heading on first use. */
export function dailyNotePath(date: string): string {
  return `Daily/${date}.md`;
}

/** Opens the daily note of `date` (YYYY-MM-DD), creating it (and the `Daily` folder) when missing. */
export async function openDailyNote(api: PluginApi, date: string): Promise<boolean> {
  const path = dailyNotePath(date);
  if (!(await api.vault.exists(path))) await api.vault.write(path, `# ${date}\n\n`);
  return api.workspace.openFile(path);
}
