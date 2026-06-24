// Design tokens — ported verbatim from inputs/arena-rater-view.jsx.
// Single source of truth for the rater + admin UIs.

export const t = {
  paper: '#F4F3EE',
  card: '#FFFFFF',
  ink: '#17171B',
  inkSoft: '#5B5A63',
  inkFaint: '#8E8D95',
  line: '#E4E2DB',
  lineSoft: '#EEEDE7',
  accent: '#34566F',
  accentSoft: '#E8EEF2',
  rewrite: '#7A5B3A',
  rewriteSoft: '#F1EAE0',
} as const;

export const sans = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
export const serif = "Georgia, 'Times New Roman', serif";
export const mono = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
