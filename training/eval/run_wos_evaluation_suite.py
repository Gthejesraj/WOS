#!/usr/bin/env python3
"""
Run full WOS evaluation across models listed in models_config.json.

Resolves API keys: per-row `api_key`, else env RUNPOD_API_KEY / RUNPOD_KEY, else EMPTY.

Per model type:
  - coding: HumanEval (HF) + MBPP + tool-use probe
  - meeting: DialogSum ROUGE + faithfulness / hallucination proxy
  - main: orchestration ROUGE + tool-use probe
  - baseline: full slate (coding + meeting + main + tools + faithfulness)

Then runs meeting_long_showcase.py unless --skip-showcase.

Example:
  export RUNPOD_API_KEY=rpa_...
  cd training/eval
  python run_wos_evaluation_suite.py --config models_config.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = sys.executable


def slug(s: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", s)[:120]


def run_py(args: list[str], cwd: Path) -> int:
    print("+", " ".join(args), flush=True)
    p = subprocess.run([PY, *args], cwd=str(cwd))
    return p.returncode


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=str(HERE / "models_config.json"))
    ap.add_argument("--out-dir", default=None, help="Output directory (default: suite_UTCtimestamp)")
    ap.add_argument("--humaneval-limit", type=int, default=80, help="OpenAI HumanEval HF tasks (max 164)")
    ap.add_argument("--mbpp-limit", type=int, default=50, help="MBPP train tasks")
    ap.add_argument("--meeting-samples", type=int, default=72, help="DialogSum test samples")
    ap.add_argument("--skip-showcase", action="store_true")
    args = ap.parse_args()

    cfg_path = Path(args.config)
    if not cfg_path.is_file():
        print(f"Missing config: {cfg_path}")
        sys.exit(1)

    cfg = json.loads(cfg_path.read_text())
    models = [m for m in cfg.get("models", []) if "YOUR_" not in m.get("endpoint", "")]
    if not models:
        print("No active models (fill endpoint URLs in models_config.json).")
        sys.exit(1)

    out = Path(
        args.out_dir
        or HERE / f"suite_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"
    )
    out.mkdir(parents=True, exist_ok=True)

    default_key = os.environ.get("RUNPOD_API_KEY") or os.environ.get("RUNPOD_KEY") or ""

    manifest: dict = {
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "config": str(cfg_path),
        "out_dir": str(out),
        "humaneval_limit": args.humaneval_limit,
        "mbpp_limit": args.mbpp_limit,
        "meeting_samples": args.meeting_samples,
        "artifacts": [],
    }

    def record(path: str, **meta):
        meta.setdefault("model_id", model_id)
        meta.setdefault("label", label)
        meta.setdefault("model_role", mtype)
        manifest["artifacts"].append({"path": path, **meta})

    for m in models:
        label = m.get("label", m.get("model_id", "model"))
        mtype = m.get("type", "coding")
        # Must be OpenAI-compatible base, e.g. https://api.runpod.ai/v2/<id>/openai/v1
        endpoint = m["endpoint"].rstrip("/")
        model_id = m["model_id"]
        api_key = m.get("api_key") or default_key or "EMPTY"
        base = slug(f"{mtype}_{model_id}")

        def he_path():
            return str(out / f"{base}_humaneval.json")

        def mbpp_path():
            return str(out / f"{base}_mbpp.json")

        def meeting_path():
            return str(out / f"{base}_meeting_dialogsum.json")

        def main_path():
            return str(out / f"{base}_main_orchestration.json")

        def tool_path():
            return str(out / f"{base}_tool_use.json")

        def faith_path():
            return str(out / f"{base}_meeting_faith.json")

        if mtype in ("coding", "baseline"):
            rc = run_py(
                [
                    str(HERE / "eval_coding.py"),
                    "--endpoint",
                    endpoint,
                    "--model",
                    model_id,
                    "--api_key",
                    api_key,
                    "--benchmark",
                    "humaneval",
                    "--humaneval-source",
                    "hf",
                    "--humaneval-limit",
                    str(args.humaneval_limit),
                    "--out",
                    he_path(),
                ],
                HERE,
            )
            record(he_path(), label=label, benchmark="humaneval", rc=rc)
            if rc != 0:
                print(f"WARN: HumanEval failed for {label} (rc={rc})")

            rc = run_py(
                [
                    str(HERE / "eval_coding.py"),
                    "--endpoint",
                    endpoint,
                    "--model",
                    model_id,
                    "--api_key",
                    api_key,
                    "--benchmark",
                    "mbpp",
                    "--mbpp-limit",
                    str(args.mbpp_limit),
                    "--out",
                    mbpp_path(),
                ],
                HERE,
            )
            record(mbpp_path(), label=label, benchmark="mbpp", rc=rc)
            if rc != 0:
                print(f"WARN: MBPP failed for {label} (rc={rc})")

        if mtype in ("coding", "main", "baseline"):
            rc = run_py(
                [
                    str(HERE / "eval_tool_use.py"),
                    "--endpoint",
                    endpoint,
                    "--model",
                    model_id,
                    "--api_key",
                    api_key,
                    "--out",
                    tool_path(),
                ],
                HERE,
            )
            record(tool_path(), label=label, benchmark="tool_use", rc=rc)
            if rc != 0:
                print(f"WARN: Tool-use eval failed for {label} (rc={rc})")

        if mtype in ("meeting", "baseline"):
            rc = run_py(
                [
                    str(HERE / "eval_meeting.py"),
                    "--endpoint",
                    endpoint,
                    "--model",
                    model_id,
                    "--api_key",
                    api_key,
                    "--max-samples",
                    str(args.meeting_samples),
                    "--out",
                    meeting_path(),
                ],
                HERE,
            )
            record(
                meeting_path(),
                label=label,
                benchmark="meeting_dialogsum",
                rc=rc,
            )
            if rc != 0:
                print(f"WARN: Meeting eval failed for {label} (rc={rc})")

            rc = run_py(
                [
                    str(HERE / "eval_meeting_faithfulness.py"),
                    "--endpoint",
                    endpoint,
                    "--model",
                    model_id,
                    "--api_key",
                    api_key,
                    "--out",
                    faith_path(),
                ],
                HERE,
            )
            record(faith_path(), label=label, benchmark="meeting_faithfulness", rc=rc)
            if rc != 0:
                print(f"WARN: Meeting faithfulness eval failed for {label} (rc={rc})")

        if mtype in ("main", "baseline"):
            rc = run_py(
                [
                    str(HERE / "eval_main.py"),
                    "--endpoint",
                    endpoint,
                    "--model",
                    model_id,
                    "--api_key",
                    api_key,
                    "--out",
                    main_path(),
                ],
                HERE,
            )
            record(main_path(), label=label, benchmark="main_orchestration", rc=rc)
            if rc != 0:
                print(f"WARN: Main eval failed for {label} (rc={rc})")

    showcase_path = out / "showcase_meeting_long.json"
    if not args.skip_showcase:
        env = os.environ.copy()
        if default_key:
            env.setdefault("RUNPOD_API_KEY", default_key)
        print("+ meeting_long_showcase", flush=True)
        p = subprocess.run(
            [
                PY,
                str(HERE / "meeting_long_showcase.py"),
                "--config",
                str(cfg_path),
                "--out",
                str(showcase_path),
            ],
            cwd=str(HERE),
            env=env,
        )
        record(str(showcase_path), benchmark="showcase_long_meeting", rc=p.returncode)

    man_path = out / "suite_manifest.json"
    man_path.write_text(json.dumps(manifest, indent=2))
    print(f"\nSuite complete. Manifest: {man_path}")
    print("Generate HTML report:")
    print(f"  python generate_comprehensive_report.py --manifest {man_path}")


if __name__ == "__main__":
    main()
