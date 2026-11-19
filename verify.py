"""Entry point for the offline reproducibility and scoring checks."""
import argparse
import json
import sys
import unittest
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description="NoLimit Audit offline checker")
    parser.add_argument("--report", type=Path, help="write diagnostic report to this file")
    parser.add_argument("--seed-offset", type=int, default=0, help="use an independent evaluator-selected seed family")
    args = parser.parse_args()
    suite = unittest.defaultTestLoader.discover("tests")
    tested=unittest.TextTestRunner(verbosity=1).run(suite)
    if not tested.wasSuccessful() or not tested.testsRun:
        return 1
    from auditlab.benchmark import evaluate, validation_cases
    result = evaluate(validation_cases(args.seed_offset))
    result["unit_tests"] = tested.testsRun
    if args.report:
        args.report.parent.mkdir(parents=True,exist_ok=True)
        args.report.write_text(json.dumps(result,indent=2,ensure_ascii=False)+"\n", encoding="utf-8")
    print(f"{tested.testsRun} tests; {result['episodes']} evaluation episodes; {result['pairs']} paired transformations; {result['replays']} deterministic replays.")
    for name, metrics in result["averages"].items():
        print(f"{name:12s} P={metrics['precision']:.3f} R={metrics['recall']:.3f} F1={metrics['f1']:.3f} return={metrics['reward']:.3f} inspections={metrics['inspection_steps']:.1f} time={metrics['elapsed_seconds']:.3f}s")
    return 0

if __name__=="__main__":
    sys.exit(main())
