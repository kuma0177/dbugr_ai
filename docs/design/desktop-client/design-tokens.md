# Desktop Design Tokens

These tokens translate the Dbugr design system into native macOS values. Use them for Swift/AppKit views, custom `CALayer` drawing, and any SwiftUI helper screens.

## Color

| Token | Hex | Native Use |
| --- | --- | --- |
| `desktop.canvas` | `#FBFAF9` | Warm app background for non-overlay screens |
| `desktop.surface` | `#FFFFFF` | Panels, popovers, cards, note panel |
| `desktop.surfaceSoft` | `#F8F7F4` | Secondary controls, empty states, subtle inset panels |
| `desktop.border` | `#F2F0ED` | Card borders and dividers |
| `desktop.text` | `#343433` | Main labels and body text |
| `desktop.textStrong` | `#121212` | High-emphasis labels |
| `desktop.textMuted` | `#848281` | Helper copy and metadata |
| `desktop.primaryBlue` | `#0090FF` | Primary desktop actions and active annotation strokes |
| `desktop.primaryBlueDark` | `#0077E5` | Pressed/hover primary actions |
| `desktop.primaryBlueSoft` | `rgba(0, 144, 255, 0.10)` | Selected segmented states and active cards |
| `desktop.toolbarNavy` | `#061B31` | Bottom annotation toolbar |
| `desktop.success` | `#00CA48` | Saved, synced, accepted |
| `desktop.warningOrange` | `#FF3E00` | Selection warning or active review emphasis only |
| `desktop.yellow` | `#FFBB26` | Needs-review accent |
| `desktop.danger` | `#FF2B3A` | Delete/error |
| `desktop.overlayDim` | `rgba(15, 23, 42, 0.42)` | Optional dimming behind annotation surfaces |

## Typography

Use native Apple text for the desktop client.

| Role | Font | Size | Weight | Line Height |
| --- | --- | --- | --- | --- |
| Large app title | SF Pro Display | 34 | Semibold | 40 |
| Panel title | SF Pro Display | 24 | Semibold | 30 |
| Section title | SF Pro Text | 17 | Semibold | 23 |
| Body | SF Pro Text | 15 | Regular | 22 |
| Compact body | SF Pro Text | 13 | Regular | 18 |
| Button | SF Pro Text | 15 | Semibold | 20 |
| Caption | SF Pro Text | 12 | Semibold | 16 |
| Metadata | SF Pro Text | 12 | Regular | 16 |

Do not use decorative display typography inside annotation, source picking, session chooser, note entry, or permission recovery surfaces. Those controls need to read like a real native Mac utility.

## Shape

| Component | Radius |
| --- | --- |
| Floating toolbar | 18 |
| Shortcut/status pill | 18 |
| Note panel | 24 |
| Source chooser panel | 28 |
| Session chooser modal | 24 |
| Buttons | 14 or full pill |
| Input fields | 12 |
| Tags/chips | 999 |
| Region handles | 999 |

## Elevation

Use shadows only for floating surfaces.

| Surface | Shadow |
| --- | --- |
| Toolbar | `0 14 32 rgba(6, 27, 49, 0.22)` |
| Note panel | `0 24 70 rgba(15, 23, 42, 0.16)` |
| Source/session modal | `0 24 70 rgba(15, 23, 42, 0.16)` |
| Normal cards | No drop shadow; use inset border |

## Spacing

Use a 4px base grid.

Common values:

- `8px`: chip gap, compact internal spacing.
- `12px`: button padding, toolbar gaps.
- `16px`: panel internal spacing.
- `24px`: card spacing.
- `32px`: large screen section spacing.

## Motion

Motion should be useful, not decorative.

- Overlay fade in: 120ms ease-out.
- Toolbar slide up: 140ms ease-out.
- Note panel scale/fade: 160ms ease-out.
- Region handle updates: immediate, no lag.
- Save confirmation: 140ms fade/slide.

Respect Reduce Motion.

