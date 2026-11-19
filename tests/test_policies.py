import unittest

from auditlab.policies import policy_actions, run_policy


def public_case():
    def payment(pid, currency, amount, timestamp, iid):
        return {"payment_id": pid, "doc_id": pid, "invoice_refs": [iid], "currency": currency,
                "amount_minor": amount, "timestamp": timestamp}
    def line(lid, account, iid, pid, debit=0, credit=0, stamp="2026-10-31T18:50:00Z"):
        return {"row_id": lid, "account": account, "invoice_id": iid, "payment_id": pid,
                "debit_minor": debit, "credit_minor": credit, "currency": "KZT", "timestamp": stamp}
    invoices = [{"doc_id": iid, "invoice_id": iid, "entity_id": "Acme", "total_minor": 400000,
                 "currency": "KZT", "source_ref": source} for iid, source in [
                    ("I", "reference"), ("I2", "reference"), ("I3", "lawful recurring invoice")]]
    return {
        "invoices": invoices,
        "payments": [payment("P", "USD", 30000, "2026-10-31T21:00:00Z", "I"),
                     payment("R", "KZT", -1000, "2026-10-31T18:50:00Z", "I3")],
        "fx": [
            {"date": "2026-10-31", "source_currency": "USD", "target_currency": "KZT", "rate": "2", "row_id": "old"},
            {"date": "2026-11-01", "source_currency": "USD", "target_currency": "KZT", "rate": "3", "row_id": "new"}],
        "ledger": [
            line("a1", "receivable", "I", None, debit=400000),
            line("a2", "receivable", "I2", None, debit=400000),
            line("a3", "receivable", "I3", None, debit=400000),
            line("bank", "cash", None, "P", debit=60000),
            line("alloc", "receivable", "I", "P", credit=59000),
            line("refund", "cash", None, "R", credit=1000),
            line("alloc-refund", "receivable", "I3", "R", debit=1000)],
    }


def observe_only(name, seed=1):
    tables = public_case()
    initial = {"manifest": {"episode_id": "public", "timezone": "Etc/GMT-5"},
               "policy": {"currency_exponents": {"USD": 2, "KZT": 2}}, "remaining_steps": 100}
    actions = []
    def step(action):
        actions.append(action)
        obs = {"remaining_steps": 100 - len(actions)}
        if action["tool"] == "submit":
            return (obs, 0, True, False, {})
        table = tables[action["table"]]
        if action["tool"] == "list_records":
            # The tiny test runner pages two rows at a time to exercise continuation.
            offset = int(action["cursor"] or 0)
            stop = offset + min(2, action["limit"])
            obs["result"] = {"records": table[offset:stop], "next_cursor": str(stop) if stop < len(table) else None}
        else:
            obs["result"] = next(row for row in table if (row.get("row_id") or row.get("doc_id")) == action["id"])
        return (obs, 0, False, False, {})
    result = run_policy(name, initial, step, random_seed=seed)
    assert result[2]
    return actions


class PolicyTests(unittest.TestCase):
    def test_public_policy_detects_all_four_using_local_fx_date_and_evidence(self):
        findings = observe_only("reconcile")[-1]["findings"]["findings"]
        by_type = {f["type"]: f for f in findings}
        self.assertEqual(len(findings), 4)
        self.assertEqual(by_type["fx_conversion"]["claimed_amount_minor"], 30000)
        self.assertEqual(by_type["fx_conversion"]["evidence_ids"], ["P", "bank", "new"])
        self.assertEqual(by_type["period_cutoff"]["currency"], "USD")
        self.assertEqual(by_type["payment_allocation"]["claimed_amount_minor"], 1000)
        self.assertEqual(by_type["duplicate_invoice"]["affected_ids"], ["I", "I2"])

    def test_explorer_reproducible_and_seeded_independently(self):
        self.assertEqual(observe_only("random"), observe_only("random"))
        self.assertNotEqual(observe_only("random"), observe_only("random", seed=16))

    def test_bulk_claims_respect_submission_limit(self):
        findings = observe_only("mark_all")[-1]["findings"]["findings"]
        self.assertTrue(0 < len(findings) <= 30)
        self.assertEqual(len({f["type"] for f in findings}), 4)

    def test_reserves_final_step_and_no_privileged_adapter(self):
        obs = {"remaining_steps": 1, "manifest": {"episode_id": "episode", "timezone": "UTC"}, "policy": {}}
        for name in ("random", "mark_all", "reconcile"):
            self.assertEqual(next(policy_actions(name, obs))["tool"], "submit")
        with self.assertRaises(ValueError):
            next(policy_actions("oracle", obs))
