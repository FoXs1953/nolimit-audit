"""Independent checks against public company books and evaluator-only mutation history."""
import copy
import unittest
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_EVEN

from auditlab.generator import ISSUES, TABLE_IDS, generate, generate_demo, generate_period_demo, open_configs, transform


def observed_issues(episode):
    """Reconstruct discrepancies without reading truth, provenance or generator helpers."""
    rows = episode["tables"]
    names = episode["manifest"]["timezone"]
    zone = timezone.utc if names == "UTC" else timezone(timedelta(hours=-int(names[7:])))
    invoices = {doc["invoice_id"]: doc for doc in rows["invoices"]}
    accruals = {}
    posting = {}
    sources = defaultdict(list)
    for row in rows["ledger"]:
        if row["payment_id"] is None and row["account"] == "receivable":
            accruals[row["invoice_id"]] = row
        if row["payment_id"] is not None:
            posting[row["payment_id"], row["account"]] = row
    for inv in invoices.values():
        sources[inv["entity_id"], inv["source_ref"]].append(inv["invoice_id"])
    issues = []
    def add(kind, affected, amount, currency, evidence):
        issues.append((kind, tuple(sorted(affected)), amount, currency, tuple(sorted(evidence))))
    for ids in sources.values():
        if len(ids) == 2:
            doc = invoices[ids[0]]
            add("duplicate_invoice", ids, doc["total_minor"], doc["currency"], ids + [accruals[i]["row_id"] for i in ids])
    rates = {(row["date"], row["source_currency"], row["target_currency"]): row for row in rows["fx"]}
    exp = episode["policy"]["currency_exponents"]
    for pay in rows["payments"]:
        inv_id = pay["invoice_refs"][0]
        pid = pay["payment_id"]
        bank = datetime.fromisoformat(pay["timestamp"]).astimezone(zone)
        cash = posting[pid, "cash"]
        ar = posting[pid, "receivable"]
        target, source = invoices[inv_id]["currency"], pay["currency"]
        booked = cash["debit_minor"] - cash["credit_minor"]
        allocated = ar["credit_minor"] - ar["debit_minor"]
        different_currency = target != source
        if different_currency:
            quote = rates[bank.date().isoformat(), source, target]
            expected = Decimal(pay["amount_minor"]) / 10**exp[source] * Decimal(quote["rate"]) * 10**exp[target]
            diff = abs(int(expected.quantize(Decimal(1), rounding=ROUND_HALF_EVEN)) - booked)
            if diff:
                add("fx_conversion", [pid,cash["row_id"]], diff, target, [pid,cash["row_id"],quote["row_id"]])
        else:
            assert booked == pay["amount_minor"], "bank/cash signed amounts should agree"
        if booked != allocated:
            ids = [pid,inv_id,ar["row_id"]]
            add("payment_allocation", ids, booked - allocated, target, ids + ([cash["row_id"]] if different_currency else []))
        recorded = datetime.fromisoformat(cash["timestamp"]).astimezone(zone)
        if (bank.year, bank.month) != (recorded.year, recorded.month):
            ids = [pid, cash["row_id"]]
            add("period_cutoff", ids, abs(pay["amount_minor"]), source, ids)
    return sorted(issues)


def truth_signature(ep):
    return sorted((issue["type"], tuple(sorted(issue["affected_ids"])), issue["expected_amount_minor"],
                   issue["currency"], tuple(sorted(issue["evidence_sets"][0]))) for issue in ep["truth"])


class EpisodeGeneratorTests(unittest.TestCase):
    def test_all_open_cases_have_independent_public_proof(self):
        seeds = set()
        for split in ("train","dev"):
            configs = open_configs(split)
            self.assertEqual(len(configs), 10)
            for seed,cfg in configs:
                with self.subTest(split=split, seed=seed):
                    self.assertNotIn(seed,seeds)
                    seeds.add(seed)
                    ep = generate(seed,cfg)
                    self.assertEqual(ep["manifest"]["record_counts"], {k:len(v) for k,v in ep["tables"].items()})
                    self.assertGreaterEqual(ep["manifest"]["record_count"],200)
                    self.assertLessEqual(ep["manifest"]["document_count"],200)
                    self.assertEqual(Counter(x["type"] for x in ep["truth"]),Counter(cfg["issues"]))
                    self.assertEqual(truth_signature(ep),observed_issues(ep))
                    for inv in ep["tables"]["invoices"]:
                        self.assertEqual(sum(i["quantity"]*i["unit_price_minor"] for i in inv["line_items"]),inv["total_minor"])
                    balances=Counter()
                    for row in ep["tables"]["ledger"]:
                        self.assertGreaterEqual(min(row["debit_minor"],row["credit_minor"]),0)
                        balances[row["journal_id"],row["currency"]] += row["debit_minor"] - row["credit_minor"]
                    self.assertTrue(all(amount==0 for amount in balances.values()))
                    if cfg["scenario"] in ("fx_period","allocation_period"):
                        types = defaultdict(set)
                        for issue in ep["truth"]:
                            for rid in issue["affected_ids"]:
                                types[rid].add(issue["type"])
                        pair = {"period_cutoff","fx_conversion" if cfg["scenario"]=="fx_period" else "payment_allocation"}
                        self.assertTrue(any(pair.issubset(kinds) for kinds in types.values()))

    def test_causal_edits_are_reversible(self):
        for scenario in ("fx_period", "allocation_period", "mixed"):
            ep = generate(973, {"scenario":scenario, "issues":dict.fromkeys(ISSUES,2)})
            rows = {table:{row[TABLE_IDS[table]]:copy.deepcopy(row) for row in records} for table,records in ep["tables"].items()}
            for event in reversed(ep["provenance"]):
                for edit in reversed(event["changes"]):
                    table = rows[edit["table"]]
                    rid = edit["record_id"]
                    self.assertEqual(table[rid],edit["after"])
                    if edit["before"] is None:
                        del table[rid]
                    else:
                        table[rid] = edit["before"]
            recovered = {**ep,"tables":{table:list(data.values()) for table,data in rows.items()}}
            self.assertEqual(observed_issues(recovered),[])

    def test_paired_and_deterministic(self):
        cfg={"scenario":"fx_period","issues":dict.fromkeys(ISSUES,2)}
        ep=generate(5721,cfg)
        original=copy.deepcopy(ep)
        same=generate(5721,cfg)
        self.assertEqual(ep,same)
        renamed,mapping=transform(ep,42100)
        self.assertEqual(ep,original)
        self.assertEqual((renamed,mapping),transform(same,42100))
        self.assertEqual(len(mapping),len(set(mapping.values())))
        self.assertTrue(set(mapping).isdisjoint(mapping.values()))
        self.assertEqual(observed_issues(renamed),truth_signature(renamed))
        first=truth_signature(ep)
        expected=sorted((kind,tuple(sorted(mapping[i] for i in ids)),amount,ccy,tuple(sorted(mapping[i] for i in evidence)))
                        for kind,ids,amount,ccy,evidence in first)
        self.assertEqual(expected,truth_signature(renamed))
        self.assertNotEqual(ep["manifest"]["episode_id"],generate(5722,cfg)["manifest"]["episode_id"])
        for table,records in ep["tables"].items():
            key=TABLE_IDS[table]
            self.assertNotEqual([mapping[r[key]] for r in records],[r[key] for r in renamed["tables"][table]])

    def test_clean_distractors_remain_clean(self):
        ep=generate(88,{"scenario":"clean"})
        self.assertEqual(ep["truth"],[])
        self.assertEqual(ep["provenance"],[])
        self.assertEqual(observed_issues(ep),[])
        payments=ep["tables"]["payments"]
        self.assertTrue(any(p["amount_minor"]<0 for p in payments))
        self.assertTrue(any(n>1 for n in Counter(p["invoice_refs"][0] for p in payments if p["amount_minor"]>0).values()))
        counter=Counter((i["entity_id"],i["currency"],i["total_minor"]) for i in ep["tables"]["invoices"])
        self.assertTrue(any(n>1 for n in counter.values()))

    def test_limits_and_fixtures(self):
        for cfg in ({"issues":{"bogus":1}},{"issues":{"fx_conversion":True}},
                    {"issues":{"period_cutoff":13}},{"scenario":"fx_period","issues":{}},
                    {"scenario":"clean","issues":{"duplicate_invoice":1}}):
            with self.assertRaises(ValueError):
                generate(11,cfg)
        dense=generate(78,{"issues":dict.fromkeys(ISSUES,3)})
        self.assertEqual(len(observed_issues(dense)),12)
        demo,period=generate_demo(),generate_period_demo()
        self.assertEqual(truth_signature(demo),observed_issues(demo))
        self.assertEqual(truth_signature(period),observed_issues(period))
        self.assertEqual(demo["truth"][0]["expected_amount_minor"],2_000_000)
        self.assertEqual(set(period["truth"][0]["affected_ids"]),{"PAY-088","L-208"})


if __name__ == "__main__":
    unittest.main()
