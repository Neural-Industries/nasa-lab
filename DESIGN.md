---
name: NASA Lab
description: The live universe from NASA's open data, in the nasa.gov design language.
colors:
  space: "#000000"
  carbon: "#17171b"
  carbon-2: "#2e2e32"
  steel: "#58585b"
  red: "#d83933"
  red-bright: "#f64137"
  white: "#ffffff"
  text-2: "#b9b9bb"
  text-3: "#959599"
  status-ok: "#3fbf6a"
  status-warn: "#f2b33d"
  data-leo: "#8cdbff"
  data-meo: "#ffc75c"
  data-geo: "#db99ff"
  data-wildfire: "#ff7529"
typography:
  display:
    fontFamily: "Inter, Helvetica Neue, Arial, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Inter, Helvetica Neue, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Public Sans, Helvetica Neue, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "DM Mono, ui-monospace, Menlo, monospace"
    fontSize: "11px"
    fontWeight: 500
    letterSpacing: "0.3em"
  data:
    fontFamily: "DM Mono, ui-monospace, Menlo, monospace"
    fontSize: "11.5px"
    fontWeight: 400
    fontFeature: "'tnum'"
rounded:
  surface: "0px"
  button: "4px"
  pill: "999px"
spacing:
  gutter: "16px"
  gutter-mobile: "12px"
  panel-pad: "24px"
components:
  button-primary:
    backgroundColor: "{colors.red}"
    textColor: "{colors.white}"
    typography: "{typography.title}"
    rounded: "{rounded.button}"
    height: "38px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.red-bright}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.white}"
    rounded: "{rounded.button}"
    height: "38px"
    padding: "0 16px"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.text-2}"
    rounded: "{rounded.pill}"
    height: "30px"
    padding: "0 11px"
  chip-active:
    backgroundColor: "{colors.white}"
    textColor: "{colors.space}"
  surface:
    backgroundColor: "{colors.space}"
    textColor: "{colors.white}"
    rounded: "{rounded.surface}"
---

# Design System: NASA Lab

## Overview

The interface borrows the nasa.gov design language, which the owner pinned: black surfaces, confident Inter headlines, Public Sans body text, small DM Mono labels in wide-tracked capitals, and NASA red reserved for action and for "you are here". The 3-D scenes carry all the colour; the chrome stays black and white. Every datum is credited to its source and time.

It is a design language, not a brand: never use the NASA insignia ("meatball") or logotype. The wordmark is text, a red dot and "NASA **Lab**". An independent-project disclaimer lives in the Help sheet.

## Colors

- **Space `#000`** is the base of every surface. Floating surfaces use black at 84% with a 14 px backdrop blur, purely so text stays legible over the moving 3-D scene. They carry a hairline border of white at 12–20%.
- **Carbon** (`#17171b`, `#2e2e32`) is for hover fills, segmented controls and skeleton loaders.
- **Steel `#58585b`** is for input borders, slider tracks and scrollbars.
- **Text:** white for primary, `#b9b9bb` secondary, `#959599` for labels and captions.
- **Red:**
  - `#d83933` fills primary buttons.
  - `#f64137` is for the round arrow icon, the active-tab underline, the NOW marker, slider thumbs, the live dot and the active destination's distance dot.
  - The one red highlight in 3-D is the selected orbit trail and landing pins.
- **Status LEDs** on the Sources board use green, amber and red. This is the only place the UI uses other hues.

## Typography

- **Inter 700–800** for headlines and titles, tracked tight (−0.015 to −0.035em).
- **Public Sans** for body text.
- **DM Mono** in two roles:
  - wide-tracked uppercase labels (0.22–0.3em): section sub-labels, dt labels, kickers on the brand bar, tile badges;
  - tabular numerics for readouts, times and coordinates.
- Stats values are Inter 700 at 18 px with DM Mono units.

## Layout

- **Desktop:**
  - Brand bar top-left (352 px).
  - Detail panel full height on the right (392 px; 360 px under 1280).
  - Time bar along the bottom-left, up to the panel.
  - The destination rail (272 px) sits above the time bar.
  - The camera's view offset centres the subject in the unobstructed area.
- **Short screens:** below 820 px of height the brand bar drops its readouts; below 700 px the rail drops its distance tracks.
- **Mobile (≤ 860 px):**
  - The brand bar spans the top.
  - The panel is a 36 vh bottom sheet with a grip.
  - The time bar sits above the sheet.
  - The destinations become a swipeable strip of pill chips.
  - Framing distance scales with aspect (`engine.fit`).

## Elevation & Depth

Surfaces are flat black with a soft drop shadow (0 16px 40px −12px, black at 80%). Modal sheets sit on a 72% black scrim. There are no gradients on chrome; depth inside the scenes comes from light, atmosphere and bloom.

## Shapes

- **Corners:** surfaces are square (0 radius). Buttons, inputs and notes use 4 px. Chips, the rate segmented control, the play button and mobile destination chips are pills or circles.
- **Arrow:** the round red arrow is a 22 px circle, 18 px in the rail.
- **Lines:** hairlines divide lists and stats.

## Components

- **Primary button:** red fill, white Inter bold, 4 px radius. Hover is the brighter red.
- **Secondary button:** transparent with a 40% white outline. Hover fills white at 10%; active or pressed is solid white with black text.
- **Chip:** a pill with a steel outline. Hover whitens the outline; pressed is solid white with black text.
- **Tabs (Archive):** Inter 600, with a 3 px red underline on the selected tab.
- **Destination rail:**
  - Each row shows the keyboard key (mono), the name (Inter 700), the live distance (mono) and a round red arrow on hover or active.
  - A hairline track under each row carries a dot at the log-scaled distance from Earth (10⁵ km to 10¹⁴ km). The dot turns red when the row is active.
- **Time bar:** a circular play/pause button and a date in Inter bold. The scale has a red NOW line and a white cursor dot. The rate selector is a pill segmented control.
- **Stats grid, list rows, notes, error boxes:** see the tokens. Errors are tinted red with a red hairline.
- **Motion:** log-zoom camera arcs, an iris between destinations, and 0.4–0.6 s ease-out entrances. All of it respects `prefers-reduced-motion`.

## Do's and Don'ts

**Do:**
- Keep chrome black and white.
- Save red for action and the current position.
- Credit sources in mono labels.
- Label anything illustrative.

**Don't:**
- Use the NASA insignia or logotype.
- Use gradient text.
- Tint surfaces with colour.
- Put decorative glows on UI.
- Show fabricated numbers.
- Hide a failing feed: say so on the Sources board.
