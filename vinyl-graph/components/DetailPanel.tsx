'use client';

import { useState } from 'react';
import { CLUSTER_COLORS, type DiscNode, type InfluenceEdge, type VinylGraph } from '@/lib/types';
import { asset } from '@/lib/runtime';

interface Props {
  graph: VinylGraph;
  selectedId: string | null;
  onChange: (g: VinylGraph) => void;
  onSelect: (id: string) => void;
}

export default function DetailPanel({ graph, selectedId, onChange, onSelect }: Props) {
  const node = graph.nodes.find((n) => n.id === selectedId) ?? null;
  const [editing, setEditing] = useState(false);

  if (!node) {
    return (
      <div className="panel">
        <h2>Detalle</h2>
        <p className="hint">
          Hacé click en un disco para ver sus datos y sus influencias entrantes y salientes.
          Los nodos con punto amarillo necesitan revisión manual.
        </p>
      </div>
    );
  }

  const incoming = graph.edges.filter((e) => e.target === node.id);
  const outgoing = graph.edges.filter((e) => e.source === node.id);
  const byId = (id: string) => graph.nodes.find((n) => n.id === id);

  const deleteEdge = (edge: InfluenceEdge) => {
    onChange({
      ...graph,
      edges: graph.edges.filter(
        (e) => !(e.source === edge.source && e.target === edge.target && e.tipo_de_influencia === edge.tipo_de_influencia),
      ),
    });
  };

  const deleteNode = () => {
    if (!confirm(`¿Eliminar "${node.album}" y todas sus conexiones?`)) return;
    onChange({
      ...graph,
      nodes: graph.nodes.filter((n) => n.id !== node.id),
      edges: graph.edges.filter((e) => e.source !== node.id && e.target !== node.id),
    });
  };

  const saveNode = (patch: Partial<DiscNode>) => {
    onChange({
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === node.id ? { ...n, ...patch, needs_review: false } : n)),
    });
    setEditing(false);
  };

  const EdgeList = ({ edges, dir }: { edges: InfluenceEdge[]; dir: 'in' | 'out' }) => (
    <>
      {edges.length === 0 && <p className="hint">Ninguna.</p>}
      {edges.map((e, i) => {
        const otherId = dir === 'in' ? e.source : e.target;
        const other = byId(otherId);
        return (
          <div className="edge-row" key={`${e.source}-${e.target}-${i}`}>
            <div className="head">
              <span className="rel">
                {dir === 'in' ? '←' : '→'}{' '}
                <a
                  style={{ color: 'inherit', cursor: 'pointer', textDecoration: 'underline dotted' }}
                  onClick={() => other && onSelect(other.id)}
                >
                  {other ? `${other.album} (${other.artista})` : otherId}
                </a>
              </span>
              <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span className="badge">{e.tipo_de_influencia}</span>
                <button className="danger-ghost" title="Borrar arista" onClick={() => deleteEdge(e)}>×</button>
              </span>
            </div>
            <div className="why">{e['explicación']}</div>
          </div>
        );
      })}
    </>
  );

  return (
    <div className="panel">
      <div className="node-head">
        {node.imagen_portada ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset(node.imagen_portada)} alt={node.album} />
        ) : null}
        <div>
          <h3>{node.album} {node.needs_review && <span className="warn" title="Revisar manualmente">⚠</span>}</h3>
          <div className="meta">
            {node.artista}
            {node.año ? ` · ${node.año}` : ''}
            {node.pais ? ` · ${node.pais}` : ''}
          </div>
          <div className="meta">
            <span className="dot" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: CLUSTER_COLORS[node.cluster], marginRight: 5 }} />
            {node.genero} — {node.cluster}
          </div>
        </div>
      </div>

      {editing ? (
        <form
          className="form-grid"
          style={{ marginTop: 10 }}
          onSubmit={(ev) => {
            ev.preventDefault();
            const fd = new FormData(ev.currentTarget);
            saveNode({
              artista: String(fd.get('artista') || node.artista),
              album: String(fd.get('album') || node.album),
              año: fd.get('año') ? Number(fd.get('año')) : node.año,
              genero: String(fd.get('genero') || node.genero),
            });
          }}
        >
          <label>Artista<input name="artista" defaultValue={node.artista} /></label>
          <label>Álbum<input name="album" defaultValue={node.album} /></label>
          <label>Año<input name="año" type="number" defaultValue={node.año ?? ''} /></label>
          <label>Género<input name="genero" defaultValue={node.genero} /></label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="primary" type="submit">Guardar</button>
            <button type="button" onClick={() => setEditing(false)}>Cancelar</button>
          </div>
        </form>
      ) : (
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button onClick={() => setEditing(true)}>Editar</button>
          <button onClick={deleteNode}>Eliminar disco</button>
        </div>
      )}

      <h2 style={{ marginTop: 14 }}>Influenciado por ({incoming.length})</h2>
      <EdgeList edges={incoming} dir="in" />
      <h2 style={{ marginTop: 14 }}>Influyó a ({outgoing.length})</h2>
      <EdgeList edges={outgoing} dir="out" />
    </div>
  );
}
