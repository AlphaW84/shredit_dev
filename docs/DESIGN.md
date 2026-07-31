# Shredit Design System

Status: canonical local design authority for the Shredit v1.1 interface.

Runtime tokens and component styling live only in `app/globals.css`. Shared product behavior and component markup live in `components/shredit-ui.tsx`; page composition lives in `components/home-page.tsx`, `components/note-page-client.tsx`, and `components/legal-page.tsx`. This document owns the visual thesis, token meanings, component contracts, state behavior, responsive rules, and verification requirements.

## Visual Direction

### Precision Split / Disposable Instrument

Shredit is presented as one focused instrument rather than a landing page. A layered graphite workspace contains two explicit responsibilities: the editor owns plaintext input and byte state, while the numbered control rail owns expiry, optional access protection, request readiness, and the irreversible primary action. The complete surface changes state as one object after creation, opening, consumption, or failure.

The direction is adapted from the official 21st.dev `Precision split` take selected by the project owner. Its useful idea is structural, not ornamental: large editor, fixed control rail, compact lifecycle bar, restrained borders, and status detail that never competes with the task. The dark theme uses lifted graphite surfaces without collapsing into black. The light theme translates the same depth hierarchy into cool paper neutrals rather than becoming a separate visual concept. Neither theme may resemble a fictional terminal, security dashboard, cyberpunk scene, or generic SaaS dashboard.

## Design Principles

1. **The workspace is the product.** The first screen opens directly on the composer, not marketing copy.
2. **One surface, two responsibilities.** Input and controls share one outer boundary and never become nested cards.
3. **Lifecycle is visible.** Compose, ready, open, removed, unavailable, loading, and error states reuse the same frame and information rhythm.
4. **Signals have strict ownership.** Orange is action, green is verified readiness, blue is keyboard focus, amber is caution, and red is failure or destruction.
5. **Technical detail stays quiet.** UTF-8 counts, labels, commit data, and status facts use compact mono typography without fake telemetry.
6. **Privacy claims remain bounded.** Qualified Tor language stays on the same surface; graphite styling never turns product limits into stronger claims.

## Anti-Principles

- No marketing/editorial side column, hero, feature-card stack, dashboard navigation, or detached SEO panel.
- No gradients, glow, blur wallpaper, decorative blobs, bokeh, fake IDs, telemetry, or command-line fiction.
- No remote fonts, Tailwind CDN, inline decorative SVG, copied 21st dependencies, or a second theme runtime.
- No nested cards. Internal groups use rules, spacing, and the existing outer workspace boundary.
- No false password copy. The optional password is an Argon2id server-side access gate; it is not the AES key and is transmitted only through the approved secure transport.
- No pill buttons. The password switch may use its familiar track geometry; commands and segments remain compact rectangles.

## Token Architecture

`app/globals.css` contains one base `:root` plus one semantic `[data-theme="light"]` override. Both themes share the same primitive, semantic, and component layers; component markup never forks by theme.

### Primitive Tokens

- Dark neutral scale: `--neutral-1000` through `--neutral-050`.
- Light paper scale: `--paper-000` through `--paper-950`.
- Action scale: `--orange-700` through `--orange-400`.
- Feedback scales: green, blue, red, and amber primitives.
- Type: system sans and system mono only.
- Spacing: `4 / 8 / 12 / 16 / 20 / 24 / 28 / 32 / 40 / 48px`.
- Shape: `0 / 2 / 4 / 6px`; the workspace uses `6px`, controls use `4px`.
- Motion: `120ms` feedback and `180ms` panel behavior, both removed for reduced motion.

### Semantic Tokens

Components consume semantic roles rather than raw colors:

| Role                | Tokens                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Canvas and surfaces | `--color-canvas`, `--color-surface`, `--color-surface-raised`, `--color-surface-inset`, `--color-overlay`  |
| Text                | `--color-text`, `--color-text-strong`, `--color-text-muted`, `--color-text-quiet`, `--color-text-disabled` |
| Structure           | `--color-border`, `--color-border-subtle`, `--color-border-strong`                                         |
| Action              | `--color-action`, `--color-action-hover`, `--color-action-active`, `--color-action-text`                   |
| Focus and selection | `--color-focus`, `--color-focus-text`, `--color-selection`                                                 |
| Feedback            | `--color-success*`, `--color-danger*`, `--color-warning*`                                                  |

### Component Tokens

- `--shell-max-width: 1400px`.
- `--workspace-rail-width: 380px`, reduced to `340px` on smaller desktop/tablet layouts.
- `--header-height: 58px`.
- `--control-height: 44px` and `--icon-button-size: 44px`.
- `--primary-height: 52px`.
- `--textarea-min-height-desktop: 300px` and `--textarea-min-height-mobile: 220px`.
- `--workspace-radius: 6px` and `--control-radius: 4px`.
- `--shadow-workspace` belongs only to the complete workspace; children do not create floating panels.
- `--theme-toggle-icon` maps the Sun/Moon glyph to the current theme without changing control geometry.

## Color And Surface Quality

The palette is neutral-first rather than hue-dominated. Dark mode uses lifted graphite; light mode uses cool paper, white, and mineral-gray levels. Both separate canvas, workspace, inset editor, raised controls, and hover states through restrained luminance steps. Strong control borders retain at least 3:1 non-text contrast against their adjacent surface. Orange appears only on the primary action, enabled password switch, selected lifecycle accent, and small brand mark. Green, blue, amber, and red have separate semantic jobs and may not become decoration.

Light mode keeps the orange CTA and dark action text from the accepted direction. Focus moves to the stronger blue primitive, while success, warning, and danger use darker feedback primitives against pale semantic surfaces. The workspace shadow is reduced to a neutral 12% elevation so the light interface stays instrument-like rather than card-heavy.

No raw runtime color literal may appear outside the token declaration block. No component may introduce an unexplained accent or local shadow. Status meaning always includes text or an icon.

## Typography

- Body and controls: `ui-sans-serif`, platform UI fallback, 12-16px depending on role.
- Technical metadata, editor, URLs, passwords, byte counts, indexes, and build data: platform monospace fallback.
- Workspace titles: 28px desktop and 24px mobile.
- Legal title: 38px desktop and 32px mobile.
- Labels: 10-11px mono with zero letter spacing.
- Note plaintext: 14-15px mono, `pre-wrap`, `overflow-wrap: anywhere`.

Font size never scales with viewport width. Letter spacing is always `0`. EN and zh-CN use the same semantic hierarchy; Chinese may fall back per glyph without nowrap assumptions.

## Spacing And Layout

The shell is capped at `1400px` and spans the viewport while reserving a stable scrollbar track, so a state transition cannot shift the centered frame horizontally. On wide screens the active workspace is `minmax(0, 1fr) + 380px`; the editor and rail meet at one structural rule. Compose and ready states share `max(500px, calc(100svh - 194px))`, a 44px lifecycle bar, a 42px privacy strip, and a standalone bottom action slot so the complete surface stays inside the required desktop and tablet viewports without document scrolling. The editor header, main plane, numbered rail sections, state feedback, and action form one continuous lifecycle object; ready-state commands occupy that same action slot rather than introducing a result-only panel.

Page sections are not wrapped in decorative cards. The workspace is a genuine framed tool. Share rows are value controls, notices are state feedback, and the language switch is a segmented control; none are nested presentation cards.

The header and footer remain compact. The footer identity and build metadata share one 44px desktop row with legal navigation, keeping the footer adjacent to the workspace. Legal routes use the same wide shell frame and desktop stage insets as the composer (`16px` above and `8px` below), plus the same workspace bar, border system, mono indexes, and surface hierarchy without imitating the composer grid. Inner copy keeps readable line lengths through its own content caps.

Note routes are lifecycle views inside this same shell, not alternate pages. `OpenNoteGate`, `NoteViewer`, and `UnavailableNoteState` all use the `task-panel lifecycle-panel` frame, the shared workspace bar, the same semantic surfaces, the privacy strip, and the same footer placement. Their inner content may be state-specific, but the outer panel width, border, radius, density, and responsive gutters must remain continuous with compose and result.

## Component Inventory

| Component                | Contract                                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ShreditShell`           | compact brand header, source action, theme switch, segmented locale control, stage ownership, build footer                                                       |
| `NoteComposer`           | one editor/control-rail workspace; owns plaintext, expiry, password gate, anti-abuse readiness, request preparation, and primary action                          |
| `ByteCounter`            | exact UTF-8 count with normal, near-limit, and over-limit states in stable meter geometry                                                                        |
| `ExpirySelect`           | five-option segmented radiogroup, 7-day default, arrow/Home/End keyboard control, compact visible labels and full accessible names                               |
| `PasswordControl`        | optional access-gate input with show/hide and browser-generated password controls; never described as the encryption key                                         |
| `CopyButton`             | fixed 44px target with copied/error icon and polite announcement                                                                                                 |
| `GeneratedPasswordField` | independent password visibility and copy controls; memory-only value                                                                                             |
| `CreateResult`           | same split workspace and density contract; share values stay on the main plane while lifecycle/caution data and commands stay in the rail's existing action slot |
| `OpenNoteGate`           | centered explicit-consume state in the same lifecycle frame; no GET or render consumption                                                                        |
| `NoteViewer`             | literal plaintext plane, removal status, and adjacent copy control                                                                                               |
| `UnavailableNoteState`   | one non-enumerating terminal state with one route back to creation                                                                                               |
| `LanguageMenu`           | direct EN/中文 segmented control; selected and keyboard states remain visible                                                                                    |
| `ThemeToggle`            | 44px Sun/Moon switch beside language; localized accessible name, checked state, tooltip, and cookie-backed persistence                                           |
| `TorLink`                | optional unframed Tor row with qualified limitation copy and external-link action                                                                                |
| `BuildInfoFooter`        | license, legal routes, optional onion/source links, and safe commit link; qualified Tor limits stay beside product privacy claims                                |
| `LegalPage`              | graphite document surface with workspace bar and numbered content sections                                                                                       |

## States And Interaction

- **Default and hover:** borders and neutral surface luminance change without layout shift.
- **Selected:** expiry and locale segments use a raised neutral surface plus readable text; password switch uses orange only when enabled.
- **Theme:** the switch changes only semantic tokens, writes the first-party `shredit-theme` preference, and preserves layout and component state.
- **Focus-visible:** every interactive element has a 2px blue outline with an offset. Compound password fields move focus treatment to their owning boundary.
- **Disabled:** geometry remains stable and readable; opacity is not used as the only treatment.
- **Loading:** request labels and spinner occupy existing feedback/action geometry.
- **Validation/error:** red boundary and text appear together; input values and prepared requests are retained where the protocol requires.
- **Success:** green readiness dot/check plus text; never green alone.
- **Warning:** amber rule, icon, and explicit irreversible-action copy.
- **Empty:** the editor remains the dominant first-screen input; primary action is visibly unavailable without disappearing.
- **Clipboard failure:** values remain selectable and the localized fallback remains visible.

## Responsive

Required QA viewports are `1440x900`, `1024x768`, `390x844`, and `320x700`, in EN and zh-CN.

| Range        | Composition                                                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Above 1120px | `1fr + 380px` workspace, compact 44px lifecycle bar, viewport-aware editor, numbered rail                                                                                        |
| 901-1120px   | `1fr + 340px`, compact vertical rhythm, unchanged 44px interaction dimensions                                                                                                    |
| 641-900px    | editor above a two-column rail; status, feedback, and primary action span the full width                                                                                         |
| 361-640px    | edge-to-edge workspace; 64px mobile header; composer uses expiry, access, feedback, CTA, then status; ready uses summary, caution, then the same CTA slot; 220px editor baseline |
| 320-360px    | same task-first rail order, 12px gutters, 64px header, 142px editor baseline, no horizontal overflow                                                                             |

Long URLs, passwords, Chinese labels, 64 KiB plaintext, errors, and policy states wrap inside their owning tracks. Build commit identifiers render as a compact 12-character label while the exact validated hash remains in the link URL, tooltip, and localized accessible name. Dynamic labels and icons do not resize controls. The initial primary action remains reachable in the first viewport across the required matrix.

On mobile, the language control retains two 44px targets while the header provides visible space above and below the segmented frame. EN and 中文 use the system sans at 14px/medium so the short labels do not look undersized inside their touch targets. The adjacent theme switch remains 44px and the complete preference cluster fits at 320px without wrapping.

## Motion

Motion is limited to request-state rotation, color/border feedback, and a 1px pressed response. There are no entrance sequences, background animation, parallax, or smooth-scroll dependency. `prefers-reduced-motion: reduce` removes transitions and animation while preserving state text and geometry.

## Accessibility

- Semantic forms, labels, textarea/input/button elements, segmented radiogroup semantics, `aria-invalid`, descriptions, alerts, and live regions remain mandatory.
- All icon buttons are 44px square. Primary and text controls keep at least a 44px target.
- The theme control uses `role="switch"`, `aria-checked`, a stable localized name, a command tooltip, and a familiar Lucide Sun/Moon glyph.
- Expiry supports ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Home, and End; locale buttons work through normal keyboard order.
- Focus is visible against canvas, workspace, inset fields, and the orange action.
- The skip link pairs `--color-focus` with theme-specific `--color-focus-text` so its compact label remains AA-readable in both themes.
- Normal text and important control states target WCAG AA contrast.
- Meaning never depends on color alone.
- Literal note content remains selectable, preserves whitespace, and never renders HTML or Markdown.

## Governance And Ownership

- `app/globals.css` is the only runtime token/style authority. Dark is the deterministic default; light overrides semantic roles through `html[data-theme="light"]`. Do not append a second theme runtime or component-local palette.
- `ThemeProvider` owns client theme state. `getRequestTheme` validates the first-party cookie before reflecting it into server-rendered `data-theme`, preventing both an initial flash and arbitrary theme attributes without inline scripts or CSP changes.
- `docs/DESIGN.md` must change whenever token meaning, component anatomy, responsive order, or state behavior changes.
- `components/shredit-ui.tsx` owns reusable product components and protocol-sensitive client behavior; page files own composition only.
- New values must map to a primitive, semantic role, and justified component contract.
- API routes, browser crypto, database, anti-abuse, copy boundaries, public claims, routes, and locales remain governed by `SHREDIT_PROJECT_SPEC.md`.
- The selected 21st structure is evidence. Local tokens, accessible behavior, and current component APIs are the system of record.

## 21st.dev Evidence

The selected direction is the official 21st AI take named `Precision split`, preserved at:

- `_codex/design/21st/a-plus-take-1.html`
- `_codex/design/21st/a-plus-take-1-desktop.png`
- `_codex/design/21st/a-plus-take-1-mobile.png`

The project owner selected the same take from an open 21st.dev tab in the `DE-Work` browser workspace. The current implementation adapts the editor/control-rail composition, lifecycle bars, numbered controls, lifted neutral graphite palette, orange action, green readiness dot, segmented expiry, and compact footer.

Rejected prototype details include Tailwind CDN, inline SVG icons, gradient hairlines, rounded-card excess, demo-only preview actions, false passphrase claims, and mock note state. Production uses local CSS tokens, Lucide, existing Shredit logic, exact EN/zh-CN copy, and the real Argon2id/password protocol.

The official 21st MCP tools were exposed during the light-theme extension, but the project proxy preflight could not prove the explicit HTTP proxy agent required for the MCP transport. No new remote request is claimed. The implementation reuses the already successful official 21st artifact and extends its local semantic token model without an undocumented endpoint or another design system.

## Verification And Evidence

Every material design change requires:

1. Prettier, project lint, TypeScript, Vitest, and clean standalone Next.js build.
2. `check-design-system.mjs <project-root> --strict` with one token authority, no conflicting root aliases, and no raw runtime colors outside token declarations.
3. External Playwright in fresh isolated contexts with the analytics request denylist installed before navigation.
4. Full-page QA at `1440x900`, `1024x768`, `390x844`, and `320x700` in EN and zh-CN.
5. Compose-to-ready continuity checks compare the shared header, stage, panel, split, bar, privacy strip, and footer geometry within 1px; desktop/tablet states have no vertical overflow and narrow states have no horizontal overflow.
6. Overflow, overlap, first-screen action, focus order, visible focus, CTA contrast/padding, long content, clipboard denial, loading, error, create result, gate, viewer, and unavailable checks.
7. Evidence under `/_codex/evidence/`; the folder remains local-only and is never committed or deployed.
8. Note-route continuity covers unavailable, gate-ready, and consumed viewer states in EN and zh-CN at `1440x900`, `1024x768`, `390x844`, and `320x700`; the outer lifecycle frame, privacy strip, overflow behavior, and browser diagnostics are recorded in `/_codex/evidence/precision-split/note-route-qa/`.

Production deployment remains a separate explicit authorization.
