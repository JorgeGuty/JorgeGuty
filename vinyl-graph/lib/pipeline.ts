import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { structuredCall } from './claude';
import { updateJob } from './jobs';
import { CLUSTERS, type Cluster, type DiscNode, type InfluenceEdge, type VinylGraph } from './types';

const execFileAsync = promisify(execFile);

const FRAME_WIDTH = 768;
const FRAMES_PER_SECOND = 1;
const VISION_BATCH_SIZE = 5;

interface Identification {
  frame: number;
  artista: string;
  album: string;
  año: number | null;
  confianza: number;
  needs_review: boolean;
  // Normalized bounding box of the cover inside the frame (0..1), if visible.
  bbox: { x: number; y: number; w: number; h: number } | null;
}

function slugify(artista: string, album: string): string {
  return `${artista}-${album}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

async function ffmpeg(args: string[]) {
  // Uses system ffmpeg; see README for installation.
  await execFileAsync('ffmpeg', ['-v', 'error', '-y', ...args]);
}

export async function extractFrames(videoPath: string, outDir: string): Promise<string[]> {
  await fs.mkdir(outDir, { recursive: true });
  await ffmpeg([
    '-i', videoPath,
    '-vf', `fps=${FRAMES_PER_SECOND},scale=${FRAME_WIDTH}:-1`,
    '-q:v', '3',
    path.join(outDir, 'f_%04d.jpg'),
  ]);
  const files = (await fs.readdir(outDir)).filter((f) => f.endsWith('.jpg')).sort();
  return files.map((f) => path.join(outDir, f));
}

async function frameToImageBlock(framePath: string) {
  const data = await fs.readFile(framePath);
  return {
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: 'image/jpeg' as const,
      data: data.toString('base64'),
    },
  };
}

const IDENTIFY_SCHEMA = {
  type: 'object',
  properties: {
    discos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          frame: { type: 'integer' },
          artista: { type: 'string' },
          album: { type: 'string' },
          año: { type: ['integer', 'null'] },
          confianza: { type: 'number' },
          needs_review: { type: 'boolean' },
          bbox: {
            type: ['object', 'null'],
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              w: { type: 'number' },
              h: { type: 'number' },
            },
            required: ['x', 'y', 'w', 'h'],
            additionalProperties: false,
          },
        },
        required: ['frame', 'artista', 'album', 'año', 'confianza', 'needs_review', 'bbox'],
        additionalProperties: false,
      },
    },
  },
  required: ['discos'],
  additionalProperties: false,
};

export async function identifyDiscs(
  jobId: string,
  framePaths: string[],
): Promise<Map<string, Identification & { framePath: string }>> {
  const found = new Map<string, Identification & { framePath: string }>();

  for (let i = 0; i < framePaths.length; i += VISION_BATCH_SIZE) {
    const batch = framePaths.slice(i, i + VISION_BATCH_SIZE);
    updateJob(jobId, {
      stage: 'identificando',
      percent: 15 + Math.round((i / framePaths.length) * 45),
      message: `Analizando frames ${i + 1}–${Math.min(i + batch.length, framePaths.length)} de ${framePaths.length}…`,
      discsFound: found.size,
    });

    const content: Parameters<typeof structuredCall>[0]['content'] = [];
    for (let j = 0; j < batch.length; j++) {
      content.push({ type: 'text', text: `Frame ${i + j}:` });
      content.push(await frameToImageBlock(batch[j]));
    }
    content.push({
      type: 'text',
      text: 'Identifica cada portada de vinilo visible en estos frames (pueden ser fotos físicas o capturas de una app de colección como Discogs, donde además puedes leer título/artista/año en el texto).',
    });

    try {
      const result = await structuredCall<{ discos: Identification[] }>({
        system: [
          'Eres un experto en identificación de discos de vinilo.',
          'Recibes frames de un video de una colección. Para cada portada de álbum claramente visible, devuelve artista, álbum, año de lanzamiento ORIGINAL (no el de la reedición) si lo conoces, y un bbox normalizado (0-1) de la portada dentro del frame.',
          'Si un frame es una captura de una app de colección (p. ej. Discogs), lee los metadatos del texto y reporta cada entrada visible; usa el año original del álbum, no el de la reedición listada.',
          'NUNCA inventes datos: si no estás seguro del artista o álbum, marca needs_review=true y baja la confianza. Omite portadas demasiado borrosas o cortadas para identificar.',
          'El mismo disco puede aparecer en varios frames; repórtalo cada vez, la deduplicación ocurre después.',
        ].join(' '),
        content,
        schema: IDENTIFY_SCHEMA,
      });

      for (const d of result.discos) {
        if (!d.artista || !d.album) continue;
        const key = slugify(d.artista, d.album);
        const existing = found.get(key);
        // Keep the highest-confidence sighting of each disc.
        if (!existing || d.confianza > existing.confianza) {
          const localIndex = Math.min(Math.max(d.frame - i, 0), batch.length - 1);
          found.set(key, { ...d, framePath: batch[localIndex] });
        }
      }
    } catch (err) {
      // One failed batch shouldn't kill the whole run.
      console.error(`Batch de frames ${i} falló:`, err);
    }
  }
  return found;
}

const ENRICH_SCHEMA = {
  type: 'object',
  properties: {
    discos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          genero: { type: 'string' },
          cluster: { type: 'string', enum: [...CLUSTERS] },
          año: { type: ['integer', 'null'] },
          pais: { type: 'string' },
        },
        required: ['id', 'genero', 'cluster', 'año', 'pais'],
        additionalProperties: false,
      },
    },
  },
  required: ['discos'],
  additionalProperties: false,
};

export async function enrichMetadata(
  jobId: string,
  discs: { id: string; artista: string; album: string; año: number | null }[],
): Promise<Map<string, { genero: string; cluster: Cluster; año: number | null; pais: string }>> {
  updateJob(jobId, {
    stage: 'enriqueciendo',
    percent: 65,
    message: 'Completando género, año y país de cada disco…',
  });

  const result = await structuredCall<{
    discos: { id: string; genero: string; cluster: Cluster; año: number | null; pais: string }[];
  }>({
    system: [
      'Eres un musicólogo. Para cada disco de la lista, devuelve: género específico (etiqueta corta y precisa, p. ej. "Emo", "Dream pop", "G-funk"),',
      `cluster (exactamente uno de: ${CLUSTERS.join(' | ')}),`,
      'año de lanzamiento original y país/escena de origen del artista.',
      'Usa tu conocimiento; si de verdad no conoces el disco, deja año null y da tu mejor estimación de género.',
    ].join(' '),
    content: [{ type: 'text', text: JSON.stringify(discs, null, 1) }],
    schema: ENRICH_SCHEMA,
  });

  const map = new Map<string, { genero: string; cluster: Cluster; año: number | null; pais: string }>();
  for (const d of result.discos) map.set(d.id, d);
  return map;
}

const EDGES_SCHEMA = {
  type: 'object',
  properties: {
    edges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          source: { type: 'string' },
          target: { type: 'string' },
          tipo_de_influencia: { type: 'string' },
          explicación: { type: 'string' },
        },
        required: ['source', 'target', 'tipo_de_influencia', 'explicación'],
        additionalProperties: false,
      },
    },
  },
  required: ['edges'],
  additionalProperties: false,
};

export async function inferInfluences(jobId: string, nodes: DiscNode[]): Promise<InfluenceEdge[]> {
  updateJob(jobId, {
    stage: 'infiriendo_influencias',
    percent: 78,
    message: 'Infiriendo relaciones de influencia musical…',
  });

  const compact = nodes.map((n) => ({
    id: n.id,
    artista: n.artista,
    album: n.album,
    año: n.año,
    genero: n.genero,
  }));

  const result = await structuredCall<{ edges: InfluenceEdge[] }>({
    system: [
      'Eres un historiador musical riguroso. Recibes una colección de discos y propones un grafo dirigido de influencias.',
      'Una arista A → B significa "A influyó musicalmente a B": A es anterior o contemporáneo, y existe una relación documentada o estilísticamente reconocida (sonido, productor, escena, técnica, sampleo, homenaje, o evolución interna del mismo artista).',
      'NO generes una arista por cada par posible: propone SOLO las relaciones más significativas y bien fundamentadas (en promedio 1–2 por disco; deja nodos sin conexiones si no hay relación honesta).',
      'tipo_de_influencia: una palabra corta (sonido, escena, producción, linaje, evolución interna, homenaje, sampleo, colaboración).',
      'explicación: UNA frase concreta en español. Respeta la cronología: el año de source debe ser ≤ al de target.',
      'Usa exactamente los ids provistos.',
    ].join(' '),
    content: [{ type: 'text', text: JSON.stringify(compact, null, 1) }],
    schema: EDGES_SCHEMA,
    thinking: true,
    maxTokens: 16000,
  });

  const ids = new Set(nodes.map((n) => n.id));
  return result.edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);
}

export async function cropCover(
  framePath: string,
  bbox: { x: number; y: number; w: number; h: number } | null,
  outPath: string,
): Promise<boolean> {
  try {
    if (bbox && bbox.w > 0.05 && bbox.h > 0.05) {
      await ffmpeg([
        '-i', framePath,
        '-vf', `crop=iw*${bbox.w.toFixed(4)}:ih*${bbox.h.toFixed(4)}:iw*${bbox.x.toFixed(4)}:ih*${bbox.y.toFixed(4)},scale=160:160`,
        '-q:v', '4',
        outPath,
      ]);
    } else {
      // No bbox: use a centered square crop of the frame as fallback thumbnail.
      await ffmpeg(['-i', framePath, '-vf', "crop='min(iw,ih)':'min(iw,ih)',scale=160:160", '-q:v', '4', outPath]);
    }
    return true;
  } catch {
    return false;
  }
}

export async function runPipeline(jobId: string, videoPath: string, projectRoot: string) {
  const workDir = path.join(projectRoot, '.tmp', jobId);
  const framesDir = path.join(workDir, 'frames');
  const coversDir = path.join(projectRoot, 'public', 'covers', 'gen');

  try {
    updateJob(jobId, { stage: 'extrayendo_frames', percent: 5, message: 'Extrayendo frames con ffmpeg…' });
    const frames = await extractFrames(videoPath, framesDir);
    if (frames.length === 0) throw new Error('No se pudieron extraer frames del video.');

    const identified = await identifyDiscs(jobId, frames);
    if (identified.size === 0) throw new Error('No se identificó ningún disco en el video.');

    const discList = [...identified.entries()].map(([id, d]) => ({
      id,
      artista: d.artista,
      album: d.album,
      año: d.año,
    }));
    const enriched = await enrichMetadata(jobId, discList);

    updateJob(jobId, { stage: 'guardando', percent: 72, message: 'Recortando portadas…' });
    await fs.mkdir(coversDir, { recursive: true });

    const nodes: DiscNode[] = [];
    for (const [id, d] of identified.entries()) {
      const meta = enriched.get(id);
      const coverPath = path.join(coversDir, `${id}.jpg`);
      const ok = await cropCover(d.framePath, d.bbox, coverPath);
      nodes.push({
        id,
        artista: d.artista,
        album: d.album,
        año: meta?.año ?? d.año,
        genero: meta?.genero ?? 'Desconocido',
        cluster: meta?.cluster ?? 'Indie / Art Rock',
        pais: meta?.pais,
        imagen_portada: ok ? `/covers/gen/${id}.jpg` : undefined,
        needs_review: d.needs_review || d.confianza < 0.6,
      });
    }

    const edges = await inferInfluences(jobId, nodes);

    updateJob(jobId, { stage: 'guardando', percent: 92, message: 'Guardando grafo…' });
    const graph: VinylGraph = {
      nodes,
      edges,
      meta: { generado: new Date().toISOString(), fuente: 'video' },
    };
    await fs.mkdir(path.join(projectRoot, 'data'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'data', 'graph.json'), JSON.stringify(graph, null, 2));

    updateJob(jobId, {
      stage: 'listo',
      percent: 100,
      message: `Listo: ${nodes.length} discos, ${edges.length} influencias.`,
      discsFound: nodes.length,
    });
  } catch (err) {
    updateJob(jobId, {
      stage: 'error',
      percent: 100,
      message: 'El procesamiento falló.',
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
