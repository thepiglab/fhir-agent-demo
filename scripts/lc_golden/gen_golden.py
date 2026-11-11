"""Lc golden fixtures from fhir_suite_harness at 7da3ad1: render_compact_v2 over real store results
(the demo's served shards) plus hand-made edge cases, and lc_system_prompt over the demo's prompts.

PYTHONPATH=<7da3ad1>/environments/fhir_query_rl python gen_golden.py results.jsonl <demo> out.jsonl.gz
"""
import base64
import collections
import gzip
import json
import random
import sys

from fhir_suite_harness.profiles.c_parts import lc_system_prompt
from fhir_suite_harness.render import render_compact_v2

results_path, demo, out_path = sys.argv[1:4]
random.seed(0)

rows = [json.loads(line) for line in open(results_path)]
by_tag = collections.defaultdict(list)
for r in rows:
    by_tag[r["tag"]].append(r)

picked = []
for tag, items in sorted(by_tag.items()):
    kind = tag.split(":")[0]
    keep = {"search": 4, "page": 2, "page2": 2, "include": 6, "read": 1, "write": 4, "error": 3, "empty": 1, "patient-search": 3}[kind]
    picked += random.sample(items, min(keep, len(items)))


def long_values(r):
    body = json.loads(r["result"]).get("body") or {}
    return any(
        len(json.dumps(v, ensure_ascii=False)) > 300
        for e in body.get("entry", []) if isinstance(e.get("resource"), dict) for v in e["resource"].values()
    )


# every real search with a value longer than the cut, up to 60 more
longs = [r for r in rows if r["tag"].split(":")[0] in {"search", "include"} and r not in picked and long_values(r)]
picked += random.sample(longs, min(60, len(longs)))

b64 = lambda s: base64.b64encode(s.encode("utf-8") if isinstance(s, str) else s).decode()
astral = "𝔄𝔅" * 200  # astral characters across the 300-character cut
edge_resources = [
    {"resourceType": "Observation", "id": "edge-1", "meta": {"versionId": "3", "lastUpdated": "x"}, "status": "final",
     "valueBoolean": True, "issued": None, "note": [{"text": "   "}], "valueQuantity": {"value": 13.0, "unit": "g/dL"},
     "referenceRange": [{"low": {"value": 1e-05, "unit": "x"}, "high": {"value": 1e16}}, {"high": {"value": 5, "code": "mg"}, "text": "adult"}],
     "component": [{"code": {"text": "only text"}, "valueQuantity": {"value": 2, "comparator": "<", "system": "http://unitsofmeasure.org", "code": "mmol/L"}}],
     "effectivePeriod": {}, "category": [{"coding": [{"system": "s", "code": "c", "display": "D"}], "text": "D"}],
     "code": {"coding": [{"code": "nosys"}, {"system": "s2", "code": "c2"}], "text": "other text"},
     "extension": [{"url": "u"}], "text": {"div": "<div/>"}, "language": "en"},
    {"resourceType": "Patient", "id": "edge-2", "identifier": [{"system": "urn:mrn", "value": "A1", "use": "usual"}, {"value": 7, "system": "num"}],
     "active": False, "multipleBirthInteger": 2, "deceasedBoolean": False, "name": [{"family": "Z", "given": ["A", "B"]}],
     "managingOrganization": {"reference": "Organization/o1", "display": "Org"}, "link": [{"other": {"reference": "Patient/p2"}, "type": "seealso"}],
     "address": [{"line": [astral], "city": "C"}]},
    {"resourceType": "DocumentReference", "id": "edge-3", "meta": {"versionId": "1"}, "content": [
        {"attachment": {"contentType": "text/plain", "data": b64("short note é ✓"), "title": "T"}},
        {"attachment": {"contentType": "text/plain", "data": b64("long " * 120)}, "format": {"code": "f"}},
        {"attachment": {"contentType": "application/pdf", "data": b64(b"%PDF-1.4 \x00\x01")}},
        {"attachment": {"contentType": "text/plain", "data": "not base64!"}},
        {"attachment": {"contentType": "text/plain", "data": "abc"}},
        {"attachment": {"contentType": "text/plain", "data": b64(b"\xff\xfe\x00")}},
        {"attachment": {"data": b64("﻿bom text")}},
        {"attachment": {"contentType": "text/html", "url": "http://x/y"}},
        {"attachment": {"url": "http://x/z", "title": ""}},
        {"attachment": {"contentType": "", "data": ""}},
    ], "description": "d" * 300, "docStatus": "e" * 301},
    {"resourceType": "Media", "id": "edge-4", "content": {"contentType": "text/plain", "data": b64("inline")}, "weird": {"a": [1, 2.5, None], "b": "ü"},
     "partOf": [{"reference": "Procedure/p", "type": "Procedure", "identifier": {"value": "x"}}], "nested": [[1, 2], []], "emptyList": [], "emptyStr": "",
     "valueRange": {"low": {"value": 1}}, "valueRatio": {"numerator": {"value": 1}, "denominator": {"value": 2}}, "t": "tab\tnew\nline \"q\""},
]
edge_resources += [  # each attachment shape on its own row, so the cut hides none
    {"resourceType": "DocumentReference", "id": f"att-{i}", "content": [c]}
    for i, c in enumerate(edge_resources[2]["content"])
]
edge_cases = [
    ("edge:resources", {"status": 200, "headers": {}, "body": {"resourceType": "Bundle", "type": "searchset", "total": 4,
     "link": [{"relation": "self", "url": "s"}, {"relation": "prev", "url": "p"}, {"relation": "previous"}, {"relation": "next", "url": "n?a=1&b=2"}],
     "entry": [{"resource": r, "search": {"mode": "match" if i else "include"}} for i, r in enumerate(edge_resources)]}}),
    ("edge:odd-entries", {"status": 200, "headers": {}, "body": {"resourceType": "Bundle", "type": "searchset",
     "entry": [{"fullUrl": "x"}, {"resource": {"id": "noType"}}, {"resource": "str"}, {"resource": {"resourceType": "", "id": "e"}}, {"resource": {"resourceType": "Flag", "id": "f1"}}]}}),
    ("edge:empty-no-total", {"status": 200, "headers": {}, "body": {"resourceType": "Bundle", "type": "searchset", "entry": []}}),
    ("edge:no-entry-key", {"status": 200, "headers": {"ETag": "W/\"1\""}, "body": {"resourceType": "Bundle", "type": "searchset", "total": 0}}),
    ("edge:total-null", {"status": 200, "headers": {}, "body": {"resourceType": "Bundle", "type": "searchset", "total": None, "entry": [{"resource": {"resourceType": "Flag", "id": "f2", "status": "active"}}]}}),
    ("edge:no-type", {"status": 200, "headers": {}, "body": {"resourceType": "Bundle", "entry": [{"resource": {"resourceType": "Flag", "id": "f3"}}]}}),
    ("edge:transaction", {"status": 200, "headers": {}, "body": {"resourceType": "Bundle", "type": "transaction-response", "entry": [{"resource": {"resourceType": "Flag", "id": "f4"}}, {"response": {"status": "204"}}]}}),
    ("edge:status-304", {"status": 304, "headers": {}, "body": {"resourceType": "Bundle", "type": "searchset", "entry": []}}),
    ("edge:body-list", {"status": 200, "headers": {}, "body": [1, 2]}),
    ("edge:body-null", {"status": 204, "headers": {}, "body": None}),
    ("edge:read-no-id", {"status": 200, "headers": {}, "body": {"resourceType": "CapabilityStatement", "fhirVersion": "4.0.1"}}),
]

cases = []
for r in picked:
    result = json.loads(r["result"])
    cases.append((r["tag"], r["result"], result))
for tag, result in edge_cases:
    cases.append((tag, json.dumps(result, ensure_ascii=False), result))

out = gzip.open(out_path, "wt", encoding="utf-8")
n = collections.Counter()
for tag, text, result in cases:
    rendered = render_compact_v2(result)
    out.write(json.dumps({"kind": "render", "tag": tag, "result": text, "text": rendered.text,
                          "exposed": {k: sorted(v) for k, v in rendered.exposed.items()}}, ensure_ascii=False) + "\n")
    n["searchset" if result.get("body", {}).__class__ is dict and (result["body"] or {}).get("type") == "searchset" else "other"] += 1

cfg = json.load(open(f"{demo}/public/data/config.json"))
conventions = open(f"{demo}/src/chart/charting_conventions_v0234.txt").read()
for name, system in [("config.system_prompt", cfg["system_prompt"]), ("conventions", conventions), ("empty", ""), ("unicode", "é ✓ 𝔄\n")]:
    out.write(json.dumps({"kind": "system", "tag": name, "system": system, "text": lc_system_prompt(system)}, ensure_ascii=False) + "\n")
out.close()
print(dict(n), len(cases))
