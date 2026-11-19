"""Synthetic company journal, causal mutations and permitted paired transformations."""
from __future__ import annotations

import calendar
import copy
import hashlib
import random
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_EVEN

VERSION = "1.0.0"
ISSUES = ("duplicate_invoice", "payment_allocation", "fx_conversion", "period_cutoff")
EXPONENTS = {"KZT": 2, "USD": 2, "EUR": 2, "JPY": 0}
KZT_PRICE = {"KZT": 1, "USD": 505, "EUR": 545, "JPY": Decimal("3.4")}
COMPANIES = ("Орион", "Алатау", "Север", "Маяк", "Аспан", "Исток", "Керуен", "Арка")
GOODS = ("Керамика", "Стекло", "Мебель", "Упаковка", "Печать", "Текстиль", "Освещение")
TABLE_IDS = {"ledger": "row_id", "invoices": "doc_id", "payments": "doc_id", "fx": "row_id"}


def _rng(seed, namespace):
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise ValueError("seed must be an integer")
    material = (VERSION + ":" + namespace + ":" + str(seed)).encode()
    return random.Random(int.from_bytes(hashlib.sha256(material).digest(), "big"))


def _zone(name):
    if not isinstance(name, str):
        raise ValueError("timezone must be a string")
    if name == "UTC":
        return timezone.utc
    if name.startswith("Etc/GMT") and len(name) > 7:
        hours = -int(name[7:])  # POSIX/IANA Etc/GMT signs are reversed.
        if -12 <= hours <= 14:
            return timezone(timedelta(hours=hours))
    raise ValueError("timezone must be UTC or an Etc/GMT fixed-offset zone")


def _month(period):
    if not isinstance(period, str) or len(period) != 7:
        raise ValueError("period must have format YYYY-MM")
    first = date.fromisoformat(period + "-01")
    last = first.replace(day=calendar.monthrange(first.year, first.month)[1])
    return first, last + timedelta(days=1)


def convert_minor(amount, source, target, rate):
    scale = Decimal(10) ** (EXPONENTS[target] - EXPONENTS[source])
    return int((Decimal(amount) * Decimal(rate) * scale).quantize(Decimal(1), rounding=ROUND_HALF_EVEN))


def _stamp(ts):
    return ts.isoformat(timespec="seconds")


class _Company:
    def __init__(self, rng, period, zone, base, name, episode_id=None):
        self.rng = rng
        self.zone = _zone(zone)
        self.first, self.end = _month(period)
        self.currencies = list(EXPONENTS)
        self.ids = set()
        self.tables = {name: [] for name in TABLE_IDS}
        self.truth = []
        self.provenance = []
        self.fx_index = {}
        self.manifest = {
            "schema_version": VERSION, "generator_version": VERSION,
            "episode_id": episode_id or self.key("EP"), "company": name,
            "base_currency": base, "timezone": zone,
            "period_start": _stamp(self.at(self.first)), "period_end": _stamp(self.at(self.end)),
            "currency_exponents": dict(EXPONENTS), "rounding": "ROUND_HALF_EVEN",
        }
        self.policy = {
            "policy_version": VERSION, "currency_exponents": dict(EXPONENTS),
            "rounding": "ROUND_HALF_EVEN", "amount_tolerance_minor": 0,
            "fx_date": "payment local calendar date in manifest.timezone",
            "rate_direction": "one source major unit priced in target major units",
            "period": "recognize cash on payment local date; period_start inclusive, period_end exclusive; adjacent-month records are supplied as evidence",
            "document_identity": "source_ref identifies one original vendor invoice within entity_id; distinct source documents may repeat an amount",
            "allocation": "Each non-refund payment lists one invoice. Allocate its entire booked cash amount to receivable in invoice currency. A positive suspense balance is the unallocated amount.",
            "journal": "Invoice booking: debit receivable, credit revenue. Receipt: debit cash, credit receivable. Negative refund reverses this pair and reopens the balance. Foreign receipts use the cash posting's target currency.",
        }
        self._make_rates()

    def key(self, prefix):
        while True:
            key = f"{prefix}-{self.rng.randrange(1, 0x10000000):07X}"
            if key not in self.ids:
                self.ids.add(key)
                return key

    def at(self, day, hour=0, minute=0):
        return datetime.combine(day, time(hour, minute), self.zone)

    def _make_rates(self):
        day = self.first - timedelta(days=4)
        while day <= self.end + timedelta(days=3):
            prices = {k: Decimal(v) * Decimal(self.rng.randrange(9850, 10151)) / 10000
                      for k, v in KZT_PRICE.items()}
            for source in self.currencies:
                for target in self.currencies:
                    if source == target:
                        continue
                    rate = (prices[source] / prices[target]).quantize(Decimal("0.0000000001"))
                    row = {"row_id": self.key("FX"), "date": day.isoformat(),
                           "source_currency": source, "target_currency": target, "rate": format(rate, "f")}
                    self.fx_index[(day, source, target)] = row
                    self.tables["fx"].append(row)
            day += timedelta(days=1)

    def conversion(self, amount, source, target, day):
        if source == target:
            return amount
        return convert_minor(amount, source, target, self.fx_index[day, source, target]["rate"])

    def split(self, delta):
        return {"debit_minor": max(delta, 0), "credit_minor": max(-delta, 0)}

    def journal(self, account, signed, cur, when, entity, inv_id, pay_id, journal_id, row_id=None):
        row = {"row_id": row_id or self.key("L"), "timestamp": _stamp(when),
               "account": account, **self.split(signed), "currency": cur, "entity_id": entity,
               "invoice_id": inv_id, "payment_id": pay_id, "journal_id": journal_id}
        self.tables["ledger"].append(row)
        return row

    def sale(self, entity, target, issued, receipts, *, inv_id=None):
        """Create a single genuine sale and its bank events; amounts are in source minor units."""
        inv_id = inv_id or self.key("INV")
        amounts = [self.conversion(r["amount"], r["currency"], target, r["when"].date()) for r in receipts]
        total = sum(a for a in amounts if a > 0)
        document = {"doc_id": inv_id, "invoice_id": inv_id, "entity_id": entity,
                    "issued_at": _stamp(issued), "due_at": _stamp(issued + timedelta(days=30)),
                    "currency": target, "total_minor": total, "source_ref": self.key("REF"),
                    "line_items": [{"description": self.rng.choice(GOODS), "quantity": 1,
                                    "unit_price_minor": total, "amount_minor": total}]}
        self.tables["invoices"].append(document)
        journal_id = self.key("J")
        ar = self.journal("receivable", total, target, issued, entity, inv_id, None, journal_id)
        revenue = self.journal("revenue", -total, target, issued, entity, inv_id, None, journal_id)
        booked = []
        for spec, gross in zip(receipts, amounts):
            pay_id = spec.get("id") or self.key("PAY")
            when = spec["when"]
            # The bank can transmit a UTC timestamp while the journal uses local clock time.
            raw_time = when.astimezone(timezone.utc) if spec.get("utc", False) else when
            payment = {"doc_id": pay_id, "payment_id": pay_id, "timestamp": _stamp(raw_time),
                       "currency": spec["currency"], "amount_minor": spec["amount"], "invoice_refs": [inv_id],
                       "kind": "refund" if gross < 0 else "receipt"}
            self.tables["payments"].append(payment)
            reference = self.key("J")
            cash = self.journal("cash", gross, target, when, entity, None, pay_id, reference, spec.get("cash"))
            allocation = self.journal("receivable", -gross, target, when, entity, inv_id, pay_id, reference, spec.get("allocation"))
            item = {"invoice": document, "payment": payment, "cash": cash, "allocation": allocation}
            booked.append(item)
        return document, ar, revenue, booked

    def patch(self, changes, table, row, **attrs):
        before = copy.deepcopy(row)
        row.update(attrs)
        changes.append({"table": table, "record_id": row[TABLE_IDS[table]],
                        "before": before, "after": copy.deepcopy(row)})

    def inserted(self, changes, table, row):
        changes.append({"table": table, "record_id": row[TABLE_IDS[table]],
                        "before": None, "after": copy.deepcopy(row)})

    def issue(self, kind, affected, amount, currency, evidence, changes):
        number = self.key("I")
        self.truth.append({"issue_id": number, "type": kind, "affected_ids": sorted(affected),
                           "expected_amount_minor": amount, "currency": currency,
                           "evidence_sets": [sorted(evidence)], "tolerance_minor": 0})
        self.provenance.append({"issue_id": number, "operation": kind, "changes": changes})

    def duplicate(self, sale):
        inv, ar, revenue, _ = sale
        new = copy.deepcopy(inv)
        new["invoice_id"] = new["doc_id"] = self.key("INV")
        self.tables["invoices"].append(new)
        changes = []
        self.inserted(changes, "invoices", new)
        journal = self.key("J")
        booking = []
        for original in (ar, revenue):
            row = {**original, "row_id": self.key("L"), "invoice_id": new["invoice_id"], "journal_id": journal}
            self.tables["ledger"].append(row)
            self.inserted(changes, "ledger", row)
            booking.append(row)
        ids = [inv["doc_id"], new["doc_id"]]
        self.issue("duplicate_invoice", ids, inv["total_minor"], inv["currency"],
                   ids + [ar["row_id"], booking[0]["row_id"]], changes)

    def bad_fx(self, event):
        pay, cash, alloc = event["payment"], event["cash"], event["allocation"]
        target, source = cash["currency"], pay["currency"]
        day = datetime.fromisoformat(pay["timestamp"]).astimezone(self.zone).date()
        right = self.fx_index[day, source, target]
        correct_amount = cash["debit_minor"]
        candidates = [fx for (d, s, t), fx in self.fx_index.items() if s == source and t == target and d < day]
        # Use an actual different published quote. Avoid a no-op after unit rounding.
        alternatives = [(q, convert_minor(pay["amount_minor"], source, target, q["rate"])) for q in candidates]
        candidates = [(q, amt) for q, amt in alternatives if amt != correct_amount]
        if candidates:
            wrong, wrong_amount = self.rng.choice(candidates)
            wrong_rate = wrong["rate"]
        else:
            # Stable market quotes can quantize to the same minor amount. In that case
            # record a genuine rate-entry error large enough to affect at least one unit.
            wrong = right
            unit_scale = Decimal(10) ** (EXPONENTS[target] - EXPONENTS[source])
            wrong_rate = format(Decimal(right["rate"]) + Decimal(2) / (pay["amount_minor"] * unit_scale), "f")
            wrong_amount = convert_minor(pay["amount_minor"], source, target, wrong_rate)
        changes = []
        self.patch(changes, "ledger", cash, debit_minor=wrong_amount)
        self.patch(changes, "ledger", alloc, credit_minor=wrong_amount)
        refs = [pay["doc_id"], cash["row_id"]]
        self.issue("fx_conversion", refs, abs(wrong_amount - correct_amount), target,
                   refs + [right["row_id"]], changes)
        self.provenance[-1].update(used_quote=wrong["row_id"], used_rate=wrong_rate)

    def underallocate(self, event, fixed=None):
        inv, pay, cash, alloc = (event[k] for k in ("invoice", "payment", "cash", "allocation"))
        gross = cash["debit_minor"]
        loss = fixed if fixed is not None else self.rng.randint(1, max(1, gross // 3))
        changes = []
        self.patch(changes, "ledger", alloc, credit_minor=gross - loss)
        suspense = self.journal("suspense", -loss, cash["currency"], datetime.fromisoformat(cash["timestamp"]),
                                inv["entity_id"], None, pay["payment_id"], cash["journal_id"])
        self.inserted(changes, "ledger", suspense)
        refs = [inv["doc_id"], pay["doc_id"], alloc["row_id"]]
        evidence = refs + ([cash["row_id"]] if inv["currency"] != pay["currency"] else [])
        self.issue("payment_allocation", refs, loss, cash["currency"], evidence, changes)

    def bad_period(self, event, forced=None):
        pay, cash = event["payment"], event["cash"]
        when = datetime.fromisoformat(pay["timestamp"]).astimezone(self.zone)
        if forced is None:
            # Both sides of the cut are valid observation windows.
            if when.date() >= self.end:
                forced = self.at(self.end - timedelta(days=1), 23, self.rng.randrange(30, 60))
            else:
                forced = self.at(self.end, 0, self.rng.randrange(1, 55))
        changes = []
        for row in self.tables["ledger"]:
            if row["journal_id"] == cash["journal_id"]:
                self.patch(changes, "ledger", row, timestamp=_stamp(forced))
        refs = [pay["doc_id"], cash["row_id"]]
        self.issue("period_cutoff", refs, abs(pay["amount_minor"]), pay["currency"], refs, changes)

    def emit(self):
        for rows in self.tables.values():
            self.rng.shuffle(rows)
        counts = {table: len(rows) for table, rows in self.tables.items()}
        self.manifest.update(record_counts=counts, record_count=counts["ledger"],
                             document_count=counts["invoices"]+counts["payments"])
        return {"manifest": self.manifest, "policy": self.policy, "tables": self.tables,
                "truth": self.truth, "provenance": self.provenance}


def _plan(config):
    scenario = config.get("scenario", "mixed")
    if scenario not in {"clean", "mixed", "fx_period", "allocation_period"}:
        raise ValueError("unknown scenario")
    defaults = {"clean": {}, "mixed": {k: 1 for k in ISSUES},
                "fx_period": {"fx_conversion": 1, "period_cutoff": 1},
                "allocation_period": {"payment_allocation": 1, "period_cutoff": 1}}
    chosen = config.get("issues", defaults[scenario])
    if not isinstance(chosen, dict) or set(chosen) - set(ISSUES):
        raise ValueError("issues must map recognized types to integer counts")
    counts = {k: chosen.get(k, 0) for k in ISSUES}
    if any(type(n) is not int or n < 0 for n in counts.values()) or sum(counts.values()) > 12:
        raise ValueError("select between zero and twelve issues")
    if scenario == "clean" and any(counts.values()):
        raise ValueError("clean scenario must not request issues")
    groups = []
    combo = {"fx_period": "fx_conversion", "allocation_period": "payment_allocation"}.get(scenario)
    if combo:
        if not counts[combo] or not counts["period_cutoff"]:
            raise ValueError("requested interaction must have both issue counts")
        counts[combo] -= 1
        counts["period_cutoff"] -= 1
        groups.append({combo, "period_cutoff"})
    groups.extend({kind} for kind, count in counts.items() for _ in range(count))
    return groups


def generate(seed, config=None):
    """Build one clean latent history before projecting any requested mutations.

    config: issues {type: count}, scenario (clean/mixed/fx_period/allocation_period),
    invoice_count (50–72), period (YYYY-MM), timezone (UTC/Etc/GMT offset),
    base_currency. All randomized choices are local to this edition and seed.
    """
    config = {} if config is None else config
    if not isinstance(config, dict):
        raise ValueError("config must be an object")
    allowed = {"issues", "scenario", "invoice_count", "period", "timezone", "base_currency"}
    if set(config) - allowed:
        raise ValueError("unknown generation option")
    groups = _plan(config)
    rng = _rng(seed, "history")
    n = config.get("invoice_count", rng.randrange(50, 59))
    if type(n) is not int or not 50 <= n <= 72:
        raise ValueError("invoice_count must be 50 to 72")
    period = config.get("period", f"2026-{rng.randrange(1,13):02d}")
    base = config.get("base_currency", rng.choice(["KZT", "USD", "EUR", "JPY"]))
    if base not in EXPONENTS:
        raise ValueError("unsupported base currency")
    zone = config.get("timezone", rng.choice(["UTC", "Etc/GMT-5", "Etc/GMT-3", "Etc/GMT+4"]))
    c = _Company(rng, period, zone, base, rng.choice(COMPANIES))
    entities = [c.key("ENT") for _ in range(rng.randrange(5, 11))]
    # Keep two sibling transactions free as legitimate recurring equal amounts.
    slots = rng.sample(range(2, n), len(groups))
    plan = dict(zip(slots, groups))
    days = (c.end - c.first).days
    sales = []
    recurring_amount = rng.randint(500, 1600) * (10 ** EXPONENTS[base])
    for i in range(n):
        group = plan.get(i, set())
        entity = rng.choice(entities)
        target = base if rng.random() < .76 else rng.choice(c.currencies)
        foreign = "fx_conversion" in group or rng.random() < .30
        source = rng.choice([x for x in c.currencies if x != target]) if foreign else target
        issue_day = c.first + timedelta(days=rng.randrange(0, days - 7))
        when = c.at(issue_day + timedelta(days=rng.randint(1, 6)), rng.randrange(8, 21), rng.randrange(60))
        if "period_cutoff" in group or (i >= 2 and i % 12 == 0):
            on_boundary = c.end if rng.randrange(2) else c.end - timedelta(days=1)
            when = c.at(on_boundary, rng.choice([0, 1, 2]) if on_boundary == c.end else 23, rng.randrange(60))
        amount = rng.randint(75_000, 500_000) * (10 ** EXPONENTS[source]) // int(max(1, KZT_PRICE[source]))
        if i < 2:
            target = source = base
            entity = entities[0]
            amount = recurring_amount
        primary = {"when": when, "amount": amount, "currency": source, "utc": bool(rng.randrange(2))}
        receipts = [primary]
        # True splits share invoice refs but each separate payment is fully allocated.
        if i >= 2 and i % 4 == 0:
            receipts.append({"when": c.at(issue_day, 16), "amount": max(10, amount // 2),
                             "currency": source, "utc": True})
        if i >= 2 and i % 13 == 0:
            receipts.append({"when": when + timedelta(hours=2), "amount": -max(5, amount // 7),
                             "currency": source, "utc": True})
        sales.append(c.sale(entity, target, c.at(issue_day, 7, 30), receipts))
    # All input documents and balanced journal entries exist at this point.
    for slot, group in plan.items():
        sale = sales[slot]
        main = sale[3][0]
        if "duplicate_invoice" in group:
            c.duplicate(sale)
        if "fx_conversion" in group:
            c.bad_fx(main)
        if "payment_allocation" in group:
            c.underallocate(main)
        if "period_cutoff" in group:
            c.bad_period(main)
    return c.emit()


def generate_demo():
    """A small open teaching fixture; train/dev use the full-size generator."""
    c = _Company(_rng(2711, "tutorial"), "2026-10", "Etc/GMT-5", "KZT", "Маяк", "demo-mayak-2026-10")
    _, _, _, receipts = c.sale("ENT-M", "KZT", c.at(c.first.replace(day=3), 10), [
        {"id": "PAY-041", "cash": "C-101", "allocation": "L-101", "when": c.at(c.first.replace(day=12), 11),
         "currency": "KZT", "amount": 18000000},
        {"id": "PAY-042", "cash": "C-102", "allocation": "L-102", "when": c.at(c.first.replace(day=28), 15),
         "currency": "KZT", "amount": 30000000}], inv_id="INV-017")
    c.underallocate(receipts[-1], fixed=2000000)
    return c.emit()


def generate_period_demo():
    c = _Company(_rng(2712, "calendar"), "2026-10", "Etc/GMT-5", "KZT", "Маяк", "demo-mayak-cutoff")
    _, _, _, receipts = c.sale("ENT-M", "KZT", c.at(c.first.replace(day=27), 10), [
        {"id": "PAY-088", "cash": "L-208", "allocation": "L-209", "when": c.at(c.end, 2, 15),
         "currency": "KZT", "amount": 1000000}], inv_id="INV-088")
    c.bad_period(receipts[0], c.at(c.end - timedelta(days=1), 23, 50))
    return c.emit()


def open_configs(split):
    """Disjoint public train/dev seeds and varied public configuration values."""
    if split not in {"train", "dev"}:
        raise ValueError("split must be train or dev")
    seeds = [19031, 857, 90911, 8213, 7111, 119, 553, 74011, 821, 10177]
    recipes = [("clean", {}), ("clean", {}), ("mixed", {"duplicate_invoice": 2}),
               ("mixed", {"payment_allocation": 2}), ("mixed", {"fx_conversion": 2}),
               ("mixed", {"period_cutoff": 2}), ("allocation_period", {"payment_allocation": 2, "period_cutoff": 1}),
               ("fx_period", {"period_cutoff": 2, "fx_conversion": 1}),
               ("mixed", dict.fromkeys(ISSUES, 1)), ("mixed", dict.fromkeys(ISSUES, 2))]
    result = []
    for i, (scenario, amounts) in enumerate(recipes):
        config = {"scenario": scenario, "issues": dict(amounts), "invoice_count": 50+i,
                  "base_currency": list(EXPONENTS)[(i + (split == "dev")) % 4]}
        if split == "dev":
            config["invoice_count"] += 4
            if scenario in {"allocation_period", "fx_period", "mixed"} and len(amounts) > 1:
                config["issues"]["duplicate_invoice"] = 3
        result.append((seeds[i] + (1_000_100 if split == "dev" else 0), config))
    return result


def transform(episode, seed):
    """Re-key every identifier/reference and independently permute all public rows."""
    rng = _rng(seed, "paired")
    categories = {"invoice_id": "INV", "payment_id": "PAY", "row_id": "R", "entity_id": "ENT",
                  "journal_id": "J", "source_ref": "REF", "issue_id": "I", "episode_id": "EP"}
    identifiers = {episode["manifest"]["episode_id"]: "EP"}
    for table, rows in episode["tables"].items():
        for row in rows:
            for field, prefix in categories.items():
                if row.get(field) is not None:
                    identifiers[row[field]] = "FX" if field == "row_id" and table == "fx" else prefix
    identifiers.update({issue["issue_id"]: "I" for issue in episode["truth"]})
    keys = sorted(identifiers)
    rng.shuffle(keys)
    occupied = set(keys)
    changed = {}
    for old in keys:
        while True:
            new = f"{identifiers[old]}-{rng.randrange(1, 0x10000000):07X}"
            if new not in occupied:
                break
        changed[old] = new
        occupied.add(new)

    def replace(value):
        if isinstance(value, dict):
            return {k: replace(v) for k, v in value.items()}
        if isinstance(value, list):
            return [replace(v) for v in value]
        if isinstance(value, str):
            return changed.get(value, value)
        return value

    variant = replace(episode)
    for table, rows in variant["tables"].items():
        rng.shuffle(rows)
        # Guarantee a changed order when a tiny table happens to retain its permutation.
        if len(rows) > 1 and all(rows[i][TABLE_IDS[table]] == changed[old[TABLE_IDS[table]]]
                                 for i, old in enumerate(episode["tables"][table])):
            rows.append(rows.pop(0))
    for issue in variant["truth"]:
        issue["affected_ids"].sort()
        for evidence in issue["evidence_sets"]:
            evidence.sort()
    return variant, changed
