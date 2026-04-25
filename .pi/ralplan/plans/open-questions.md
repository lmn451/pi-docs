# Open Questions

## Document Injection Strategy - 2026-04-24
- [ ] Should keyword matching be exact word boundary or fuzzy/substring matching? — Affects false positive rate and overall usefulness
- [ ] Should docs be injected as a visible message in chat history or as a silent context modification? — UX difference: visible vs hidden context; visible helps user understand what the model knows
- [ ] Should the extension monitor model `<think>` thinking blocks, or only the final visible response? — Thinking blocks may surface early keywords worth catching, but may also generate noise
- [ ] What's the maximum number of docs that can be injected per turn? — Critical for context budget management
- [ ] Should the extension support glob patterns for docs path (e.g., `docs/**/*.md`)? — Flexibility for nested doc structures vs simpler flat-folder design
