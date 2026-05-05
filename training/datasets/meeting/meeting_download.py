"""Download and prepare the Meeting model dataset.

Sources:
  - knkarthick/dialogsum    (dialogue summarization, 13k samples)
  - huuuyeah/meetingbank    (real meeting transcripts + summaries, 6.8k)
  - yale-nlp/QMSum          (query-based meeting summarization, 1.8k)

Output: ../processed/  — JSONL in ShareGPT chat format for Unsloth.
"""

import json
import random
from pathlib import Path
from datasets import load_dataset
from tqdm import tqdm

SEED = 42
OUT_DIR = Path(__file__).parent / "processed"
OUT_DIR.mkdir(parents=True, exist_ok=True)

random.seed(SEED)

SYSTEM = (
    "You are WOS Meeting, an expert meeting intelligence assistant. "
    "You excel at summarizing meeting transcripts, extracting action items, "
    "identifying key decisions, and answering questions about meeting content."
)


def to_sharegpt(human: str, gpt: str) -> dict:
    return {
        "conversations": [
            {"from": "system", "value": SYSTEM},
            {"from": "human", "value": human},
            {"from": "gpt", "value": gpt},
        ]
    }


def download_dialogsum() -> list[dict]:
    print("Downloading DialogSum...")
    ds = load_dataset("knkarthick/dialogsum", split="train")
    samples = []
    for row in tqdm(ds, desc="DialogSum"):
        dialogue = row.get("dialogue", "")
        summary = row.get("summary", "")
        if not dialogue or not summary:
            continue
        human = (
            f"Please summarize the following conversation and extract any action items:\n\n"
            f"{dialogue}"
        )
        samples.append(to_sharegpt(human, summary))
    return samples


def download_meetingbank() -> list[dict]:
    print("Downloading MeetingBank...")
    try:
        ds = load_dataset("huuuyeah/meetingbank", split="train")
    except Exception as e:
        print(f"MeetingBank load failed: {e} — skipping")
        return []
    samples = []
    for row in tqdm(ds, desc="MeetingBank"):
        transcript = row.get("transcript", "") or row.get("meeting_transcripts", "")
        summary = row.get("summary", "")
        if not transcript or not summary:
            continue
        # Truncate very long transcripts
        if len(transcript) > 8000:
            transcript = transcript[:8000] + "\n[transcript truncated]"
        human = (
            f"Below is a meeting transcript. Please provide:\n"
            f"1. A concise summary\n"
            f"2. Key decisions made\n"
            f"3. Action items with owners (if mentioned)\n\n"
            f"TRANSCRIPT:\n{transcript}"
        )
        samples.append(to_sharegpt(human, summary))
    return samples


def download_qmsum() -> list[dict]:
    print("Downloading QMSum...")
    try:
        ds = load_dataset("yale-nlp/QMSum", split="train")
    except Exception:
        try:
            ds = load_dataset("pszemraj/qmsum-cleaned", split="train")
        except Exception as e:
            print(f"QMSum load failed: {e} — skipping")
            return []
    samples = []
    for row in tqdm(ds, desc="QMSum"):
        meeting = row.get("meeting", row.get("transcript", ""))
        query = row.get("query", row.get("question", ""))
        answer = row.get("answer", row.get("summary", ""))
        if not meeting or not answer:
            continue
        if len(meeting) > 6000:
            meeting = meeting[:6000] + "\n[transcript truncated]"
        human = f"MEETING TRANSCRIPT:\n{meeting}\n\nQUESTION: {query}" if query else f"MEETING TRANSCRIPT:\n{meeting}\n\nSummarize this meeting."
        samples.append(to_sharegpt(human, answer))
    return samples


def add_action_item_samples(base_samples: list[dict], n: int = 2000) -> list[dict]:
    """Generate synthetic action-item extraction samples from existing summaries."""
    extras = []
    pool = random.sample(base_samples, min(n, len(base_samples)))
    for item in pool:
        convs = item["conversations"]
        original_human = convs[1]["value"]
        original_gpt = convs[2]["value"]
        human = original_human.replace(
            "Please summarize", "Extract all action items from"
        ).replace(
            "Below is a meeting transcript. Please provide:", "List only the action items from this meeting:"
        )
        if human == original_human:
            continue
        gpt = f"Action items extracted:\n{original_gpt}"
        extras.append(to_sharegpt(human, gpt))
    return extras


def main():
    dialogsum = download_dialogsum()
    meetingbank = download_meetingbank()
    qmsum = download_qmsum()

    all_samples = dialogsum + meetingbank + qmsum
    all_samples += add_action_item_samples(all_samples)
    random.shuffle(all_samples)

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
    print(f"  DialogSum: {len(dialogsum)}, MeetingBank: {len(meetingbank)}, QMSum: {len(qmsum)}")
    print(f"Saved to {out_path}")


if __name__ == "__main__":
    main()
