---
paths:
  - "src/app/**"
  - "src/components/**"
  - "src/hooks/**"
  - "src/stores/**"
  - "src/styles/**"
  - "public/**"
---

# Frontend and UI rules

- Owners: `frontend-engineer` (pages, feature components, client state, data wiring) and `ux-ui-designer` (tokens, `src/components/ui`, visual and layout quality, `ui.md`).
- Server Components by default; `'use client'` only on interactive leaves. Client files never import `@/server/*` or `server-only` modules and only read `NEXT_PUBLIC_` variables.
- Data in: DAL calls in Server Components. Data out: Server Actions with `useActionState`, `useFormStatus`, `useOptimistic`.
- Each data route segment has `loading.tsx` or Suspense boundaries and an `error.tsx`; add `not-found.tsx` for missing resources.
- Use design tokens and shadcn/ui primitives; no hardcoded colors or spacing. Support dark mode.
- Accessibility: semantic elements, labelled controls, visible focus, keyboard paths, WCAG 2.2 AA contrast, `prefers-reduced-motion`.
- Performance: avoid request waterfalls, keep client bundles small, `next/image` and `next/font`, dynamic import for heavy client-only widgets. React Compiler is enabled; do not add `useMemo`/`useCallback` without a measured reason.
- Verify at runtime with `pnpm dev`, the next-devtools MCP and the Playwright MCP before handing off.
