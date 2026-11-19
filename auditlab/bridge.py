"""Policy-facing NDJSON over stdin/stdout. All configuration comes from the owner."""
import argparse
import os
from pathlib import Path
import select
import sys
import time

from .env import ACTION_LIMIT, AuditEnv, decode, decode_action, encode


def entries(fd, deadline):
    """Bound line memory, including absent newlines. An oversized line costs a step."""
    buffer = bytearray()
    overflow = False
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0 or not select.select([fd], [], [], remaining)[0]:
            return
        data = os.read(fd, 65536)
        if not data:
            if buffer or overflow:
                yield None if overflow else bytes(buffer)
            return
        offset = 0
        while offset < len(data):
            newline = data.find(b"\n", offset)
            boundary = newline if newline >= 0 else len(data)
            if not overflow:
                if len(buffer) + boundary - offset + 1 > ACTION_LIMIT:
                    buffer.clear()
                    overflow = True
                else:
                    buffer.extend(data[offset:boundary])
            if newline < 0:
                break
            yield None if overflow else bytes(buffer)
            buffer.clear()
            overflow, offset = False, newline + 1


def write_message(fd, value, deadline):
    """Write one JSON line to an already nonblocking descriptor within its deadline."""
    data = memoryview(encode(value))
    while data:
        try:
            written = os.write(fd, data)
        except BlockingIOError:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([], [fd], [], remaining)[1]:
                raise TimeoutError("Peer did not read its messages on time") from None
            continue
        if not written:
            raise BrokenPipeError("Peer disconnected")
        data = data[written:]


def emit_step(fd, transition, deadline):
    observation, reward, terminated, truncated, info = transition
    write_message(fd, dict(observation=observation, reward=reward,
                           terminated=terminated, truncated=truncated, info=info), deadline)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["train", "eval"], default="eval")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--config", type=Path, help="Trusted JSON configuration file")
    parser.add_argument("--report", type=Path, help="Optional private evaluator output")
    parser.add_argument("--max-steps", type=int, default=100)
    parser.add_argument("--time-limit", type=float, default=60)
    args = parser.parse_args()
    config = decode(args.config.read_bytes()) if args.config is not None else {}
    with AuditEnv(args.mode, args.max_steps, args.time_limit) as env:
        observation, info = env.reset(args.seed, config)
        deadline = env.deadline
        output = sys.stdout.fileno()
        os.set_blocking(output, False)
        try:
            write_message(output, dict(observation=observation, info=info), deadline)
            for line in entries(sys.stdin.fileno(), deadline):
                result = env.step(decode_action(line))
                emit_step(output, result, deadline)
                if result[2] or result[3]:
                    break
            else:
                reason = "time_limit" if time.monotonic() >= deadline else "peer_closed"
                emit_step(output, env.truncate(reason), deadline)
        except BrokenPipeError:
            env.truncate("peer_closed")
        except TimeoutError:
            env.truncate("time_limit")
        if args.report is not None:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_bytes(encode(env.get_report()))


if __name__ == "__main__":
    main()
