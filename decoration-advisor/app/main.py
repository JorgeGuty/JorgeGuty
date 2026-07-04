"""FastAPI server for the Decoration Advisor app."""

from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import advisor

MAX_IMAGE_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}

STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="Decoration Advisor")


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "provider": advisor.PROVIDER}


@app.post("/api/advise")
async def advise(
    image: UploadFile = File(...),
    room_type: str = Form(""),
    style: str = Form(""),
    budget: str = Form(""),
    notes: str = Form(""),
    language: str = Form("English"),
) -> dict:
    if image.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=415,
            detail="Please upload a JPEG, PNG, or WebP image.",
        )
    data = await image.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image larger than 10 MB.")
    if not data:
        raise HTTPException(status_code=400, detail="Empty image file.")

    try:
        advice = await advisor.get_advice(
            data,
            mime=image.content_type,
            room_type=room_type.strip(),
            style=style.strip(),
            budget=budget.strip(),
            notes=notes.strip()[:2000],
            language="Spanish" if language.lower().startswith("es") else "English",
        )
    except advisor.AdvisorError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"advice": advice}


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
