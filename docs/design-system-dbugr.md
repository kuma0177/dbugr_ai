# Dbugr Design System

This document is the canonical visual reference for Dbugr product design. Use it when creating or changing desktop, web, onboarding, collaboration, feed, review, and submission experiences.

## Direction

Warm, tactile, and playful, but still clear enough for a developer workflow. Dbugr should feel like a calm annotation and collaboration workspace with a soft editorial surface, vivid accent moments, and precise UI structure.

The source reference describes a warm off-white canvas, flat illustration vocabulary, grounded typography, inset warm-stone borders, and pill-shaped actions. For Dbugr, apply those rules with restraint inside product screens: keep operational flows quiet and scannable, while using the warmer brand language for onboarding, empty states, public/team feed surfaces, and confirmation moments.

## Core Tokens

| Name | Value | Token | Role |
| --- | --- | --- | --- |
| Warm Canvas | `#fbfaf9` | `--color-warm-canvas` | App/page background and light navigation surfaces |
| Stone Surface | `#f2f0ed` | `--color-stone-surface` | Inset borders, subtle dividers, secondary button background |
| Parchment Card | `#f8f7f4` | `--color-parchment-card` | Recessed panels and screenshot containers |
| Graphite | `#474645` | `--color-graphite` | Body text and dominant UI copy |
| Charcoal Primary | `#343433` | `--color-charcoal-primary` | Headings, compact titles, strong labels |
| Midnight | `#121212` | `--color-midnight` | High-contrast text and rare dark surfaces |
| Ash | `#848281` | `--color-ash` | Muted labels and secondary metadata |
| Fog | `#c6c6c6` | `--color-fog` | Inactive borders and dividers |
| Smoke | `#a7a7a7` | `--color-smoke` | Disabled states and placeholders |
| Ember Orange | `#ff3e00` | `--color-ember-orange` | Text-link accent and illustration highlight |
| Meadow Green | `#00ca48` | `--color-meadow-green` | Success, valid, accepted, confirmation accent |
| Sky Blue | `#0090ff` | `--color-sky-blue` | Brand blue and primary action family |
| Ocean Blue | `#0086fc` | `--color-ocean-blue` | Primary app CTA and link blue |
| Sunburst Yellow | `#ffbb26` | `--color-sunburst-yellow` | Illustration accent and warm highlight |
| Coral Red | `#ff2b3a` | `--color-coral-red` | Destructive/error accent |

## Typography

Use a display typeface only for hero-scale or section-scale moments. Do not use display typography inside dense app panels, sidebars, submit panels, session lists, or toolbars.

Recommended display substitutes:

- `Fraunces`
- `Playfair Display`

Recommended UI stack:

- `Inter`
- system UI fallback when Inter is unavailable

Type scale:

| Role | Size | Line height | Use |
| --- | --- | --- | --- |
| Caption | `12px` | `1.58` | Metadata, helper copy, timestamps |
| Body | `15px` | `1.47` | Main product copy |
| Heading Small | `19px` | `1.38` | Compact panel headings |
| Heading | `23px` | `1.2` | Page/panel titles |
| Heading Large | `44px` | `1.09` | Marketing or onboarding section headings |
| Display | `68px` | `1.09` | Rare hero moments only |

Implementation note: the source reference uses tight negative letter spacing. In Dbugr product UI, keep letter spacing subtle and avoid aggressive tracking in compact controls, because the desktop app needs to stay legible at small sizes.

## Surfaces

| Level | Name | Value | Purpose |
| --- | --- | --- | --- |
| 1 | Canvas | `#fbfaf9` | Warm app/page background |
| 2 | Card Surface | `#ffffff` | White card faces with inset stone border |
| 3 | Recessed Panel | `#f8f7f4` | Screenshot/demo/review containers |
| 4 | Stone Tint | `#f2f0ed` | Secondary buttons, hover states, dividers |
| 5 | Dark Shell | `#000000` | Rare product showcase or focused tool surface |

Cards should use a warm inset border style rather than heavy drop shadows:

```css
box-shadow: inset 0 0 0 1px #f2f0ed;
```

Use hover elevation sparingly:

```css
box-shadow:
  rgba(0, 0, 0, 0.04) 0 1px 6px 0,
  rgba(0, 0, 0, 0.05) 0 0 24px 0;
```

## Shapes And Spacing

- Base spacing unit: `4px`
- Typical gaps: `8px`, `12px`, `16px`, `24px`, `32px`
- Inputs: `10px` radius
- Cards: `10px` radius
- Large cards/panels: `24px` radius only where the layout has enough room
- Pill buttons: `32px` radius
- Tags: `6px` radius

Product screens should avoid oversized marketing spacing. Use the generous spacing language for onboarding, empty states, and web pages; keep dense workflows compact and scan-friendly.

## Components

### Primary CTA

Use `#0086fc` / `--color-ocean-blue` for Dbugr app primary actions.

```css
background: #0086fc;
color: #ffffff;
border-radius: 32px;
font-size: 14px;
font-weight: 500;
```

### Secondary CTA

```css
background: #f6f4ef;
color: #121212;
border-radius: 32px;
box-shadow: inset 0 0 0 1px #f2f0ed;
```

### Destructive Action

Use red as an accent, not a flood fill.

```css
background: #fdf1ef;
color: #ff2b3a;
box-shadow: inset 0 0 0 1px rgba(255, 43, 58, 0.14);
```

### Success / Accepted State

Use green as an accent, not heavy green text everywhere.

```css
background: rgba(0, 202, 72, 0.08);
color: #343433;
box-shadow: inset 0 0 0 1px rgba(0, 202, 72, 0.2);
```

### Feed Cards

For internal review and public feed cards:

- white surface
- inset stone border
- 10px radius
- compact avatar/name/time row
- screenshot thumbnail
- annotation/comment counters
- clear visibility badge: `Private`, `Team`, `Public`

### Review And Curation

Curation decisions should map to brand accents:

- Accepted: meadow green accent
- Rejected: coral red accent
- Needs clarification: sunburst yellow accent
- Owner/system generated: ocean blue accent

## Illustration

Use flat, playful illustration only where it helps the product breathe:

- onboarding
- empty states
- public/community pages
- confirmation moments
- docs or marketing surfaces

Do not put decorative illustration inside dense annotation, session, submit, or review controls unless it is directly helpful.

Illustration palette:

- Ember Orange: `#ff3e00`
- Meadow Green: `#00ca48`
- Sky Blue: `#0090ff`
- Sunburst Yellow: `#ffbb26`
- Flamingo: `#ff58ae`

## Do

- Use `#fbfaf9` as the warm canvas.
- Use `#0086fc` for Dbugr primary app CTAs.
- Use inset warm-stone borders on white cards.
- Keep product screens quiet, scannable, and operational.
- Use pill buttons for primary and secondary actions.
- Use green/red/yellow as accents, not dominant fills.
- Use public/team/private visibility badges consistently.
- Keep comments, annotations, and curation decisions visually distinct.

## Don't

- Do not use pure white as the page/app background.
- Do not use heavy drop shadows on normal cards.
- Do not overuse orange in app chrome.
- Do not use bold red or bold green text for every status.
- Do not use display typography inside compact panels.
- Do not make dense workflow screens feel like marketing pages.
- Do not create multiple unrelated button systems.

## Agent Guidance

When future Codex sessions change Dbugr UI:

1. Check this file first.
2. Preserve the current product surface if it already follows these rules.
3. Use `#0086fc` for primary app actions unless the user explicitly asks otherwise.
4. Keep desktop app screens compact and calm.
5. Use the warmer illustrative style mostly in web, onboarding, feed, and confirmation surfaces.
6. Avoid introducing a new design language without updating this document.
