"""Policy adapters. Ordinary policies consume observations and emit JSON actions.

The oracle is a separate trusted adapter; its input contains private truth and is
never supplied to the three ordinary policies.
"""

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_EVEN, localcontext
from itertools import combinations
from random import Random
from zoneinfo import ZoneInfo

TABLES = ("invoices", "payments", "ledger", "fx")
ISSUE_TYPES = ("duplicate_invoice", "payment_allocation", "fx_conversion", "period_cutoff")


def _claim(kind, affected, amount, currency, evidence, explanation):
    return {"type": kind, "affected_ids": sorted(set(affected)),
            "claimed_amount_minor": amount, "currency": currency,
            "evidence_ids": sorted(set(evidence)), "explanation": explanation}


def _submit(episode_id, findings):
    return {"tool": "submit", "findings": {"episode_id": episode_id, "findings": findings}}


def oracle_submission(episode):
    """Evaluator-only maximum. Must run in the trusted process."""
    findings = [
        _claim(issue["type"], issue["affected_ids"], issue["expected_amount_minor"],
               issue["currency"], min(issue["evidence_sets"], key=lambda ids: (len(ids), sorted(ids))),
               "Расхождение подтверждено документами.")
        for issue in sorted(episode["truth"], key=lambda item: item["issue_id"])
    ]
    return {"episode_id": episode["manifest"]["episode_id"], "findings": findings}


def _zone(name):
    if name in ("Z", "UTC"):
        return timezone.utc
    offset = name.removeprefix("UTC")
    if offset.startswith(("+", "-")):
        hours, _, minutes = offset[1:].partition(":")
        delta = timedelta(hours=int(hours), minutes=int(minutes or "0"))
        return timezone(delta if offset[0] == "+" else -delta)
    return ZoneInfo(name)


def _local_date(stamp, zone):
    instant = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    return instant.astimezone(zone).date()


def _duplicate_claims(invoices, accruals):
    by_reference = defaultdict(list)
    for invoice in invoices:
        if invoice.get("source_ref"):
            by_reference[invoice["entity_id"], invoice["source_ref"]].append(invoice)
    for group in by_reference.values():
        for first, second in combinations(sorted(group, key=lambda item: item["invoice_id"]), 2):
            left, right = first["invoice_id"], second["invoice_id"]
            if left not in accruals or right not in accruals:
                continue
            if first["currency"] == second["currency"] and first["total_minor"] == second["total_minor"]:
                yield _claim("duplicate_invoice", [left, right], first["total_minor"], first["currency"],
                             [first["doc_id"], second["doc_id"], accruals[left]["row_id"], accruals[right]["row_id"]],
                             "Один первичный номер поставщика использован в двух отдельно проведённых счетах.")


def _convert(source_minor, source_exp, target_exp, rate):
    with localcontext() as context:
        context.prec = 50
        scaled = Decimal(source_minor).scaleb(target_exp - source_exp) * Decimal(rate)
        return int(scaled.to_integral_value(rounding=ROUND_HALF_EVEN))


def _reconcile(tables, manifest, policy):
    """Derive errors from posted documents, account meanings, FX and period policy."""
    invoices = {inv["invoice_id"]: inv for inv in tables["invoices"]}
    accruals, cash, applied = {}, {}, {}
    for line in tables["ledger"]:
        account = line["account"]
        if line["payment_id"] is None:
            if account == "receivable" and line["debit_minor"] > 0:
                accruals[line["invoice_id"]] = line
        elif account == "cash":
            cash[line["payment_id"]] = line
        elif account == "receivable":
            applied[line["payment_id"]] = line

    findings = list(_duplicate_claims(invoices.values(), accruals))
    rates = {(row["date"], row["source_currency"], row["target_currency"]): row for row in tables["fx"]}
    zone = _zone(manifest["timezone"])
    exponents = policy.get("currency_exponents", {})
    for pay in tables["payments"]:
        refs = pay["invoice_refs"]
        pid = pay["payment_id"]
        if not refs or len(refs) != 1 or refs[0] not in invoices or pid not in cash:
            continue
        if pay["amount_minor"] <= 0:  # Refunds carry opposite entries and can be legitimate.
            continue
        inv, bank, allocation = invoices[refs[0]], cash[pid], applied.get(pid)
        iid = inv["invoice_id"]
        source, target = pay["currency"], inv["currency"]
        foreign = source != target
        gross = bank["debit_minor"] if foreign else pay["amount_minor"]
        if allocation and gross > allocation["credit_minor"]:
            evidence = [inv["doc_id"], pay["doc_id"], allocation["row_id"]]
            if foreign:
                evidence.append(bank["row_id"])
            findings.append(_claim("payment_allocation", [iid, pid, allocation["row_id"]],
                                   gross - allocation["credit_minor"], target, evidence,
                                   "Сумма поступления превышает сумму, распределённую на указанный счёт."))

        paid = _local_date(pay["timestamp"], zone)
        posted = _local_date(bank["timestamp"], zone)
        if (paid.year, paid.month) != (posted.year, posted.month):
            findings.append(_claim("period_cutoff", [pid, bank["row_id"]], pay["amount_minor"], source,
                                   [pay["doc_id"], bank["row_id"]],
                                   "Дата поступления и дата проводки относятся к разным местным отчётным месяцам."))
        if not foreign:
            continue
        fx = rates.get((paid.isoformat(), source, target))
        if fx and source in exponents and target in exponents:
            expected = _convert(pay["amount_minor"], exponents[source], exponents[target], fx["rate"])
            discrepancy = abs(expected - bank["debit_minor"])
            if discrepancy:
                findings.append(_claim("fx_conversion", [pid, bank["row_id"]], discrepancy, target,
                                       [pay["doc_id"], bank["row_id"], fx["row_id"]],
                                       "Сумма конвертации расходится с курсом на местную дату платежа."))
    return sorted(findings, key=lambda f: (f["type"], f["affected_ids"]))[:30]


def _mark_all(records):
    findings = []
    for record in records:
        for kind in ISSUE_TYPES:
            findings.append(_claim(kind, [record["row_id"]], abs(record["debit_minor"] - record["credit_minor"]),
                                   record["currency"], [record["row_id"]],
                                   "Базовая политика помечает каждую просмотренную строку."))
            if len(findings) == 30:
                return findings
    return findings


def policy_actions(name, initial_observation, *, random_seed=0):
    """Yield the next action; send back only that action's public observation.

    Seed controls the explorer's own choices, independently of the episode seed.
    Paging never spends the reserved final submission step.
    """
    manifest = initial_observation["manifest"]
    eid = manifest["episode_id"]
    obs = initial_observation
    if name == "random":
        rng = Random(random_seed)
        for _ in range(8):
            if obs["remaining_steps"] <= 1:
                break
            table = rng.choice(TABLES)
            obs = yield {"tool": "list_records", "table": table, "cursor": None, "limit": rng.randint(1, 30)}
            result = obs.get("result")
            rows = result.get("records", []) if isinstance(result, dict) else []
            if rows and obs["remaining_steps"] > 1:
                row = rng.choice(rows)
                obs = yield {"tool": "get_record", "table": table, "id": row.get("row_id") or row["doc_id"]}
        yield _submit(eid, [])
        return
    if name == "mark_all":
        records = []
        if obs["remaining_steps"] > 1:
            obs = yield {"tool": "list_records", "table": "ledger", "cursor": None, "limit": 50}
            records = (obs.get("result") or {}).get("records", [])
        yield _submit(eid, _mark_all(records))
        return
    if name != "reconcile":
        raise ValueError("Unknown observation-only policy")
    tables = {table: [] for table in TABLES}
    for table in TABLES:
        cursor = None
        while obs["remaining_steps"] > 1:
            obs = yield {"tool": "list_records", "table": table, "cursor": cursor, "limit": 50}
            page = obs.get("result") or {}
            tables[table].extend(page.get("records", []))
            cursor = page.get("next_cursor")
            if cursor is None:
                break
    findings = _reconcile(tables, manifest, initial_observation["policy"])
    yield _submit(eid, findings)


def run_policy(name, initial_observation, step, *, random_seed=0):
    """Run an observation-only adapter against step and return its terminal tuple."""
    actions = policy_actions(name, initial_observation, random_seed=random_seed)
    action = next(actions)
    while True:
        result = step(action)
        observation, _, terminated, truncated, _ = result
        if terminated or truncated:
            return result
        action = actions.send(observation)
