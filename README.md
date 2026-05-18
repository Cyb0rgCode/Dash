# Hypercube Design System

The design system for **Hypercube** â€” a personal productivity dashboard for tracking
tasks, time, habits, and goals. Dark, vibrant, and quietly opinionated:
violetâ†’mint gradients, Syne display type, JetBrains Mono for everything that
counts or measures, and iOS-style springy micro-interactions throughout.

> The product is named **Hypercube** in the UI (page title, app title, logo).
> The source repo is named **Dash**. Treat "Hypercube" as the live brand.

## Sources used

- **GitHub:** [`Cyb0rgCode/Dash`](https://github.com/Cyb0rgCode/Dash) â€” the
  Flask + vanilla-JS codebase that powers the product. Templates, CSS, and
  client JS all live in `templates/` and `static/`. Worth exploring further
  if you want to extend this system: every visual choHypercube here is rooted in
  that codebase.
- **Local codebase:** `Dash/` mount â€” read while creating this system.

## What Hypercube is

A single-surface web app (with strong mobile responsive design). Five top-level
views, navigated via a left sidebar (desktop) or a floating "liquid glass"
bottom dock (mobile):

| View | What it does |
| --- | --- |
| **Dashboard** | Greeting, today's focus banner, three stat cards, two charts (daily time logged + time by priority). Chart.js. |
| **Matrix** | Eisenhower 2Ã—2 grid of tasks by urgency Ã— importance. |
| **Tasks** | Create, prioritize, batch-edit, filter, and time-log tasks. Grouped by category â†’ chapter. |
| **Habits & Goals** | Daily habit checks with streak tracking; goals with progress bars. |
| _(Edit sheet)_ | iOS-style modal that slides up for editing a single task. |

Backend: Flask + SQLite. Frontend: vanilla JS + Chart.js. No framework.

## Index

| File | Purpose |
| --- | --- |
| `README.md` | This file. |
| `SKILL.md` | Agent-skill entrypoint. |
| `colors_and_type.css` | All design tokens â€” colors, type, spacing, radii, shadows, motion. |
| `fonts/` | Webfont reference (Hypercube uses Google Fonts via CDN â€” no local files). |
| `assets/` | Logo SVG, app-icon mark, social/illustrative placeholders. |
| `preview/` | Design-system preview cards (rendered in the Design System tab). |
| `ui_kits/web/` | UI kit for the Hypercube web app â€” JSX components + interactive index. |

### What's in `preview/`

A small card per token category, registered in the Design System tab. **Colors:**
brand palette, surfaces, semantic, gradient. **Type:** display, headings, mono,
stat numerals. **Spacing:** radii, shadows, scale. **Components:** buttons,
toggles, tags, inputs, stat cards, task row, focus banner, habits/goals, empty
state. **Brand:** logo, icons, sidebar.

### What's in `ui_kits/web/`

A click-through React prototype with all four product surfaces:
`Dashboard.jsx`, `Matrix.jsx`, `Tasks.jsx`, `HabitsGoals.jsx`, plus the
`Sidebar.jsx` shell and `parts.jsx` (icons, chips, pills). Charts are
re-drawn as inline SVG so no Chart.js runtime is needed.

## Content fundamentals

Hypercube's copy is **terse, warm, and quietly clever**. It's a single-user app
talking to one person â€” yourself. The voHypercube is implied second-person without
ever saying "you", and avoids commanding verbs in favor of soft observations.

**Casing.** Sentence case everywhere. Title Case is reserved for proper nouns
and the brand (`Hypercube`). Two exceptions: small mono labels are `UPPERCASE`
(letter-spaced `0.08em` â€” see `.hk-label`), and quadrant titles in the Matrix
use Title Case (`Do First`, `Schedule`, `Delegate`, `Eliminate`).

**Tone.** Gentle, observational, with the occasional dry one-liner instead
of a generic empty state. From the codebase, verbatim:

- Greeting (time-aware): `Burning the midnight oil` Â· `Good morning` Â· `Good afternoon` Â· `Good evening` Â· `Late night focus`
- Subtitle when no tasks pending: `Inbox zero â€” nHypercube`
- Focus banner with no tasks: `All clear â€” add a task to plan your day`
- Focus banner meta with 1 task: `Last one standing`
- Pending filter empty state: `Inbox zero` / `All caught up â€” no pending tasks.`
- Tasks meta: `3 pending Â· 2 done today`
- Toasts: `Task added` (success), short and present-tense.

**Tags / chips.** Lowercase, mono, often with a single leading glyph that
substitutes for words: `! urgent`, `â˜… key`, `â± 1h 20m`, `~45m` (estimated),
`âš™ medium`. The glyph is the brand â€” never strip it.

**Numbers and time.** Always JetBrains Mono with tabular figures. Time
formats as `1h 20m`, never `80 minutes`. Counts are formatted with the unit:
`3 tasks on your plate`, not `3`.

**Em-dashes** are used as a casual joining glyph in copy
(`Inbox zero â€” nHypercube`, `All clear â€” add a task`). Not hyphens.

**No emoji** in chrome. Single Unicode glyphs do appear sparingly as icons
in dense rows (`âœ“` for done, `âœ•` for delete, `âœŽ` for edit, `â±` for time
logged, `!` and `â˜…` in tags). Treat these as iconography, not as decoration.

## Visual foundations

**Mood.** Late-night focus app. Deep blue-black, vibrant accents, ambient
radial glows in the background. Glassy, slightly sci-fi, never neon-bright.

**Backgrounds.** `--hk-bg #0a0a0f` (not pure black). Body carries a fixed
radial-gradient wash: violet glow top-left, mint glow bottom-right, both
held to ~7% opacity (`--hk-ambient-bg`). The sidebar uses `backdrop-filter:
blur(20px)` over the body wash for a glassmorphic edge. No raster textures,
no patterns, no decorative imagery â€” the brand is the gradient.

**Colors.**
- Brand violet `#7c6af7` carries primary actions, focus rings, the active
  nav state, primary chart bars.
- Mint `#6af7c8` is success/done and the second half of every gradient.
- Pink `#f76a8c` = high priority / urgent / destructive hover.
- Amber `#f7c76a` = medium priority / streaks / warning.
- Muted slate-violet `#6060a0` is the workhorse for meta, labels, dividers.

  Every semantic color has a `-dim` variant at ~13â€“15% alpha, used as the
  pill/tag background while the solid color is the text + border.

**Brand gradient.** `linear-gradient(135deg, #7c6af7 0%, #9d8fff 60%,
#6af7c8 100%)`. Applied to: the hero page title (background-clip text),
the logo mark, the goal progress bar, the focus-banner icon. Reserve it
for moments of emphasis â€” never as a section background.

**Typography.** Two families do everything.
- **Syne** (700/800) â€” every heading, every button label, every task title.
  Sharp, geometric, slightly playful. `letter-spacing: -0.02em` to -0.03em
  on display sizes.
- **JetBrains Mono** (400/600/700) â€” every number, badge, tag, label,
  timestamp, chart axis, page subtitle, sidebar date. With `0.04em`â€“`0.12em`
  tracking and frequent UPPERCASE. This is the secret to Hypercube looking like
  software and not a marketing site.

**Spacing.** A loose 4px grid. Cards pad `20px` (down to `16px` on mobile).
Items in lists are `8px` apart, fields in forms `10pxâ€“12px`. Generous outer
margins (`36â€“40px`) on desktop content; tight on mobile.

**Corner radii.** `14px` is the default card radius. Buttons and inputs are
`8px`. Tags and chips are `4px` with the occasional `20px` pill (badges,
time-logged chip). Avatars, the habit-check circle, and the focus icon use
larger soft-square radii (`11â€“14px`) rather than full circles.

**Cards.** Flat dark surface (`--bg-2`) on a `1px` hairline border
(`--line`) with a two-layer drop shadow (`--shadow-sm`). On hover, stat
cards lift 3px and an extremely subtle tinted overlay fades in (`opacity:
0.04`). No inner shadows except for translucent control surfaces
(segmented controls, sidebar dock).

**Borders.** A single 1px hairline, always (`--line`). The exception is
left-border priority coding on task rows â€” a 3px accent border in pink
(urgent+important), mint (important), or amber (urgent). Matrix quadrants
get a 3px top accent + faint matching wash.

**Hover.** Soft. Most controls just lighten color (muted â†’ text, or
muted â†’ accent) and tint background with the matching `-dim` color. Cards
lift `translateY(-3px)` and gain the larger shadow. Item rows pick up a
left-to-right `4%` accent gradient and a soft glow shadow.

**Press / tap.** Universal `transform: scale(0.94)` with the springy
`cubic-bezier(0.34, 1.56, 0.64, 1)` easing. Fast in (`0.08s`), springy out
(`0.4s`). This is the iOS-feel â€” applied to every button across the app.

**Animation.** Three named curves, used everywhere:
- `--spring` `cubic-bezier(0.34, 1.56, 0.64, 1)` â€” taps, sliding nav
  indicators, segmented control thumbs, card entrances.
- `--ease-out` `cubic-bezier(0.22, 1, 0.36, 1)` â€” modal open, page
  transitions, hover state changes.
- `0.18s` `ease` â€” color/border crossfades on hover.

Entrance: `translateY(14px) scale(0.98) â†’ 0,1` over `0.5s`, staggered
60ms per card. Tab switches: `translateY(6px) â†’ 0` over `0.18s`. The
focus-banner radial glow breathes in a `7s` loop at `scale(1.18)`.

**Transparency & blur.** Three glass surfaces:
1. Sidebar â€” `rgba(18,18,26,0.75)` + `blur(20px)`.
2. Sticky category headers in lists â€” `rgba(10,10,15,0.78)` + `blur(18px)
   saturate(180%)`.
3. Mobile floating nav dock â€” `rgba(18,18,26,0.62)` + `blur(28px)
   saturate(180%)`.

No blur is ever applied to body content. Modals use a flat 55% black
backdrop + 4px blur â€” not as glassy as the chrome.

**Layout rules.**
- Desktop: fixed `232px` sidebar, content with `max-width: 1140px`,
  `40px` horizontal padding.
- Mobile: floating bottom nav, `14px` page padding, single-column stacks.
- Form rows stack to vertical at `â‰¤720px`.
- All inputs jump to `font-size: 16px` on mobile to suppress iOS Safari
  zoom.

**Charts (Chart.js).** Bars get a vertical violet gradient
(`0.95 â†’ 0.2 alpha`) with `8px` rounded tops, max-thickness `48px`.
Doughnuts use the priority palette (pink/amber/mint) with a `3px`
`#0a0a0f` border-gap. Tooltips are `surface-2` with a violet hairline.
Grid lines are `rgba(30,30,46,0.8)`; axis ticks are `--hk-muted` in
JetBrains Mono `11px`.

**Reduced motion.** Honored throughout via
`@media (prefers-reduced-motion: reduce)` â€” all animations, transitions,
and the breathing glow drop to `0.001ms`.

## Iconography

Hypercube's icons are **all hand-rolled inline SVGs**, sitting directly in
markup. There is no icon font, no sprite, no external icon library. Every
icon shares a tight style:

- `viewBox="0 0 24 24"` with `width:height` of 14â€“24px depending on context.
- `fill: none; stroke: currentColor` â€” icons inherit color from text.
- `stroke-width: 2` for nav/chrome, `2.2` for accent / stat icons, `2.4` for
  the logo mark.
- `stroke-linecap: round` and `stroke-linejoin: round` on every icon.
- A handful of solid fills appear inside otherwise stroked icons â€” e.g.
  the bullseye dot in the habits / focus icon (`<circle fill="currentColor">`).

The set is small and purposeful â€” bar chart, 2Ã—2 grid, checklist, target,
checkmark, flame, in-tray, copy, upload â€” drawn to match
[Lucide](https://lucide.dev/)/Feather's visual language but custom geometry.

Unicode glyphs are used inline for ultra-dense controls where an SVG would
be too heavy: `âœ“` `âœ•` `âœŽ` `â±` `â˜…` `!`. These are styled with the same color
tokens as the SVGs.

**No emoji** appear anywhere in chrome, content, or empty states.

We provide:

- `assets/logo-mark.svg` â€” the 4-tile stacked grid mark used in the sidebar
  and as the app icon. Renders inside a `--hk-gradient-brand`-filled rounded
  square.
- `assets/icons/*.svg` â€” extracted nav + stat icons (`dashboard`, `matrix`,
  `tasks`, `habits`, `focus`, `flame`, `inbox`, `upload`, `copy`, `check`).
  Drop straight into JSX as inline SVG; do not load via `<img>` (color
  inheritance won't work).
- For anything outside this set, use [Lucide](https://lucide.dev/) at
  `stroke-width: 2`, `round` joins/caps â€” it's the closest match.

## LHypercubense

Personal project, no explicit lHypercubense in the source repo.
