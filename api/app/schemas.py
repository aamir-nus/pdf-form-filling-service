"""Request/response models (pydantic v2). All coordinates are PDF-spec points:
bottom-left origin, Y-up, 1pt = 1/72". The frontend converts screen px <-> these
via PDF.js PageViewport; the backend flips Y when stamping with PyMuPDF."""

from typing import Literal

from pydantic import BaseModel, Field


class PageDef(BaseModel):
    width: float
    height: float


class FieldDef(BaseModel):
    name: str
    type: str  # text | checkbox | radio | list | combo | other
    page: int  # 0-indexed
    rect: list[float]  # [x0, y0, x1, y1] in PDF-spec points
    value: str | bool | None = None  # current field value (pre-fill)
    max_len: int | None = None  # MaxLen (text fields); caps input length
    comb: bool = False  # Comb flag -> one character per cell, max_len cells
    on_state: str | None = None  # export value that selects a button field
    # (checkbox="Yes"; radio=the option e.g. "Yes"/"No"). Sent back by the UI to fill it.
    options: list[str] | None = None  # choices for combo/list ("select") fields


class DocumentMeta(BaseModel):
    id: str
    pages: list[PageDef]
    fields: list[FieldDef]


class Overlay(BaseModel):
    kind: Literal["text", "image"]
    page: int  # 0-indexed
    rect: list[float]  # [x0, y0, x1, y1] in PDF-spec points
    value: str | None = None  # for kind == "text"
    src: str | None = None  # data URL (base64) for kind == "image"
    font_size: float = 12


class FillRequest(BaseModel):
    fields: dict[str, str | bool] = Field(default_factory=dict)
    overlays: list[Overlay] = Field(default_factory=list)
