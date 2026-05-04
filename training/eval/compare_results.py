"""Generate a comparison table across all 3 models — baseline vs fine-tuned.

Usage:
  python compare_results.py

Reads all *_results.json files and prints a markdown table.
"""

import json
import glob
from pathlib import Path


def load_results(pattern: str) -> list[dict]:
    results = []
    for path in glob.glob(pattern):
        with open(path) as f:
            results.append(json.load(f))
    return results


def print_coding_table(results: list[dict]):
    print("\n## Coding Model — HumanEval pass@1\n")
    print(f"{'Model':<45} {'pass@1':>8} {'Passed':>8} {'Avg Latency':>12}")
    print("-" * 75)
    for r in sorted(results, key=lambda x: -x.get("pass_at_1", 0)):
        print(
            f"{r['model']:<45} {r.get('pass_at_1', 0):>7.1f}%"
            f" {r.get('passed', 0)}/{r.get('total', 0):>5}"
            f" {r.get('avg_latency', 0):>10.2f}s"
        )


def print_meeting_table(results: list[dict]):
    print("\n## Meeting Model — ROUGE Scores (DialogSum)\n")
    print(f"{'Model':<45} {'ROUGE-1':>8} {'ROUGE-2':>8} {'ROUGE-L':>8} {'Latency':>10}")
    print("-" * 82)
    for r in sorted(results, key=lambda x: -x.get("rougeL", 0)):
        print(
            f"{r['model']:<45} {r.get('rouge1', 0):>7.2f} {r.get('rouge2', 0):>8.2f}"
            f" {r.get('rougeL', 0):>8.2f} {r.get('avg_latency_sec', 0):>9.2f}s"
        )


def print_summary():
    print("\n" + "=" * 82)
    print("WOS MODEL COMPARISON — CAPSTONE PROJECT")
    print("=" * 82)
    print("Models compared:")
    print("  1. Qwen2.5-32B-Instruct   (baseline, no fine-tuning)")
    print("  2. WOS-Main-32B           (fine-tuned: general assistant)")
    print("  3. WOS-Meeting-32B        (fine-tuned: meeting intelligence)")
    print("  4. WOS-Coding-32B         (fine-tuned: code generation)")
    print("  5. GPT-5.4                (commercial reference)")

    coding_results = load_results("coding_results*.json")
    meeting_results = load_results("meeting_results*.json")

    if coding_results:
        print_coding_table(coding_results)
    else:
        print("\n[No coding results found — run eval_coding.py first]")

    if meeting_results:
        print_meeting_table(meeting_results)
    else:
        print("\n[No meeting results found — run eval_meeting.py first]")

    print("\n" + "=" * 82)


if __name__ == "__main__":
    print_summary()
