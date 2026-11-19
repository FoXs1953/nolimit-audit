"""Pipe only observations/actions between two offline Docker containers."""
import argparse
import asyncio
import json
import uuid


async def main(args):
    prefix = ["docker", "run", "--rm", "--pull=never", "-i", "--network=none", "--read-only",
              "--tmpfs", "/tmp:rw,nosuid,nodev,size=64m", "--cpus=1", "--memory=2g",
              "--pids-limit=48", "--cap-drop=ALL", "--security-opt=no-new-privileges"]
    suffix = uuid.uuid4().hex[:12]
    containers=[]
    async def start(role, image, commands):
        name = "nolimit-"+role+"-"+suffix
        proc = await asyncio.create_subprocess_exec(*prefix, "--name", name, image, *commands,
                                                   stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                                                   limit=2**20)
        containers.append((name, proc))
        return proc
    async def exchange():
        evaluator = await start("eval", args.image, ["python","-m","auditlab.bridge","--mode","eval","--seed",str(args.seed)])
        policy_command = args.command if args.command else ["python","-m","auditlab.runner",args.policy]
        policy = await start("policy", args.policy_image or args.image, policy_command)
        packet = json.loads(await evaluator.stdout.readline())
        actions=0
        while True:
            policy.stdin.write(json.dumps(packet["observation"],ensure_ascii=False).encode()+b"\n")
            await policy.stdin.drain()
            line = await policy.stdout.readline()
            if not line or len(line)>2**20:
                raise RuntimeError("Policy disconnected or exceeded the action size limit")
            evaluator.stdin.write(line)
            await evaluator.stdin.drain()
            packet=json.loads(await evaluator.stdout.readline())
            actions+=1
            if packet["reward"] != 0 or packet["info"]:
                raise RuntimeError("Closed evaluation returned diagnostics to the agent")
            if packet["terminated"] or packet["truncated"]:
                print(json.dumps({"steps":actions,"terminated":packet["terminated"],"truncated":packet["truncated"]}))
                break
        for proc in (policy,evaluator):
            proc.stdin.close()
            code=await proc.wait()
            if code:
                raise RuntimeError(f"Container exited with status {code}")
    try:
        await asyncio.wait_for(exchange(), timeout=75)
    finally:
        for name, proc in containers:
            if proc.returncode is None:
                remover=await asyncio.create_subprocess_exec("docker","rm","-f",name,stdout=asyncio.subprocess.DEVNULL,
                                                            stderr=asyncio.subprocess.DEVNULL)
                await remover.wait()
                await proc.wait()


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image",default="nolimit-audit")
    parser.add_argument("--policy-image",help="Separate, preloaded policy image")
    parser.add_argument("--seed",type=int,required=True)
    parser.add_argument("--policy",choices=("random","reconcile","mark_all"),default="reconcile")
    parser.add_argument("command",nargs="*",help="Optional policy image command")
    asyncio.run(main(parser.parse_args()))
