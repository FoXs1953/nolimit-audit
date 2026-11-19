"""Portable episode exchange. Files in agent-facing exports are explicitly selected."""
import csv
import io
import json
import zipfile


def readable(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n"


def lines(rows):
    return "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n" for row in rows)


def csv_text(rows):
    stream = io.StringIO(newline="")
    if rows:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]), lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: "null" if val is None else val for key, val in row.items()})
    return stream.getvalue()


def public_files(ep):
    tables = ep["tables"]
    return {"manifest.json": readable(ep["manifest"]), "policy.json": readable(ep["policy"]),
            "ledger.csv": csv_text(tables["ledger"]), "fx.csv": csv_text(tables["fx"]),
            "invoices.jsonl": lines(tables["invoices"]), "payments.jsonl": lines(tables["payments"])}


def add_file(archive, name, data):
    info = zipfile.ZipInfo(name, date_time=(2026, 11, 19, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    archive.writestr(info, data)
