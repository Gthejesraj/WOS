"""Main/orchestrator model evaluation — tests across all 3 task domains.

Tests the main model on coding, meeting, and general tasks using ROUGE
against reference answers. Measures how well the orchestrator handles
all task types without specialization.

Usage:
  python eval_main.py --endpoint https://your-endpoint/v1 --model thejesraj/wos-main-32b
  python eval_main.py --endpoint https://your-endpoint/v1 --model mistralai/Mixtral-8x7B-Instruct-v0.1
"""

import argparse
import json
import time

import requests
from rouge_score import rouge_scorer

SYSTEM = (
    "You are WOS, a highly capable AI assistant. "
    "You help with coding, meetings, and general tasks accurately and concisely."
)

PROMPTS = [
    # ── Coding tasks ──────────────────────────────────────────────────────────
    {
        "id": "coding_1",
        "domain": "coding",
        "prompt": "Write a Python function that checks if a string is a palindrome.",
        "reference": "def is_palindrome(s): return s == s[::-1]",
    },
    {
        "id": "coding_2",
        "domain": "coding",
        "prompt": "Write a Python function that returns the factorial of a number using recursion.",
        "reference": "def factorial(n): return 1 if n <= 1 else n * factorial(n - 1)",
    },
    {
        "id": "coding_3",
        "domain": "coding",
        "prompt": "Write a Python function that finds the maximum element in a list without using max().",
        "reference": "def find_max(lst): m = lst[0]\n for x in lst:\n  if x > m: m = x\n return m",
    },

    # ── Meeting tasks ─────────────────────────────────────────────────────────
    {
        "id": "meeting_1",
        "domain": "meeting",
        "prompt": (
            "Summarize this meeting:\n"
            "Alice: We need to finalize the Q3 budget by Friday.\n"
            "Bob: I can have the numbers ready by Thursday.\n"
            "Alice: Great. The client demo is moved to next Tuesday.\n"
            "Bob: I'll prepare the slides."
        ),
        "reference": (
            "Q3 budget to be finalized by Friday. Bob will prepare numbers by Thursday. "
            "Client demo rescheduled to next Tuesday. Bob will prepare slides."
        ),
    },
    {
        "id": "meeting_2",
        "domain": "meeting",
        "prompt": (
            "Extract action items from:\n"
            "John: Let's assign the new feature to Sarah.\n"
            "Sarah: I'll need the design files first.\n"
            "Mike: I'll send them today.\n"
            "John: Sarah, can you have a prototype by Monday?"
        ),
        "reference": (
            "Mike to send design files to Sarah today. "
            "Sarah to deliver prototype by Monday."
        ),
    },
    {
        "id": "meeting_3",
        "domain": "meeting",
        "prompt": (
            "What decisions were made?\n"
            "Team discussed microservices vs monolith. Decided on microservices for scalability. "
            "Budget approved for 3 new engineers."
        ),
        "reference": (
            "Decided to use microservices architecture for scalability. "
            "Budget approved to hire 3 new engineers."
        ),
    },

    # ── General tasks ─────────────────────────────────────────────────────────
    {
        "id": "general_1",
        "domain": "general",
        "prompt": "Explain what an API is in 2 sentences.",
        "reference": (
            "An API (Application Programming Interface) is a set of rules that allows "
            "different software applications to communicate with each other. "
            "It defines how requests and responses should be formatted."
        ),
    },
    {
        "id": "general_2",
        "domain": "general",
        "prompt": "What is the difference between RAM and storage?",
        "reference": (
            "RAM is temporary memory used by the CPU to run active programs and is lost when powered off. "
            "Storage (SSD/HDD) holds data permanently even without power."
        ),
    },
    {
        "id": "general_3",
        "domain": "general",
        "prompt": "List 3 best practices for writing clean code.",
        "reference": (
            "Use meaningful variable names. Write small focused functions. "
            "Add comments only when the why is non-obvious."
        ),
    },
    {
        "id": "general_4",
        "domain": "general",
        "prompt": "What does GPU stand for and why is it used for AI training?",
        "reference": (
            "GPU stands for Graphics Processing Unit. It is used for AI training because it can "
            "perform thousands of parallel computations simultaneously, making matrix operations "
            "much faster than a CPU."
        ),
    },
]


def call_model(endpoint: str, model: str, prompt: str, api_key: str = "EMPTY") -> str:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 300,
        "temperature": 0.0,
    }
    r = requests.post(f"{endpoint}/chat/completions", json=payload, headers=headers, timeout=60)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def compute_rouge(prediction: str, reference: str) -> dict:
    s = rouge_scorer.RougeScorer(["rouge1", "rouge2", "rougeL"], use_stemmer=True)
    scores = s.score(reference, prediction)
    return {
        "rouge1": round(scores["rouge1"].fmeasure * 100, 2),
        "rouge2": round(scores["rouge2"].fmeasure * 100, 2),
        "rougeL": round(scores["rougeL"].fmeasure * 100, 2),
    }


def evaluate(endpoint: str, model: str, api_key: str) -> dict:
    results = []
    domain_scores = {"coding": [], "meeting": [], "general": []}

    for p in PROMPTS:
        start = time.time()
        try:
            response = call_model(endpoint, model, p["prompt"], api_key)
            rouge = compute_rouge(response, p["reference"])
            error = None
        except Exception as e:
            response = ""
            rouge = {"rouge1": 0, "rouge2": 0, "rougeL": 0}
            error = str(e)
        latency = round(time.time() - start, 2)

        result = {
            "id": p["id"],
            "domain": p["domain"],
            "response": response[:500],
            "rouge1": rouge["rouge1"],
            "rouge2": rouge["rouge2"],
            "rougeL": rouge["rougeL"],
            "latency": latency,
            "error": error,
        }
        results.append(result)
        domain_scores[p["domain"]].append(rouge["rougeL"])
        status = f"ROUGE-L {rouge['rougeL']:.1f}" if not error else f"ERROR: {error}"
        print(f"  {p['id']}: {status} ({latency:.1f}s)")

    def avg(lst): return round(sum(lst) / len(lst), 2) if lst else 0

    return {
        "model": model,
        "num_prompts": len(PROMPTS),
        "overall_rougeL": avg([r["rougeL"] for r in results]),
        "coding_rougeL": avg(domain_scores["coding"]),
        "meeting_rougeL": avg(domain_scores["meeting"]),
        "general_rougeL": avg(domain_scores["general"]),
        "avg_latency": avg([r["latency"] for r in results]),
        "details": results,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", default="http://localhost:8000/v1")
    parser.add_argument("--model", required=True)
    parser.add_argument("--api_key", default="EMPTY")
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    slug = args.model.replace("/", "_").replace(".", "-")
    out_file = args.out or f"main_results_{slug}.json"

    print(f"\nEvaluating Main Model: {args.model}")
    print(f"Endpoint: {args.endpoint}")
    print(f"Prompts: {len(PROMPTS)} (3 coding + 3 meeting + 4 general)\n")

    result = evaluate(args.endpoint, args.model, args.api_key)

    print(f"\n{'='*55}")
    print(f"Results for {args.model}")
    print(f"  Overall ROUGE-L:  {result['overall_rougeL']}")
    print(f"  Coding ROUGE-L:   {result['coding_rougeL']}")
    print(f"  Meeting ROUGE-L:  {result['meeting_rougeL']}")
    print(f"  General ROUGE-L:  {result['general_rougeL']}")
    print(f"  Avg latency:      {result['avg_latency']}s")
    print(f"{'='*55}")

    with open(out_file, "w") as f:
        json.dump(result, f, indent=2)
    print(f"\nSaved to {out_file}")


if __name__ == "__main__":
    main()
