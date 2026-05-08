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

from eval_metrics_common import rouge_single_prf

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
    # ── extra orchestration coverage (longer / multi-step) ───────────────────
    {
        "id": "coding_4",
        "domain": "coding",
        "prompt": (
            "Write Python to merge two sorted lists without using sorted() on the concatenation."
        ),
        "reference": (
            "def merge_sorted(a, b):\n    i, j, out = 0, 0, []\n    while i < len(a) and j < len(b):\n"
            "        if a[i] <= b[j]:\n            out.append(a[i]); i += 1\n        else:\n"
            "            out.append(b[j]); j += 1\n    return out + a[i:] + b[j:]"
        ),
    },
    {
        "id": "meeting_4",
        "domain": "meeting",
        "prompt": (
            "Summarize risks and owners from:\n"
            "PM: Launch is in 10 days. QA found regression in checkout.\n"
            "Eng: Root cause is cache invalidation; fix ETA 48h.\n"
            "PM: We need a go/no-go Friday. Legal still reviewing updated ToS.\n"
            "Eng lead: I'll own the cache fix; QA will rerun full regression by Thursday."
        ),
        "reference": (
            "Risk: checkout regression from cache invalidation; fix ETA 48h. "
            "Legal review of ToS still pending — go/no-go Friday. "
            "Eng lead owns cache fix; QA owns full regression by Thursday."
        ),
    },
    {
        "id": "general_5",
        "domain": "general",
        "prompt": "Explain fine-tuning vs prompt engineering in 4 sentences.",
        "reference": (
            "Fine-tuning updates model weights on domain-specific data so the model internalizes patterns. "
            "Prompt engineering keeps weights frozen and steers behavior with instructions and examples in the input. "
            "Fine-tuning costs more upfront but can improve consistency on specialized tasks. "
            "Prompt engineering is faster to iterate but bounded by context length and base model capability."
        ),
    },
    {
        "id": "general_6",
        "domain": "general",
        "prompt": "What is idempotency in APIs and why does it matter for payments?",
        "reference": (
            "An idempotent API produces the same outcome when called multiple times with the same request. "
            "For payments, retries are common; idempotency keys prevent duplicate charges when a client retries after a timeout."
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
        "max_tokens": 512,
        "temperature": 0.0,
    }
    r = requests.post(f"{endpoint}/chat/completions", json=payload, headers=headers, timeout=60)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def _zero_prf() -> dict:
    z = {f"rouge{k}_{m}": 0.0 for k in ("1", "2", "L") for m in ("precision", "recall", "f1")}
    z["rouge1"] = z["rouge2"] = z["rougeL"] = 0.0
    return z


def compute_rouge(prediction: str, reference: str) -> dict:
    if not (prediction or "").strip():
        return _zero_prf()
    prf = rouge_single_prf(prediction, reference, use_stemmer=True)
    prf["rouge1"] = prf["rouge1_f1"]
    prf["rouge2"] = prf["rouge2_f1"]
    prf["rougeL"] = prf["rougeL_f1"]
    return prf


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
            rouge = _zero_prf()
            error = str(e)
        latency = round(time.time() - start, 2)

        result = {
            "id": p["id"],
            "domain": p["domain"],
            "response": response[:500],
            "rouge1": rouge["rouge1"],
            "rouge2": rouge["rouge2"],
            "rougeL": rouge["rougeL"],
            "rouge1_precision": rouge.get("rouge1_precision", 0),
            "rouge1_recall": rouge.get("rouge1_recall", 0),
            "rouge1_f1": rouge.get("rouge1_f1", 0),
            "rougeL_precision": rouge.get("rougeL_precision", 0),
            "rougeL_recall": rouge.get("rougeL_recall", 0),
            "rougeL_f1": rouge.get("rougeL_f1", 0),
            "latency": latency,
            "error": error,
        }
        results.append(result)
        domain_scores[p["domain"]].append(rouge)
        status = f"ROUGE-L {rouge['rougeL']:.1f}" if not error else f"ERROR: {error}"
        print(f"  {p['id']}: {status} ({latency:.1f}s)")

    def avg(lst):
        return round(sum(lst) / len(lst), 2) if lst else 0

    def avg_prf(domain: str, key: str) -> float:
        lst = domain_scores[domain]
        if not lst:
            return 0.0
        return round(sum(x.get(key, 0) for x in lst) / len(lst), 3)

    all_prf = [domain_scores[d] for d in ("coding", "meeting", "general")]
    flat = [x for sub in all_prf for x in sub]

    def overall_prf(key: str) -> float:
        return round(sum(x.get(key, 0) for x in flat) / len(flat), 3) if flat else 0.0

    return {
        "model": model,
        "num_prompts": len(PROMPTS),
        "overall_rougeL": avg([r["rougeL"] for r in results]),
        "coding_rougeL": avg([x["rougeL"] for x in domain_scores["coding"]]),
        "meeting_rougeL": avg([x["rougeL"] for x in domain_scores["meeting"]]),
        "general_rougeL": avg([x["rougeL"] for x in domain_scores["general"]]),
        "overall_rouge1_precision": overall_prf("rouge1_precision"),
        "overall_rouge1_recall": overall_prf("rouge1_recall"),
        "overall_rouge1_f1": overall_prf("rouge1_f1"),
        "overall_rougeL_precision": overall_prf("rougeL_precision"),
        "overall_rougeL_recall": overall_prf("rougeL_recall"),
        "overall_rougeL_f1": overall_prf("rougeL_f1"),
        "coding_rouge1_f1": avg_prf("coding", "rouge1_f1"),
        "meeting_rouge1_f1": avg_prf("meeting", "rouge1_f1"),
        "general_rouge1_f1": avg_prf("general", "rouge1_f1"),
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
    print(f"Prompts: {len(PROMPTS)} (orchestration mix: coding + meeting + general)\n")

    result = evaluate(args.endpoint, args.model, args.api_key)

    print(f"\n{'='*55}")
    print(f"Results for {args.model}")
    print(f"  Overall ROUGE-L:  {result['overall_rougeL']}  (F1 {result['overall_rougeL_f1']})")
    print(
        f"  Overall ROUGE-1:  P {result['overall_rouge1_precision']}  "
        f"R {result['overall_rouge1_recall']}  F1 {result['overall_rouge1_f1']}"
    )
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
