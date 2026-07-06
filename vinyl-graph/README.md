# 🎧 Grafo de Influencias — Colección de Vinilos

App web que genera un **grafo dirigido de influencias musicales** (A → B = "A influyó a B")
entre los discos de una colección de vinilos, con **clusters visuales por género**.

El input es un **video** de la colección — un recorrido físico por los discos o un screen
recording de una app de colección (p. ej. Discogs). El pipeline:

1. **ffmpeg** extrae frames a 1 fps (escalados a 768px).
2. **Claude (visión)** identifica artista/álbum/año en cada frame; si no está seguro,
   marca el disco como *revisar manualmente* en vez de inventar datos.
3. Se **deduplican** discos vistos en varios frames (se conserva la detección de mayor confianza).
4. **Claude** enriquece la metadata: género específico, cluster, año original y país.
5. **Claude (razonamiento)** infiere solo las influencias **significativas** (no O(n²)),
   cada una con tipo y explicación de una frase.
6. El grafo se persiste en `data/graph.json` y se visualiza con `react-force-graph-2d`.

El repo incluye un **grafo semilla ya generado** a partir del video de la colección
(53 discos, 38 influencias, portadas recortadas de los frames en `public/covers/`),
así que la visualización funciona sin API key.

## Requisitos

- Node.js 20+
- `ffmpeg` en el PATH (`brew install ffmpeg` / `apt install ffmpeg`)
- `ANTHROPIC_API_KEY` (solo para procesar videos nuevos; el grafo semilla no la necesita)

## Uso

```bash
cd vinyl-graph
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # opcional si solo querés ver el grafo
npm run dev
```

Abrí <http://localhost:3000>.

- **Grafo** — grafo dirigido con flechas, clusters por género (fuerzas de atracción hacia
  el centroide de cada cluster), portadas en miniatura, hover para tooltip, click para el
  panel de detalle con influencias entrantes/salientes y sus explicaciones.
- **Filtros** — chips de género (mostrar/ocultar clusters) y filtro por década.
- **Edición manual** — borrar aristas, agregar aristas (origen, destino, tipo, explicación),
  editar o eliminar discos. Todo se guarda en `data/graph.json` vía `PUT /api/graph`.
- **Exportar JSON** — descarga el grafo completo.
- **Procesar video** — subí un mp4/mov; barra de progreso por etapas
  (frames → identificación → metadata → influencias). Al terminar reemplaza el grafo.

## Modelo de datos

```ts
Node: { id, artista, album, año, genero, cluster, pais, imagen_portada, needs_review }
Edge: { source, target, tipo_de_influencia, explicación }
```

`cluster` es uno de 8 grupos fijos usados para color y layout; `genero` es la etiqueta
específica del disco (p. ej. "Emo", "G-funk", "Hyperpop").

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript
- `@anthropic-ai/sdk` — `claude-opus-4-8` con salidas estructuradas (JSON schema) y
  razonamiento adaptativo para la inferencia de influencias
- `ffmpeg` (sistema) para frames y recorte de portadas
- `react-force-graph-2d` + `d3-force` para el grafo con clustering
- Persistencia simple en JSON (`data/graph.json`) — suficiente para el MVP

## Estructura

```
app/            páginas y API routes (process, progress, graph)
components/     GraphView, DetailPanel, EdgeEditor, UploadPanel
lib/            tipos, pipeline (ffmpeg + Claude), cliente Claude, jobs en memoria
data/graph.json grafo persistido (incluye el semilla)
public/covers/  portadas recortadas del video
```
