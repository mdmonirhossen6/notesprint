# Website PDF feature audit (Phase 4 input)

Source: the Next.js app in the repository root. Audit date: 2026-11-07.

## Architecture finding

The website does **all PDF work in the browser**:

- `src/lib/pdfProcessing.ts` loads a PDF with `pdfjs-dist`, renders each page to a
  `<canvas>`, and keeps a JPEG thumbnail data URL.
- `src/lib/pdfExport.ts` re-renders every selected page at higher resolution, applies
  pixel filters on a canvas, converts the result to JPEG, embeds it in a new `pdf-lib`
  document, and lays out cells for N-up output.
- `src/components/wizard/Step4Enhance.tsx` uses the same canvas filter function for live
  preview.
- `src/components/wizard/Step6Processing.tsx` generates the final Blob, then also
  auto-uploads it to the Supabase `pdfs` bucket.

Consequences:

1. None of the processing can run in Node as-is: `document`, `Image`,
   `HTMLCanvasElement`, `canvas.toDataURL`, and browser `File`/`Blob` are required.
2. The website output is always rasterized, even with no filters and 1-up layout.
   Vector text becomes an image.
3. The website has no OCR and no true "AI" enhancement. Filters are pixel thresholds.
4. The tools grid is navigational only: every card links to `/process`.

## Feature inventory

| # | Feature | Implementation | Actually works? | Reusable code? | Server-side migration |
|---|---|---|---|---|---|
| 1 | Multi-file upload | `Step1Upload.tsx`, `usePDFStore.addFiles` | Yes | Store pattern only | New Telegram session; download each file with the existing intake |
| 2 | File reorder | `Step2Reorder.tsx`, `reorderFiles` | Yes (files only, not pages) | Logic idea only | Order by Telegram message ID, or accept an explicit order |
| 3 | "Merge" output | `Step2` + `Step6` + `pdfExport.generateFinalPDF` | Yes, but implicit: all pages are rasterized into one PDF | No (browser canvas) | **Implemented in the bot with `pdf-lib.copyPages` — vector, no rasterization** |
| 4 | Page thumbnails | `pdfProcessing.extractPDFPages` | Yes | No | Not needed for the bot flow |
| 5 | Page selection (keep/remove) | `Step3Preview.tsx` | Yes | Selection concept | Future: page-range parser + `copyPages` |
| 6 | Page reorder | None. Page order always follows file order then page number | No page-level reorder | — | Future: explicit index list |
| 7 | Split PDF / extract pages | None | No such tool | — | Future: `copyPages` per range |
| 8 | Rotate pages | None | No such tool | — | Future: `page.setRotation` |
| 9 | Grayscale | `imageFilters.ts` (Rec.601 weights) | Yes, in browser | Filter math only | Needs rasterization (`pdfjs-dist` + Node canvas/sharp); heavy on Render Free |
| 10 | Black & White | `imageFilters.ts`, fixed threshold 128 | Yes, in browser; **no threshold UI** | Threshold math only | Rasterization + a user-selectable threshold |
| 11 | Invert colors | `imageFilters.ts` | Yes | Math only | Rasterization |
| 12 | Clear background | `imageFilters.ts`, fixed threshold 200 | Yes (simple near-white clamp) | Math only | Rasterization; threshold must be exposed |
| 13 | Remove logo / crop | `Step4Enhance.tsx` disabled control | **No** (UI is dimmed and non-interactive) | No | Not a real feature; do not expose |
| 14 | N-up / multiple slides | `pdfExport.ts` layout loop; `Step5Layout.tsx` rows/cols 1-4 | Yes, browser-rendered | Layout math concept | Feasible vector-side with `pdf-lib.embedPage`; raster needed only with filters |
| 15 | Paper size | `pdfExport.ts` (`a3`, `a4`, `a5`, `letter`, `legal`, `original`) | Yes for N-up output | Size table | Reuse the same point sizes |
| 16 | Orientation | `pdfExport.ts` + `Step5Layout.tsx` | Only when a fixed paper size is selected | Logic | Reuse; portrait/landscape swaps width/height |
| 17 | Output quality (low/medium/high) | `pdfExport.ts` scale 1.0/1.8/2.5, JPEG 0.6/0.8/0.92 | Yes | Mapping only | Only meaningful for raster filters; not for vector merge |
| 18 | Separation lines | `pdfExport.ts` draws grey lines | Yes | Drawing code idea | Optional layout feature |
| 19 | Page numbers | `pdfExport.ts` draws Helvetica text | Yes | Drawing code idea | Optional layout feature |
| 20 | Live filter preview | `Step4Enhance.tsx` | Yes | No | Not applicable to Telegram |
| 21 | Quick tools grid | `src/app/page.tsx`, `src/app/tools/page.tsx` | Navigation only; all cards open `/process` | No | Menu entries only for tested operations |
| 22 | Settings defaults | `useSettingsStore.ts`, `settings/page.tsx` | Yes, persisted in localStorage | Defaults idea | Bot uses env/config; no persistence |
| 23 | Clear cached files | `settings/page.tsx` deletes IndexedDB databases | Yes, but the app stores no PDF data there | No | Not applicable |
| 24 | Supabase auto-upload of results | `Step6Processing.tsx`, `lib/supabase.ts` | Runs after export | **Must not migrate** | Violates the stateless, no-external-storage requirement |
| 25 | OCR / handwriting cleanup | None | **No** | — | Do not claim it |

## Notes that affect the migration

- The UI claim "all processing happens in your browser, no files are uploaded" conflicts
  with the Supabase upload in Step 6. The Telegram bot will not reproduce that upload.
- N-up and page selection can be vector operations with `pdf-lib`; filters cannot. A
  filter feature needs a rasterization dependency and a strict page cap on Render Free
  (512 MB RAM, 0.1 CPU). It must be benchmarked before being exposed.
- The website has no split, rotate, or standalone page-reorder workflow. Those would be
  new server-side implementations, not migrations.

## Phase 4 progress tracker

| Operation | Status |
|---|---|
| Merge PDF | Implemented and tested with `pdf-lib` (order-preserving, vector) |
| Process PDF (validate/re-save) | Already live |
| Split, page selection, reorder, rotate | Not started |
| Grayscale, Black & White, filters | Not started (needs rasterization benchmark) |
| N-up, paper size, orientation | Not started (vector approach planned) |
| Enhance | Not started; website has no real enhancement beyond filters |
