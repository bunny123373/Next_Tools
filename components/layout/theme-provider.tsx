"use client";

import * as React from "react";

export type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
  /** False until the client has read localStorage — use to avoid mismatches. */
  mounted: boolean;
}

const STORAGE_KEY = "balu:theme:v1";
const ThemeContext = React.createContext<ThemeContextValue | null>(null);

/**
 * Dark is the product default. Light mode is opt-in and persisted.
 *
 * The initial paint is handled by the inline script in the root layout, which
 * sets `data-theme` on <html> before React hydrates. That is what prevents a
 * white flash for dark-mode users.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Server render always assumes dark, matching the inline script's default.
  const [theme, setThemeState] = React.useState<Theme>("dark");
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const initial: Theme =
      stored === "light" || stored === "dark"
        ? stored
        : window.matchMedia?.("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark";
    setThemeState(initial);
    setMounted(true);
  }, []);

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode: the theme still applies for this session.
    }
  }, []);

  const toggle = React.useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const value = React.useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme: theme, setTheme, toggle, mounted }),
    [theme, setTheme, toggle, mounted],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return context;
}

/**
 * Runs before first paint. Kept as a string so it can be inlined in <head>
 * without becoming a blocking request.
 */
export const THEME_INIT_SCRIPT = `
(function(){try{
  var s=localStorage.getItem('${STORAGE_KEY}');
  var t=(s==='light'||s==='dark')?s:(window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');
  document.documentElement.dataset.theme=t;
}catch(e){document.documentElement.dataset.theme='dark';}})();
`;
