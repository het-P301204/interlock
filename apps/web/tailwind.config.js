/**
 * INTERLOCK design tokens. Every color is an RGB channel triple defined in
 * src/styles.css (light on :root, dark under [data-theme="dark"]), so
 * opacity modifiers such as `bg-coral/15` compose correctly. Never define a
 * token with its own alpha: Tailwind's `/NN` would replace it.
 *
 * Accents are semantic only:
 *   coral     CRITICAL            marigold  HIGH
 *   sage      positive/strengthened  iris   informational
 * `*-ink` variants are the text-safe versions (>= 4.5:1 on paper and paper-2
 * in light mode; lighter tints in dark mode).
 */
const rgb = (name) => `rgb(var(--${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    screens: {
      xs: '400px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1440px',
    },
    extend: {
      colors: {
        paper: { DEFAULT: rgb('paper'), 2: rgb('paper-2'), 3: rgb('paper-3') },
        surface: { DEFAULT: rgb('surface'), raised: rgb('surface-raised') },
        ink: { DEFAULT: rgb('ink'), 2: rgb('ink-2'), 3: rgb('ink-3') },
        line: { DEFAULT: rgb('line'), strong: rgb('line-strong') },
        inverse: { DEFAULT: rgb('inverse'), ink: rgb('inverse-ink'), 2: rgb('inverse-ink-2') },
        coral: { DEFAULT: rgb('coral'), ink: rgb('coral-ink') },
        marigold: { DEFAULT: rgb('marigold'), ink: rgb('marigold-ink') },
        sage: { DEFAULT: rgb('sage'), ink: rgb('sage-ink') },
        iris: { DEFAULT: rgb('iris'), ink: rgb('iris-ink') },
        focus: rgb('focus'),
      },
      fontFamily: {
        sans: ['Manrope', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'Cascadia Mono', 'Consolas', 'monospace'],
      },
      fontSize: {
        label: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.11em', fontWeight: '500' }],
        data: ['0.8125rem', { lineHeight: '1.25rem' }],
        display: ['clamp(2.5rem, 0.9rem + 4.6vw, 4.6rem)', { lineHeight: '0.98', letterSpacing: '-0.042em', fontWeight: '800' }],
        'display-2': ['clamp(2rem, 1.2rem + 3vw, 3.5rem)', { lineHeight: '1.02', letterSpacing: '-0.035em', fontWeight: '800' }],
        'title-1': ['clamp(1.75rem, 1.3rem + 1.6vw, 2.5rem)', { lineHeight: '1.08', letterSpacing: '-0.03em', fontWeight: '800' }],
        'title-2': ['1.5rem', { lineHeight: '1.2', letterSpacing: '-0.022em', fontWeight: '700' }],
        'title-3': ['1.125rem', { lineHeight: '1.35', letterSpacing: '-0.012em', fontWeight: '700' }],
        lede: ['clamp(1.0625rem, 0.98rem + 0.35vw, 1.25rem)', { lineHeight: '1.55', letterSpacing: '-0.006em' }],
      },
      borderRadius: {
        control: '14px',
        input: '16px',
        card: '18px',
        panel: '24px',
        hero: '30px',
        chip: '8px',
      },
      boxShadow: {
        hairline: '0 0 0 1px rgb(var(--line) / 1)',
        soft: '0 1px 0 rgb(var(--shadow) / 0.04), 0 1px 2px rgb(var(--shadow) / 0.06), 0 10px 28px -16px rgb(var(--shadow) / 0.22)',
        lift: '0 1px 0 rgb(var(--shadow) / 0.05), 0 4px 10px -4px rgb(var(--shadow) / 0.12), 0 22px 48px -24px rgb(var(--shadow) / 0.32)',
        overlay: '0 2px 6px rgb(var(--shadow) / 0.10), 0 32px 80px -24px rgb(var(--shadow) / 0.45)',
        'inset-line': 'inset 0 0 0 1px rgb(var(--line) / 1)',
      },
      transitionTimingFunction: {
        'out-quart': 'cubic-bezier(0.25, 1, 0.5, 1)',
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'in-out-quad': 'cubic-bezier(0.45, 0, 0.55, 1)',
      },
      transitionDuration: {
        fast: '140ms',
        base: '220ms',
        slow: '420ms',
      },
      maxWidth: {
        prose: '68ch',
        page: '1320px',
      },
    },
  },
  plugins: [],
}
