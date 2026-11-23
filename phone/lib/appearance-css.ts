import type { ThemeColors } from '@/constants/theme';
import { WORKSPACE_METRICS } from '../../packages/appearance/workspace';

const colorKeys = {
  'surface': 'bgPrimary',
  'navigation': 'bgSecondary',
  'panel': 'bgTertiary',
  'border': 'border',
  'text': 'textPrimary',
  'muted': 'textMuted',
  'accent': 'accent',
  'success': 'green',
} as const satisfies Record<string, keyof ThemeColors>;

const metricKeys = {
  'control-radius': ['controlRadius', 0, 32],
  'panel-radius': ['panelRadius', 0, 40],
  'row-radius': ['rowRadius', 0, 24],
  'content-padding': ['contentPadding', 8, 40],
  'toolbar-height': ['toolbarHeight', 48, 72],
  'drawer-width': ['drawerWidth', 200, 520],
  'launcher-width': ['launcherWidth', 280, 720],
} as const;

export function workspaceAppearance(base: ThemeColors, css: string) {
  const colors = { ...base };
  const metrics = { ...WORKSPACE_METRICS };
  let depth = 0;
  let selector = '';
  let declarations = '';
  for (const section of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/[^{}]+|[{}]/g)) {
    const token = section[0];
    if (token === '{') {
      if (depth++ > 0) selector = '';
    } else if (token === '}') {
      if (depth === 1 && selector === ':root') {
        for (const [, name, raw] of declarations.matchAll(/(?:^|;)\s*--noteriv-([\w-]+)\s*:\s*([^;]+)/g)) {
          const value = raw.trim();
          const colorKey = colorKeys[name as keyof typeof colorKeys];
          const metricKey = metricKeys[name as keyof typeof metricKeys];
          if (Object.hasOwn(colorKeys, name) && /^#[\da-f]{6}$/i.test(value)) colors[colorKey] = value;
          if (Object.hasOwn(metricKeys, name) && /^\d+(\.\d+)?px$/.test(value)) {
            const [key, min, max] = metricKey;
            metrics[key] = Math.max(min, Math.min(max, Number.parseFloat(value)));
          }
        }
      }
      depth = Math.max(0, depth - 1);
      if (depth === 0) {
        selector = '';
        declarations = '';
      }
    } else if (depth === 0) {
      selector = token.trim();
    } else if (depth === 1 && selector === ':root') {
      declarations += token;
    }
  }
  return { colors, metrics };
}
