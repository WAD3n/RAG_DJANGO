"""
Markdown-aware chunking for docling-converted documents.

Strategy:
  1. Split on headings (## / ###) — one section per logical block.
  2. If a section exceeds max_words, split further on blank-line paragraph
     boundaries.
  3. Merge orphan chunks (< min_words) with the previous one.
  4. Sliding overlap: each chunk gets a tail of the previous chunk prepended
     so context is not lost at boundaries.
"""

import logging
import re
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class Chunk:
    text: str
    heading: str       # nearest heading above the chunk
    chunk_index: int
    page_no: int = 1   # position within the document


def _clean(text: str) -> str:
    text = re.sub(r"<!--.*?-->", " ", text, flags=re.DOTALL)
    text = re.sub(r"!\[.*?\]\(.*?\)", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _word_count(text: str) -> int:
    return len(text.split())


def _split_paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\n+", text) if p.strip()]


def _heading_level(line: str) -> int:
    m = re.match(r"^(#{1,6})\s", line)
    return len(m.group(1)) if m else 0


def _is_toc_line(line: str) -> bool:
    return bool(re.match(r"^[.\s]{10,}$", line)) or bool(
        re.match(r".*\.{5,}\s*\d+\s*$", line)
    )


def chunk_markdown(
    text: str,
    max_words: int = 400,
    overlap_words: int = 40,
    min_words: int = 30,
) -> list[Chunk]:
    logger.debug("Chunking document — %d chars, max_words=%d", len(text), max_words)
    text = _clean(text)
    lines = text.splitlines()

    # Phase 1: split into sections at every heading; track --- page breaks from docling
    sections: list[tuple[str, list[str], int]] = []
    current_heading = ""
    current_lines: list[str] = []
    current_page = 1
    section_start_page = 1

    for line in lines:
        if line.strip() == "---" or "\f" in line:
            current_page += 1
            continue
        if _heading_level(line) in (2, 3) and len(line) < 120:
            if current_lines:
                sections.append((current_heading, current_lines, section_start_page))
            current_heading = re.sub(r"^#{1,6}\s+", "", line).strip()
            current_lines = []
            section_start_page = current_page
        elif not _is_toc_line(line):
            current_lines.append(line)

    if current_lines:
        sections.append((current_heading, current_lines, section_start_page))

    # Phase 2: split large sections by paragraphs
    raw_chunks: list[tuple[str, str, int]] = []

    for heading, sec_lines, page_no in sections:
        sec_text = "\n".join(sec_lines).strip()
        if not sec_text:
            continue
        if _word_count(sec_text) <= max_words:
            raw_chunks.append((heading, sec_text, page_no))
            continue
        paragraphs = _split_paragraphs(sec_text)
        buffer: list[str] = []
        buf_words = 0
        for para in paragraphs:
            pw = _word_count(para)
            if buf_words + pw > max_words and buffer:
                raw_chunks.append((heading, "\n\n".join(buffer), page_no))
                buffer = []
                buf_words = 0
            buffer.append(para)
            buf_words += pw
        if buffer:
            raw_chunks.append((heading, "\n\n".join(buffer), page_no))

    # Phase 3: merge orphans
    merged: list[tuple[str, str, int]] = []
    for heading, text_block, page_no in raw_chunks:
        if merged and _word_count(text_block) < min_words:
            prev_h, prev_t, prev_p = merged[-1]
            merged[-1] = (prev_h, prev_t + "\n\n" + text_block, prev_p)
        else:
            merged.append((heading, text_block, page_no))

    # Phase 4: sliding overlap
    chunks: list[Chunk] = []
    for i, (heading, text_block, page_no) in enumerate(merged):
        if i > 0 and overlap_words > 0:
            prev_words = merged[i - 1][1].split()
            tail = " ".join(prev_words[-overlap_words:])
            text_block = tail + "\n\n" + text_block
        chunks.append(Chunk(text=text_block, heading=heading, chunk_index=i, page_no=page_no))

    logger.debug("Chunking produced %d chunks from %d sections", len(chunks), len(sections))
    return chunks
