from __future__ import annotations

import json

import pymupdf

from .conftest import download, make_pdf, upload


def out_doc(client, res: dict, idx: int = 0) -> pymupdf.Document:
    return pymupdf.open("pdf", download(client, res["outputs"][idx]))


FIELDS = [
    {"type": "text", "name": "full_name", "page": 1, "rect": [72, 300, 300, 325], "tooltip": "Your name"},
    {"type": "text", "name": "notes", "page": 1, "rect": [72, 340, 400, 420], "multiline": True, "max_len": 200},
    {"type": "checkbox", "name": "agree", "page": 1, "rect": [72, 440, 90, 458], "required": True},
    {"type": "combobox", "name": "color", "page": 1, "rect": [72, 480, 200, 500], "options": ["red", "green"]},
    {"type": "listbox", "name": "fruit", "page": 1, "rect": [72, 520, 200, 580], "options": ["apple", "pear"]},
    {"type": "date", "name": "when", "page": 1, "rect": [72, 600, 200, 620]},
    {"type": "signature", "name": "sig", "page": 2, "rect": [72, 600, 300, 660]},
    {
        "type": "text",
        "name": "total",
        "page": 2,
        "rect": [72, 100, 200, 120],
        "calc": 'AFSimple_Calculate("SUM", new Array("a"));',
    },
]


def test_add_fields_list_fill_export_import_flatten(client, uploaded):
    fid = uploaded["file_id"]
    before = client.get(f"/api/forms/fields/{fid}").json()
    assert before == {"fields": [], "has_forms": False, "xfa": False, "count": 0}

    r = client.post("/api/forms/add-fields", json={"file_id": fid, "fields": FIELDS})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["added"] == len(FIELDS), r.json()["warnings"]
    form_id = r.json()["outputs"][0]["file_id"]

    listed = client.get(f"/api/forms/fields/{form_id}").json()
    assert listed["has_forms"] is True and listed["count"] == len(FIELDS)
    by_name = {f["name"]: f for f in listed["fields"]}
    assert by_name["full_name"]["type"] == "text" and by_name["full_name"]["tooltip"] == "Your name"
    assert by_name["notes"]["multiline"] is True and by_name["notes"]["max_len"] == 200
    assert by_name["agree"]["type"] == "checkbox" and by_name["agree"]["required"] is True
    assert by_name["color"]["options"] == ["red", "green"]
    assert by_name["fruit"]["type"] == "listbox"
    assert by_name["sig"]["type"] == "signature" and by_name["sig"]["page"] == 2
    doc = pymupdf.open("pdf", download(client, r.json()["outputs"][0]))
    scripts = {w.field_name: (w.script_format, w.script_calc) for p in doc for w in p.widgets()}
    assert scripts["when"][0] and "AFDate_FormatEx" in scripts["when"][0]
    assert scripts["total"][1] and "AFSimple_Calculate" in scripts["total"][1]

    values = {"full_name": "Ada Lovelace", "agree": True, "color": "green", "notes": "line1\nline2", "nope": "x"}
    r = client.post("/api/forms/fill", json={"file_id": form_id, "values": values})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["filled"] == 4 and r.json()["data"]["missing"] == ["nope"]
    assert r.json()["outputs"][0]["name"].endswith("-filled.pdf")
    filled_id = r.json()["outputs"][0]["file_id"]
    filled = {f["name"]: f["value"] for f in client.get(f"/api/forms/fields/{filled_id}").json()["fields"]}
    assert filled["full_name"] == "Ada Lovelace" and filled["color"] == "green" and filled["agree"] == "Yes"

    # export in every format
    r = client.post("/api/forms/export", json={"file_id": filled_id, "format": "json"})
    assert r.status_code == 200, r.text
    exported = json.loads(download(client, r.json()["outputs"][0]))
    assert exported["full_name"] == "Ada Lovelace" and exported["agree"] is True
    assert r.json()["data"]["fields"]["color"] == "green"

    r = client.post("/api/forms/export", json={"file_id": filled_id, "format": "csv"})
    csv_text = download(client, r.json()["outputs"][0]).decode("utf-8-sig")
    assert csv_text.splitlines()[0].startswith("full_name,") and "Ada Lovelace" in csv_text

    r = client.post("/api/forms/export", json={"file_id": filled_id, "format": "fdf"})
    fdf = download(client, r.json()["outputs"][0])
    assert fdf.startswith(b"%FDF-1.2") and b"/T (full_name) /V (Ada Lovelace)" in fdf and b"%%EOF" in fdf

    r = client.post("/api/forms/export", json={"file_id": filled_id, "format": "xfdf"})
    xfdf = download(client, r.json()["outputs"][0])
    assert b'<field name="full_name"><value>Ada Lovelace</value>' in xfdf

    # import each format back into the empty form
    for data, name in ((fdf, "data.fdf"), (xfdf, "data.xfdf"), (csv_text.encode(), "data.csv")):
        dfile = upload(client, data, name, "application/octet-stream")
        r = client.post("/api/forms/import", json={"file_id": form_id, "data_file_id": dfile["file_id"]})
        assert r.status_code == 200, r.text
        assert r.json()["data"]["filled"] >= 4, (name, r.json())
        vals = {
            f["name"]: f["value"]
            for f in client.get(f"/api/forms/fields/{r.json()['outputs'][0]['file_id']}").json()["fields"]
        }
        assert vals["full_name"] == "Ada Lovelace", name
        assert vals["agree"] == "Yes", name

    jfile = upload(client, json.dumps({"full_name": "Grace", "agree": False}).encode(), "d.json", "application/json")
    r = client.post("/api/forms/import", json={"file_id": form_id, "data_file_id": jfile["file_id"], "flatten": True})
    flat = out_doc(client, r.json())
    assert list(flat[0].widgets()) == [] and "Grace" in flat[0].get_text()

    # flatten + remove
    r = client.post("/api/forms/flatten", json={"file_id": filled_id})
    flat = out_doc(client, r.json())
    assert not list(flat[0].widgets()) and "Ada Lovelace" in flat[0].get_text()
    r = client.post("/api/forms/remove-fields", json={"file_id": form_id, "names": ["sig", "total"]})
    assert r.json()["data"]["removed"] == 2
    assert client.get(f"/api/forms/fields/{r.json()['outputs'][0]['file_id']}").json()["count"] == len(FIELDS) - 2
    r = client.post("/api/forms/remove-fields", json={"file_id": form_id})
    assert client.get(f"/api/forms/fields/{r.json()['outputs'][0]['file_id']}").json()["count"] == 0


def test_radio_group(client):
    pdf = upload(client, make_pdf(1))
    fields = [{"type": "radio", "name": "size", "page": 1, "rect": [72, 300, 92, 360], "options": ["S", "M", "L"]}]
    r = client.post("/api/forms/add-fields", json={"file_id": pdf["file_id"], "fields": fields})
    assert r.status_code == 200, r.text
    listed = client.get(f"/api/forms/fields/{r.json()['outputs'][0]['file_id']}").json()
    assert [f["type"] for f in listed["fields"]] == ["radio"] * 3


def test_fdf_parser_edge_cases():
    from app.tools.forms import parse_fdf, parse_form_data

    fdf = b"%FDF-1.2\n<< /T (a\\)b) /V <FEFF00480069> >> << /V /Yes /T (chk) >>"
    assert parse_fdf(fdf) == {"a)b": "Hi", "chk": "Yes"}
    assert parse_form_data(b'{"fields": {"x": 1}}', "x.json") == {"x": 1}
    assert parse_form_data(b"name,value\nfoo,bar\n", "x.csv") == {"foo": "bar"}
