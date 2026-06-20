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
            maxlen = w.text_maxlen or None
            ftype = w.field_type
            on_state = None
            if ftype in (
                pymupdf.PDF_WIDGET_TYPE_CHECKBOX,
                pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON,
            ):
                try:
                    on_state = w.on_state()
                except Exception:
                    on_state = None
            # Button "is it checked" differs by type: checkbox truthy-not-Off,
            # radio when the field's current value equals this widget's on_state.
            if ftype == pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON and on_state:
                value = w.field_value == on_state
            else:
                value = w.field_value
            options = None
            if ftype in (
                pymupdf.PDF_WIDGET_TYPE_COMBOBOX,
                pymupdf.PDF_WIDGET_TYPE_LISTBOX,
            ):
                options = list(w.choice_values or [])
            fields.append(
                FieldDef(
                    name=w.field_name or "",
                    type=_TYPE_MAP.get(ftype, "other"),
                    page=i,
                    rect=_mupdf_rect_to_pdf(w.rect, h),
                    value=value,
                    max_len=maxlen,
                    comb=bool(maxlen and w.field_flags & (1 << 24)),
                    on_state=on_state,
                    options=options,
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
                elif w.field_type == pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON:
                    # Only the widget whose option matches gets selected; the
                    # whole group follows. Skip the rest (leave their state).
                    try:
                        if w.on_state() == str(val):
                            w.field_value = w.on_state()
                        else:
                            continue
                    except Exception:
                        continue
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
