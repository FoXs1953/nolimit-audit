"""Trusted orchestration for a JSON-only, read-only audit environment.

Pass PolicyPort or the JSONL bridge to an external policy. Keep AuditEnv with
the harness. Its independent control channel owns reset, traces and scoring.
"""
import json
import math
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
import weakref


ACTION_LIMIT = 1024 * 1024


def encode(value):
    return json.dumps(value, allow_nan=False, ensure_ascii=False, separators=(",", ":")).encode("utf-8", "backslashreplace") + b"\n"


def _unique(pairs):
    result = dict(pairs)
    if len(result) != len(pairs):
        raise ValueError("duplicate key")
    return result


def _nonfinite(_):
    raise ValueError("nonfinite number")


def _finite_float(text):
    value = float(text)
    if not math.isfinite(value):
        raise ValueError("nonfinite number")
    return value


def decode(data):
    return json.loads(data, object_pairs_hook=_unique, parse_constant=_nonfinite, parse_float=_finite_float)


def decode_action(line):
    """Recognized protocol objects can be nested up to 32 levels including the envelope."""
    if line is None:
        return None
    try:
        value = decode(line)
    except (ValueError, RecursionError):
        return None

    def exceeds_depth(item, depth):
        if isinstance(item, (dict, list)):
            children = item.values() if isinstance(item, dict) else item
            return depth >= 32 or any(exceeds_depth(child, depth + 1) for child in children)
        return False

    if exceeds_depth(value, 0):
        return {"tool": "submit"} if isinstance(value, dict) and value.get("tool") == "submit" else None
    return value


class PolicyPort:
    """Action-only JSON transport. Neither private data nor owner methods cross it."""

    def __init__(self, sock):
        self._sock = sock
        self._reader = sock.makefile("rb")
        self._lock = threading.Lock()

    def step(self, action):
        try:
            payload = encode(action)
            if len(payload) > ACTION_LIMIT:
                raise ValueError("action too large")
        except (ValueError, TypeError, RecursionError, OverflowError):
            payload = b'{"tool":"submit"}\n' if isinstance(action, dict) and action.get("tool") == "submit" else b"null\n"
        with self._lock:
            self._sock.sendall(payload)
            response = self._reader.readline()
            if not response:
                raise RuntimeError("Evaluator is unavailable")
            return tuple(decode(response))

    def fileno(self):
        """A trusted launcher may pass only this action socket to an agent."""
        return self._sock.fileno()

    def close(self):
        # Wake any outstanding reader before closing the buffered file, and revoke
        # the channel even if a policy retained a duplicate of the socket.
        try:
            self._sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self._reader.close()
        self._sock.close()


def _shutdown(proc, port):
    try:
        port.close()
        proc.stdin.close()
        proc.wait(timeout=1)
    except (OSError, subprocess.TimeoutExpired):
        proc.kill()
        proc.wait()
    finally:
        proc.stdout.close()


class AuditEnv:
    """Reusable evaluator process. Run trusted controller and policy separately."""

    def __init__(self, mode="train", max_steps=100, time_limit=60):
        if mode not in ("train", "eval"):
            raise ValueError("mode must be train or eval")
        if type(max_steps) is not int or not 1 <= max_steps <= 100:
            raise ValueError("max_steps must be an integer from 1 to 100")
        if type(time_limit) not in (int, float) or not math.isfinite(time_limit) or not 0 < time_limit <= 60:
            raise ValueError("time_limit must be positive and at most 60 seconds")
        self.mode, self.max_steps, self.time_limit = mode, max_steps, time_limit
        self.deadline = None
        self._port_exposed = False
        self._start_worker()

    def _start_worker(self):
        controller_end, evaluator_end = socket.socketpair()
        try:
            args = [sys.executable, "-B", "-m", "auditlab.worker", str(evaluator_end.fileno()), self.mode, str(self.max_steps), str(self.time_limit)]
            self._process = subprocess.Popen(
                args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                pass_fds=(evaluator_end.fileno(),), cwd=Path(__file__).resolve().parent.parent,
            )
        except BaseException:
            controller_end.close()
            raise
        finally:
            evaluator_end.close()
        self._port = PolicyPort(controller_end)
        self._admin_lock = threading.Lock()
        self._finalize = weakref.finalize(self, _shutdown, self._process, self._port)

    def _control(self, command, **params):
        if not self._finalize.alive:
            raise RuntimeError("Environment is closed")
        packet = encode({"op": command, **params})
        with self._admin_lock:
            self._process.stdin.write(packet)
            self._process.stdin.flush()
            raw = self._process.stdout.readline()
        if not raw:
            raise RuntimeError("Evaluator stopped")
        response = decode(raw)
        if "error" in response:
            raise ValueError(response["error"])
        return response["ok"]

    def _reset(self, operation, **params):
        if not self._finalize.alive:
            raise RuntimeError("Environment is closed")
        if self._port_exposed:
            # An external policy can retain a duplicated descriptor. A fresh socket
            # and evaluator revoke its access before the next episode is installed.
            self._finalize()
            self._start_worker()
            self._port_exposed = False
        result = tuple(self._control(operation, **params))
        self.deadline = time.monotonic() + self.time_limit
        return result

    def reset(self, seed, config=None):
        """Trusted reset(seed, config) -> (observation, info)."""
        if type(seed) is not int or (config is not None and not isinstance(config, dict)):
            raise ValueError("Expected an integer seed and a configuration object")
        return self._reset("generate", seed=seed, config=config if config is not None else {})

    def reset_episode(self, episode):
        """Install a prepared episode. Only the trusted owner calls this method."""
        return self._reset("reset_episode", episode=episode)

    def step(self, action):
        return self._port.step(action)

    def policy_port(self):
        """Grant the action channel for the current episode. Reset revokes it."""
        if self.deadline is None:
            raise RuntimeError("Reset before granting the policy channel")
        self._port_exposed = True
        return self._port

    def get_report(self):
        """Trusted terminal diagnostics, or None while an episode is running."""
        return self._control("report")

    def truncate(self, reason="time_limit"):
        """Trusted stop for a policy that times out or disconnects."""
        return tuple(self._control("truncate", reason=reason))

    @property
    def trajectory(self):
        return self._control("trajectory")

    def close(self):
        self._finalize()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
