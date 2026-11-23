import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { BUILT_IN_THEMES, ThemeColors, ThemeDefinition, getTheme } from '@/constants/theme';

import { DEFAULT_WORKSPACE_THEME, WORKSPACE_METRICS } from '../../packages/appearance/workspace';
import { workspaceAppearance } from '@/lib/appearance-css';
import { loadAppearanceCSS, onSnippetChange } from '@/lib/css-snippets';

interface ThemeContextType {
  metrics: typeof WORKSPACE_METRICS;
  colors: ThemeColors;
  themeId: string;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  colors: getTheme(DEFAULT_WORKSPACE_THEME),
  metrics: WORKSPACE_METRICS,
  themeId: DEFAULT_WORKSPACE_THEME,
  isDark: true,
});

export function ThemeProvider({
  themeId,
  customThemes,
  vaultPath,
  children,
}: {
  themeId: string;
  customThemes?: ThemeDefinition[];
  vaultPath?: string;
  children: React.ReactNode;
}) {
  const [snippet, setSnippet] = useState<{ path: string; css: string }>();
  useEffect(() => {
    if (!vaultPath) return;
    let active = true;
    let revision = 0;
    const reload = () => {
      const request = ++revision;
      void loadAppearanceCSS(vaultPath).then(css => {
        if (active && request === revision) setSnippet({ path: vaultPath, css });
      }).catch(() => {
        if (active && request === revision) setSnippet({ path: vaultPath, css: '' });
      });
    };
    reload();
    const unsubscribe = onSnippetChange(path => { if (path === vaultPath) reload(); });
    return () => { active = false; unsubscribe(); };
  }, [vaultPath]);
  const css = snippet && snippet.path === vaultPath ? snippet.css : '';
  const value = useMemo(() => {
    // Check custom themes first, then fall back to built-in
    const custom = customThemes?.find((t) => t.id === themeId);
    const builtIn = BUILT_IN_THEMES.find((t) => t.id === themeId);
    const themeType = custom?.type ?? builtIn?.type ?? 'dark';
    return {
      ...workspaceAppearance(custom?.colors ?? getTheme(themeId), css),
      themeId,
      isDark: themeType === 'dark',
    };
  }, [themeId, customThemes, css]);

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
