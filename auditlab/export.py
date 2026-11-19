"""Export public episode documents, optionally with separate evaluator-only files."""
import argparse
from pathlib import Path
import tempfile

from .env import decode
from .generator import VERSION, generate, open_configs
from .storage import public_files, readable


def _same_tree(target, files):
    if not target.is_dir() or target.is_symlink():
        return False
    found = set()
    for path in target.rglob("*"):
        if path.is_symlink():
            return False
        if path.is_file():
            found.add(path.relative_to(target).as_posix())
    return found == set(files) and all((target / name).read_bytes() == body.encode("utf-8")
                                        for name, body in files.items())


def _status(target, files):
    if not target.exists():
        return "new"
    if target.is_dir() and not any(target.iterdir()):
        return "new"
    if _same_tree(target, files):
        return "same"
    raise ValueError(f"destination has different contents: {target}; choose a fresh directory")


def _write_tree(target, files, private):
    if _status(target, files) == "same":
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=target.parent, prefix=".audit-export-") as temp:
        staged = Path(temp) / "data"
        staged.mkdir(mode=0o700 if private else 0o755)
        for name, body in files.items():
            path = staged / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body.encode("utf-8"))
            if private:
                path.chmod(0o600)
        try:
            staged.rename(target)
        except OSError:
            if not _same_tree(target, files):
                raise


def export(pairs, public_out, private_out=None, *, split=False):
    public = Path(public_out).resolve()
    private = Path(private_out).resolve() if private_out is not None else None
    if private is not None:
        if public.is_relative_to(private) or private.is_relative_to(public):
            raise ValueError("public and private outputs must be disjoint directories")
        web = Path(__file__).resolve().parent.parent / "dist"
        if private.is_relative_to(web) or web.is_relative_to(private):
            raise ValueError("private evaluator data must stay outside the published site")
    exposed, hidden = {}, {}
    for index, (seed, config) in enumerate(pairs, 1):
        episode = generate(seed, config)
        prefix = f"{index:02}/" if split else ""
        for name, body in public_files(episode).items():
            exposed[prefix + name] = body
        if private is not None:
            hidden[prefix + "truth.json"] = readable(episode["truth"])
            recipe = {"episode_id": episode["manifest"]["episode_id"], "generator_version": VERSION,
                      "seed": seed, "config": config, "changes": episode["provenance"]}
            hidden[prefix + "provenance.json"] = readable(recipe)
    # Preflight both destinations before publishing either complete staged tree.
    _status(public, exposed)
    if private is not None:
        _status(private, hidden)
        _write_tree(private, hidden, private=True)
    _write_tree(public, exposed, private=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument("--seed", type=int, help="generate one episode")
    choice.add_argument("--split", choices=("train","dev"), help="export ten published configurations")
    parser.add_argument("--config", type=Path, help="trusted JSON generation configuration for --seed")
    parser.add_argument("--out", type=Path, required=True, help="public destination directory")
    parser.add_argument("--private-out", type=Path, help="separate evaluator-only directory")
    args = parser.parse_args()
    if args.config and args.split:
        parser.error("--config is only valid with --seed")
    try:
        if args.split:
            pairs = open_configs(args.split)
        else:
            config = decode(args.config.read_bytes()) if args.config else {}
            if not isinstance(config, dict):
                raise ValueError("config must be an object")
            pairs = [(args.seed, config)]
        export(pairs, args.out, args.private_out, split=bool(args.split))
    except (ValueError, OSError, TypeError, OverflowError) as exc:
        parser.exit(2, f"export: {exc}\n")
    print(f"Exported {len(pairs)} episode(s) to {args.out}")
    if args.private_out:
        print(f"Evaluator-only files: {args.private_out}")


if __name__ == "__main__":
    main()
