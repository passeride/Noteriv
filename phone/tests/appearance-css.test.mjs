import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTheme } from '@/constants/theme';
import { workspaceAppearance } from '@/lib/appearance-css';

const base = getTheme('noteriv-night');

test('reads the workspace tokens from an enabled snippet', () => {
  const result = workspaceAppearance(base, `
    /* A setting that would change every note if it were active.
    :root { --noteriv-text: #ffffff; } */
    :root {
      --noteriv-accent: #35624e;
      --noteriv-panel-radius: 20px;
    }
    :root { --noteriv-accent: #123456; --noteriv-content-padding: 24px }
  `);
  assert.equal(result.colors.accent, '#123456');
  assert.equal(result.colors.textPrimary, base.textPrimary);
  assert.equal(result.metrics.panelRadius, 20);
  assert.equal(result.metrics.contentPadding, 24);
});

test('ignores unsupported CSS and keeps touch controls usable', () => {
  const result = workspaceAppearance(base, `
    @media (prefers-color-scheme: light) {
      :root { --noteriv-surface: #ffffff; }
    }
    .note { --noteriv-accent: #ff0000; }
    :root { --noteriv-accent: url(example.png); --noteriv-toolbar-height: 3px;
      --noteriv-panel-radius: 500px; --noteriv-drawer-width: 40%; }
  `);
  assert.equal(result.colors.bgPrimary, base.bgPrimary);
  assert.equal(result.colors.accent, base.accent);
  assert.equal(result.metrics.toolbarHeight, 48);
  assert.equal(result.metrics.panelRadius, 40);
  assert.equal(result.metrics.drawerWidth, workspaceAppearance(base, '').metrics.drawerWidth);
});
