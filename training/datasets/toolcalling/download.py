"""Download and prepare tool-calling training data.

Sources:
  - glaiveai/glaive-function-calling-v2  (113k function-calling conversations)
  - Salesforce/xlam-function-calling-60k (60k structured tool-use samples)

Output: processed/  — JSONL in ShareGPT chat format, ready to mix into any model.

Usage:
  python datasets/toolcalling/download.py
"""

import json
import random
from pathlib import Path
from datasets import load_dataset
from tqdm import tqdm

SEED = 42
MAX_SAMPLES = 10_000
OUT_DIR = Path(__file__).parent / "processed"
OUT_DIR.mkdir(parents=True, exist_ok=True)

random.seed(SEED)

SYSTEM = (
    "You are WOS, a highly capable AI assistant with access to tools. "
    "When the user's request requires a tool, call it with correct arguments. "
    "Otherwise respond directly. Always be accurate and helpful."
)


def to_sharegpt(messages: list[dict]) -> dict:
    return {"conversations": messages}


def download_glaive(n: int) -> list[dict]:
    """glaive-function-calling-v2: columns system, chat (alternating HUMAN/ASSISTANT blocks)."""
    print("Downloading glaive-function-calling-v2...")
    try:
        ds = load_dataset("glaiveai/glaive-function-calling-v2", split="train")
    except Exception as e:
        print(f"Glaive load failed: {e} — skipping")
        return []

    samples = []
    for row in tqdm(ds, desc="Glaive"):
        system_text = row.get("system", "") or SYSTEM
        chat = row.get("chat", "")
        if not chat:
            continue

        # Parse alternating HUMAN/ASSISTANT blocks
        messages = [{"from": "system", "value": system_text}]
        parts = chat.split("HUMAN:")
        for part in parts[1:]:
            if "ASSISTANT:" not in part:
                continue
            human_text, rest = part.split("ASSISTANT:", 1)
            human_text = human_text.strip()
            # Next HUMAN block ends the assistant turn
            assistant_text = rest.split("HUMAN:")[0].strip()
            if not human_text or not assistant_text:
                continue
            messages.append({"from": "human", "value": human_text})
            messages.append({"from": "gpt", "value": assistant_text})

        if len(messages) < 3:
            continue
        samples.append(to_sharegpt(messages))
        if len(samples) >= n:
            break
    return samples


def download_xlam(n: int) -> list[dict]:
    """xlam-function-calling-60k: columns query, answers, tools."""
    print("Downloading xlam-function-calling-60k...")
    try:
        ds = load_dataset("Salesforce/xlam-function-calling-60k", split="train")
    except Exception as e:
        print(f"XLAM load failed: {e} — skipping")
        return []

    samples = []
    for row in tqdm(ds, desc="XLAM"):
        query = row.get("query", "")
        answers = row.get("answers", "")
        tools = row.get("tools", "")
        if not query or not answers:
            continue

        # Build a human prompt that includes available tools
        if tools:
            try:
                tools_obj = json.loads(tools) if isinstance(tools, str) else tools
                tools_str = json.dumps(tools_obj, indent=2)
                human = f"Available tools:\n{tools_str}\n\nTask: {query}"
            except Exception:
                human = query
        else:
            human = query

        # answers is usually a JSON list of tool calls
        try:
            ans_obj = json.loads(answers) if isinstance(answers, str) else answers
            assistant = json.dumps(ans_obj, indent=2)
        except Exception:
            assistant = str(answers)

        if len(human) < 10 or len(assistant) < 5:
            continue

        messages = [
            {"from": "system", "value": SYSTEM},
            {"from": "human", "value": human},
            {"from": "gpt", "value": assistant},
        ]
        samples.append(to_sharegpt(messages))
        if len(samples) >= n:
            break
    return samples


def main():
    glaive = download_glaive(7_000)
    xlam = download_xlam(5_000)

    all_samples = glaive + xlam
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
    print(f"  Glaive: {len(glaive)}, XLAM: {len(xlam)}")
    print(f"Saved to {out_path}")


if __name__ == "__main__":
    main()
