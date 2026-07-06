'use client';

import { useState } from 'react';
import type { VinylGraph } from '@/lib/types';

const TIPOS = ['sonido', 'escena', 'producción', 'linaje', 'evolución interna', 'homenaje', 'sampleo', 'colaboración'];

export default function EdgeEditor({ graph, onChange }: { graph: VinylGraph; onChange: (g: VinylGraph) => void }) {
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [tipo, setTipo] = useState(TIPOS[0]);
  const [explica, setExplica] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sorted = [...graph.nodes].sort((a, b) => a.artista.localeCompare(b.artista));

  const add = () => {
    setError(null);
    if (!source || !target) return setError('Elegí origen y destino.');
    if (source === target) return setError('Origen y destino no pueden ser el mismo disco.');
    const dup = graph.edges.some((e) => e.source === source && e.target === target);
    if (dup) return setError('Ya existe una arista entre esos discos.');
    onChange({
      ...graph,
      edges: [...graph.edges, { source, target, tipo_de_influencia: tipo, explicación: explica || 'Agregada manualmente.' }],
    });
    setSource(''); setTarget(''); setExplica('');
  };

  return (
    <div className="panel">
      <h2>Agregar influencia (A → B)</h2>
      <div className="form-grid">
        <label>
          A — influye
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">— elegir disco —</option>
            {sorted.map((n) => (
              <option key={n.id} value={n.id}>{n.artista} — {n.album}</option>
            ))}
          </select>
        </label>
        <label>
          B — es influido
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">— elegir disco —</option>
            {sorted.map((n) => (
              <option key={n.id} value={n.id}>{n.artista} — {n.album}</option>
            ))}
          </select>
        </label>
        <label>
          Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>
          Explicación (1 frase)
          <input value={explica} onChange={(e) => setExplica(e.target.value)} placeholder="¿Por qué A influyó a B?" />
        </label>
        {error && <span className="error-text">{error}</span>}
        <button className="primary" onClick={add}>Agregar arista</button>
      </div>
    </div>
  );
}
