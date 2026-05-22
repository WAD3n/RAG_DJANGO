# Citation PDF Navigation Fix

**Date:** 2026-05-22  
**Status:** Approved

## Problem

Clicking "Open in PDF" in the sources panel always opens the PDF at page 1 instead of the page containing the cited passage.

## Root Cause

Three-layer bug:

1. `views.py` exports markdown with `page_break_placeholder="\f"` (form feed character).
2. `chunker.py` splits text with `text.splitlines()`. Python's `splitlines()` treats `\f` as a line separator and **consumes** it — the resulting strings never contain `\f`.
3. Therefore `"\f" in line` is always `False`, `current_page` never increments, and every chunk gets `page_no = 1`.
4. Frontend `openInPdf`: condition `pageNo > 1` is never true → always falls through to `#search=passage` fragment, which browsers do not support → PDF opens at page 1.

## Changes

### `backend/core/chunker.py`

Replace `splitlines()` with `split('\n')`.

```python
# Before
lines = text.splitlines()

# After
lines = text.split('\n')
```

`split('\n')` does not treat `\f` as a line separator. Lines containing `\f` are preserved, and the existing `"\f" in line` condition correctly increments `current_page` and skips the page-break line.

No other changes to chunker logic.

### `frontend/components/sources-panel.tsx`

Fix the `openInPdf` fragment condition.

```js
// Before
const fragment = pageNo && pageNo > 1
    ? `#page=${pageNo}`
    : `#search=${encodeURIComponent(passage.replace(/\s+/g, ' ').trim().slice(0, 120))}`;

// After
const fragment = pageNo != null ? `#page=${pageNo}` : '';
```

- Page 1 now correctly uses `#page=1`.
- `#search=` removed — not a standard PDF URL parameter; browsers ignore it.
- `#page=N` is supported by Chrome and Edge's native PDF viewer.

## Operational Note

After deploying the backend fix, all previously ingested documents must be re-ingested. Existing chunks in pgvector have `page_no = 1` throughout. Re-ingest overwrites them with correct per-page values.

## Out of Scope

- Firefox PDF viewer compatibility (PDF.js embedded viewer — future work).
- In-panel PDF viewer with text highlight (future work).
