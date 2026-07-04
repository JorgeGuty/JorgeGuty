"""Core advisor logic: sends a room photo to an open vision-language model
and returns structured decoration advice.

Supported providers (selected via the ADVISOR_PROVIDER env var):

- "ollama" (default): runs fully local open models through Ollama
  (https://ollama.com). Recommended models: qwen2.5vl, llava, llama3.2-vision.
- "huggingface": uses the Hugging Face Inference API (router) with an open
  model such as Qwen/Qwen2.5-VL-7B-Instruct. Requires a free HF_TOKEN.
- "mock": returns canned advice, useful for developing the UI without a model.
"""

import base64
import json
import os
import re

import httpx

PROVIDER = os.environ.get("ADVISOR_PROVIDER", "ollama")

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5vl")

HF_TOKEN = os.environ.get("HF_TOKEN", "")
HF_MODEL = os.environ.get("HF_MODEL", "Qwen/Qwen2.5-VL-7B-Instruct")
HF_URL = os.environ.get(
    "HF_URL", "https://router.huggingface.co/v1/chat/completions"
)

REQUEST_TIMEOUT = float(os.environ.get("ADVISOR_TIMEOUT", "180"))

SYSTEM_PROMPT = """\
You are an expert interior designer. The user sends a photo of an empty (or
nearly empty) space plus optional preferences. Study the photo carefully:
its dimensions, natural light, windows, floor and wall materials, and
architectural features.

Respond ONLY with a single JSON object, no markdown fences, no commentary,
matching exactly this schema:

{
  "summary": "2-3 sentence assessment of the space and overall design concept",
  "style": "the recommended decoration style and why it suits this space",
  "color_palette": [
    {"name": "color name", "hex": "#RRGGBB", "usage": "where/how to use it"}
  ],
  "furniture": [
    {"item": "furniture piece", "description": "materials, size, style",
     "placement": "where to put it in this room"}
  ],
  "lighting": ["lighting recommendation", "..."],
  "decor": ["decorative element recommendation", "..."],
  "layout_tips": ["tip about arranging the space", "..."]
}

Give 4-6 colors, 4-7 furniture pieces, and 3-5 items in each list. Ground
every recommendation in what you actually see in the photo. Write the values
in {language}.
"""


class AdvisorError(Exception):
    """Raised when the model provider fails or returns unusable output."""


def build_user_prompt(room_type: str, style: str, budget: str, notes: str) -> str:
    parts = ["Here is a photo of my empty space. Please advise me on decorating it."]
    if room_type:
        parts.append(f"Intended use of the space: {room_type}.")
    if style:
        parts.append(f"Preferred style: {style}.")
    if budget:
        parts.append(f"Budget level: {budget}.")
    if notes:
        parts.append(f"Additional notes: {notes}")
    return " ".join(parts)


def extract_json(text: str) -> dict:
    """Pull the first JSON object out of a model response, tolerating fences."""
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise AdvisorError(f"Model did not return JSON: {text[:200]}")
    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise AdvisorError(f"Could not parse model JSON: {exc}") from exc


async def _ask_ollama(image_bytes: bytes, system: str, prompt: str) -> str:
    payload = {
        "model": OLLAMA_MODEL,
        "stream": False,
        "format": "json",
        "messages": [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": prompt,
                "images": [base64.b64encode(image_bytes).decode()],
            },
        ],
    }
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        try:
            resp = await client.post(f"{OLLAMA_URL}/api/chat", json=payload)
        except httpx.HTTPError as exc:
            raise AdvisorError(
                f"Could not reach Ollama at {OLLAMA_URL}. Is it running? "
                f"Install from https://ollama.com and run "
                f"'ollama pull {OLLAMA_MODEL}'. ({exc})"
            ) from exc
    if resp.status_code != 200:
        raise AdvisorError(f"Ollama error {resp.status_code}: {resp.text[:300]}")
    return resp.json()["message"]["content"]


async def _ask_huggingface(image_bytes: bytes, system: str, prompt: str,
                           mime: str) -> str:
    if not HF_TOKEN:
        raise AdvisorError(
            "HF_TOKEN is not set. Create a free token at "
            "https://huggingface.co/settings/tokens and export HF_TOKEN."
        )
    data_uri = f"data:{mime};base64,{base64.b64encode(image_bytes).decode()}"
    payload = {
        "model": HF_MODEL,
        "max_tokens": 2048,
        "messages": [
            {"role": "system", "content": system},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": data_uri}},
                ],
            },
        ],
    }
    headers = {"Authorization": f"Bearer {HF_TOKEN}"}
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
        try:
            resp = await client.post(HF_URL, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            raise AdvisorError(f"Could not reach Hugging Face API: {exc}") from exc
    if resp.status_code != 200:
        raise AdvisorError(
            f"Hugging Face error {resp.status_code}: {resp.text[:300]}"
        )
    return resp.json()["choices"][0]["message"]["content"]


def _mock_advice(language: str) -> dict:
    es = language.lower() in ("spanish", "español", "espanol", "es")
    return {
        "summary": (
            "Espacio luminoso con buen potencial. Un estilo cálido y minimalista "
            "aprovechará la luz natural." if es else
            "A bright space with great potential. A warm, minimal style will "
            "make the most of the natural light."
        ),
        "style": "Japandi" if not es else "Japandi (mezcla escandinava-japonesa)",
        "color_palette": [
            {"name": "Blanco hueso" if es else "Warm white", "hex": "#F5F1E8",
             "usage": "Paredes" if es else "Walls"},
            {"name": "Verde salvia" if es else "Sage green", "hex": "#9CAF88",
             "usage": "Pared de acento" if es else "Accent wall"},
            {"name": "Roble claro" if es else "Light oak", "hex": "#C8A97E",
             "usage": "Muebles" if es else "Furniture"},
            {"name": "Carbón" if es else "Charcoal", "hex": "#3B3B3B",
             "usage": "Detalles" if es else "Accents"},
        ],
        "furniture": [
            {"item": "Sofá modular" if es else "Modular sofa",
             "description": "Lino natural, 3 plazas" if es else "Natural linen, 3-seater",
             "placement": "Frente a la ventana" if es else "Facing the window"},
            {"item": "Mesa de centro" if es else "Coffee table",
             "description": "Madera de roble, baja" if es else "Low oak wood",
             "placement": "Centro de la sala" if es else "Center of the room"},
        ],
        "lighting": ["Lámpara de pie de arco" if es else "Arc floor lamp",
                     "Luces cálidas 2700K" if es else "Warm 2700K bulbs"],
        "decor": ["Plantas de interior grandes" if es else "Large indoor plants",
                  "Alfombra de yute" if es else "Jute rug"],
        "layout_tips": [
            "Deja pasillos de al menos 80 cm" if es else
            "Keep walkways at least 80 cm wide"
        ],
        "_mock": True,
    }


async def get_advice(image_bytes: bytes, mime: str, room_type: str = "",
                     style: str = "", budget: str = "", notes: str = "",
                     language: str = "English") -> dict:
    """Analyze a room photo and return structured decoration advice."""
    system = SYSTEM_PROMPT.replace("{language}", language)
    prompt = build_user_prompt(room_type, style, budget, notes)

    if PROVIDER == "mock":
        return _mock_advice(language)
    if PROVIDER == "huggingface":
        raw = await _ask_huggingface(image_bytes, system, prompt, mime)
    elif PROVIDER == "ollama":
        raw = await _ask_ollama(image_bytes, system, prompt)
    else:
        raise AdvisorError(f"Unknown ADVISOR_PROVIDER: {PROVIDER}")
    return extract_json(raw)
