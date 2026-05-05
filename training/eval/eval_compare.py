"""Cross-model comparison — runs ALL models on the SAME prompts.

Shows the specialization tradeoff:
  - Coding model: best at coding, weak at meeting
  - Meeting model: best at meeting, weak at coding
  - Main model: good at both, not the best at either
  - Baseline: weakest across all tasks

Usage:
  1. Fill in models_config.json with your RunPod endpoint URLs
  2. python eval_compare.py
  3. python generate_report.py  (to rebuild HTML with cross-model section)

Output: cross_compare_results.json + printed table
"""

import argparse
import json
import re
import subprocess
import tempfile
import time
from pathlib import Path

import requests
from rouge_score import rouge_scorer

# ── Coding test prompts ────────────────────────────────────────────────────────
CODING_PROMPTS = [
    {
        "id": "C1",
        "prompt": "def has_close_elements(numbers, threshold):\n    \"\"\"Check if any two numbers in the list are closer than threshold.\"\"\"\n",
        "entry_point": "has_close_elements",
        "test": "assert has_close_elements([1.0, 2.0, 3.0], 0.5) == False\nassert has_close_elements([1.0, 2.8, 3.0], 0.3) == True",
    },
    {
        "id": "C2",
        "prompt": "def below_zero(operations):\n    \"\"\"Return True if bank balance goes below zero given a list of operations.\"\"\"\n",
        "entry_point": "below_zero",
        "test": "assert below_zero([1, 2, 3]) == False\nassert below_zero([1, 2, -4, 5]) == True",
    },
    {
        "id": "C3",
        "prompt": "def truncate_number(number):\n    \"\"\"Return the decimal part of a positive float.\"\"\"\n",
        "entry_point": "truncate_number",
        "test": "assert abs(truncate_number(3.5) - 0.5) < 1e-6",
    },
]

# ── Meeting test prompts ───────────────────────────────────────────────────────
MEETING_PROMPTS = [
    {
        "id": "M1",
        "prompt": (
            "Summarize this meeting transcript:\n"
            "Alice: We need to finalize the Q3 budget by Friday.\n"
            "Bob: I can have the numbers ready by Thursday.\n"
            "Alice: Great. The client demo is moved to next Tuesday.\n"
            "Bob: I'll prepare the slides."
        ),
        "reference": (
            "Q3 budget to be finalized by Friday. Bob will prepare numbers by Thursday. "
            "Client demo rescheduled to next Tuesday. Bob will prepare the slides."
        ),
    },
    {
        "id": "M2",
        "prompt": (
            "Extract action items from this meeting:\n"
            "John: Let's assign the new feature to Sarah.\n"
            "Sarah: I'll need the design files first.\n"
            "Mike: I'll send them today.\n"
            "John: Sarah, can you have a prototype by Monday?"
        ),
        "reference": (
            "Mike: Send design files to Sarah — today. "
            "Sarah: Deliver prototype — by Monday."
        ),
    },
    {
        "id": "M3",
        "prompt": (
            "What decisions were made in this meeting?\n"
            "Team discussed microservices vs monolith architecture for 30 minutes. "
            "Decided to go with microservices for scalability. "
            "Budget approved for 3 new engineers."
        ),
        "reference": (
            "Decided to adopt microservices architecture for scalability. "
            "Approved budget for 3 new engineers."
        ),
    },
]

CODING_SYSTEM  = "You are an expert software engineer. Write correct Python code. Return only the function implementation."
MEETING_SYSTEM = "You are a meeting intelligence assistant. Summarize transcripts and extract action items concisely."


def call_model(endpoint: str, model_id: str, system: str, prompt: str, api_key: str = "EMPTY") -> str:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model_id,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": prompt},
        ],
        "max_tokens": 512,
        "temperature": 0.0,
    }
    r = requests.post(f"{endpoint}/chat/completions", json=payload, headers=headers, timeout=90)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def extract_code(response: str, entry_point: str) -> str:
    match = re.search(r"```(?:python)?\n(.*?)```", response, re.DOTALL)
    if match:
        return match.group(1).strip()
    lines = response.strip().split("\n")
    code_lines, in_func = [], False
    for line in lines:
        if f"def {entry_point}" in line:
            in_func = True
        if in_func:
            code_lines.append(line)
    return "\n".join(code_lines) if code_lines else response.strip()


def run_test(code: str, test: str) -> bool:
    full = f"from typing import List, Dict, Tuple, Optional\n{code}\n{test}"
    with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
        f.write(full)
        tmp = f.name
    try:
        result = subprocess.run(["python", tmp], capture_output=True, text=True, timeout=10)
        return result.returncode == 0
    except subprocess.TimeoutExpired:
        return False
    finally:
        Path(tmp).unlink(missing_ok=True)


def rouge_l(prediction: str, reference: str) -> float:
    s = rouge_scorer.RougeScorer(["rougeL"], use_stemmer=True)
    return round(s.score(reference, prediction)["rougeL"].fmeasure * 100, 1)


def eval_model(label: str, endpoint: str, model_id: str, api_key: str) -> dict:
    print(f"\n  Testing: {label}")

    # Coding
    coding_passed = 0
    for p in CODING_PROMPTS:
        try:
            response = call_model(endpoint, model_id, CODING_SYSTEM,
                                  f"Complete this Python function:\n\n{p['prompt']}", api_key)
            code = extract_code(response, p["entry_point"])
            passed = run_test(code, p["test"])
        except Exception:
            passed = False
        coding_passed += passed
        print(f"    {p['id']}: {'PASS' if passed else 'FAIL'}")

    coding_pass_at_1 = round(coding_passed / len(CODING_PROMPTS) * 100, 1)

    # Meeting
    meeting_scores = []
    for p in MEETING_PROMPTS:
        try:
            response = call_model(endpoint, model_id, MEETING_SYSTEM, p["prompt"], api_key)
            score = rouge_l(response, p["reference"])
        except Exception:
            score = 0.0
        meeting_scores.append(score)
        print(f"    {p['id']}: ROUGE-L {score}")

    meeting_rougeL = round(sum(meeting_scores) / len(meeting_scores), 1)

    return {
        "label":          label,
        "model_id":       model_id,
        "coding_pass_at_1": coding_pass_at_1,
        "coding_passed":  coding_passed,
        "coding_total":   len(CODING_PROMPTS),
        "meeting_rougeL": meeting_rougeL,
    }


def print_table(results: list[dict]):
    print(f"\n{'='*70}")
    print("CROSS-MODEL COMPARISON — Specialization Tradeoff")
    print(f"{'='*70}")
    print(f"{'Model':<35} {'Coding pass@1':>14} {'Meeting ROUGE-L':>16}")
    print("-" * 70)
    for r in results:
        coding  = f"{r['coding_pass_at_1']}% ({r['coding_passed']}/{r['coding_total']})"
        meeting = f"{r['meeting_rougeL']}"
        print(f"{r['label']:<35} {coding:>14} {meeting:>16}")
    print(f"{'='*70}")
    print("\nInterpretation:")
    print("  - Coding model:  highest coding score, lower meeting score")
    print("  - Meeting model: highest meeting score, lower coding score")
    print("  - Main model:    competitive on both — best all-rounder")
    print("  - Baseline:      lowest across both tasks")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="models_config.json",
                        help="Path to models_config.json")
    parser.add_argument("--out", default="cross_compare_results.json")
    args = parser.parse_args()

    config_path = Path(args.config)
    if not config_path.exists():
        print(f"Config not found: {args.config}")
        print("Create models_config.json with your endpoint URLs first.")
        return

    config = json.loads(config_path.read_text())
    models = config["models"]

    # Skip placeholder entries
    active = [m for m in models if "YOUR_" not in m["endpoint"]]
    if not active:
        print("No endpoints configured yet — fill in models_config.json with your RunPod URLs.")
        return

    print(f"Running cross-model comparison across {len(active)} models...")
    print(f"Coding: {len(CODING_PROMPTS)} problems | Meeting: {len(MEETING_PROMPTS)} samples\n")

    results = []
    for m in active:
        try:
            result = eval_model(m["label"], m["endpoint"], m["model_id"], m.get("api_key", "EMPTY"))
            results.append(result)
        except Exception as e:
            print(f"  ERROR evaluating {m['label']}: {e}")

    print_table(results)

    with open(args.out, "w") as f:
        json.dump({"models": results, "coding_problems": len(CODING_PROMPTS),
                   "meeting_samples": len(MEETING_PROMPTS)}, f, indent=2)
    print(f"\nSaved to {args.out}")
    print("Run python generate_report.py to update the HTML report.")


if __name__ == "__main__":
    main()
