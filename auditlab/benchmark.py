"""Public independent regression set, not the organizer's confidential benchmark."""
from __future__ import annotations
from statistics import mean

from .env import AuditEnv
from .generator import generate, transform
from .runner import NAMES, run


def validation_cases(offset=0):
    ordinary = ("duplicate_invoice", "payment_allocation", "fx_conversion", "period_cutoff")
    for i in range(20):
        seed = 810_000 + offset + i * 173
        if i < 5:
            config = {"scenario": "clean"}
        elif i < 10:
            config = {"scenario": ("fx_period", "allocation_period")[i % 2]}
        else:
            config = {"issues": {ordinary[i % 4]: 1 + (i % 3 == 0)}}
        yield seed, config


def summarize(report):
    return {k:report[k] for k in ("tp","fp","fn","precision","recall","f1","reward","inspection_steps","elapsed_seconds")}


def normalized(submission, reverse):
    def ids(values):
        return tuple(sorted(reverse.get(v,v) for v in values))
    return sorted((item["type"],ids(item["affected_ids"]),item["currency"],item["claimed_amount_minor"],
                   ids(item["evidence_ids"])) for item in submission["findings"])


def evaluate(cases):
    rows = []
    with AuditEnv(mode="eval") as env:
        for seed, config in cases:
            ep = generate(seed, config)
            if ep != generate(seed, config):
                raise AssertionError("same seed/config generated a different episode")
            policies = {}
            reference = None
            for name in NAMES:
                _, trajectory, report = run(ep, name, env=env)
                policies[name] = summarize(report)
                if name == "oracle":
                    reference = report
                if name == "random":
                    _, again, repeated = run(ep, name, env=env)
                    if trajectory != again or report["reward"] != repeated["reward"]:
                        raise AssertionError("reset and replay failed")
            changed, mapping = transform(ep, seed+91)
            _, _, other = run(changed, "oracle", env=env)
            reverse={new:old for old,new in mapping.items()}
            if normalized(reference["submission"],{}) != normalized(other["submission"],reverse):
                raise AssertionError("renamed oracle conclusions or evidence do not match")
            for key in ("f1","reward","tp","fp","fn"):
                if reference[key] != other[key]:
                    raise AssertionError(f"paired oracle disagreement in {key}")
            if reference["f1"] != 1:
                raise AssertionError("oracle was not matched")
            rows.append({"id":ep["manifest"]["episode_id"], "policies":policies, "pair_ok":True, "repeat_ok":True})
    totals={}
    for name in NAMES:
        metrics=[r["policies"][name] for r in rows]
        totals[name] = {field:mean(m[field] for m in metrics) for field in ("precision","recall","f1","reward","inspection_steps","elapsed_seconds")}
        totals[name].update({k:sum(m[k] for m in metrics) for k in ("tp","fp","fn")})
    return {"episodes":len(rows),"pairs":sum(r["pair_ok"] for r in rows),"replays":sum(r["repeat_ok"] for r in rows),"averages":totals,"runs":rows}
