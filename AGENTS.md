# Project Guidelines

## Start Here

- Read [README.md](README.md) for product scope, engineering references, and known exclusions.
- Use [src/domain/scaffold.ts](src/domain/scaffold.ts) as the source of truth for scaffold geometry and materials.
- Use [src/domain/plan.ts](src/domain/plan.ts) as the source of truth for 2D scale and measured path geometry.

## Commands

- Install: `npm install`
- Develop: `npm run dev`
- Test: `npm test`
- Lint: `npm run lint`
- Production build: `npm run build`
- Android toolchain (one-off, ~600 MB into `.toolchain/`): `npm run android:setup`
- Build APK: `npm run apk` (debug) or `npm run apk:release`
- Before finishing code changes, run tests, lint, and build. For 3D changes, also inspect the WebGL canvas in a real browser at desktop and tablet/mobile sizes.

## Architecture

- `App.tsx` owns project state and computes one `ScaffoldLayout`; 2D, 3D, exports, and BOM must consume that result rather than recalculate independently.
- `ScaffoldMember` is a logical design member. `PipeSegment` is a physical fixed-stock pipe linked to a member by `memberId`. Never use one where the other is intended.
- Theoretical length comes from logical members; purchased stock and combinations come from physical pipe segments.
- Keep engineering calculations out of React components. Add or change rules in `src/domain/` and cover them with deterministic tests.

## Domain Invariants

- The 2D scale is `50 px/m`; keep `Point2D[]` and measured segment lengths synchronized through the helpers in `src/domain/plan.ts`.
- The scaffold has exactly two post rows. `deckSupportRailCount` adds longitudinal deck-support rails between them and must never add posts. Those rails only exist on lifts that actually carry a deck — they are 钢笆支承杆, so a deckless lift (including the 扫地杆 layer) gets only the two ordinary longitudinal rows at the post rows.
- The 扫地杆 (sweep-bar) layer sits at `sweepBarHeight` and is tagged `SWEEP_BAR_LAYER` (0), so it is never counted as a lift. It has ordinary transverse and longitudinal members, but no deck and therefore no deck-support rails. JGJ 130-2011 §6.3.2 caps the longitudinal sweep bar at 200 mm above the tube bottom, so anything above that raises a `sweep-bar-height` warning — the site-confirmed 300 mm is still produced, but never silently.
- One 槽钢 base beam is laid under each pair of posts, running in the same direction as the transverse members, and is reported as `channelSteel` (size / count / length per piece / total length / total mass) using the `CHANNEL_STEEL` constant (GB/T 706-2016 10#, 10 kg/m). It is not a `ScaffoldMember` and not a `PipeSegment` — it is bought by the piece, not cut from tube stock.
- Stock pipe lengths are the confirmed field set `0.8 / 1.2 / 2 / 2.4 / 3 / 4 / 4.5 / 6 m`. `spliceOverlap` defaults to **0**: a 对接扣件 butts two tube ends inside a sleeve, so consecutive segments meet end to end and each joint takes exactly **one** coupler. Setting `spliceOverlap >= 1` means a 搭接, which JGJ 130-2011 requires to be tied with 旋转扣件 (3 per longitudinal lap, at least 2 per post lap); that regime is **not** modelled and raises a `lap-not-modelled` warning rather than silently reporting 对接扣件.
- Connector names follow the site: 十字扣 (`cross`, right angle), 对接扣 (`butt`, end-to-end sleeve splice) and 转向扣 (`swivel`, any angle). Use `CONNECTOR_LABELS` from the domain rather than repeating the strings. 十字扣 is emitted at two per 主节点, which matches JGJ 130-2011 条文说明 §4.2.1. `connectorSummary.swivel` stays `null`/`--` because this model has neither laps nor braces.
- Wall ties are intentionally excluded. Braces are not calculated or rendered. Do not invent either rule without an explicit engineering specification.
- 扎丝, 小垫板, 支模板 and 剪刀撑 are listed through `PENDING_MATERIALS` with a `--` quantity because they are outside the calculation scope. Never emit a computed-looking number for them.
- Preserve the local-storage key `scaffold-project`, merge stored parameters with defaults, and keep the legacy `rowCount -> deckSupportRailCount` migration.

## Theming (monochrome neumorphic)

The UI is a neumorphic ("soft UI") theme in **white + black** — deliberately colourless — built on CSS custom properties in [src/index.css](src/index.css). The only chromatic values left in the app are the 3D member colours in `ScaffoldViewer.tsx`, which are a data encoding (立杆 / 纵向 / 横向), not decoration. The governing rule is **soft chrome, flat data**:

- Shadows belong to the CONTROL plane only — buttons, tabs, panels, toolbars, popovers. Raised = actionable, recessed = editable/container.
- The DATA plane stays **flat** with real hairlines and no `box-shadow`: material tables, numeric readouts, and both canvases. A neumorphic edge measures only ~1.14–1.45:1 against its own surface, so it can never tell a user where a field begins, which row they are on, or what is selected. Keep the shadow budget of a screen to roughly a handful of controls.
- Use the `--nm-*` tokens rather than literal colours: `--nm-e1..e4` (raised depth), `--nm-i1..i2` (inset), `--nm-edge` (1px inset ring). Keep `blur = 2 × offset`, spread 0, offsets equal and opposite.
- **Never paint the neumorphic plane `#ffffff`.** On pure white the highlight has no headroom (255 → 255), so the raised state becomes invisible and only a grey smudge remains. `--nm-surface` is a very light grey for exactly this reason.
- Functional colours were renamed when the theme went monochrome: `--accent` / `--accent-strong` / `--accent-soft` (were `--teal*`) and `--mark` (was `--orange`). The names are historical — do not reintroduce colour under them.
- **Every input and toggle needs `--nm-edge`**, never only a shadow, so it clears the 3:1 non-text contrast requirement.
- Keep the verified contrast floors against `--nm-surface`: `--ink` 15.6:1, `--muted` 5.3:1, `--accent` 15.5:1, `--nm-border` 3.9:1. Do not darken the surface or lighten these without re-checking.
- Focus visibility is a real colour, not a shadow: `3px solid var(--nm-focus)` at 18.4:1. The older `rgba(23,109,115,0.22)` ring measured 1.38:1 and failed WCAG 2.4.11 — do not restore it.
- Do not animate `box-shadow`; swap to a pseudo-element whose opacity changes if a press transition is needed.
- Print must stay flat black-on-white: the `@media print` block in [src/index.css](src/index.css) zeroes every shadow and background image, because the Android print framework renders through this same stylesheet.
- `color-scheme: light` plus `android:forceDarkAllowed="false"` in the manifest are required: WebView algorithmic darkening recomputes every shadow and inverts the light source.
- There is **no per-tab heading block**. The single 60px topbar carries the brand, the workflow tabs and the project actions; each tab's own toolbar is the panel's first row.

## 2D Canvas

The drawing surface is an **unbounded plane**, not a fixed view box:

- Pan and zoom are a pure VIEW transform (`view = {x, y, k}` in [PlanEditor.tsx](src/components/PlanEditor.tsx)). Model coordinates stay in plan pixels at `PIXELS_PER_METER`, so `measurePath`, `resizePathSegment` and every measured length are untouched by panning or zooming. Never bake a zoom factor into the stored `Point2D[]`.
- Never reintroduce coordinate clamping for nodes or added segments; the whole point is that geometry can sit anywhere.
- The SVG `viewBox` tracks the element's real pixel size (via `ResizeObserver`) so one user unit equals one CSS pixel, and the grid rect covers exactly the visible model area rather than a giant fixed rect.
- Grid and geometry strokes use `vector-effect: non-scaling-stroke`; node labels are counter-scaled by `1 / k`. Keep line weights and label sizes constant on screen at any zoom.
- The 1 m scale bar lives in screen space and multiplies by `k`, so it always reports the true on-screen length.
- Snapping still rounds to the absolute `GRID_SIZE` lattice in model space.

## 3D Rules

- Render `layout.pipeSegments`, `layout.decks`, and `layout.connectors`; do not render logical members as physical pipes.
- Data edits and layer visibility changes must not remount `CameraRig` or reset the user's camera. Only explicit reset/preset actions may change its key.
- Avoid coincident geometry: keep rendered pipe segments and connector positions unique, suppress overlapping corner members, and separate steel-deck lines from transparent surfaces to prevent Z-fighting.
- Keep the DPR cap and offline rendering behavior. Do not add remote HDR, texture, or model dependencies. drei's `<Environment preset>` fetches an HDR from a CDN — use the procedural `RoomEnvironment` + PMREM path already in `ScaffoldViewer.tsx` instead.
- Keep `gl={{ antialias: true }}`: three defaults `antialias` to `false`, so without it the scene renders with no MSAA at all. There is no `antialias` prop on `<Canvas>`; it must go through `gl` or it is silently dropped.
- Draw tubes at the true radius (`TUBE_RADIUS`, half of the domain's `pipeDiameter`). Oversizing them visually swallows the joint clearances the domain already emits. Keep the per-end axial insets so abutting segments read as separate parts, and never change geometry size to show selection — that re-uploads the geometry and makes the part jump. Selection is emissive.

## Android / Capacitor

The tablet build is a Capacitor WebView shell around the same web bundle, so the app must stay fully offline and every browser-only API must have a native path.

- Put anything the WebView cannot do in `src/platform/`, never inline in a component. `saveTextFile` (Filesystem + Share) and `printDocument` (local `NativePrint` plugin) are the existing examples.
- `window.print()` is a no-op in an Android WebView and an anchor `download` attribute is ignored for `blob:` URLs. Never reintroduce either; route through `src/platform/` instead.
- Capacitor's `WebChromeClient.onShowCustomView` cancels the DOM Fullscreen API, so `requestFullscreen()` never takes effect in the APK. Use `useCssFullscreen()` from `src/platform/fullscreen.ts`, which overlays with CSS.
- Android's back button belongs to the host, not the page. Keep `useAndroidBackButton` in `App.tsx`: exit fullscreen, then return to the first tab, then leave the app.
- Keep `base: './'` in [vite.config.ts](vite.config.ts); the bundle is loaded from a local scheme.
- The native plugin lives in `android/app/src/main/java/com/scaffoldfield/app/` and is registered in `MainActivity.onCreate` **before** `super.onCreate`.
- `.toolchain/` holds the JDK, Android SDK and Gradle caches. It is gitignored and must never be committed; `scripts/setup-android-toolchain.sh` recreates it.
- Keep the JDK/SDK versions in `scripts/setup-android-toolchain.sh` in step with `android/variables.gradle` (`compileSdkVersion` / `build-tools`).

### Device debugging over Wi-Fi

- Always run adb through `npm run adb -- <args>` (or `bash scripts/adb.sh`). adb keeps its keys in `$HOME/.android`, which this environment blocks, so the wrapper points `HOME` at `.toolchain/adb-home`. A bare `adb` fails with `Cannot mkdir '<home>/.android': Operation not permitted`.
- Android 11+ wireless debugging needs a **one-time pairing** before `adb connect`. On the tablet open 开发者选项 → 无线调试 → 「使用配对码配对设备」, read the pairing port with `npm run adb -- mdns services` (it advertises `_adb-tls-pairing._tcp` only while that dialog is open), then `npm run adb -- pair <ip>:<pairing-port> <code>`. After that `adb connect <ip>:<connect-port>` works and adb reconnects on its own via mDNS.
- The connect port advertises as `_adb-tls-connect._tcp`. If the handshake fails with `SSLV3_ALERT_CERTIFICATE_UNKNOWN`, the device is simply not paired yet — it is not a network or port problem.
- On Xiaomi HyperOS/MIUI both `adb install` and `pm install` fail with `INSTALL_FAILED_USER_RESTRICTED` unless 「USB 调试（安全设置）」 is enabled. To avoid depending on that setting, push the APK and open the installer on the device:
  `npm run adb -- push <apk> /sdcard/Download/` then
  `npm run adb -- shell am start -a android.intent.action.VIEW -d file:///sdcard/Download/<apk> -t application/vnd.android.package-archive`
- This machine has neither a connected device nor an emulator image, so on-device behaviour can only be checked when a tablet is actually paired.

## Validation

- Geometry, stock assembly, connector, or migration changes require updates to [src/domain/scaffold.test.ts](src/domain/scaffold.test.ts).
- 2D scale, snapping, or path-resize changes require updates to [src/domain/plan.test.ts](src/domain/plan.test.ts).
- For 3D changes, verify nonblank rendering, selection, independent layer visibility, camera persistence, fullscreen, and absence of overlap flicker.
- Treat all outputs as measurement and material estimates, never as structural verification or a construction plan.
