export const CLUSTERS = [
  'Rock Clásico',
  'Post-Punk / New Wave',
  'Dream Pop / Shoegaze',
  'Indie / Art Rock',
  'Hip-Hop',
  'R&B Alternativo',
  'Pop Electrónico / Funk',
  'Jazz & Global',
] as const;

export type Cluster = (typeof CLUSTERS)[number];

// Dark-mode categorical palette (validated: lightness band, chroma floor,
// CVD floor band with secondary encoding via cover art + labels, ≥3:1 contrast)
export const CLUSTER_COLORS: Record<Cluster, string> = {
  'Rock Clásico': '#3987e5',
  'Post-Punk / New Wave': '#9085e9',
  'Dream Pop / Shoegaze': '#d55181',
  'Indie / Art Rock': '#199e70',
  'Hip-Hop': '#e66767',
  'R&B Alternativo': '#d95926',
  'Pop Electrónico / Funk': '#c98500',
  'Jazz & Global': '#008300',
};

export interface DiscNode {
  id: string;
  artista: string;
  album: string;
  año: number | null;
  genero: string;       // specific display genre, e.g. "Emo", "Hyperpop"
  cluster: Cluster;      // one of the 8 fixed clusters (color + layout)
  pais?: string;
  imagen_portada?: string; // URL under /public
  needs_review?: boolean;
}

export type TipoInfluencia =
  | 'sonido'
  | 'escena'
  | 'producción'
  | 'linaje'
  | 'evolución interna'
  | 'homenaje'
  | 'sampleo'
  | 'colaboración';

export interface InfluenceEdge {
  source: string;
  target: string;
  tipo_de_influencia: TipoInfluencia | string;
  explicación: string;
}

export interface VinylGraph {
  nodes: DiscNode[];
  edges: InfluenceEdge[];
  meta?: { generado?: string; fuente?: string };
}

export interface JobStatus {
  id: string;
  stage:
    | 'subiendo'
    | 'extrayendo_frames'
    | 'identificando'
    | 'enriqueciendo'
    | 'infiriendo_influencias'
    | 'guardando'
    | 'listo'
    | 'error';
  percent: number;
  message: string;
  discsFound: number;
  error?: string;
}
