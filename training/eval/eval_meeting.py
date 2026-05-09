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

from eval_metrics_common import rouge_macro_prf

SYSTEM = (
    "You are WOS Meeting, an expert meeting intelligence assistant. "
    "Summarize meeting transcripts concisely and extract action items."
)

DEFAULT_MAX_SAMPLES = 80


def call_model(
    endpoint: str,
    model: str,
    transcript: str,
    api_key: str = "EMPTY",
    max_tokens: int = 512,
    max_transcript_chars: int = 6000,
) -> str:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    prompt = (
        f"Please summarize the following conversation/meeting transcript:\n\n"
        f"{transcript[:max_transcript_chars]}"
    )
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt},
        ],
        "max_tokens": max_tokens,
        "temperature": 0.0,
    }
    r = requests.post(f"{endpoint}/chat/completions", json=payload, headers=headers, timeout=120)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def compute_rouge_metrics(predictions: list[str], references: list[str]) -> dict:
    """ROUGE F1 (legacy keys) + precision/recall/F1 per variant (macro over samples)."""
    prf = rouge_macro_prf(predictions, references, use_stemmer=True)
    # Backward-compatible keys = F1 (same as before)
    out = {
        "rouge1": prf["rouge1_f1"],
        "rouge2": prf["rouge2_f1"],
        "rougeL": prf["rougeL_f1"],
    }
    out.update(prf)
    return out


def evaluate(
    endpoint: str,
    model: str,
    api_key: str,
    max_samples: int,
    max_tokens: int,
    max_transcript_chars: int,
) -> dict:
    print("Loading DialogSum test set...")
    ds = load_dataset("knkarthick/dialogsum", split="test")
    samples = list(ds)[:max_samples]

    from eval_metrics_common import rouge_single_prf

    predictions = []
    references = []
    latencies = []
    sample_details = []

    for i, row in enumerate(samples):
        transcript = row["dialogue"]
        reference = row["summary"]
        start = time.time()
        try:
            pred = call_model(
                endpoint, model, transcript, api_key, max_tokens, max_transcript_chars
            )
        except Exception as e:
            pred = ""
            print(f"  Sample {i}: ERROR — {e}")
        latency = time.time() - start
        predictions.append(pred)
        references.append(reference)
        latencies.append(latency)
        prf = rouge_single_prf(pred, reference)
        sample_details.append({
            "sample_id": i,
            "rougeL_f1": prf["rougeL_f1"],
            "rouge1_f1": prf["rouge1_f1"],
            "rouge1_precision": prf["rouge1_precision"],
            "rouge1_recall": prf["rouge1_recall"],
            "latency": round(latency, 2),
        })
        if (i + 1) % 10 == 0:
            print(f"  Evaluated {i+1}/{len(samples)} samples...")

    rouge = compute_rouge_metrics(predictions, references)
    avg_latency = sum(latencies) / len(latencies)

    return {
        "model": model,
        "dataset": "DialogSum test",
        "num_samples": len(samples),
        "max_transcript_chars": max_transcript_chars,
        "rouge1": rouge["rouge1"],
        "rouge2": rouge["rouge2"],
        "rougeL": rouge["rougeL"],
        "rouge1_precision": rouge["rouge1_precision"],
        "rouge1_recall": rouge["rouge1_recall"],
        "rouge1_f1": rouge["rouge1_f1"],
        "rouge2_precision": rouge["rouge2_precision"],
        "rouge2_recall": rouge["rouge2_recall"],
        "rouge2_f1": rouge["rouge2_f1"],
        "rougeL_precision": rouge["rougeL_precision"],
        "rougeL_recall": rouge["rougeL_recall"],
        "rougeL_f1": rouge["rougeL_f1"],
        "avg_latency_sec": round(avg_latency, 2),
        "details": sample_details,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--endpoint", default="http://localhost:8000/v1")
    parser.add_argument("--model", required=True)
    parser.add_argument("--api_key", default="EMPTY")
    parser.add_argument("--out", default=None, help="Output file (default: meeting_results_<model>.json)")
    parser.add_argument(
        "--max-samples",
        type=int,
        default=DEFAULT_MAX_SAMPLES,
        help="DialogSum test samples (default 80)",
    )
    parser.add_argument("--max-tokens", type=int, default=512, help="Max new tokens per summary")
    parser.add_argument(
        "--max-transcript-chars",
        type=int,
        default=6000,
        help="Truncate each transcript to this many characters",
    )
    args = parser.parse_args()

    slug = args.model.replace("/", "_").replace(".", "-")
    out_file = args.out or f"meeting_results_{slug}.json"

    print(f"\nEvaluating: {args.model}")
    print(f"Endpoint:   {args.endpoint}")
    print(f"Samples:    {args.max_samples}\n")

    result = evaluate(
        args.endpoint,
        args.model,
        args.api_key,
        args.max_samples,
        args.max_tokens,
        args.max_transcript_chars,
    )

    print(f"\n{'='*50}")
    print(f"Results for {args.model}")
    print(f"  ROUGE-1 F1:   {result['rouge1_f1']}  (P {result['rouge1_precision']}, R {result['rouge1_recall']})")
    print(f"  ROUGE-L F1:   {result['rougeL_f1']}  (P {result['rougeL_precision']}, R {result['rougeL_recall']})")
    print(f"  ROUGE-2 F1:   {result['rouge2_f1']}")
    print(f"  Avg latency:  {result['avg_latency_sec']}s")
    print(f"{'='*50}")

    with open(out_file, "w") as f:
        json.dump(result, f, indent=2)
    print(f"\nSaved to {out_file}")


if __name__ == "__main__":
    main()
