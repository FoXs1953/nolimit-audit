from copy import deepcopy
import unittest

from auditlab.scoring import score
from auditlab.policies import oracle_submission


def fixture():
    return {
        "manifest": {"episode_id": "unit"},
        "tables": {"invoices": [{"doc_id": "I"}], "payments": [{"doc_id": "P"}],
                   "ledger": [{"row_id": "L"}, {"row_id": "L2"}], "fx": []},
        "truth": [{"issue_id": "T", "type": "payment_allocation", "affected_ids": ["I", "P", "L"],
                   "expected_amount_minor": 2000000, "currency": "KZT",
                   "evidence_sets": [["I", "P", "L"], ["L2", "I"]]}],
    }


class ScoreTests(unittest.TestCase):
    def setUp(self):
        self.case = fixture()
        self.answer = oracle_submission(self.case)
        self.one = self.answer["findings"][0]

    def test_clean_conventions_and_no_findings(self):
        silence = {"episode_id": "unit", "findings": []}
        missed = score(self.case, silence, 1)
        self.assertEqual((missed["reward"], missed["fn"]), (-1, 1))
        self.case["truth"] = []
        clean = score(self.case, silence, 3)
        self.assertEqual((clean["precision"], clean["recall"], clean["f1"]), (0, 0, 1))
        self.assertEqual(clean["reward"], .994)
        false_claim = score(self.case, self.answer, 3)
        self.assertEqual((false_claim["reward"], false_claim["fp"], false_claim["f1"]), (-1, 1, 0))

    def test_duplicates_are_false_positives_and_steps_cost(self):
        self.assertEqual(score(self.case, self.answer, 8)["reward"], .984)
        self.assertGreater(score(self.case, self.answer, 2)["reward"], score(self.case, self.answer, 3)["reward"])
        self.answer["findings"].append(deepcopy(self.one))
        result = score(self.case, self.answer, 8)
        self.assertEqual((result["tp"], result["fp"], result["fn"]), (1, 1, 0))
        self.assertAlmostEqual(result["reward"], 2 * (2 / 3) - 1 - .016)

    def test_normalization_alternatives_and_explanation(self):
        self.one.update(affected_ids=[" L ", "I", "P", "P"], evidence_ids=[" P ", "L", "I"], explanation="")
        self.assertEqual(score(self.case, self.answer, 0)["tp"], 1)
        self.one.update(evidence_ids=["I", "L2"], explanation="Мнение не влияет на награду.")
        self.assertEqual(score(self.case, self.answer, 0)["tp"], 1)

    def test_all_compatibility_conditions(self):
        for field, value in [
            ("affected_ids", ["I", "P"]), ("affected_ids", ["I", "P", "L", "X"]),
            ("currency", "USD"), ("claimed_amount_minor", 2000001), ("type", "period_cutoff"),
            ("evidence_ids", ["I"]), ("evidence_ids", ["I", "L2", "unknown"]), ("evidence_ids", []),
        ]:
            with self.subTest(field=field, value=value):
                answer = deepcopy(self.answer)
                answer["findings"][0][field] = value
                result = score(self.case, answer, 1)
                self.assertEqual((result["valid"], result["tp"], result["fp"], result["fn"]), (True, 0, 1, 1))

    def test_maximum_matching_handles_overlapping_tolerances(self):
        broad = self.case["truth"][0]
        broad.update(issue_id="A", expected_amount_minor=100, tolerance_minor=2)
        narrow = deepcopy(broad)
        narrow.update(issue_id="B", expected_amount_minor=101, tolerance_minor=0)
        self.case["truth"].append(narrow)
        both = deepcopy(self.one)
        both["claimed_amount_minor"] = 101
        broad_only = deepcopy(self.one)
        broad_only["claimed_amount_minor"] = 98
        self.answer["findings"] = [both, broad_only]
        result = score(self.case, self.answer, 0)
        self.assertEqual(result["tp"], 2)
        self.assertEqual(result["matches"], [{"finding_index": 0, "issue_id": "B"}, {"finding_index": 1, "issue_id": "A"}])
        self.assertEqual(result, score(self.case, self.answer, 0))
        self.case["truth"].reverse()
        self.assertEqual(result, score(self.case, self.answer, 0))

    def test_marking_many_claims_is_poor(self):
        self.answer["findings"] = [deepcopy(self.one) for _ in range(30)]
        result = score(self.case, self.answer, 4)
        self.assertTrue(result["valid"])
        self.assertEqual(result["fp"], 29)
        self.assertLess(result["reward"], -.85)

    def test_malformed_envelopes_terminate_with_minus_one(self):
        invalid = [None, {}, [], {"episode_id": "other", "findings": []}, {"episode_id": "unit", "findings": [self.one] * 31},
                   {"episode_id": "unit", "findings": [None]}, {"episode_id": "unit", "findings": [], "extra": 1}]
        for field, value in [("claimed_amount_minor", True), ("claimed_amount_minor", "100"),
                             ("claimed_amount_minor", 1.0), ("evidence_ids", ["I"] * 11),
                             ("explanation", "x" * 1001), ("currency", 1), ("affected_ids", [""]),
                             ("evidence_ids", "I"), ("type", None)]:
            change = deepcopy(self.one)
            change[field] = value
            invalid.append({"episode_id": "unit", "findings": [change]})
        self.case["truth"] = []
        for answer in invalid:
            result = score(self.case, answer, 0)
            self.assertFalse(result["valid"])
            self.assertEqual(result["reward"], -1)
            self.assertTrue(result["errors"])

    def test_boundary_lengths_and_tolerance(self):
        self.one["explanation"] = "я" * 1000
        self.one["evidence_ids"] = ["L2", "I"] * 5
        self.one["claimed_amount_minor"] += 1
        self.case["truth"][0]["tolerance_minor"] = 1
        self.assertEqual(score(self.case, self.answer, 0)["tp"], 1)
        self.one["claimed_amount_minor"] += 1
        self.assertEqual(score(self.case, self.answer, 0)["tp"], 0)
