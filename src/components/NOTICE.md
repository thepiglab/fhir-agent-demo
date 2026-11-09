# Third-party component sources

- `ui/` — shadcn/ui components (https://ui.shadcn.com), MIT License, copied with the shadcn CLI
  4.22.1 (new-york style) and adapted; `ui/trace.tsx` is shadcn's Trace (radix-nova registry).
- `ai-elements/` — AI Elements (https://registry.ai-sdk.dev, Vercel), Apache License 2.0, copied
  from the registry and modified: the `ai`, `streamdown`, `motion` and code-block dependencies
  were removed (plain text rendering, CSS shimmer, local types and a local controllable-state hook).
- The dot-matrix loader, run-activity row, chart card, data-table card view, score breakdown and
  confidence underlines in `src/chat/conversation/` are our own code, designed after assistant-ui
  elements (https://www.assistant-ui.com/components, MIT); no assistant-ui code is included.
