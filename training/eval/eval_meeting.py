"""Meeting model evaluation using ROUGE and BERTScore on QMSum/DialogSum test sets.

Usage:
  python eval_meeting.py --endpoint http://localhost:8000/v1 --model wos-meeting
  python eval_meeting.py --endpoint http://localhost:8000/v1 --model Qwen/Qwen2.5-32B-Instruct
"""

import argparse
import json
import time

import requests
from datasets import load_dataset
from rouge_score import rouge_scorer

SYSTEM = (
    "You are WOS Meeting, an expert meeting intelligence assistant. "
    "Summarize meeting transcripts concisely and extract action items."
)

MAX_EVAL_SAMPLES = 50


def call_model(endpoint: str, model: str, transcript: str, api_key: str = "EMPTY") -> str:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    prompt = (
        f"Please summarize the following conversation/meeting transcript:\n\n{transcript[:3000]}"
    )
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 400,
        "temperature": 0.0,
    }
    r = requests.post(f"{endpoint}/chat/completions", json=payload, headers=headers, timeout=90)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def compute_rouge(predictions: list[str], references: list[str]) -> dict:
    scorer = rouge_scorer.RougeScorer(["rouge1", "rouge2", "rougeL"], use_stemmer=True)
    scores = {"rouge1": [], "rouge2": [], "rougeL": []}
    for pred, ref in zip(predictions, references):
        s = scorer.score(ref, pred)
        scores["rouge1"].append(s["rouge1"].fmeasure)
        scores["rouge2"].append(s["rouge2"].fmeasure)
        scores["rougeL"].append(s["rougeL"].fmeasure)
    return {k: round(sum(v) / len(v) * 100, 2) for k, v in scores.items()}


def evaluate(endpoint: str, model: str, api_key: str) -> dict:
    print("Loading DialogSum test set...")
    ds = load_dataset("knkarthick/dialogsum", split="test")
    samples = list(ds)[:MAX_EVAL_SAMPLES]

    predictions = []
    references = []
    latencies = []

    for i, row in enumerate(samples):
        transcript = row["dialogue"]
        reference = row["summary"]
        start = time.time()
        try:
            pred = call_model(endpoint, model, transcript, api_key)
        except Exception as e:
            pred = ""
            print(f"  Sample {i}: ERROR — {e}")
        latency = time.time() - start
        predictions.append(pred)
        references.append(reference)
        latencies.append(latency)
        if (i + 1) % 10 == 0:
            print(f"  Evaluated {i+1}/{len(samples)} samples...")

    rouge = compute_rouge(predictions, references)
    avg_latency = sum(latencies) / len(latencies)

    return {
        "model": model,
        "dataset": "DialogSum test",
        "num_samples": len(samples),
        "rouge1": rouge["rouge1"],
        "rouge2": rouge["rouge2"],
        "rougeL": rouge["rougeL"],
        "avg_latency_sec": round(avg_latency, 2),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", default="http://localhost:8000/v1")
    parser.add_argument("--model", required=True)
    parser.add_argument("--api_key", default="EMPTY")
    parser.add_argument("--out", default=None, help="Output file (default: meeting_results_<model>.json)")
    args = parser.parse_args()

    slug = args.model.replace("/", "_").replace(".", "-")
    out_file = args.out or f"meeting_results_{slug}.json"

    print(f"\nEvaluating: {args.model}")
    print(f"Endpoint:   {args.endpoint}")
    print(f"Samples:    {MAX_EVAL_SAMPLES}\n")

    result = evaluate(args.endpoint, args.model, args.api_key)

    print(f"\n{'='*50}")
    print(f"Results for {args.model}")
    print(f"  ROUGE-1:      {result['rouge1']}")
    print(f"  ROUGE-2:      {result['rouge2']}")
    print(f"  ROUGE-L:      {result['rougeL']}")
    print(f"  Avg latency:  {result['avg_latency_sec']}s")
    print(f"{'='*50}")

    with open(out_file, "w") as f:
        json.dump(result, f, indent=2)
    print(f"\nSaved to {out_file}")


if __name__ == "__main__":
    main()
