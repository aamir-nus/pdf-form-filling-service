"""Document upload + fill endpoints (mounted under /api/v1)."""

import uuid

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response

from .. import pdf_engine
from ..schemas import DocumentMeta, FillRequest

router = APIRouter(prefix="/documents", tags=["documents"])

# Ephemeral in-memory store: doc_id -> (original PDF bytes, original filename).
# Single uvicorn worker only; cleared on restart. Fine for a local-hosted tool.
_STORE: dict[str, tuple[bytes, str]] = {}


@router.post("", response_model=DocumentMeta)
async def upload(file: UploadFile = File(...)) -> DocumentMeta:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="A .pdf file is required")
    data = await file.read()
    try:
        pages, fields = pdf_engine.read_meta(data)
    except Exception as e:  # noqa: BLE001 - surface as 422 to the client
        raise HTTPException(status_code=422, detail=f"Could not read PDF: {e}") from e
    doc_id = uuid.uuid4().hex
    _STORE[doc_id] = (data, file.filename)
    return DocumentMeta(id=doc_id, pages=pages, fields=fields)


@router.post("/{doc_id}/fill")
async def fill(doc_id: str, req: FillRequest) -> Response:
    entry = _STORE.get(doc_id)
    if entry is None:
        raise HTTPException(
            status_code=404, detail="Document not found (it may have expired)."
        )
    data, filename = entry
    try:
        out = pdf_engine.fill_pdf(data, req)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"Fill failed: {e}") from e
    base = filename[:-4] if filename.lower().endswith(".pdf") else filename
    return Response(
        content=out,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{base}_filled.pdf"'},
    )
