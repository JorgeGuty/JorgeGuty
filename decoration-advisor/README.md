# 🛋️ Decoration Advisor

Upload a photo of an empty (or nearly empty) space and get AI-powered interior
decoration advice: a color palette with hex swatches, furniture suggestions
(muebles) with placement, lighting, decor ideas, and layout tips.

The AI runs entirely on **open models** — no proprietary APIs required:

| Provider | Models | Cost |
|---|---|---|
| [Ollama](https://ollama.com) (default) | `qwen2.5vl`, `llava`, `llama3.2-vision` | Free, runs locally |
| [Hugging Face Inference API](https://huggingface.co/docs/inference-providers) | `Qwen/Qwen2.5-VL-7B-Instruct` | Free tier with a token |
| Mock | — | Demo mode, no AI needed |

## Quick start

```bash
cd decoration-advisor
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### Option A — local open model with Ollama (recommended)

```bash
# one-time setup
ollama pull qwen2.5vl

# run the app
uvicorn app.main:app --reload
```

### Option B — hosted open model via Hugging Face

```bash
export ADVISOR_PROVIDER=huggingface
export HF_TOKEN=hf_...   # free token from https://huggingface.co/settings/tokens
uvicorn app.main:app --reload
```

### Option C — demo mode (no model)

```bash
ADVISOR_PROVIDER=mock uvicorn app.main:app --reload
```

Then open **http://localhost:8000**, drop in a photo of your space, optionally
pick the room use, style, budget, and answer language (English / Español), and
click **Get decoration advice**.

## How it works

1. The photo is sent to `POST /api/advise` along with your preferences.
2. The backend forwards it to an open vision-language model with a prompt that
   asks for structured JSON: design concept, color palette (`#RRGGBB` values),
   furniture with placement, lighting, decor, and layout tips.
3. The frontend renders the palette as color swatches and the rest as cards.

Configuration is via environment variables — see [.env.example](.env.example).

## API

- `GET /api/health` — provider status.
- `POST /api/advise` — multipart form: `image` (JPEG/PNG/WebP ≤ 10 MB), plus
  optional `room_type`, `style`, `budget`, `notes`, `language`. Returns
  `{"advice": {...}}`.
