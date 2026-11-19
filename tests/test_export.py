import json
from pathlib import Path
import tempfile
import unittest

from auditlab.export import export


class ExportTests(unittest.TestCase):
    def test_outputs_stay_separate_and_are_repeatable(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            public, private = base / "public", base / "private"
            for first, second in ((public, public), (public, public / "truth"), (public / "sample", public)):
                with self.assertRaises(ValueError):
                    export([(12, {})], first, second)
            self.assertEqual(list(base.iterdir()), [])
            recipe = [(12, {"scenario": "allocation_period"})]
            export(recipe, public, private)
            self.assertEqual({p.name for p in public.iterdir()},
                             {"manifest.json","policy.json","ledger.csv","fx.csv","payments.jsonl","invoices.jsonl"})
            self.assertEqual({p.name for p in private.iterdir()}, {"truth.json","provenance.json"})
            provenance = json.loads((private / "provenance.json").read_text())
            manifest = json.loads((public / "manifest.json").read_text())
            self.assertEqual((provenance["episode_id"], provenance["seed"]), (manifest["episode_id"],12))
            original = (public / "ledger.csv").read_bytes()
            export(recipe, public, private)
            with self.assertRaises(ValueError):
                export([(13, {})], public, private)
            self.assertEqual((public / "ledger.csv").read_bytes(), original)

    def test_schema_references_stay_local(self):
        folder = Path(__file__).resolve().parents[1] / "docs" / "schemas"
        docs = {p.name: json.loads(p.read_text()) for p in folder.glob("*.json")}
        self.assertTrue({"manifest.json", "policy.json", "action.json", "reset.json", "step.json",
                         "records.json","findings.json","truth.json","provenance.json","trajectory.json"} <= docs.keys())

        def visit(value, local_name):
            if isinstance(value, list):
                for item in value:
                    visit(item,local_name)
            elif isinstance(value, dict):
                if "$ref" in value:
                    file, _, fragment = value["$ref"].partition("#")
                    target = docs[file or local_name]
                    for key in fragment.split("/")[1:]:
                        target = target[key]
                for sub in value.values():
                    visit(sub,local_name)

        for name, schema in docs.items():
            self.assertEqual(schema["$schema"],"https://json-schema.org/draft/2020-12/schema")
            visit(schema,name)
