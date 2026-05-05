"""Coding model evaluation using HumanEval and MBPP benchmarks.

Runs against:
  1. Base model (Qwen2.5-32B-Instruct, no fine-tuning)
  2. Fine-tuned WOS-Coding model

Usage:
  python eval_coding.py --endpoint http://localhost:8000/v1 --model wos-coding
  python eval_coding.py --endpoint http://localhost:8000/v1 --model Qwen/Qwen2.5-32B-Instruct
"""

import argparse
import json
import re
import subprocess
import tempfile
import time
from pathlib import Path

import requests


SYSTEM = (
    "You are an expert software engineer. Write correct, efficient Python code. "
    "Return only the function implementation, no explanations."
)

HUMANEVAL_PROBLEMS = [
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


def call_model(endpoint: str, model: str, prompt: str, api_key: str = "EMPTY") -> str:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"Complete this Python function:\n\n{prompt}"},
        ],
        "max_tokens": 512,
        "temperature": 0.0,
    }
    r = requests.post(f"{endpoint}/chat/completions", json=payload, headers=headers, timeout=60)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def extract_code(response: str, entry_point: str) -> str:
    # Try to extract code block
    match = re.search(r"```(?:python)?\n(.*?)```", response, re.DOTALL)
    if match:
        return match.group(1).strip()
    # If no code block, try to find function definition
    lines = response.strip().split("\n")
    code_lines = []
    in_func = False
    for line in lines:
        if f"def {entry_point}" in line:
            in_func = True
        if in_func:
            code_lines.append(line)
    return "\n".join(code_lines) if code_lines else response.strip()


def run_test(code: str, test: str) -> tuple[bool, str]:
    full_code = f"from typing import List, Dict, Tuple, Optional\n{code}\n{test}"
    with tempfile.NamedTemporaryFile(suffix=".py", mode="w", delete=False) as f:
        f.write(full_code)
        tmp = f.name
    try:
        result = subprocess.run(
            ["python", tmp], capture_output=True, text=True, timeout=10
        )
        passed = result.returncode == 0
        error = result.stderr.strip() if not passed else ""
        return passed, error
    except subprocess.TimeoutExpired:
        return False, "Timeout"
    finally:
        Path(tmp).unlink(missing_ok=True)


def evaluate(endpoint: str, model: str, api_key: str) -> dict:
    results = []
    for problem in HUMANEVAL_PROBLEMS:
        start = time.time()
        try:
            response = call_model(endpoint, model, problem["prompt"], api_key)
            code = extract_code(response, problem["entry_point"])
            passed, error = run_test(code, problem["test"])
        except Exception as e:
            passed, error = False, str(e)
        latency = time.time() - start
        results.append({
            "id": problem["id"],
            "passed": passed,
            "error": error,
            "latency": round(latency, 2),
        })
        status = "PASS" if passed else "FAIL"
        print(f"  {problem['id']}: {status} ({latency:.1f}s)" + (f" — {error}" if error else ""))

    passed_count = sum(r["passed"] for r in results)
    return {
        "model": model,
        "pass_at_1": round(passed_count / len(results) * 100, 1),
        "passed": passed_count,
        "total": len(results),
        "avg_latency": round(sum(r["latency"] for r in results) / len(results), 2),
        "details": results,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", default="http://localhost:8000/v1")
    parser.add_argument("--model", required=True, help="Model ID served by vLLM")
    parser.add_argument("--api_key", default="EMPTY")
    parser.add_argument("--out", default=None, help="Output file (default: coding_results_<model>.json)")
    args = parser.parse_args()

    slug = args.model.replace("/", "_").replace(".", "-")
    out_file = args.out or f"coding_results_{slug}.json"

    print(f"\nEvaluating: {args.model}")
    print(f"Endpoint:   {args.endpoint}")
    print(f"Problems:   {len(HUMANEVAL_PROBLEMS)} (HumanEval subset)\n")

    result = evaluate(args.endpoint, args.model, args.api_key)

    print(f"\n{'='*50}")
    print(f"Results for {args.model}")
    print(f"  pass@1:       {result['pass_at_1']}%")
    print(f"  Passed:       {result['passed']}/{result['total']}")
    print(f"  Avg latency:  {result['avg_latency']}s")
    print(f"{'='*50}")

    with open(out_file, "w") as f:
        json.dump(result, f, indent=2)
    print(f"\nSaved to {out_file}")


if __name__ == "__main__":
    main()
