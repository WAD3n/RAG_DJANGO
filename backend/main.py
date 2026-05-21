#!/usr/bin/env python
"""CLI entry point — document conversion and RAG pipeline."""

import asyncio
import logging
import sys
from pathlib import Path

import typer

# Add backend/ to sys.path so core.* packages are importable
sys.path.insert(0, str(Path(__file__).parent))

from core.config import Settings
from core.converter import build_document_converter
from core.llm import VLLMClient
from core.local_llm import LocalLLMClient
from core.vectorstore import VectorStore

logging.basicConfig(
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

app = typer.Typer(name="ragdocs", help="Document conversion and RAG pipeline.")
settings = Settings()


@app.command()
def convert(
    input_path: Path = typer.Argument(..., exists=True, help="Document to convert (PDF, DOCX, …)"),
    query: str = typer.Option(None, "--query", "-q", help="Ask the LLM a question about the document"),
    output: Path = typer.Option(None, "--output", "-o", help="Output path (default: <stem>.md in current dir)"),
) -> None:
    """Convert a document to markdown, optionally querying the LLM about its content."""
    logger.info("Converting %s", input_path)
    converter = build_document_converter(settings)
    result = converter.convert(str(input_path))
    markdown = result.document.export_to_markdown()

    out = output or Path(f"{input_path.stem}.md")
    out.write_text(markdown, encoding="utf-8")
    logger.info("Saved to %s", out)
    typer.echo(f"Saved: {out}")

    if query:
        asyncio.run(_run_query_direct(markdown, query))


@app.command()
def ingest(
    path: Path = typer.Argument(..., help="Markdown file or directory of .md files to index"),
    show_stats: bool = typer.Option(False, "--stats", help="Print vector store stats after ingestion"),
) -> None:
    """Chunk and embed markdown documents into the vector store."""
    md_files: list[Path] = []
    if path.is_dir():
        md_files = sorted(path.glob("*.md"))
        if not md_files:
            typer.echo(f"No .md files found in {path}", err=True)
            raise typer.Exit(1)
    elif path.suffix == ".md":
        md_files = [path]
    else:
        typer.echo("Path must be a .md file or directory containing .md files.", err=True)
        raise typer.Exit(1)

    store = VectorStore(settings)
    total = 0
    for md in md_files:
        logger.info("Ingesting %s", md.name)
        typer.echo(f"Indexing {md.name}…")
        n = store.ingest(md)
        typer.echo(f"  >> {n} chunks")
        total += n

    logger.info("Ingest complete — total_chunks=%d", total)
    typer.echo(f"\nDone. Total chunks ingested: {total}")

    if show_stats:
        _print_stats(store)


@app.command()
def query(
    question: str = typer.Argument(..., help="Question to ask about the indexed documents"),
    n: int = typer.Option(None, "--top", "-n", help="Number of chunks to retrieve"),
    show_context: bool = typer.Option(False, "--show-context", help="Print retrieved chunks before the answer"),
) -> None:
    """Retrieve relevant chunks from the vector store and answer with the LLM."""
    logger.info("Query: %r", question[:80])
    store = VectorStore(settings)

    if store.stats()["total_chunks"] == 0:
        typer.echo("Vector store is empty. Run 'ingest' first.", err=True)
        raise typer.Exit(1)

    hits = store.search(question, n=n)

    if show_context:
        typer.echo("\n--- Retrieved context ---")
        for i, h in enumerate(hits, 1):
            typer.echo(f"\n[{i}] {h['source']} / {h['heading']}  (score={h['score']})")
            typer.echo(h["text"][:300] + ("…" if len(h["text"]) > 300 else ""))
        typer.echo("\n--- Answer ---")

    context = "\n\n---\n\n".join(
        f"[{h['source']} / {h['heading']}]\n{h['text']}" for h in hits
    )
    asyncio.run(_run_query_rag(context, question))


@app.command(name="store-stats")
def store_stats() -> None:
    """Show vector store statistics."""
    store = VectorStore(settings)
    _print_stats(store)


def _print_stats(store: VectorStore) -> None:
    stats = store.stats()
    typer.echo(f"\n  Total chunks : {stats['total_chunks']:,}")
    typer.echo(f"  Indexed files: {len(stats['sources'])}")
    for src in stats["sources"]:
        typer.echo(f"    - {src}")


def _llm_client():
    if settings.use_local_llm:
        return LocalLLMClient(settings)
    return VLLMClient(settings)


async def _run_query_direct(content: str, question: str) -> None:
    async with _llm_client() as client:
        answer = await client.complete(
            prompt=f"Document:\n\n{content}\n\nQuestion: {question}",
            system="You are a document analysis assistant. Answer only based on the provided document content.",
        )
    typer.echo(f"\n{answer}")


async def _run_query_rag(context: str, question: str) -> None:
    async with _llm_client() as client:
        answer = await client.complete(
            prompt=f"Context fragments retrieved from the document collection:\n\n{context}\n\nQuestion: {question}",
            system=(
                "You are a document analysis assistant. "
                "Answer the question using only the provided context fragments. "
                "If the answer is not contained in the fragments, say so explicitly."
            ),
        )
    typer.echo(f"\n{answer}")


if __name__ == "__main__":
    app()
