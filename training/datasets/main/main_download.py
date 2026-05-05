"""Download and prepare the Main model dataset.

Sources:
  - teknium/OpenHermes-2.5  (general instruction following, 1M samples — we use 80k)
  - HuggingFaceH4/ultrafeedback_binarized  (preference-ranked responses)

Output: ../processed/  — JSONL in ShareGPT chat format for Unsloth.
"""

import os
import json
import random
from pathlib import Path
from datasets import load_dataset
from tqdm import tqdm

SEED = 42
MAX_SAMPLES = 80_000
OUT_DIR = Path(__file__).parent / "processed"
OUT_DIR.mkdir(parents=True, exist_ok=True)

random.seed(SEED)


def to_sharegpt(system: str, human: str, gpt: str) -> dict:
    return {
        "conversations": [
            {"from": "system", "value": system},
            {"from": "human", "value": human},
            {"from": "gpt", "value": gpt},
        ]
    }


def download_openhermes(n: int) -> list[dict]:
    print("Downloading OpenHermes-2.5...")
    ds = load_dataset("teknium/OpenHermes-2.5", split="train")
    samples = []
    for row in tqdm(ds, desc="OpenHermes"):
        convs = row.get("conversations", [])
        if len(convs) < 2:
            continue
        system = next((c["value"] for c in convs if c["from"] == "system"), "")
        turns = [c for c in convs if c["from"] in ("human", "gpt")]
        if len(turns) < 2:
            continue
        # Take first human/gpt pair
        human = turns[0]["value"]
        gpt = turns[1]["value"]
        if len(human) < 10 or len(gpt) < 20:
            continue
        samples.append(to_sharegpt(system, human, gpt))
        if len(samples) >= n:
            break
    return samples


def download_ultrafeedback(n: int) -> list[dict]:
    print("Downloading UltraFeedback...")
    ds = load_dataset("HuggingFaceH4/ultrafeedback_binarized", split="train_sft")
    samples = []
    for row in tqdm(ds, desc="UltraFeedback"):
        prompt = row.get("prompt", "")
        messages = row.get("chosen", [])
        if not prompt or not messages:
            continue
        response = next((m["content"] for m in messages if m["role"] == "assistant"), "")
        if not response:
            continue
        samples.append(to_sharegpt("You are a helpful assistant.", prompt, response))
        if len(samples) >= n:
            break
    return samples


def main():
    hermes = download_openhermes(60_000)
    ultra = download_ultrafeedback(20_000)

    all_samples = hermes + ultra
    random.shuffle(all_samples)
    all_samples = all_samples[:MAX_SAMPLES]

    out_path = OUT_DIR / "train.jsonl"
    with open(out_path, "w") as f:
        for s in all_samples:
            f.write(json.dumps(s) + "\n")

    print(f"\nSaved {len(all_samples)} samples to {out_path}")

    # Split: 95% train, 5% eval
    split = int(len(all_samples) * 0.95)
    with open(OUT_DIR / "train_split.jsonl", "w") as f:
        for s in all_samples[:split]:
            f.write(json.dumps(s) + "\n")
    with open(OUT_DIR / "eval_split.jsonl", "w") as f:
        for s in all_samples[split:]:
            f.write(json.dumps(s) + "\n")

    print(f"Train: {split} | Eval: {len(all_samples) - split}")


if __name__ == "__main__":
    main()
