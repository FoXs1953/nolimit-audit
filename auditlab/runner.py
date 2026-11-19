"""Execute a policy and keep evaluator-only diagnostics out of the policy transcript."""
from __future__ import annotations

import json
import os
import time
import subprocess
import sys
from pathlib import Path

from .bridge import entries, write_message
from .env import AuditEnv, decode_action
from .policies import oracle_submission, policy_actions

NAMES = ("random", "reconcile", "mark_all", "oracle")
ROOT = Path(__file__).resolve().parent.parent


def agent_loop(name):
    """Unprivileged baseline side. Only public observations and a fixed policy RNG enter."""
    initial = json.loads(sys.stdin.readline())
    iterator = policy_actions(name, initial, random_seed=17)
    try:
        action = next(iterator)
        while True:
            print(json.dumps(action, ensure_ascii=False, allow_nan=False), flush=True)
            line = sys.stdin.readline()
            if not line:
                return
            action = iterator.send(json.loads(line))
    except StopIteration:
        return


def run(episode, name, mode="eval", *, env=None):
    if name not in NAMES:
        raise ValueError("unknown policy")
    if env is None:
        with AuditEnv(mode=mode) as owner:
            return run(episode, name, mode, env=owner)
    initial, _ = env.reset_episode(episode)
    if name == "oracle":
        env.step({"tool": "submit", "findings": oracle_submission(episode)})
    else:
        with subprocess.Popen([sys.executable, "-m", "auditlab.runner", name], cwd=ROOT,
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE) as process:
            try:
                os.set_blocking(process.stdin.fileno(), False)
                responses = entries(process.stdout.fileno(), env.deadline)
                observation = initial
                for _ in range(env.max_steps):
                    write_message(process.stdin.fileno(), observation, env.deadline)
                    try:
                        line = next(responses)
                    except StopIteration:
                        reason = "time_limit" if time.monotonic() >= env.deadline else "peer_closed"
                        env.truncate(reason)
                        break
                    observation, _, terminated, truncated, _ = env.step(decode_action(line))
                    if terminated or truncated:
                        break
            except BrokenPipeError:
                env.truncate("peer_closed")
            except TimeoutError:
                env.truncate("time_limit")
            finally:
                process.stdin.close()
                try:
                    process.wait(timeout=.5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
    return initial, env.trajectory, env.get_report()


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in NAMES[:-1]:
        raise SystemExit("Choose random, reconcile or mark_all; oracle is evaluator-only.")
    agent_loop(sys.argv[1])
