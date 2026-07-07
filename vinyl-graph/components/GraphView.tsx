'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d';
import { CLUSTERS, CLUSTER_COLORS, type Cluster, type DiscNode, type InfluenceEdge, type VinylGraph } from '@/lib/types';
import { asset } from '@/lib/runtime';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false });

type GNode = NodeObject & DiscNode;
type GLink = LinkObject & InfluenceEdge;

interface Props {
  graph: VinylGraph;
  visibleClusters: Set<Cluster>;
  decadeRange: [number, number] | null;
  onSelectNode: (id: string | null) => void;
  selectedId: string | null;
}

export default function GraphView({ graph, visibleClusters, decadeRange, onSelectNode, selectedId }: Props) {
  const fgRef = useRef<ForceGraphMethods | undefined>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [hoverId, setHoverId] = useState<string | null>(null);
  const zoomedRef = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    obs.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => obs.disconnect();
  }, []);

  // Preload cover thumbnails once.
  useEffect(() => {
    for (const n of graph.nodes) {
      if (n.imagen_portada && !imagesRef.current.has(n.id)) {
        const img = new Image();
        img.src = asset(n.imagen_portada);
        imagesRef.current.set(n.id, img);
      }
    }
  }, [graph.nodes]);

  const data = useMemo(() => {
    const inDecade = (n: DiscNode) =>
      !decadeRange || (n.año != null && n.año >= decadeRange[0] && n.año <= decadeRange[1]);
    const nodes = graph.nodes
      .filter((n) => visibleClusters.has(n.cluster) && inDecade(n))
      .map((n) => ({ ...n }));
    const ids = new Set(nodes.map((n) => n.id));
    const links = graph.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ ...e }));
    return { nodes, links };
  }, [graph, visibleClusters, decadeRange]);

  // Genre clustering: pull each node toward its cluster's centroid on a circle.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    let cancelled = false;
    (async () => {
      const d3 = await import('d3-force');
      if (cancelled || !fgRef.current) return;
      const R = Math.min(size.w, size.h) * 0.34;
      const centroid = (c: Cluster) => {
        const i = CLUSTERS.indexOf(c);
        const angle = (i / CLUSTERS.length) * 2 * Math.PI - Math.PI / 2;
        return { x: R * Math.cos(angle), y: R * Math.sin(angle) };
      };
      fgRef.current.d3Force(
        'x',
        d3.forceX((n) => centroid((n as unknown as GNode).cluster).x).strength(0.14),
      );
      fgRef.current.d3Force(
        'y',
        d3.forceY((n) => centroid((n as unknown as GNode).cluster).y).strength(0.14),
      );
      fgRef.current.d3Force('charge', d3.forceManyBody().strength(-90));
      fgRef.current.d3Force('collide', d3.forceCollide(24));
      fgRef.current.d3ReheatSimulation();
    })();
    return () => { cancelled = true; };
  }, [size, data]);

  const neighborIds = useMemo(() => {
    const focus = hoverId ?? selectedId;
    if (!focus) return null;
    const set = new Set<string>([focus]);
    for (const e of graph.edges) {
      if (e.source === focus) set.add(e.target);
      if (e.target === focus) set.add(e.source);
    }
    return set;
  }, [hoverId, selectedId, graph.edges]);

  const drawNode = useCallback(
    (node: NodeObject, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as GNode;
      const r = 14;
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      const dimmed = neighborIds ? !neighborIds.has(n.id) : false;
      ctx.save();
      ctx.globalAlpha = dimmed ? 0.18 : 1;

      // Cluster-colored ring
      ctx.beginPath();
      ctx.arc(x, y, r + 2.2, 0, 2 * Math.PI);
      ctx.fillStyle = CLUSTER_COLORS[n.cluster] ?? '#898781';
      ctx.fill();

      // Cover thumbnail clipped to a circle (fallback: dark disc + initials)
      const img = imagesRef.current.get(n.id);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.clip();
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
      } else {
        ctx.fillStyle = '#232322';
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
        ctx.fillStyle = '#c3c2b7';
        ctx.font = `600 ${r * 0.7}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(n.album.slice(0, 2).toUpperCase(), x, y);
      }
      ctx.restore();

      if (n.id === selectedId) {
        ctx.beginPath();
        ctx.arc(x, y, r + 4.5, 0, 2 * Math.PI);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
      if (n.needs_review) {
        ctx.fillStyle = '#fab219';
        ctx.beginPath();
        ctx.arc(x + r, y - r, 3.4, 0, 2 * Math.PI);
        ctx.fill();
      }

      // Album label when zoomed in or focused
      if (globalScale > 1.4 || n.id === (hoverId ?? selectedId)) {
        ctx.globalAlpha = dimmed ? 0.18 : 1;
        ctx.font = `500 ${Math.max(10 / globalScale, 3)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#c3c2b7';
        ctx.fillText(n.album, x, y + r + 5);
      }
      ctx.globalAlpha = 1;
    },
    [neighborIds, selectedId, hoverId],
  );

  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }}>
      <ForceGraph2D
        ref={fgRef}
        width={size.w}
        height={size.h}
        graphData={data}
        backgroundColor="#1a1a19"
        nodeCanvasObject={drawNode}
        nodePointerAreaPaint={(node, color, ctx) => {
          const n = node as GNode;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(n.x ?? 0, n.y ?? 0, 18, 0, 2 * Math.PI);
          ctx.fill();
        }}
        nodeLabel={(node) => {
          const n = node as GNode;
          return `<div style="text-align:center"><b>${n.album}</b><br/>${n.artista}${n.año ? ` · ${n.año}` : ''}<br/><span style="opacity:.7">${n.genero}</span></div>`;
        }}
        onNodeHover={(node) => setHoverId(node ? (node as GNode).id : null)}
        onNodeClick={(node) => onSelectNode((node as GNode).id)}
        onBackgroundClick={() => onSelectNode(null)}
        linkColor={(link) => {
          const l = link as GLink;
          const src = typeof l.source === 'object' ? (l.source as GNode) : null;
          const base = src ? CLUSTER_COLORS[src.cluster] : '#898781';
          const focus = hoverId ?? selectedId;
          if (focus) {
            const sid = typeof l.source === 'object' ? (l.source as GNode).id : String(l.source);
            const tid = typeof l.target === 'object' ? (l.target as GNode).id : String(l.target);
            if (sid !== focus && tid !== focus) return 'rgba(137,135,129,0.06)';
            return base;
          }
          return base + '66';
        }}
        linkWidth={(link) => {
          const l = link as GLink;
          const focus = hoverId ?? selectedId;
          if (!focus) return 1.2;
          const sid = typeof l.source === 'object' ? (l.source as GNode).id : String(l.source);
          const tid = typeof l.target === 'object' ? (l.target as GNode).id : String(l.target);
          return sid === focus || tid === focus ? 2.2 : 0.6;
        }}
        linkDirectionalArrowLength={5}
        linkDirectionalArrowRelPos={0.92}
        linkCurvature={0.15}
        linkDirectionalParticles={0}
        cooldownTicks={200}
        onEngineStop={() => {
          if (!zoomedRef.current && fgRef.current) {
            fgRef.current.zoomToFit(500, 70);
            zoomedRef.current = true;
          }
        }}
        linkLabel={(link) => {
          const l = link as GLink;
          return `<div style="max-width:260px"><b>${l.tipo_de_influencia}</b><br/>${l['explicación'] ?? ''}</div>`;
        }}
      />
    </div>
  );
}
