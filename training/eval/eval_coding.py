"""Coding model evaluation — HumanEval (inline subset or full HF dataset) + MBPP.

Usage:
  # 5-problem inline subset (fast smoke)
  python eval_coding.py --endpoint URL/v1 --model thejesraj/wos-coding-gemma --api_key KEY

  # First 40 HumanEval problems from Hugging Face (recommended for reports)
  python eval_coding.py --endpoint URL/v1 --model thejesraj/wos-coding-gemma \\
      --api_key KEY --benchmark humaneval --humaneval-source hf --humaneval-limit 40

  # MBPP (default 30 tasks from sanitized split)
  python eval_coding.py --endpoint URL/v1 --model thejesraj/wos-coding-gemma \\
      --api_key KEY --benchmark mbpp --mbpp-limit 30
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import requests

import math

from eval_metrics_common import code_token_f1, code_token_prf

SYSTEM = (
    "You are an expert software engineer. Write correct, efficient Python code. "
    "Return only the function implementation, no explanations."
)

# ── small inline subset (no datasets dependency) ───────────────────────────
HUMANEVAL_INLINE = [
    {
        "id": "HE/0",
        "prompt": "def has_close_elements(numbers: List[float], threshold: float) -> bool:\n    \"\"\" Check if in given list of numbers, are any two numbers closer to each other than\n    given threshold.\n    >>> has_close_elements([1.0, 2.0, 3.0], 0.5)\n    False\n    >>> has_close_elements([1.0, 2.8, 3.0, 4.0, 5.0, 2.0], 0.3)\n    True\n    \"\"\"",
        "entry_point": "has_close_elements",
        "test": "assert has_close_elements([1.0, 2.0, 3.0], 0.5) == False\nassert has_close_elements([1.0, 2.8, 3.0, 4.0, 5.0, 2.0], 0.3) == True",
    },
    {
        "id": "HE/1",
        "prompt": "def separate_paren_groups(paren_string: str) -> List[str]:\n    \"\"\" Input to this function is a string containing multiple groups of nested parentheses.\n    Your goal is to separate those groups into separate strings and return the list of those.\n    Separate groups are balanced (each open brace is properly closed) and not nested within each other.\n    \"\"\"",
        "entry_point": "separate_paren_groups",
        "test": "assert separate_paren_groups('( ) (( )) (( )( ))') == ['()', '(())', '(()())']",
    },
    {
        "id": "HE/2",
        "prompt": "def truncate_number(number: float) -> float:\n    \"\"\" Given a positive floating point number, it can be decomposed into\n    and integer part (largest integer smaller than given number) and decimals\n    (leftover part always smaller than 1).\n    Return the decimal part of the number.\n    >>> truncate_number(3.5)\n    0.5\n    \"\"\"",
        "entry_point": "truncate_number",
        "test": "assert abs(truncate_number(3.5) - 0.5) < 1e-6\nassert abs(truncate_number(1.33) - 0.33) < 1e-6",
    },
    {
        "id": "HE/3",
        "prompt": "def below_zero(operations: List[int]) -> bool:\n    \"\"\" You're given a list of deposit and withdrawal operations on a bank account that starts with\n    zero balance. Your task is to detect if at any point the balance of account falls below zero, and\n    at that point function should return True. Otherwise it should return False.\n    \"\"\"",
        "entry_point": "below_zero",
        "test": "assert below_zero([1, 2, 3]) == False\nassert below_zero([1, 2, -4, 5]) == True",
    },
    {
        "id": "HE/4",
        "prompt": "def mean_absolute_deviation(numbers: List[float]) -> float:\n    \"\"\" For a given list of input numbers, calculate Mean Absolute Deviation\n    around the mean of this dataset.\n    Mean Absolute Deviation is the average absolute difference between each\n    element and a centerpoint (mean in this case).\n    \"\"\"",
        "entry_point": "mean_absolute_deviation",
        "test": "assert abs(mean_absolute_deviation([1.0, 2.0, 3.0, 4.0]) - 1.0) < 1e-6",
    },
]


def load_humaneval_hf(limit: int) -> list[dict]:
    from datasets import load_dataset

    ds = load_dataset("openai_humaneval", split="test")
    out = []
    for i, row in enumerate(ds):
        if i >= limit:
            break
        out.append(
            {
                "id": row["task_id"],
                "prompt": row["prompt"],
                "entry_point": row["entry_point"],
                "test": row["test"],
                "canonical_solution": row.get("canonical_solution", ""),
                "mode": "hf_check",
            }
        )
    return out


def _entry_from_ref(code_ref: str) -> str:
    m = re.search(r"def\s+(\w+)\s*\(", code_ref or "")
    return m.group(1) if m else "solution"


def load_mbpp_hf(limit: int) -> list[dict]:
    from datasets import load_dataset

    ds = None
    for config in ("sanitized", "full"):
        try:
            ds = load_dataset("mbpp", config, split="train")
            break
        except Exception:
            continue
    if ds is None:
        raise RuntimeError("Could not load mbpp (try: pip install datasets, check HF cache)")
    out = []
    for i, row in enumerate(ds):
        if i >= limit:
            break
        ref = row.get("code") or ""
        # MBPP dataset schema: 'text' (sanitized) or 'prompt' (full) — handle both
        text = row.get("text") or row.get("prompt") or ""
        out.append(
            {
                "id": f"MBPP/{row.get('task_id', i)}",
                "text": text,
                "code_ref": ref,
                "entry_point": _entry_from_ref(ref),
                "test_list": list(row["test_list"]),
            }
        )
    return out


def call_model(
    endpoint: str,
    model: str,
    prompt: str,
    api_key: str = "EMPTY",
    max_tokens: int = 512,
    temperature: float = 0.0,
) -> str:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"Complete this Python function:\n\n{prompt}"},
        ],
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    r = requests.post(f"{endpoint}/chat/completions", json=payload, headers=headers, timeout=180)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def _pass_at_k_unbiased(n: int, c: int, k: int) -> float:
    """Unbiased pass@k estimator (Chen et al. 2021): 1 - C(n-c,k)/C(n,k)."""
    if n - c < k:
        return 1.0
    return 1.0 - math.prod((n - c - i) / (n - i) for i in range(k))


def extract_code(response: str, entry_point: str) -> str:
    match = re.search(r"```(?:python)?\n(.*?)```", response, re.DOTALL)
    if match:
        # Strip leading/trailing blank lines but PRESERVE first-line indent.
        # Gemma + some other models return body-indented code (4-space indent)
        # for HumanEval continuation; .strip() would kill that indent and
        # break Python execution.
        body = match.group(1).rstrip()
        # Remove leading blank lines (but keep indent of first non-blank line)
        body_lines = body.split("\n")
        while body_lines and body_lines[0].strip() == "":
            body_lines.pop(0)
        return "\n".join(body_lines)
    lines = response.strip().split("\n")
    code_lines = []
    in_func = False
    for line in lines:
        if f"def {entry_point}" in line:
            in_func = True
        if in_func:
            code_lines.append(line)
    return "\n".join(code_lines) if code_lines else response.strip()


def extract_any_function(response: str) -> str:
    """First fenced python block, else first line starting with def through blank line break."""
    m = re.search(r"```(?:python)?\n(.*?)```", response, re.DOTALL)
    if m:
        return m.group(1).strip()
    lines = response.strip().split("\n")
    out, seen = [], False
    for line in lines:
        if line.strip().startswith("def "):
            seen = True
        if seen:
            out.append(line)
            if seen and line.strip() == "" and len(out) > 2:
                break
    return "\n".join(out).strip() if out else response.strip()


def merge_humaneval_program(prompt: str, response: str, entry_point: str) -> str:
    """Combine HumanEval `prompt` prefix with model output (full function or body-only).

    Normalizes tabs→4 spaces and re-indents the merged block to avoid
    'unindent does not match any outer indentation level' errors when models
    use different indentation conventions (e.g. Gemma uses 2 spaces vs HF's 4).
    """
    block = extract_code(response, entry_point)
    # Normalize tabs to 4 spaces (Python's PEP 8) for both halves
    block = block.expandtabs(4)
    key = f"def {entry_point}"
    if key in block:
        # Model returned a full function — use ONLY the model's output
        # (don't prepend prompt header; that's where indentation mismatch hits)
        return block
    # Model returned body-only — prepend the prompt prefix
    return (prompt + block).expandtabs(4)


def run_test_inline(code: str, test: str) -> tuple[bool, str]:
    full_code = f"from typing import List, Dict, Tuple, Optional\n{code}\n{test}"
    return _run_python(full_code)


def run_test_humaneval_hf(program: str, test: str, entry_point: str) -> tuple[bool, str]:
    full_code = f"{program}\n\n{test}\n\ncheck({entry_point})\n"
    return _run_python(full_code)


def run_test_mbpp(code: str, test_list: list[str]) -> tuple[bool, str]:
    asserts = "\n".join(test_list)
    full_code = f"{code}\n\n{asserts}\n"
    return _run_python(full_code)


def _run_python(full_code: str) -> tuple[bool, str]:
    with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
        f.write(full_code)
        tmp = f.name
    try:
        result = subprocess.run(
            [sys.executable, tmp], capture_output=True, text=True, timeout=30
        )
        passed = result.returncode == 0
        error = result.stderr.strip() if not passed else ""
        return passed, error
    except subprocess.TimeoutExpired:
        return False, "Timeout"
    finally:
        Path(tmp).unlink(missing_ok=True)


def evaluate_humaneval(
    endpoint: str,
    model: str,
    api_key: str,
    problems: list[dict],
    pass_k_samples: int = 0,
) -> dict:
    results = []
    for problem in problems:
        start = time.time()
        program = ""
        prf = None
        try:
            response = call_model(endpoint, model, problem["prompt"], api_key)
            if problem.get("mode") == "hf_check":
                program = merge_humaneval_program(
                    problem["prompt"], response, problem["entry_point"]
                )
                passed, error = run_test_humaneval_hf(
                    program, problem["test"], problem["entry_point"]
                )
            else:
                program = extract_code(response, problem["entry_point"])
                passed, error = run_test_inline(program, problem["test"])
        except Exception as e:
            passed, error = False, str(e)
        latency = time.time() - start
        if problem.get("canonical_solution"):
            gold = problem["prompt"] + problem["canonical_solution"]
            try:
                prf = code_token_prf(gold, program or "")
            except Exception:
                prf = None

        detail: dict = {
            "id": problem["id"],
            "passed": passed,
            "error": error[:500] if error else "",
            "latency": round(latency, 2),
            "token_precision": prf["precision"] if prf else None,
            "token_recall": prf["recall"] if prf else None,
            "token_f1_vs_canonical": prf["f1"] if prf else None,
        }

        # pass@k: sample K times at temperature=0.8
        if pass_k_samples > 0:
            k_passes = 0
            for _ in range(pass_k_samples):
                try:
                    resp_k = call_model(
                        endpoint, model, problem["prompt"], api_key, temperature=0.8
                    )
                    if problem.get("mode") == "hf_check":
                        prog_k = merge_humaneval_program(
                            problem["prompt"], resp_k, problem["entry_point"]
                        )
                        ok, _ = run_test_humaneval_hf(
                            prog_k, problem["test"], problem["entry_point"]
                        )
                    else:
                        prog_k = extract_code(resp_k, problem["entry_point"])
                        ok, _ = run_test_inline(prog_k, problem["test"])
                    if ok:
                        k_passes += 1
                except Exception:
                    pass
            detail["pass_k_samples"] = pass_k_samples
            detail["pass_k_passes"] = k_passes
            detail["pass_prob"] = round(k_passes / pass_k_samples, 4)

        results.append(detail)
        status = "PASS" if passed else "FAIL"
        pp = f"  pass@k_prob={detail['pass_prob']:.2f}" if pass_k_samples > 0 else ""
        print(f"  {problem['id']}: {status} ({latency:.1f}s){pp}")

    passed_count = sum(r["passed"] for r in results)
    n = len(results)
    precs = [r["token_precision"] for r in results if r.get("token_precision") is not None]
    recs = [r["token_recall"] for r in results if r.get("token_recall") is not None]
    f1s = [r["token_f1_vs_canonical"] for r in results if r.get("token_f1_vs_canonical") is not None]

    out: dict = {
        "model": model,
        "benchmark": "humaneval",
        "pass_at_1": round(passed_count / n * 100, 1) if n else 0.0,
        "passed": passed_count,
        "total": n,
        "precision": round(sum(precs) / len(precs) * 100, 2) if precs else None,
        "recall": round(sum(recs) / len(recs) * 100, 2) if recs else None,
        "avg_code_token_f1_vs_canonical": round(sum(f1s) / len(f1s), 4) if f1s else None,
        "avg_latency": round(sum(r["latency"] for r in results) / n, 2) if n else 0.0,
        "details": results,
    }

    if pass_k_samples > 0:
        c = sum(1 for r in results if r.get("pass_prob", 0) > 0)
        out["pass_probs"] = [r.get("pass_prob", 0.0) for r in results]
        out["pass_at_5"] = round(_pass_at_k_unbiased(pass_k_samples, int(c * pass_k_samples / n), 5) * 100, 1) if n else 0.0
        out["pass_at_10"] = round(_pass_at_k_unbiased(pass_k_samples, int(c * pass_k_samples / n), 10) * 100, 1) if n else 0.0

    return out


def evaluate_mbpp(
    endpoint: str,
    model: str,
    api_key: str,
    tasks: list[dict],
    pass_k_samples: int = 0,
) -> dict:
    results = []
    for t in tasks:
        start = time.time()
        prf = None
        code = ""
        user = (
            f"Write a Python function that satisfies this specification:\n\n{t['text']}\n\n"
            f"The primary function MUST be named exactly `{t['entry_point']}`.\n"
            "Return only the function definition (and small helpers in the same answer if needed)."
        )
        try:
            headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": SYSTEM},
                    {"role": "user", "content": user},
                ],
                "max_tokens": 768,
                "temperature": 0.0,
            }
            r = requests.post(
                f"{endpoint}/chat/completions", json=payload, headers=headers, timeout=180
            )
            r.raise_for_status()
            response = r.json()["choices"][0]["message"]["content"]
            code = extract_code(response, t["entry_point"])
            if not code.strip() or f"def {t['entry_point']}" not in code:
                code = extract_any_function(response)
            passed, error = run_test_mbpp(code, t["test_list"])
            if t.get("code_ref"):
                prf = code_token_prf(t["code_ref"], code or "")
        except Exception as e:
            passed, error = False, str(e)
        latency = time.time() - start

        detail: dict = {
            "id": t["id"],
            "passed": passed,
            "error": (error or "")[:500],
            "latency": round(latency, 2),
            "token_precision": prf["precision"] if prf else None,
            "token_recall": prf["recall"] if prf else None,
            "token_f1_vs_reference": prf["f1"] if prf else None,
        }

        if pass_k_samples > 0:
            k_passes = 0
            for _ in range(pass_k_samples):
                try:
                    hdrs = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
                    pl = {"model": model, "messages": [
                        {"role": "system", "content": SYSTEM},
                        {"role": "user", "content": user},
                    ], "max_tokens": 768, "temperature": 0.8}
                    rk = requests.post(f"{endpoint}/chat/completions", json=pl, headers=hdrs, timeout=180)
                    rk.raise_for_status()
                    ck = extract_code(rk.json()["choices"][0]["message"]["content"], t["entry_point"])
                    if not ck.strip() or f"def {t['entry_point']}" not in ck:
                        ck = extract_any_function(rk.json()["choices"][0]["message"]["content"])
                    ok, _ = run_test_mbpp(ck, t["test_list"])
                    if ok:
                        k_passes += 1
                except Exception:
                    pass
            detail["pass_k_samples"] = pass_k_samples
            detail["pass_k_passes"] = k_passes
            detail["pass_prob"] = round(k_passes / pass_k_samples, 4)

        results.append(detail)
        status = "PASS" if passed else "FAIL"
        print(f"  {t['id']}: {status} ({latency:.1f}s)")

    passed_count = sum(r["passed"] for r in results)
    n = len(results)
    precs = [r["token_precision"] for r in results if r.get("token_precision") is not None]
    recs = [r["token_recall"] for r in results if r.get("token_recall") is not None]
    f1s = [r["token_f1_vs_reference"] for r in results if r.get("token_f1_vs_reference") is not None]

    out: dict = {
        "model": model,
        "benchmark": "mbpp",
        "pass_at_1": round(passed_count / n * 100, 1) if n else 0.0,
        "passed": passed_count,
        "total": n,
        "precision": round(sum(precs) / len(precs) * 100, 2) if precs else None,
        "recall": round(sum(recs) / len(recs) * 100, 2) if recs else None,
        "avg_code_token_f1_vs_reference": round(sum(f1s) / len(f1s), 4) if f1s else None,
        "avg_latency": round(sum(r["latency"] for r in results) / n, 2) if n else 0.0,
        "details": results,
    }

    if pass_k_samples > 0:
        out["pass_probs"] = [r.get("pass_prob", 0.0) for r in results]

    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", default="http://localhost:8000/v1")
    parser.add_argument("--model", required=True, help="Model ID served by vLLM")
    parser.add_argument("--api_key", default="EMPTY")
    parser.add_argument(
        "--benchmark",
        choices=("humaneval", "mbpp"),
        default="humaneval",
        help="Which benchmark to run (run twice for both)",
    )
    parser.add_argument(
        "--humaneval-source",
        choices=("inline", "hf"),
        default="inline",
        help="inline=5 curated problems; hf=OpenAI HumanEval on Hugging Face",
    )
    parser.add_argument("--humaneval-limit", type=int, default=40, help="Max problems when --humaneval-source hf")
    parser.add_argument("--mbpp-limit", type=int, default=30, help="Max MBPP tasks")
    parser.add_argument("--pass-k-samples", type=int, default=0, help="Sample each problem N times at temp=0.8 for pass@k (0=disabled)")
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    slug = args.model.replace("/", "_").replace(".", "-")

    if args.benchmark == "humaneval":
        if args.humaneval_source == "hf":
            problems = load_humaneval_hf(args.humaneval_limit)
        else:
            problems = [dict(p) for p in HUMANEVAL_INLINE]
        out_file = args.out or f"coding_humaneval_{slug}.json"
        print(f"\nEvaluating: {args.model}")
        print(f"Endpoint:   {args.endpoint}")
        print(f"HumanEval:  {len(problems)} problems ({args.humaneval_source})")
        if args.pass_k_samples:
            print(f"pass@k:     {args.pass_k_samples} samples per problem at temp=0.8\n")
        result = evaluate_humaneval(
            args.endpoint, args.model, args.api_key, problems,
            pass_k_samples=args.pass_k_samples,
        )
    else:
        tasks = load_mbpp_hf(args.mbpp_limit)
        out_file = args.out or f"coding_mbpp_{slug}.json"
        print(f"\nEvaluating: {args.model}")
        print(f"Endpoint:   {args.endpoint}")
        print(f"MBPP:       {len(tasks)} tasks\n")
        result = evaluate_mbpp(
            args.endpoint, args.model, args.api_key, tasks,
            pass_k_samples=args.pass_k_samples,
        )

    print(f"\n{'='*50}")
    print(f"Results for {args.model}")
    print(f"  pass@1:       {result['pass_at_1']}%")
    print(f"  Passed:       {result['passed']}/{result['total']}")
    if result.get("precision") is not None:
        print(f"  Token P/R/F1: {result['precision']} / {result['recall']} / ", end="")
        f1_key = "avg_code_token_f1_vs_canonical" if args.benchmark == "humaneval" else "avg_code_token_f1_vs_reference"
        print(f"{result.get(f1_key)}")
    if result.get("pass_at_5") is not None:
        print(f"  pass@5:       {result['pass_at_5']}%")
        print(f"  pass@10:      {result['pass_at_10']}%")
    print(f"  Avg latency:  {result['avg_latency']}s")
    print(f"{'='*50}")

    with open(out_file, "w") as f:
        json.dump(result, f, indent=2)
    print(f"\nSaved to {out_file}")


if __name__ == "__main__":
    main()
