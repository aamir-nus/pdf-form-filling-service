"""PyMuPDF-backed PDF operations: read form-field schema, fill AcroForm fields,
stamp freeform text/image overlays, and flatten."""

import base64

import pymupdf

from .schemas import FieldDef, FillRequest, PageDef

_TYPE_MAP = {
    pymupdf.PDF_WIDGET_TYPE_TEXT: "text",
    pymupdf.PDF_WIDGET_TYPE_CHECKBOX: "checkbox",
    pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON: "radio",
    pymupdf.PDF_WIDGET_TYPE_LISTBOX: "list",
    pymupdf.PDF_WIDGET_TYPE_COMBOBOX: "combo",
}


def _mupdf_rect_to_pdf(rect: pymupdf.Rect, h: float) -> list[float]:
    """PyMuPDF (top-left, Y-down) -> PDF-spec (bottom-left, Y-up)."""
    return [rect.x0, h - rect.y1, rect.x1, h - rect.y0]


def read_meta(data: bytes) -> tuple[list[PageDef], list[FieldDef]]:
    doc = pymupdf.open(stream=data, filetype="pdf")
    pages: list[PageDef] = []
    fields: list[FieldDef] = []
    for i, page in enumerate(doc):
        h = page.rect.height
        pages.append(PageDef(width=page.rect.width, height=h))
        for w in page.widgets():
            fields.append(
                FieldDef(
                    name=w.field_name or "",
                    type=_TYPE_MAP.get(w.field_type, "other"),
                    page=i,
                    rect=_mupdf_rect_to_pdf(w.rect, h),
                    value=w.field_value,
                )
            )
    doc.close()
    return pages, fields


def fill_pdf(data: bytes, req: FillRequest) -> bytes:
    doc = pymupdf.open(stream=data, filetype="pdf")

    # 1. Fill AcroForm widgets.
    for page in doc:
        for w in page.widgets():
            if w.field_name in req.fields:
                val = req.fields[w.field_name]
                if w.field_type == pymupdf.PDF_WIDGET_TYPE_CHECKBOX:
                    w.field_value = bool(val)
                else:
                    w.field_value = "" if val is None else str(val)
                w.update()

    # 2. Flatten widgets into static content.
    doc.bake()

    # 3. Stamp freeform overlays on top (PDF-spec -> PyMuPDF Y-flip).
    for o in req.overlays:
        page = doc[o.page]
        h = page.rect.height
        x0, _y0, x1, y1 = o.rect  # y1 is top edge in PDF-spec space
        if o.kind == "image" and o.src:
            raw = o.src.split(",", 1)[1] if "," in o.src else o.src
            page.insert_image(
                pymupdf.Rect(x0, h - y1, x1, h - _y0), stream=base64.b64decode(raw)
            )
        elif o.kind == "text" and o.value is not None:
            page.insert_text(
                pymupdf.Point(x0, (h - y1) + o.font_size * 0.8),
                str(o.value),
                fontsize=o.font_size,
                fontname="helv",
            )

    out = doc.tobytes()
    doc.close()
    return out
