import argparse
from pathlib import Path


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="loupe", description="Loupe pipeline stages")
    sub = p.add_subparsers(dest="stage")

    f = sub.add_parser("flatten", help="shards -> data/flat")
    f.add_argument("--shards", default="all", help="all | 0-3 | 0,5,7")
    f.add_argument("--keep-raw", action="store_true")
    f.add_argument("--local", nargs="*", type=Path, help="local shard parquet paths (skips download)")

    s = sub.add_parser("sample", help="stratified intent sample")
    s.add_argument("--n", type=int, default=20000)

    l = sub.add_parser("label", help="label sample via Anthropic Message Batches")
    l.add_argument("--dry-run", action="store_true")
    l.add_argument("--model", default=None)
    l.add_argument("--budget", type=float, default=None)
    l.add_argument("--resume-batch", default=None, help="poll an existing batch id instead of submitting")

    c = sub.add_parser("classify", help="train classifier and predict all conversations")
    c.add_argument("--threshold", type=float, default=0.85)
    c.add_argument("--force", action="store_true")

    m = sub.add_parser("metrics", help="write aggregates/")
    m.add_argument("--min-cell", type=int, default=20)
    return p


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.stage is None:
        parser.print_help()
        return 1
    if args.stage == "flatten":
        from loupe.stages import flatten
        flatten.run(shards=args.shards, keep_raw=args.keep_raw, local_paths=args.local)
        return 0
    if args.stage == "sample":
        from loupe.stages import sample
        print(sample.run(n=args.n))
        return 0
    if args.stage == "label":
        from loupe.stages import label
        try:
            run_log = label.run(model=args.model, budget_usd=args.budget, dry_run=args.dry_run,
                                resume_batch_id=args.resume_batch)
        except label.CanaryFailed as e:
            print(e)
            return 5
        except label.BudgetExceeded as e:
            print(e)
            return 3
        return 0 if run_log.get("ok", True) else 4
    if args.stage == "classify":
        from loupe.stages import classify
        rep = classify.run(threshold=args.threshold, force=args.force)
        return 0 if rep.get("predicted") else 2
    if args.stage == "metrics":
        from loupe.stages import metrics
        metrics.run(min_cell=args.min_cell)
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
