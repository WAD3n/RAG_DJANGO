import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000';

// /api/convert can take several minutes (docling OCR/VLM)
const TIMEOUTS: Record<string, number> = {
  convert: 10 * 60_000,
  ingest:   5 * 60_000,
  query:    2 * 60_000,
};
const DEFAULT_TIMEOUT = 60_000;

export const dynamic = 'force-dynamic';

async function proxy(req: NextRequest, segments: string[]): Promise<NextResponse> {
  const path = segments.join('/');
  const url = new URL(req.url);

  // _token allows window.open() callers to pass auth without custom headers
  const queryToken = url.searchParams.get('_token');
  url.searchParams.delete('_token');
  const target = `${BACKEND}/api/${path}${url.search}`;

  const timeoutMs = TIMEOUTS[path] ?? DEFAULT_TIMEOUT;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), timeoutMs);

  const headers = new Headers();
  req.headers.forEach((v, k) => {
    if (k !== 'host') headers.set(k, v);
  });
  if (queryToken) headers.set('authorization', `Token ${queryToken}`);

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
      signal: controller.signal,
      // @ts-ignore — duplex required for streaming request bodies in Node fetch
      duplex: 'half',
    });

    const resHeaders = new Headers();
    upstream.headers.forEach((v, k) => resHeaders.set(k, v));

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: resHeaders,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json({ error: 'Backend request timed out' }, { status: 504 });
    }
    console.error(`[proxy] ${req.method} /api/${path} →`, err);
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 502 });
  } finally {
    clearTimeout(tid);
  }
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
