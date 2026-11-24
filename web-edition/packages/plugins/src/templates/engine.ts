/**
 * Template engine, moved unchanged from the apps' `lib/template-utils.ts` (identical on web and desktop): `{{date}}`,
 * `{{time}}`, `{{title}}`, `{{datetime}}`, `{{weekday}}`, `{{month}}`, `{{year}}`, case-insensitive; unknown
 * variables are left as written.
 */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const TEMPLATES_FOLDER = "Templates";

export function getTemplateVariables(noteTitle: string, now = new Date()): Record<string, string> {
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return {
    date: `${yyyy}-${mm}-${dd}`,
    time: `${hh}:${min}`,
    title: noteTitle,
    datetime: now.toISOString(),
    weekday: DAYS[now.getDay()],
    month: MONTHS[now.getMonth()],
    year: yyyy,
  };
}

export function processTemplate(content: string, variables: Record<string, string>): string {
  return content.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
    const lower = key.toLowerCase();
    return lower in variables ? variables[lower] : match;
  });
}

/**
 * First free `<base>.md`, `<base> 1.md`, `<base> 2.md`… at the vault root. Before 2.3 web always used `<base>.md`,
 * so creating from the same template twice failed.
 */
export async function freeNotePath(base: string, exists: (path: string) => Promise<boolean>): Promise<string> {
  for (let i = 0; ; i++) {
    const path = `${i === 0 ? base : `${base} ${i}`}.md`;
    if (!(await exists(path))) return path;
  }
}
