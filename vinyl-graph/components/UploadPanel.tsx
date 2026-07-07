'use client';

import { useEffect, useRef, useState } from 'react';
import type { JobStatus } from '@/lib/types';
import { IS_STATIC } from '@/lib/runtime';

const STAGE_LABELS: Record<JobStatus['stage'], string> = {
  subiendo: 'Subiendo video',
  extrayendo_frames: 'Extrayendo frames (ffmpeg)',
  identificando: 'Identificando discos (Claude Vision)',
  enriqueciendo: 'Enriqueciendo metadata',
  infiriendo_influencias: 'Infiriendo influencias',
  guardando: 'Guardando grafo',
  listo: 'Listo',
  error: 'Error',
};

export default function UploadPanel({ onDone }: { onDone: () => void }) {
  if (IS_STATIC) {
    return (
      <div className="upload-card">
        <h3 style={{ fontSize: 18 }}>Procesar un video de tu colección</h3>
        <p className="hint">
          Esta versión publicada en GitHub Pages es estática: no tiene servidor, así que
          el pipeline de procesamiento (ffmpeg + Claude API) no está disponible aquí.
          Para procesar un video nuevo, cloná el repo y corré el app localmente:
        </p>
        <pre className="hint" style={{ whiteSpace: 'pre-wrap' }}>
          {'cd vinyl-graph\nnpm install\nexport ANTHROPIC_API_KEY=sk-ant-...\nnpm run dev'}
        </pre>
        <p className="hint">
          Las ediciones que hagas al grafo en esta versión (aristas, nodos) se guardan en
          tu navegador (localStorage) y podés bajarlas con «Exportar JSON».
        </p>
      </div>
    );
  }
  return <UploadPanelServer onDone={onDone} />;
}

function UploadPanelServer({ onDone }: { onDone: () => void }) {
  const [job, setJob] = useState<JobStatus | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const startPolling = (jobId: string) => {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/process/${jobId}`);
        if (!res.ok) return;
        const j = (await res.json()) as JobStatus;
        setJob(j);
        if (j.stage === 'listo' || j.stage === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          if (j.stage === 'listo') onDone();
        }
      } catch { /* transient poll error, keep trying */ }
    }, 1500);
  };

  const upload = async (file: File) => {
    setError(null);
    setUploading(true);
    setJob(null);
    try {
      const fd = new FormData();
      fd.append('video', file);
      const res = await fetch('/api/process', { method: 'POST', body: fd });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Error subiendo el video.');
      startPolling(body.jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="upload-card">
      <h3 style={{ fontSize: 18 }}>Procesar un video de tu colección</h3>
      <p className="hint">
        Subí un video (mp4/mov) recorriendo tu colección — vinilos físicos o un screen
        recording de tu app de colección. El pipeline extrae frames con ffmpeg, identifica
        cada disco con Claude (visión), completa género/año/país, e infiere el grafo de
        influencias. Al terminar, el grafo se actualiza automáticamente.
      </p>
      <div
        className="dropzone"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) upload(f);
        }}
      >
        {uploading ? 'Subiendo…' : 'Arrastrá un video aquí o hacé click para elegirlo'}
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
        />
      </div>

      {job && (
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <strong>{STAGE_LABELS[job.stage]}</strong>
            <span className="meta">{job.percent}%{job.discsFound ? ` · ${job.discsFound} discos` : ''}</span>
          </div>
          <div className="progress-outer">
            <div className="progress-inner" style={{ width: `${job.percent}%` }} />
          </div>
          <p className="hint" style={{ marginTop: 8 }}>{job.message}</p>
          {job.error && <p className="error-text">{job.error}</p>}
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      <p className="hint">
        Requiere <code>ANTHROPIC_API_KEY</code> en el servidor y <code>ffmpeg</code> instalado.
        El procesamiento puede tardar varios minutos según la duración del video.
      </p>
    </div>
  );
}
