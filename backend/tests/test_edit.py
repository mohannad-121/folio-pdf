from __future__ import annotations

import datetime as dt
import io

import pymupdf
import pytest

from .conftest import download, make_pdf, upload


def png_bytes(color="red", size=(40, 40)) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def open_out(client, res: dict, idx: int = 0) -> pymupdf.Document:
    return pymupdf.open("pdf", download(client, res["outputs"][idx]))


def form_pdf() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page()
    w = pymupdf.Widget()
    w.field_name = "name"
    w.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    w.rect = pymupdf.Rect(72, 72, 300, 100)
    page.add_widget(w)
    w = pymupdf.Widget()
    w.field_name = "agree"
    w.field_type = pymupdf.PDF_WIDGET_TYPE_CHECKBOX
    w.rect = pymupdf.Rect(72, 120, 92, 140)
    page.add_widget(w)
    return doc.tobytes()


# ---- inspectors ---------------------------------------------------------------


def test_text_spans_images_links_annotations(client):
    doc = pymupdf.open("pdf", make_pdf(1))
    page = doc[0]
    page.insert_image(pymupdf.Rect(300, 300, 400, 400), stream=png_bytes())
    page.insert_link({"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(72, 60, 200, 80), "uri": "https://example.com"})
    a = page.add_highlight_annot(page.search_for("quick")[0])
    a.set_info(content="note", title="tester")
    a.update()
    f = upload(client, doc.tobytes())
    fid = f["file_id"]

    spans = client.get(f"/api/edit/text-spans/{fid}/1").json()
    assert spans["width"] == 595 and spans["blocks"]
    span = spans["blocks"][0]["lines"][0]["spans"][0]
    assert "Hello Folio" in span["text"] and span["color"] == "#000000" and span["size"] == 18

    imgs = client.get(f"/api/edit/images/{fid}/1").json()
    assert len(imgs) == 1 and imgs[0]["xref"] > 0 and imgs[0]["width"] == 40

    links = client.get(f"/api/edit/links/{fid}").json()
    assert links == [
        {
            "page": 1,
            "xref": links[0]["xref"],
            "rect": [72.0, 60.0, 200.0, 80.0],
            "kind": "uri",
            "uri": "https://example.com",
        }
    ]

    annots = client.get(f"/api/edit/annotations/{fid}").json()
    assert len(annots) == 1
    assert annots[0]["type"] == "Highlight" and annots[0]["author"] == "tester" and annots[0]["contents"] == "note"
    assert client.get(f"/api/edit/text-spans/{fid}/9").status_code == 404


# ---- /apply ---------------------------------------------------------------------


def test_apply_mixed_ops(client):
    doc = pymupdf.open("pdf", make_pdf(3))
    # add form fields on page 1 so form_value has something to set
    page = doc[0]
    w = pymupdf.Widget()
    w.field_name = "name"
    w.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    w.rect = pymupdf.Rect(72, 400, 300, 430)
    page.add_widget(w)
    doc[1].insert_text((72, 300), "TOPSECRET", fontsize=14)
    pdf = upload(client, doc.tobytes())
    img = upload(client, png_bytes("blue"), "sig.png", "image/png")
    secret_rect = list(doc[1].search_for("TOPSECRET")[0])
    fox_rect = list(doc[0].search_for("quick brown fox")[0])

    ops = [
        {"type": "highlight", "page": 1, "rects": [fox_rect], "color": "#00ff00", "author": "me", "contents": "hi"},
        {"type": "ink", "page": 1, "paths": [[[10, 10], [50, 60], [90, 20]]], "color": "#0000ff", "width": 3},
        {"type": "rect", "page": 1, "rect": [300, 300, 400, 350], "stroke": "#ff0000", "fill": "#ffff00"},
        {"type": "arrow", "page": 1, "from": [100, 500], "to": [200, 550]},
        {"type": "note", "page": 1, "point": [500, 50], "contents": "a note"},
        {"type": "freetext", "page": 1, "rect": [72, 600, 300, 640], "text": "Free text here", "color": "#ff0000"},
        {"type": "text", "page": 1, "rect": [72, 650, 400, 700], "text": "BAKEDTEXT", "font_size": 14},
        {"type": "image", "page": 1, "rect": [400, 600, 500, 700], "image_file_id": img["file_id"]},
        {"type": "link", "page": 1, "rect": [72, 650, 400, 700], "uri": "https://folio.example"},
        {"type": "link", "page": 1, "rect": [72, 700, 200, 720], "target_page": 2},
        {"type": "redact", "page": 2, "rects": [secret_rect]},
        {"type": "replace_text", "page": 1, "rect": fox_rect, "text": "slow red cat"},
        {"type": "form_value", "field_name": "name", "value": "Jane Doe"},
        {"type": "rotate_page", "page": 2, "angle": 90},
        {"type": "set_metadata", "title": "Edited title"},
        {"type": "delete_page", "page": 3},
    ]
    r = client.post("/api/edit/apply", json={"file_id": pdf["file_id"], "ops": ops})
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["data"]["applied"] == len(ops), res["warnings"]
    assert res["data"]["failed"] == 0
    assert res["outputs"][0]["name"] == "sample-edited.pdf"
    out = open_out(client, res)
    assert out.page_count == 2
    p1, p2 = out[0], out[1]
    assert p2.rotation == 90
    assert "TOPSECRET" not in p2.get_text()
    text1 = p1.get_text()
    assert "BAKEDTEXT" in text1
    assert "slow red cat" in text1 and "quick brown fox" not in text1
    assert "lazy dog" in text1  # rest of the line survived the replace
    types = sorted(a.type[1] for a in p1.annots())
    assert types == ["FreeText", "Highlight", "Ink", "Line", "Square", "Text"]
    links = p1.get_links()
    assert {ln.get("uri") for ln in links if ln["kind"] == pymupdf.LINK_URI} == {"https://folio.example"}
    assert any(ln["kind"] == pymupdf.LINK_GOTO for ln in links)
    assert len(p1.get_images()) == 1
    assert out.metadata["title"] == "Edited title"
    names = {w.field_name: w.field_value for w in p1.widgets()}
    assert names["name"] == "Jane Doe"


def test_apply_image_replace_delete_and_annot_updates(client):
    doc = pymupdf.open("pdf", make_pdf(1))
    doc[0].insert_image(pymupdf.Rect(300, 300, 400, 400), stream=png_bytes("red"))
    a = doc[0].add_rect_annot(pymupdf.Rect(10, 10, 50, 50))
    a.update()
    b = doc[0].add_circle_annot(pymupdf.Rect(60, 10, 100, 50))
    b.update()
    data = doc.tobytes()
    doc = pymupdf.open("pdf", data)
    xref = doc[0].get_image_info(xrefs=True)[0]["xref"]
    annots = list(doc[0].annots())
    pdf = upload(client, data)
    img = upload(client, png_bytes("green", (80, 20)), "new.png", "image/png")
    ops = [
        {"type": "replace_image", "page": 1, "xref": xref, "image_file_id": img["file_id"]},
        {"type": "update_annot", "page": 1, "xref": annots[0].xref, "contents": "updated", "color": "#00ff00"},
        {"type": "delete_annot", "page": 1, "xref": annots[1].xref},
        {"type": "insert_blank_page", "after_page": 0},
        {"type": "erase", "page": 2, "rect": [60, 100, 400, 140]},
    ]
    res = client.post("/api/edit/apply", json={"file_id": pdf["file_id"], "ops": ops}).json()
    assert res["data"]["failed"] == 0, res["warnings"]
    out = open_out(client, res)
    assert out.page_count == 2
    page = out[1]  # original page is now second
    infos = page.get_image_info()
    assert infos and infos[0]["width"] == 80
    remaining = list(page.annots())
    assert len(remaining) == 1 and remaining[0].info["content"] == "updated"
    assert "lazy dog" not in page.get_text()  # erased
    assert "Hello Folio" in page.get_text()


def test_apply_unknown_op_and_strict(client):
    pdf = upload(client, make_pdf(1))
    r = client.post("/api/edit/apply", json={"file_id": pdf["file_id"], "ops": [{"type": "teleport", "page": 1}]})
    assert r.status_code == 422
    bad = [{"type": "delete_annot", "page": 1, "xref": 99999}]
    r = client.post("/api/edit/apply", json={"file_id": pdf["file_id"], "ops": bad})
    assert r.status_code == 200
    assert r.json()["data"]["failed"] == 1 and "op #1 (delete_annot)" in r.json()["warnings"][0]
    r = client.post("/api/edit/apply", json={"file_id": pdf["file_id"], "ops": bad, "strict": True})
    assert r.status_code == 422


def test_apply_stamp(client):
    pdf = upload(client, make_pdf(2))
    ops = [
        {
            "type": "stamp",
            "page": 1,
            "rect": [60, 200, 260, 270],
            "text": "Approved",
            "subtext": "27 NOV 2026 · Folio",
            "color": "#16a34a",
        },
        {"type": "stamp", "page": 2, "rect": [300, 400, 480, 460], "text": "paid", "rotate": -12, "opacity": 0.6},
    ]
    r = client.post("/api/edit/apply", json={"file_id": pdf["file_id"], "ops": ops, "strict": True})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["applied"] == 2
    out = open_out(client, r.json())
    hit = out[0].search_for("APPROVED")  # label is upper-cased
    assert hit and pymupdf.Rect(60, 200, 260, 270).contains(hit[0])
    assert out[0].search_for("27 NOV 2026")
    assert out[1].search_for("PAID")
    # Validation: empty label and out-of-range tilt are rejected.
    for bad in ({"text": ""}, {"text": "X", "rotate": 90}):
        op = {"type": "stamp", "page": 1, "rect": [10, 10, 100, 50], **bad}
        assert client.post("/api/edit/apply", json={"file_id": pdf["file_id"], "ops": [op]}).status_code == 422


@pytest.mark.parametrize("page_rotation", [0, 90, 180, 270])
def test_stamp_lands_where_placed_on_rotated_pages(page_rotation):
    from app.tools.edit import draw_stamp, from_page_space

    doc = pymupdf.open()
    page = doc.new_page()
    page.set_rotation(page_rotation)
    target = pymupdf.Rect(100, 150, 300, 230)  # displayed space
    draw_stamp(page, target, "Received", "2026-11-27", tilt=0)
    hits = page.search_for("RECEIVED")
    assert hits
    shown = from_page_space(page, hits[0])
    assert target.contains(shown), (shown, target)


def test_apply_flatten(client):
    pdf = upload(client, make_pdf(1))
    ops = [{"type": "freetext", "page": 1, "rect": [72, 300, 300, 340], "text": "flat"}]
    res = client.post("/api/edit/apply", json={"file_id": pdf["file_id"], "ops": ops, "flatten": True}).json()
    out = open_out(client, res)
    assert list(out[0].annots()) == []
    assert "flat" in out[0].get_text()


def test_coordinate_helper_rotated_page(client):
    from app.tools.edit import from_page_space, to_page_space

    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.set_rotation(90)
    assert page.rect.width == 842  # displayed space is landscape
    # unit tests of the helper itself
    r = to_page_space(page, pymupdf.Rect(0, 0, 842, 595))
    assert r == pymupdf.Rect(0, 0, 595, 842)
    # 90 degrees clockwise: the unrotated top-left corner is displayed at the top-right,
    # and the displayed top-left corner is the unrotated bottom-left.
    pt = to_page_space(page, (842, 0))
    assert abs(pt.x) < 1e-6 and abs(pt.y) < 1e-6
    pt = to_page_space(page, (0, 0))
    assert abs(pt.x) < 1e-6 and abs(pt.y - 842) < 1e-6
    assert to_page_space(pymupdf.open().new_page(), (1, 2)) == pymupdf.Point(1, 2)

    pdf = upload(client, doc.tobytes())
    target = [500, 100, 800, 160]
    link_rect = [600, 400, 700, 450]
    ops = [
        {"type": "text", "page": 1, "rect": target, "text": "ROTATEDTEXT", "font_size": 14},
        {"type": "highlight", "page": 1, "rects": [target]},
        {"type": "link", "page": 1, "rect": link_rect, "uri": "https://rot.example"},
        {"type": "crop_page", "page": 1, "rect": [0, 0, 842, 400]},
    ]
    res = client.post("/api/edit/apply", json={"file_id": pdf["file_id"], "ops": ops}).json()
    assert res["data"]["failed"] == 0, res["warnings"]
    out = open_out(client, res)
    p = out[0]
    assert p.rotation == 90
    assert p.rect.width == 842 and p.rect.height == 400  # crop honoured in displayed space
    # search_for() reports unrotated coordinates; mapped to displayed space it must land in the target box
    hits = p.search_for("ROTATEDTEXT")
    assert hits and pymupdf.Rect(target).contains(from_page_space(p, hits[0])), hits
    hl = next(a for a in p.annots())
    assert from_page_space(p, hl.rect).intersects(pymupdf.Rect(target))
    # a link given in displayed space must come back in displayed space
    links = p.get_links()
    assert links and pymupdf.Rect(links[0]["from"]).intersects(pymupdf.Rect(link_rect)), links
    # and the rendered page (displayed space) really has ink inside the target box, reading horizontally
    pix = p.get_pixmap(alpha=False, clip=pymupdf.Rect(target))
    dark = [(i % pix.width, i // pix.width) for i, px in enumerate(pix.samples[::3]) if px < 128]
    assert dark, "no ink rendered inside the requested rect"
    xs, ys = {x for x, _ in dark}, {y for _, y in dark}
    assert max(xs) - min(xs) > 3 * (max(ys) - min(ys)), "text should run horizontally in displayed space"
    # the viewer-facing inspectors also report displayed-space boxes
    spans = client.get(f"/api/edit/text-spans/{res['outputs'][0]['file_id']}/1").json()
    span_box = pymupdf.Rect(spans["blocks"][0]["lines"][0]["spans"][0]["bbox"])
    assert pymupdf.Rect(target).contains(span_box), span_box
    annots = client.get(f"/api/edit/annotations/{res['outputs'][0]['file_id']}").json()
    assert pymupdf.Rect(annots[0]["rect"]).intersects(pymupdf.Rect(target))


# ---- form tools -------------------------------------------------------------------


def test_watermark_text_center_tile_and_image(client, uploaded):
    fid = uploaded["file_id"]
    r = client.post("/api/edit/watermark", json={"file_id": fid, "text": "CONFIDENTIAL", "opacity": 0.4})
    assert r.status_code == 200, r.text
    out = open_out(client, r.json())
    hits = out[0].search_for("CONFIDENTIAL")
    assert len(hits) >= 1
    r = client.post(
        "/api/edit/watermark", json={"file_ids": [fid], "text": "DRAFT", "position": "tile", "rotation": 30}
    )
    out = open_out(client, r.json())
    assert len(out[1].search_for("DRAFT")) > 4
    img = upload(client, png_bytes("red"), "wm.png", "image/png")
    r = client.post("/api/edit/watermark", json={"file_id": fid, "image_file_id": img["file_id"], "under": True})
    out = open_out(client, r.json())
    assert len(out[0].get_images()) == 1
    assert client.post("/api/edit/watermark", json={"file_id": fid}).status_code == 422


@pytest.mark.parametrize("page_rotation", [0, 90])
@pytest.mark.parametrize("position", ["center", "top", "tile"])
def test_text_watermark_is_drawn_with_base14_font(position, page_rotation):
    # Regression: insert_textbox silently drew nothing when Helvetica's line height overflowed the box.
    from app.tools.edit import WatermarkRequest, _text_watermark

    doc = pymupdf.open()
    page = doc.new_page()
    page.set_rotation(page_rotation)
    angle = 0 if position == "top" else 45  # a 45° stamp at the top edge runs partly off the page
    _text_watermark(page, WatermarkRequest(text="CONFIDENTIAL", position=position, rotation=angle, font="helv"))
    assert page.search_for("CONFIDENTIAL")


def test_page_numbers(client, uploaded):
    r = client.post(
        "/api/edit/page-numbers",
        json={"file_id": uploaded["file_id"], "format": "Page {n} of {total}", "position": "bottom-right"},
    )
    assert r.status_code == 200, r.text
    out = open_out(client, r.json())
    hit = out[1].search_for("Page 2 of 3")
    assert len(hit) == 1 and hit[0].y0 > 700 and hit[0].x1 > 400
    r = client.post("/api/edit/page-numbers", json={"file_id": uploaded["file_id"], "format": "{roman}", "start": 4})
    assert out and open_out(client, r.json())[0].search_for("iv")


def test_header_footer(client, uploaded):
    today = dt.date.today().isoformat()
    r = client.post(
        "/api/edit/header-footer",
        json={
            "file_id": uploaded["file_id"],
            "header_left": "Date: {date}",
            "header_right": "{filename}",
            "footer_center": "{n}/{total}",
            "footer_right": "{bates}",
            "bates_start": 100,
            "bates_prefix": "FOL",
        },
    )
    assert r.status_code == 200, r.text
    out = open_out(client, r.json())
    t = out[2].get_text()
    assert f"Date: {today}" in t and "sample.pdf" in t and "3/3" in t and "FOL000102" in t


def test_background(client, uploaded):
    r = client.post("/api/edit/background", json={"file_id": uploaded["file_id"], "color": "#ff0000"})
    assert r.status_code == 200, r.text
    out = open_out(client, r.json())
    pix = out[0].get_pixmap(matrix=pymupdf.Matrix(0.2, 0.2))
    assert pix.pixel(2, 2)[:3] == (255, 0, 0)
    assert "Hello Folio" in out[0].get_text()
    img = upload(client, png_bytes("blue", (20, 30)), "bg.png", "image/png")
    r = client.post("/api/edit/background", json={"file_id": uploaded["file_id"], "image_file_id": img["file_id"]})
    assert len(open_out(client, r.json())[0].get_images()) == 1


def test_metadata(client, uploaded):
    fid = uploaded["file_id"]
    r = client.post("/api/edit/metadata", json={"file_id": fid, "title": "T", "author": "A", "keywords": "k1, k2"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["metadata"]["title"] == "T"
    out_id = r.json()["outputs"][0]["file_id"]
    md = client.get(f"/api/edit/metadata/{out_id}").json()
    assert md["metadata"]["author"] == "A" and md["page_count"] == 3
    r = client.post("/api/edit/metadata", json={"file_id": out_id, "strip": True, "subject": "only"})
    meta = r.json()["data"]["metadata"]
    assert meta.get("title") in ("", None) and meta["subject"] == "only"


def test_bookmarks_set_and_auto(client, uploaded):
    fid = uploaded["file_id"]
    outline = "Intro|1\n  Background|2\n  Method|2\nResults|3"
    r = client.post("/api/edit/bookmarks", json={"file_id": fid, "outline": outline})
    assert r.status_code == 200, r.text
    out_id = r.json()["outputs"][0]["file_id"]
    toc = client.get(f"/api/edit/bookmarks/{out_id}").json()
    assert toc == [
        {"level": 1, "title": "Intro", "page": 1},
        {"level": 2, "title": "Background", "page": 2},
        {"level": 2, "title": "Method", "page": 2},
        {"level": 1, "title": "Results", "page": 3},
    ]
    # auto: the 18pt "Hello Folio page N" lines are headings relative to the 11pt body
    r = client.post("/api/edit/bookmarks", json={"file_id": fid, "auto": True})
    toc = r.json()["data"]["toc"]
    assert [t["title"] for t in toc] == ["Hello Folio page 1", "Hello Folio page 2", "Hello Folio page 3"]
    assert [t["page"] for t in toc] == [1, 2, 3]
    r = client.post("/api/edit/bookmarks", json={"file_id": fid, "outline": [{"level": 1, "title": "X", "page": 2}]})
    assert r.json()["data"]["toc"] == [{"level": 1, "title": "X", "page": 2}]


def test_crop_auto_and_margins(client, uploaded):
    fid = uploaded["file_id"]
    r = client.post("/api/edit/crop", json={"file_id": fid, "auto": True})
    assert r.status_code == 200, r.text
    out = open_out(client, r.json())
    p = out[0]
    assert p.rect.width < 595 and p.rect.height < 400
    assert p.cropbox.width < p.mediabox.width
    assert "Hello Folio" in p.get_text()
    r = client.post(
        "/api/edit/crop", json={"file_id": fid, "top": 10, "bottom": 20, "left": 30, "right": 40, "pages": "1"}
    )
    out = open_out(client, r.json())
    assert (out[0].rect.width, out[0].rect.height) == (525, 812)
    assert out[1].rect.width == 595


def test_resize_a4_letter_custom(client):
    doc = pymupdf.open()
    doc.new_page(width=400, height=400).insert_text((50, 50), "square")
    pdf = upload(client, doc.tobytes())
    r = client.post("/api/edit/resize", json={"file_id": pdf["file_id"], "size": "A4"})
    assert r.status_code == 200, r.text
    out = open_out(client, r.json())
    assert (round(out[0].rect.width), round(out[0].rect.height)) == (595, 842)
    assert "square" in out[0].get_text()
    r = client.post("/api/edit/resize", json={"file_id": pdf["file_id"], "size": "Letter", "landscape": True})
    out = open_out(client, r.json())
    assert (round(out[0].rect.width), round(out[0].rect.height)) == (792, 612)
    r = client.post("/api/edit/resize", json={"file_id": pdf["file_id"], "size": "custom", "width": 100, "height": 200})
    assert open_out(client, r.json())[0].rect.height == 200
    assert client.post("/api/edit/resize", json={"file_id": pdf["file_id"], "size": "custom"}).status_code == 422


def test_remove_and_flatten_annotations(client):
    doc = pymupdf.open("pdf", make_pdf(1))
    page = doc[0]
    page.add_highlight_annot(page.search_for("quick")[0]).update()
    page.add_rect_annot(pymupdf.Rect(10, 10, 50, 50)).update()
    pdf = upload(client, doc.tobytes())
    r = client.post("/api/edit/remove-annotations", json={"file_id": pdf["file_id"], "types": ["Square"]})
    assert r.json()["data"]["removed"] == 1
    assert [a.type[1] for a in open_out(client, r.json())[0].annots()] == ["Highlight"]
    r = client.post("/api/edit/flatten-annotations", json={"file_id": pdf["file_id"]})
    assert list(open_out(client, r.json())[0].annots()) == []


def test_form_value_checkbox(client):
    pdf = upload(client, form_pdf())
    ops = [{"type": "form_value", "field_name": "agree", "value": True}]
    res = client.post("/api/edit/apply", json={"file_id": pdf["file_id"], "ops": ops}).json()
    assert res["data"]["failed"] == 0, res["warnings"]
    out = open_out(client, res)
    vals = {w.field_name: w.field_value for w in out[0].widgets()}
    assert vals["agree"] == "Yes"


def test_apply_non_latin_text_uses_fallback_font(client, uploaded):
    ops = [
        {"type": "text", "page": 1, "rect": [72, 300, 500, 340], "text": "你好世界 Привет", "font_size": 16},
        {"type": "text", "page": 1, "rect": [72, 350, 500, 390], "text": "مرحبا بالعالم", "font_size": 16},
    ]
    res = client.post("/api/edit/apply", json={"file_id": uploaded["file_id"], "ops": ops}).json()
    assert res["data"]["failed"] == 0, res["warnings"]
    assert any("fallback font" in w for w in res["warnings"])
    out = open_out(client, res)
    assert out[0].search_for("你好世界") and "Привет" in out[0].get_text()
