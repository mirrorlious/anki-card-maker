# MikiCardPackage v1

`MikiCardPackage v1` is the bounded handoff contract between this standalone professional card studio and Miki.

## Product boundary

- The card maker owns PDF/text extraction, OCR, batch generation, source location, review, and package export.
- Miki owns deck selection, final draft review, card persistence, study, and sync.
- The package never carries authentication, account identity, cookies, secrets, or tokens.
- Importing a package creates editable Intake drafts. It never writes cards automatically.

## Envelope

```json
{
  "format": "miki-card-package",
  "schemaVersion": 1,
  "packageId": "mcp_example",
  "createdAt": "2026-08-13T08:00:00.000Z",
  "title": "民法冲刺",
  "generator": { "id": "anki-card-maker", "version": "1.0.0" },
  "source": { "kind": "pdf", "fileName": "民法.pdf" },
  "cards": []
}
```

Each card contains an `id`, `type` (`qa`, `cloze`, or `choice`), plain-text `front`, plain-text `back`, bounded `tags`, and optional lightweight provenance (`chapter`, `page`, `quote`, `confidence`, `rects`).

## Limits and compatibility

- Maximum 500 approved cards per package.
- Front: 1,200 characters; back: 8,000 characters.
- Up to 12 tags and 12 source rectangles per card.
- Files use the `.miki-cards.json` suffix.
- Consumers must reject unsupported schema versions and invalid cards instead of guessing.
- Cross-site handoff uses exact-origin `postMessage`; file export remains the fallback.
