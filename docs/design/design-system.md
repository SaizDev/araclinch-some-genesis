# Design system

Owner: ux-ui-designer. The single reference for visual language and UI primitives. Tokens live in `src/app/globals.css` (Tailwind CSS v4 `@theme` and CSS variables); primitives live in `src/components/ui` (shadcn/ui).

## Principles
- Clarity first: one primary action per view, obvious hierarchy, generous whitespace.
- Accessible by default: WCAG 2.2 AA, keyboard complete, visible focus, reduced motion respected.
- Consistent: only tokens and primitives; no one-off colors, radii or spacing.
- Honest states: every screen designs loading, empty, error and permission states.

## Tokens
| Group | Tokens | Notes |
|---|---|---|
| Color | `--background`, `--foreground`, `--primary`, `--primary-foreground`, `--muted`, `--accent`, `--destructive`, `--border`, `--ring` | Light and dark values; contrast checked |
| Typography | font families via `next/font`; scale xs to 4xl | Body 16px minimum on mobile |
| Spacing | Tailwind 4px scale | Layout gutters 16px mobile, 24px tablet, 32px desktop |
| Radius | `--radius` and derived sizes | |
| Motion | 150 to 250 ms, ease-out | Disabled with `prefers-reduced-motion` |

The foundation spec (000) sets the initial values; update this table when tokens change.

## Primitives
Record each primitive added under `src/components/ui`: name, variants, accessibility notes, usage guidance.

| Component | Variants | Accessibility | Notes |
|---|---|---|---|

## Patterns
- Forms: label above field, helper text, inline errors after submit, disabled submit while pending.
- Feedback: toasts for background success, inline messages for errors related to a field or section.
- Tables and lists: empty state with a primary action, skeleton rows while loading, pagination over infinite scroll for data that users compare.
