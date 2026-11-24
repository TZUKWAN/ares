import copy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from rubric_evidence import validate_provenance, field_values, evidence_summary, source_locator


class RubricEvidenceTests(unittest.TestCase):
    def load(self):
        return json.loads((ROOT / "data/rubrics/005.json").read_text(encoding="utf-8"))

    def test_all_archives_have_complete_honest_source_states(self):
        for path in sorted((ROOT / "data/rubrics").glob("*.json")):
            with self.subTest(path=path.name):
                rubric = json.loads(path.read_text(encoding="utf-8"))
                self.assertEqual(validate_provenance(rubric, ROOT), [])
                self.assertEqual(len(field_values(rubric)), len(rubric["provenance"]["fields"]))
                self.assertEqual(evidence_summary(rubric)["status"], "unverified")

    def test_mutation_missing_fields_scope_and_false_numeric_certification_fail(self):
        rubric = self.load()
        for mutate in [lambda r: r["judging_dimensions"][0].update(weight="999%"),
                       lambda r: r["sources"][0].update(url="https://example.invalid/changed"),
                       lambda r: r["provenance"]["fields"].pop("/competition_name"),
                       lambda r: r["provenance"]["scope"].update(competitionId=99),
                       lambda r: r.update(last_updated="2026-11-19"),
                       lambda r: r["provenance"]["fields"]["/judging_dimensions/0/weight"].update(officialWeight=99),
                       lambda r: r.update(confidence="high")]:
            changed = copy.deepcopy(rubric)
            mutate(changed)
            self.assertTrue(validate_provenance(changed, ROOT))

    def test_source_locator_is_not_clause_verification(self):
        self.assertEqual(source_locator("https://example.org"), "homepage")
        self.assertEqual(source_locator("https://www.so.com/s?q=rule"), "search")
        for value in ["file:///secret", "https://user:pass@example.org/rule", "http://127.0.0.1/rule", "http://localhost/rule"]:
            self.assertEqual(source_locator(value), "invalid")


if __name__ == "__main__":
    unittest.main()
