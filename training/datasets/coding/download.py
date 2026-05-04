"""Download and prepare the Coding model dataset.

Sources:
  - m-a-p/CodeFeedback-Filtered-Instruction  (66k high-quality code pairs)
  - sahil2801/CodeAlpaca-20k                 (20k coding instructions)
  - iamtarun/python_code_instructions_18k_alpaca (Python focus)

Output: ../processed/  — JSONL in ShareGPT chat format for Unsloth.
"""

import json
import random
from pathlib import Path
from datasets import load_dataset
from tqdm import tqdm

SEED = 42
MAX_SAMPLES = 60_000
OUT_DIR = Path(__file__).parent / "processed"
OUT_DIR.mkdir(parents=True, exist_ok=True)

random.seed(SEED)

SYSTEM = (
    "You are WOS Coding, an expert software engineer assistant. "
    "You write clean, correct, well-structured code, explain technical concepts clearly, "
    "debug issues systematically, and follow best practices for the requested language."
)


def to_sharegpt(human: str, gpt: str) -> dict:
    return {
        "conversations": [
            {"from": "system", "value": SYSTEM},
            {"from": "human", "value": human},
            {"from": "gpt", "value": gpt},
        ]
    }


def download_codefeedback(n: int) -> list[dict]:
    print("Downloading CodeFeedback-Filtered-Instruction...")
    ds = load_dataset("m-a-p/CodeFeedback-Filtered-Instruction", split="train")
    samples = []
    for row in tqdm(ds, desc="CodeFeedback"):
        query = row.get("query", "")
        answer = row.get("answer", "")
        if not query or not answer or len(query) < 10 or len(answer) < 20:
            continue
        samples.append(to_sharegpt(query, answer))
        if len(samples) >= n:
            break
    return samples


def download_codealpaca(n: int) -> list[dict]:
    print("Downloading CodeAlpaca-20k...")
    ds = load_dataset("sahil2801/CodeAlpaca-20k", split="train")
    samples = []
    for row in tqdm(ds, desc="CodeAlpaca"):
        instruction = row.get("instruction", "")
        inp = row.get("input", "")
        output = row.get("output", "")
        if not instruction or not output:
            continue
        human = f"{instruction}\n\n{inp}".strip() if inp else instruction
        samples.append(to_sharegpt(human, output))
        if len(samples) >= n:
            break
    return samples


def download_python_instructions(n: int) -> list[dict]:
    print("Downloading Python Instructions dataset...")
    try:
        ds = load_dataset("iamtarun/python_code_instructions_18k_alpaca", split="train")
    except Exception as e:
        print(f"Python instructions load failed: {e} — skipping")
        return []
    samples = []
    for row in tqdm(ds, desc="Python Instructions"):
        instruction = row.get("instruction", "")
        inp = row.get("input", "")
        output = row.get("output", "")
        if not instruction or not output:
            continue
        human = f"{instruction}\n\n{inp}".strip() if inp else instruction
        samples.append(to_sharegpt(human, output))
        if len(samples) >= n:
            break
    return samples


def main():
    codefeedback = download_codefeedback(40_000)
    codealpaca = download_codealpaca(12_000)
    python_inst = download_python_instructions(8_000)

    all_samples = codefeedback + codealpaca + python_inst
    random.shuffle(all_samples)
    all_samples = all_samples[:MAX_SAMPLES]

    out_path = OUT_DIR / "train.jsonl"
    with open(out_path, "w") as f:
        for s in all_samples:
            f.write(json.dumps(s) + "\n")

    split = int(len(all_samples) * 0.95)
    with open(OUT_DIR / "train_split.jsonl", "w") as f:
        for s in all_samples[:split]:
            f.write(json.dumps(s) + "\n")
    with open(OUT_DIR / "eval_split.jsonl", "w") as f:
        for s in all_samples[split:]:
            f.write(json.dumps(s) + "\n")

    print(f"\nTotal: {len(all_samples)} | Train: {split} | Eval: {len(all_samples) - split}")
    print(f"  CodeFeedback: {len(codefeedback)}, CodeAlpaca: {len(codealpaca)}, Python: {len(python_inst)}")
    print(f"Saved to {out_path}")


if __name__ == "__main__":
    main()
