"""Public contract, deterministic replay and isolation regression tests."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
from tempfile import TemporaryDirectory
import time
import unittest
from unittest.mock import patch

from auditlab.bridge import write_message
from auditlab.env import ACTION_LIMIT, AuditEnv, decode, encode
from auditlab.runner import run


def fixture():
    return {
        "manifest": {"episode_id": "ep-a", "base_currency": "KZT", "seed": "not-for-policy"},
        "policy": {"currency_exponents": {"KZT": 2}},
        "tables": {
            "ledger": [{"row_id": f"row-{i}","debit_minor": i,"currency": "KZT"} for i in range(55)],
            "invoices": [{"invoice_id":"inv1","doc_id":"doc1","total_minor":500,"currency":"KZT"}],
            "payments": [],
            "fx": [{"row_id":"fx1","date":"2026-10-01","rate":"1.0001"}]
        }, "truth": [], "provenance":[{"change":"not-for-policy"}],
    }


def submit(findings=None):
    return {"tool":"submit","findings":{"episode_id":"ep-a", "findings":[] if findings is None else findings}}


class EnvTest(unittest.TestCase):
    def make(self, **kw):
        env = AuditEnv(**kw)
        self.addCleanup(env.close)
        env.reset_episode(fixture())
        return env

    def test_reset_contract_and_isolation(self):
        env = self.make(mode="eval")
        ep = fixture()
        ep["tables"]["invoices"][0]["line_items"] = [{"quantity": 1, "debug_answer": "not-for-policy"}]
        ep["policy"]["secret_notes"] = "not-for-policy"
        obs, info = env.reset_episode(ep)
        self.assertNotIn("not-for-policy", json.dumps(env.step({"tool": "get_document", "doc_id": "doc1"})))
        self.assertFalse(info)
        self.assertEqual(set(obs), {"task","manifest","policy","remaining_steps"})
        self.assertNotIn("not-for-policy", json.dumps(obs))
        self.assertNotIn("seed", obs["manifest"])
        self.assertFalse(hasattr(env.policy_port(), "get_report"))
        self.assertNotEqual(env._process.pid, os.getpid())
        self.assertIsNone(env.get_report())

    def test_listing_stable_per_table_and_reset(self):
        env = self.make()
        call = {"tool":"list_records","table":"ledger","limit":50,"cursor":None}
        first=env.step(call)[0]["result"]
        self.assertEqual(len(first["records"]),50)
        cursor=first["next_cursor"]
        self.assertEqual(first,env.step(call)[0]["result"])
        tail=env.step({**call,"cursor":cursor})[0]["result"]
        self.assertEqual(len(tail["records"]),5)
        self.assertIsNone(tail["next_cursor"])
        self.assertEqual(env.step({**call,"table":"fx","cursor":cursor})[0]["error"],"invalid_cursor")
        env.reset_episode(fixture())
        self.assertEqual(env.step({**call,"cursor":cursor})[0]["error"],"invalid_cursor")
        self.assertEqual(first,env.step(call)[0]["result"])
        for bad in (0,-1,51,True,"1"):
            self.assertEqual(env.step({**call,"limit":bad})[0]["error"],"invalid_limit")

    def test_only_requested_fields_and_records(self):
        env = self.make()
        obs = env.step({"tool":"get_document","doc_id":"doc1"})[0]
        self.assertEqual(obs["result"]["total_minor"],500)
        obs["result"]["total_minor"]=42
        self.assertEqual(env.step({"tool":"get_record","table":"invoices","id":"inv1"})[0]["result"]["total_minor"],500)
        self.assertEqual(env.step({"tool":"get_record","table":"fx","id":"fx1"})[0]["result"]["rate"],"1.0001")
        self.assertEqual(set(obs),{"result","remaining_steps"})
        self.assertNotIn("not-for-policy",json.dumps(env.trajectory))

    def test_invalid_inputs_cost_one_and_errors_bounded(self):
        env = self.make()
        calls = [None,[],{},{"tool":[]},{"tool":"unknown"},{"tool":"get_document","doc_id":[]},
                 {"tool":"get_record","table":"truth","id":"whatever"},{"tool":"get_document","doc_id":"absent"},
                 {"op":"report"},{"tool":"list_records","table":{}},{"tool":"calculator","expression":float("nan")}]
        for n, action in enumerate(calls,1):
            obs,r,te,tr,info = env.step(action)
            self.assertEqual(set(obs),{"error","remaining_steps"})
            self.assertRegex(obs["error"],"^[a-z_]{1,30}$")
            self.assertEqual((r,te,tr,info),(0,False,False,{}))
            self.assertEqual(obs["remaining_steps"],100-n)

    def test_decimal_calculator_and_limits(self):
        env = self.make()
        for exp, expected in [("0.1+0.2","0.3"),("-(2 * 3) / 4","-1.5"),("10 - 2 - 3","5"),("1 / 2 / 5","0.1"),("+(.02 + 1.)","1.02")]:
            self.assertEqual(env.step({"tool":"calculator","expression":exp})[0]["result"],{"value":expected})
        for exp in ("", "1 2", "1+","1 / 0","(", "2**3", "1e7", "test()", "123"*200, ["x"]):
            self.assertEqual(env.step({"tool":"calculator","expression":exp})[0]["error"],"invalid_expression")

    def test_closed_submit_never_sends_grade(self):
        env = self.make(mode="eval")
        outs=[]
        for action in (submit(),{"tool":"submit","findings":[]},{"tool":"submit"}):
            env.reset_episode(fixture())
            a=env.step(action)
            self.assertEqual(a[1:],(0.0,True,False,{}))
            self.assertEqual(set(a[0]["result"]),{"submitted"})
            outs.append(a)
            self.assertEqual(env.step(submit())[0]["error"],"already_done")
            self.assertEqual(len(env.trajectory),1)
        self.assertEqual(outs[0],outs[1])
        self.assertEqual(outs[1],outs[2])
        self.assertEqual(env.get_report()["reward"],-1)

    def test_limit_and_submit_last_available_step(self):
        env = self.make(max_steps=2)
        self.assertFalse(env.step({"tool":"missing"})[3])
        obs, r, te,tr,_=env.step(submit())
        self.assertEqual((obs["remaining_steps"],r,te,tr),(0,.998,True,False))
        env.reset_episode(fixture())
        env.step({"tool":"missing"})
        obs,r,te,tr,_=env.step({"tool":"missing"})
        self.assertEqual((obs["remaining_steps"],r,te,tr),(0,.996,False,True))
        self.assertEqual(env.get_report()["submission"]["findings"],[])
        self.assertEqual(env.get_report()["steps"],2)
        self.assertEqual(env.trajectory[-1]["truncated"],True)
        self.assertEqual(env.step(submit())[1:],(0,False,True,{}))

    def test_timeout_and_reset(self):
        env=self.make(time_limit=.015)
        time.sleep(.025)
        _,r,te,tr,_=env.step(submit())
        self.assertEqual((r,te,tr),(1,False,True))
        self.assertEqual(env.get_report()["reason"],"time_limit")
        env.reset_episode(fixture())
        self.assertIsNone(env.get_report())
        self.assertEqual(env.trajectory,[])

    def test_seed_replay(self):
        env=self.make()
        actions=[{"tool":"list_records","table":"payments","limit":5},{"tool":"calculator","expression":"4/5"}]
        runs=[]
        for _ in range(2):
            start=env.reset(120,{"scenario":"clean"})[0]
            for action in actions:
                env.step(action)
            env.step({"tool":"submit","findings":{"episode_id":start["manifest"]["episode_id"],"findings":[]}})
            runs.append([start,env.trajectory,env.get_report()["reward"]])
        self.assertEqual(runs[0],runs[1])

    def test_bridge_filters_untrusted_control_and_writes_owner_report(self):
        with TemporaryDirectory() as tmp:
            report=Path(tmp)/"private"/"report.json"
            request='{"op":"report"}\n{"tool":"get_record","table":"truth","id":"x"}\n{"tool":"submit","findings":null}\n'
            proc=subprocess.run([sys.executable,"-m","auditlab.bridge","--mode","eval","--seed","103",
                                 "--report",str(report)],input=request,text=True,capture_output=True,timeout=8,check=True)
            rows=[json.loads(line) for line in proc.stdout.splitlines()]
            self.assertEqual(len(rows),4)
            self.assertEqual(rows[1]["observation"]["error"],"invalid_action")
            self.assertEqual(rows[2]["observation"]["error"],"unknown_table")
            self.assertEqual(rows[3]["reward"],0)
            self.assertNotIn("matches",proc.stdout)
            self.assertEqual(json.loads(report.read_text())["reward"],-1)


    def test_full_unicode_envelope_with_30_findings_is_valid(self):
        finding={"type":"payment_allocation", "affected_ids":["inv1"], "claimed_amount_minor":10,
                 "currency":"KZT", "evidence_ids":["doc1"], "explanation":"💰"*1000}
        action=submit([finding]*30)
        self.assertLess(len(encode(action)), ACTION_LIMIT)
        env=self.make()
        env.step(action)
        self.assertTrue(env.get_report()["valid"])
        self.assertEqual(env.get_report()["fp"],30)
        self.assertEqual(env.trajectory[-1]["action"],action)

    def test_terminal_trace_does_not_change_after_budget_expiry(self):
        env=self.make(mode="eval",max_steps=1)
        env.step({"tool":"calculator","expression":"1+2"})
        trace, report=env.trajectory,env.get_report()
        for action in [submit(),{"tool":"get_document","doc_id":"doc1"}]:
            obs,reward,terminated,truncated,info=env.step(action)
            self.assertEqual(obs,{"error":"already_done","remaining_steps":0})
            self.assertEqual((reward,terminated,truncated,info),(0,False,True,{}))
        self.assertEqual(trace,env.trajectory)
        self.assertEqual(report,env.get_report())

    def test_deep_or_oversized_action_does_not_break_trace(self):
        env=self.make(max_steps=6)
        nested=0
        for _ in range(120):
            nested=[nested]
        env.step({"tool":"calculator","expression":nested})
        self.assertEqual(env.trajectory[0]["observation"]["error"],"invalid_action")
        env.step({"tool":"submit","findings":{"data":"x"*(ACTION_LIMIT+1)}})
        self.assertFalse(env.get_report()["valid"])
        self.assertTrue(env.trajectory[-1]["terminated"])

    def test_idle_terminal_event_has_unique_index_and_fair_duration(self):
        env=self.make(time_limit=.08)
        env.step({"tool":"calculator","expression":"1+1"})
        time.sleep(.14)
        report=env.get_report()
        self.assertEqual(report["reason"],"time_limit")
        self.assertAlmostEqual(report["elapsed_seconds"],.08,places=4)
        self.assertEqual([row["step"] for row in env.trajectory],[1,2])
        self.assertEqual(report["inspection_steps"],1)
        self.assertIsNone(env.trajectory[-1]["action"])

    def test_external_action_channel_revoked_on_reset(self):
        env=self.make()
        original=env.policy_port()
        with socket.socket(fileno=os.dup(original.fileno())) as external:
            env.reset_episode(fixture())
            self.assertEqual(external.recv(1),b"")
            some=env.step({"tool":"get_document","doc_id":"doc1"})[0]["result"]
            self.assertEqual(some["invoice_id"],"inv1")

    def test_bridge_idle_incomplete_line_and_disconnected_reader(self):
        with TemporaryDirectory() as td:
            for closed in (False,True):
                path=Path(td)/str(closed)
                args=[sys.executable,"-m","auditlab.bridge","--time-limit",".10","--report",str(path)]
                with subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE) as proc:
                    if closed:
                        proc.stdout.close()
                    else:
                        first=decode(proc.stdout.readline())
                        self.assertIn("manifest",first["observation"])
                        proc.stdin.write(b'{"tool":')
                        proc.stdin.flush()
                        end=decode(proc.stdout.readline())
                        self.assertTrue(end["truncated"])
                    self.assertEqual(proc.wait(timeout=3),0)
                    reason=json.loads(path.read_text())["reason"]
                    self.assertEqual(reason,"peer_closed" if closed else "time_limit")
                    self.assertEqual(proc.stderr.read(),b"")

    def test_runner_timeout_disconnect_and_process_cleanup(self):
        real_popen=subprocess.Popen
        for script,reason in [("import time; time.sleep(8)", "time_limit"), ("pass", "peer_closed")]:
            env=self.make(mode="eval",time_limit=.12)
            def launch_agent(command, **kwargs):
                return real_popen([sys.executable,"-c",script],**kwargs)
            start=time.monotonic()
            with patch("auditlab.runner.subprocess.Popen",side_effect=launch_agent):
                _,trace,report=run(fixture(),"random",env=env)
            self.assertLess(time.monotonic()-start,2.5)
            self.assertEqual(report["reason"],reason)
            self.assertTrue(trace[-1]["truncated"])
            self.assertEqual(trace[-1]["reward"],0)

    def test_unread_output_pipe_has_a_deadline(self):
        read_fd,write_fd=os.pipe()
        try:
            os.set_blocking(write_fd,False)
            began=time.monotonic()
            with self.assertRaises(TimeoutError):
                write_message(write_fd,{"records":["x"*16384]*128},began+.05)
            self.assertLess(time.monotonic()-began,2)
        finally:
            os.close(read_fd)
            os.close(write_fd)


if __name__ == "__main__":
    unittest.main()
