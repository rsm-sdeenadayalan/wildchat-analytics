import argparse
import sys

STAGES = ["flatten", "sample", "label", "classify", "metrics"]


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="loupe", description="Loupe pipeline stages")
    p.add_subparsers(dest="stage", metavar="{" + ",".join(STAGES) + "}")
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    if args.stage is None:
        build_parser().print_help()
        return 1
    print(f"stage {args.stage} not implemented yet", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
