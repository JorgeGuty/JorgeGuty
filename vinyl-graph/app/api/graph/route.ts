import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import type { VinylGraph } from '@/lib/types';

export const runtime = 'nodejs';

const GRAPH_PATH = path.join(process.cwd(), 'data', 'graph.json');

export async function GET() {
  try {
    const raw = await fs.readFile(GRAPH_PATH, 'utf8');
    return new NextResponse(raw, { headers: { 'content-type': 'application/json' } });
  } catch {
    return NextResponse.json({ nodes: [], edges: [] } satisfies VinylGraph);
  }
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as VinylGraph;
  if (!Array.isArray(body?.nodes) || !Array.isArray(body?.edges)) {
    return NextResponse.json({ error: 'Formato inválido: se esperan nodes[] y edges[].' }, { status: 400 });
  }
  const ids = new Set(body.nodes.map((n) => n.id));
  for (const e of body.edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      return NextResponse.json(
        { error: `Arista con nodo inexistente: ${e.source} → ${e.target}` },
        { status: 400 },
      );
    }
  }
  await fs.mkdir(path.dirname(GRAPH_PATH), { recursive: true });
  await fs.writeFile(GRAPH_PATH, JSON.stringify(body, null, 2));
  return NextResponse.json({ ok: true });
}
