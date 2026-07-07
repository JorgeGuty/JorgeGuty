'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import DetailPanel from '@/components/DetailPanel';
import EdgeEditor from '@/components/EdgeEditor';
import UploadPanel from '@/components/UploadPanel';
import { CLUSTERS, CLUSTER_COLORS, type Cluster, type VinylGraph } from '@/lib/types';
import { BASE_PATH, IS_STATIC, LOCAL_STORAGE_KEY } from '@/lib/runtime';

const GraphView = dynamic(() => import('@/components/GraphView'), { ssr: false });

const DECADES: [number, number][] = [
  [1950, 1969], [1970, 1979], [1980, 1989], [1990, 1999],
  [2000, 2009], [2010, 2019], [2020, 2029],
];

export default function Home() {
  const [graph, setGraph] = useState<VinylGraph>({ nodes: [], edges: [] });
  const [tab, setTab] = useState<'grafo' | 'video'>('grafo');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [visibleClusters, setVisibleClusters] = useState<Set<Cluster>>(new Set(CLUSTERS));
  const [decade, setDecade] = useState<[number, number] | null>(null);
  const [saving, setSaving] = useState(false);

  const loadGraph = useCallback(async () => {
    if (IS_STATIC) {
      // Static build (GitHub Pages): local edits win over the bundled seed.
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        try {
          setGraph(JSON.parse(saved) as VinylGraph);
          return;
        } catch { /* corrupt entry — fall through to the seed */ }
      }
      const res = await fetch(`${BASE_PATH}/graph.json`);
      setGraph((await res.json()) as VinylGraph);
      return;
    }
    const res = await fetch('/api/graph');
    const g = (await res.json()) as VinylGraph;
    setGraph(g);
  }, []);

  useEffect(() => { loadGraph(); }, [loadGraph]);

  const persist = useCallback(async (g: VinylGraph) => {
    setGraph(g);
    if (IS_STATIC) {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(g));
      return;
    }
    setSaving(true);
    try {
      await fetch('/api/graph', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(g),
      });
    } finally {
      setSaving(false);
    }
  }, []);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vinyl-influence-graph.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleCluster = (c: Cluster) => {
    setVisibleClusters((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });
  };

  const stats = useMemo(
    () => `${graph.nodes.length} discos · ${graph.edges.length} influencias`,
    [graph],
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>🎧 Grafo de Influencias — Vinilos</h1>
        <div className="tabs">
          <button className={tab === 'grafo' ? 'active' : ''} onClick={() => setTab('grafo')}>Grafo</button>
          <button className={tab === 'video' ? 'active' : ''} onClick={() => setTab('video')}>Procesar video</button>
        </div>
        <div className="spacer" />
        <span className="hint">{stats}{saving ? ' · guardando…' : ''}</span>
        <select
          value={decade ? `${decade[0]}` : ''}
          onChange={(e) => {
            const v = e.target.value;
            setDecade(v ? (DECADES.find((d) => `${d[0]}` === v) ?? null) : null);
          }}
          title="Filtrar por década (año original)"
        >
          <option value="">Todas las décadas</option>
          {DECADES.map((d) => (
            <option key={d[0]} value={d[0]}>{d[0] === 1950 ? '≤1969' : `${d[0]}s`}</option>
          ))}
        </select>
        <button onClick={exportJson}>Exportar JSON</button>
      </header>

      {tab === 'video' ? (
        <UploadPanel onDone={() => { loadGraph(); setTab('grafo'); }} />
      ) : (
        <div className="main">
          <div className="graph-wrap">
            <GraphView
              graph={graph}
              visibleClusters={visibleClusters}
              decadeRange={decade}
              onSelectNode={setSelectedId}
              selectedId={selectedId}
            />
          </div>
          <aside className="side">
            <div className="legend">
              {CLUSTERS.map((c) => (
                <button
                  key={c}
                  className={`chip ${visibleClusters.has(c) ? '' : 'off'}`}
                  onClick={() => toggleCluster(c)}
                  title="Click para mostrar/ocultar cluster"
                >
                  <span className="dot" style={{ background: CLUSTER_COLORS[c] }} />
                  {c}
                </button>
              ))}
            </div>
            <DetailPanel graph={graph} selectedId={selectedId} onChange={persist} onSelect={setSelectedId} />
            <EdgeEditor graph={graph} onChange={persist} />
          </aside>
        </div>
      )}
    </div>
  );
}
