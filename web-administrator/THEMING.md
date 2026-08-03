# Theming & Skinning

The web administrator is rebranded by **re-declaring design tokens** — the CSS
custom properties in `client/css/app.css`. Every component class and every
Tailwind utility in the app resolves through these tokens, so a skin that
re-declares them restyles the entire UI — surfaces, type, chrome, branding,
light and dark — without touching a single component. **The tokens are the
contract**; the app's DOM structure, component class names, and utility names
are not (see [What is not contract](#what-is-not-contract)).

A **skin** is a directory containing:

- `skin.css` — token re-declarations (dark values on `:root`, light values on
  `[data-theme="light"]`)
- any fonts/images the skin references (served with it)

A skin is the **deployment's branding override, not a user choice**: it
re-styles what Light and Dark *mean*, so the Theme dropdown (and the top-bar
toggle) stay exactly Light/Dark and users pick a mode within the brand.

Two worked examples ship in `skins/`: **portal-example** (a brand recolor —
emerald accent, neutral slate, flat chrome) and **ledger-example** (how far the
contract stretches — serif type, paper-and-ink palette, zero radius, hard
offset shadows: same tokens, opposite character).

## Quick start

```jsonc
// config.json
{
    "skin": "skins/portal-example",
    "defaultTheme": "dark"
}
```

or `WEBADMIN_SKIN=skins/portal-example npm start`. The path resolves against
the app root. Restart, reload — the whole UI (login screen included) carries
the brand in both modes. Edit `skin.css` and reload to iterate — no build
step.

## How it works

- The server serves the skin directory at the fixed path `/webadmin/skin/` and
  links `/webadmin/skin/skin.css` into the shell **after** the app stylesheet
  (both the production shell route and the Vite dev server). The app's tokens
  are unlayered and the skin's re-declarations use equally-specific selectors,
  so plain source order decides and the skin wins — no `!important`, no
  selectors into app markup.
- Users switch modes as always (the Settings dropdown or the top-bar toggle
  stamp `data-theme` on `<html>`); the skin styles both, so the brand persists
  across every switch.
- **`defaultTheme`** (`light` | `dark`) is the mode users see before they
  pick — it applies on the login screen and after, and a later change to it
  reaches everyone who never chose. An explicit user choice always wins over
  it.
- **Precedence (later wins):** app tokens → skin → runtime environment
  background color (the per-engine chrome tint an admin sets under
  Settings → Server, plus its per-user override). A skin sets the deployment's
  look; the environment color distinguishes engines within it. Two rules keep
  the features composable:
  - Every unconfigured engine reports the **server default** color (OIE blue,
    `#2A75B2`) — a placeholder, not a chosen marker. The **optional**
    **`--env-default-color`** token decides what it means. Absent (stock
    declares nothing), the reported color tints as-is — the classic look. A
    skin declares it — usually `none`, so the skin's own chrome stands on
    server-default engines, or another color to tint them with. A
    **deliberately configured** engine color always tints, regardless of this
    token.
  - A tinting color derives its dark-mode surface tint from the **live
    tokens**, so it hue-shifts the skin's own palette rather than resurrecting
    the stock one.

**Cascade note:** a token declared only in a skin's `:root` block applies to
*both* modes (it out-orders the app's `[data-theme="light"]` re-declaration).
Declare a token in the skin's own `[data-theme="light"]` block when the two
modes need different values — see `--brand-login` in either example.

## Authoring a skin

1. Copy an example: `cp -r skins/portal-example skins/my-brand`.
2. Point the server at it (`"skin": "skins/my-brand"`) and restart. Confirm
   it's active: the served page's `<head>` links `/webadmin/skin/skin.css`
   (that URL should return your file).
3. Iterate: edit `skin.css`, reload the browser. Only *config* changes need a
   restart. Work the dark `:root` block and the `[data-theme="light"]` block in
   step — the top-bar toggle flips between them instantly.

## Token reference

Declared in `client/css/app.css` (`:root` block, light overrides in
`[data-theme="light"]`) — except `--env-default-color`, which stock leaves
undeclared on purpose. This set is the stable skinning surface: tokens may be
*added* over time, but renaming or removing one is treated as a breaking
change.

### Typography

| Token | Drives |
|---|---|
| `--font-ui` | All UI text |
| `--font-mono` | Data surfaces, code editors, message content |

### Surfaces & lines

| Token | Drives |
|---|---|
| `--bg0` | Page ground (deepest) |
| `--bg1` | View background |
| `--bg2` | Panels, cards, table bodies |
| `--bg3` | Raised elements — headers, hovers, inputs |
| `--line` | Default borders/dividers |
| `--line-strong` | Emphasized borders |

### Text

| Token | Drives |
|---|---|
| `--text` | Primary text |
| `--text-dim` | Secondary text (labels, captions) |
| `--text-faint` | Tertiary text (hints, disabled) |

### Accent (the brand color slot)

| Token | Drives |
|---|---|
| `--accent` | Primary buttons, links, active states, focus |
| `--accent-press` | Pressed/hover shade of `--accent` |
| `--accent-ink` | Text/icon color ON accent surfaces — keep the pair readable |
| `--accent-glow` | Accent at low alpha: selection washes, focus rings |

### Branding

| Token | Drives |
|---|---|
| `--brand-rail` | Expanded rail's banner image (`url(...)`) |
| `--brand-rail-h` | Its height (fitted with `contain`) |
| `--brand-login` | Login card's logo image — per-theme in the stock skin |
| `--brand-login-h` | Its height |
| `--brand-sub` | Login card's wordmark line (a CSS string, e.g. `'WEB ADMINISTRATOR'`) |

Brand art ships inside the skin directory, but must be referenced by
**absolute path** — `--brand-rail: url('/webadmin/skin/brand.svg')`. A
`url()` inside a custom property resolves where `var()` substitutes it (the
app's stylesheet), *not* against the skin file that declared it, so a relative
path would silently point into the app's assets. (This applies only to values
that travel through tokens — `@font-face src` in `skin.css` resolves against
the skin file as usual, so fonts may stay relative.) Mind contrast per
surface: the rail is dark in both stock modes, but the login card follows the
theme — both examples ship a light/dark art pair.

### Status & palette

| Token | Drives |
|---|---|
| `--ok` `--warn` `--err` `--idle` `--busy` | Channel/connection state pips, status bar, toasts |
| `--amber` `--red` `--blue` `--violet` | Statistics columns and chart accents |

Operators read channel state by these — recolor cautiously (contrast,
red/green conventions), or leave them stock as both examples do.

### Chrome (rail, top bar, status bar)

| Token | Drives |
|---|---|
| `--rail-bg` | Navigation rail background (color, gradient, or image) |
| `--rail-fg` / `--rail-fg-dim` | Rail text/icons, primary and dim |
| `--pane-bg` | Task-pane card background |
| `--topbar-fg` | Top bar text (top bar paints `--rail-bg` behind it) |
| `--statusbar-bg` | Status bar background |
| `--chrome-texture` | Overlay texture on rail+topbar (`none` to disable) |
| `--env-default-color` | *Optional.* What an engine's server-default background color means: absent, it tints as-is (the classic look); `none` lets this skin's chrome stand on unconfigured engines; a hex tints them with that instead (see the precedence rules above) |

### Geometry & depth

| Token | Drives |
|---|---|
| `--radius` | Corner rounding app-wide. Panel-scale surfaces use it directly; smaller controls use `min(<their size>, var(--radius))`, so lowering it (to `0` for a sharp look) sharpens everything, while raising it only grows the large surfaces |
| `--shadow` / `--elev` | Floating-layer and card elevation |
| `--grid-dot` | Dot-grid pattern on empty grounds |

Layout tokens (`--rail-w`, `--rail-w-icons`, `--topbar-h`, `--row-pad-y`, …)
also exist but are layout, not brand — the row-padding pair is user-set via the
table-density preference (`data-table-density` on `<html>`), so a skin should
leave it alone.

Also re-declare `color-scheme` only if you invert a theme's polarity — it tells
the browser how to paint the UI *it* owns (scrollbars, pickers, autofill).

## Fonts and assets

Files beside `skin.css` are served with it — reference them relatively:

```css
@font-face {
    font-family: 'PortalSans';
    src: url('portal-sans.woff2') format('woff2');
}
:root { --font-ui: 'PortalSans', system-ui, sans-serif; }
```

The CSP allows same-origin fonts/styles plus Google Fonts
(`fonts.googleapis.com` / `fonts.gstatic.com`); other third-party hosts are
blocked — self-host in the skin directory instead. Dotfiles in the skin
directory are never served, and there is no directory listing.

## What is not contract

- **Component classes** (`.btn`, `.panel`, `.dt`, …), DOM structure, and
  Tailwind utility names — internal, may change without notice. If a skin
  needs to select into markup, that's a missing token: open an issue.
- **The About dialog's logo** — that identifies the software itself, not the
  deployment, and deliberately stays.

## Per-engine branding

A skin is deployment-wide. Within a deployment:

- The **environment background color** (above) tints the chrome per engine at
  runtime — the lightweight way to tell prod from staging.
- A **plugin** can carry additional CSS (its client entry can inject a
  stylesheet), including an engine-served plugin — so in a hub deployment a
  particular engine can bring its own branding with it.
