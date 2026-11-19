"""Export open training data and website projections from the real environment."""
import argparse
import json
from pathlib import Path
import zipfile

from .env import AuditEnv
from .generator import generate, generate_demo, generate_period_demo, open_configs, transform
from .runner import NAMES, run
from .benchmark import summarize
from .storage import add_file, lines, public_files, readable

ROOT = Path(__file__).resolve().parent.parent
FEATURED = ("INV-017","PAY-041","PAY-042","L-101","L-102")


def demo_run(env, episode, copies=1):
    """Teaching policy for the small published fixture; IDs and math come from observations."""
    initial,_ = env.reset_episode(episode)
    def inspect(tool, **params):
        obs, _, done, cutoff, _ = env.step({"tool":tool,**params})
        if done or cutoff or "error" in obs:
            raise AssertionError((tool,obs))
        return obs["result"]
    invoices = inspect("list_records",table="invoices",cursor=None,limit=50)["records"]
    invoice = inspect("get_document",doc_id=invoices[0]["doc_id"])
    ledger = inspect("list_records",table="ledger",cursor=None,limit=50)["records"]
    payments = inspect("list_records",table="payments",cursor=None,limit=50)["records"]
    payments = sorted(payments, key=lambda r:r["timestamp"])
    first,second = [inspect("get_document",doc_id=p["doc_id"]) for p in payments]
    allocations = {r["payment_id"]:r for r in ledger if r["account"]=="receivable" and r["payment_id"]}
    affected = inspect("get_record",table="ledger",id=allocations[second["payment_id"]]["row_id"])
    gross = first["amount_minor"] + second["amount_minor"]
    booked = sum(a["credit_minor"] for a in allocations.values())
    delta = int(inspect("calculator",expression=f"{gross}-{booked}")["value"])
    ids=[invoice["doc_id"],second["doc_id"],affected["row_id"]]
    finding={"type":"payment_allocation","affected_ids":ids,"claimed_amount_minor":delta,
             "currency":invoice["currency"],"evidence_ids":ids,
             "explanation":"Второй платёж ссылается на счёт, но сумма распределения по проводке меньше поступления."}
    submission={"episode_id":initial["manifest"]["episode_id"],"findings":[finding]*copies}
    env.step({"tool":"submit","findings":submission})
    return {"manifest":initial["manifest"],"policy":initial["policy"],"trajectory":env.trajectory,
            "report":summarize(env.get_report()),"findings":submission["findings"],
            "sources":{r.get("doc_id",r.get("row_id")):r for r in [invoice,first,second,*allocations.values()]}}


def pair_preview(ep, variant, mapping, original_score, changed_score):
    def selected(episode, ids):
        rows=[]
        for table, label, icon, amount in [('invoices','Счёт','document','total_minor'),('payments','Платёж','receipt','amount_minor'),('ledger','Проводка','ledger','credit_minor')]:
            for row in episode['tables'][table]:
                key=row.get('doc_id',row.get('row_id'))
                if key in ids:
                    rows.append({'event':label,'id':key,'icon':icon,'amount_minor':row[amount]})
        return rows
    relevant = ("INV-017","PAY-041","PAY-042","L-101","L-102")
    return {"original":selected(ep,relevant), "replay":selected(variant,[mapping[k] for k in relevant]),
            "mapping":[[k,mapping[k]] for k in relevant],"before":original_score,"after":changed_score,
            "amount_minor":ep['truth'][0]['expected_amount_minor'],"currency":ep['truth'][0]['currency']}


def build(report_path):
    dest=ROOT/"dist"; data=dest/"data"; downloads=dest/"downloads"
    data.mkdir(exist_ok=True); downloads.mkdir(exist_ok=True)
    benchmark=json.loads(report_path.read_text(encoding="utf8"))
    ep=generate_demo(); period=generate_period_demo()
    ledger=period["tables"]["ledger"]; pay=period["tables"]["payments"][0]
    with AuditEnv(mode="train") as open_env, AuditEnv(mode="eval") as closed_env:
        demo=demo_run(open_env,ep)
        duplicate=demo_run(open_env,ep,2)
        changed,mapping=transform(ep,389)
        _,_,before=run(ep,"oracle",env=closed_env)
        _,_,after=run(changed,"oracle",env=closed_env)
        _,_,period_result=run(period,"reconcile",env=closed_env)
        output={"demo":demo,"reward":[demo["report"],duplicate["report"]],
                "period":{"payment":pay,"cash":next(r for r in ledger if r["account"]=="cash"),
                          "timezone":period["manifest"]["timezone"], "period_start":period["manifest"]["period_start"],
                          "period_end":period["manifest"]["period_end"],"policy":period["policy"],"report":summarize(period_result)},
                "pair":pair_preview(ep,changed,mapping,summarize(before),summarize(after)),
                "validation":{k:v for k,v in benchmark.items() if k!="runs"},"catalog":[]}
        collection=downloads/"open-episodes.zip"
        with zipfile.ZipFile(collection,"w") as archive:
            for split in ("train","dev"):
                for n,(seed,config) in enumerate(open_configs(split),1):
                    key=f"{split}-{n:02d}"; episode=generate(seed,config); manifest=episode["manifest"]
                    for name,body in public_files(episode).items():
                        add_file(archive,f"{split}/{key}/{name}",body)
                    add_file(archive,f"{split}/{key}/config.json",readable({"seed":seed,"config":config}))
                    item={"key":key,"split":split,"manifest":manifest,"policies":{}}
                    for name in NAMES:
                        _,trajectory,report=run(episode,name,mode="train",env=open_env)
                        text=lines(trajectory)
                        add_file(archive,f"runs/{key}/{name}/trajectories.jsonl",text)
                        metric=summarize(report);metric["steps"]=len(trajectory)
                        add_file(archive,f"runs/{key}/{name}/metrics.json",readable(metric))
                        item["policies"][name]=metric
                        path=data/"runs"/key;path.mkdir(parents=True,exist_ok=True)
                        (path/(name+".jsonl")).write_text(text,encoding="utf8")
                    output["catalog"].append(item)
            add_file(archive,"trajectories.jsonl",lines(demo["trajectory"]))
            add_file(archive,"benchmark.json",readable(benchmark))
            for name,body in public_files(ep).items():
                add_file(archive,"tutorial/"+name,body)
        (downloads/"trajectories.jsonl").write_text(lines(demo["trajectory"]),encoding="utf8")
        (downloads/"benchmark.json").write_text(readable(benchmark),encoding="utf8")
        (data/"release.js").write_text("window.AuditRelease="+json.dumps(output,ensure_ascii=False,separators=(",",":"),allow_nan=False).replace("<","\\u003c")+";\n",encoding="utf8")
    return output


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--report", type=Path, default=ROOT/"build"/"benchmark.json")
    args=parser.parse_args()
    out=build(args.report)
    print(f"Exported {len(out['catalog'])} open episodes and {sum(len(c['policies']) for c in out['catalog'])} policy traces.")
