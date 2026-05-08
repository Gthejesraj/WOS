#!/usr/bin/env python3
"""
WOS Fine-Tuning Script
======================
Downloads data → QLoRA fine-tune → merges adapter → saves clean bfloat16 → pushes to HF.
The merged model loads in vLLM with no issues (no quantization artifacts, no adapter files).

Usage (one command per RunPod pod):

  # Gemma 2-27B
  HF_TOKEN=hf_... python3 wos_train.py --task coding  --base google/gemma-2-27b       --repo thejesraj/wos-coding-gemma
  HF_TOKEN=hf_... python3 wos_train.py --task meeting --base google/gemma-2-27b       --repo thejesraj/wos-meeting-gemma
  HF_TOKEN=hf_... python3 wos_train.py --task main    --base google/gemma-2-27b       --repo thejesraj/wos-main-gemma

  # Mixtral 8x7B
  HF_TOKEN=hf_... python3 wos_train.py --task coding  --base mistralai/Mixtral-8x7B-v0.1 --repo thejesraj/wos-coding-mixtral
  HF_TOKEN=hf_... python3 wos_train.py --task meeting --base mistralai/Mixtral-8x7B-v0.1 --repo thejesraj/wos-meeting-mixtral
  HF_TOKEN=hf_... python3 wos_train.py --task main    --base mistralai/Mixtral-8x7B-v0.1 --repo thejesraj/wos-main-mixtral

  # Qwen 2.5-32B
  HF_TOKEN=hf_... python3 wos_train.py --task coding  --base Qwen/Qwen2.5-32B --repo thejesraj/wos-coding
  HF_TOKEN=hf_... python3 wos_train.py --task meeting --base Qwen/Qwen2.5-32B --repo thejesraj/wos-meeting
  HF_TOKEN=hf_... python3 wos_train.py --task main    --base Qwen/Qwen2.5-32B --repo thejesraj/wos-main

Install (H200 SXM):
  pip install transformers peft trl datasets bitsandbytes accelerate safetensors huggingface_hub tqdm -q
  pip install flash-attn --no-build-isolation -q
"""

import os, sys, shutil, argparse, json, random
from pathlib import Path
import torch
from tqdm import tqdm

# ── args ──────────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser()
parser.add_argument("--task",   required=True, choices=["coding","meeting","main"])
parser.add_argument("--base",   required=True, help="HF base model id")
parser.add_argument("--repo",   required=True, help="HF output repo to push to")
parser.add_argument("--epochs", type=int,   default=1)
parser.add_argument("--lr",     type=float, default=2e-4)
parser.add_argument("--bs",     type=int,   default=4)   # H200 has 141GB VRAM
parser.add_argument("--gas",    type=int,   default=8)
parser.add_argument("--maxlen", type=int,   default=2048)
parser.add_argument("--lora_r", type=int,   default=16)
parser.add_argument("--shard",  default="4GB")
parser.add_argument("--hf_token", default=os.environ.get("HF_TOKEN",""))
args = parser.parse_args()

# ── login ─────────────────────────────────────────────────────────────────────

if args.hf_token:
    from huggingface_hub import login
    login(token=args.hf_token)
    print("Logged in to HuggingFace.")
else:
    print("WARNING: HF_TOKEN not set — gated models will fail. Set HF_TOKEN env var.")
    sys.exit(1)

# ── disk cleanup ──────────────────────────────────────────────────────────────

def check_disk(path="/", min_gb=80):
    free_gb = shutil.disk_usage(path).free / 1e9
    print(f"\nDisk: {free_gb:.1f} GB free")
    if free_gb < min_gb:
        print("  Low disk — clearing HF cache...")
        hf_cache = os.path.expanduser("~/.cache/huggingface/hub")
        if os.path.exists(hf_cache):
            shutil.rmtree(hf_cache)
            print(f"  Cleared {hf_cache}")
        for d in ["/tmp/wos_adapter", "/tmp/wos_merged", "/tmp/wos_data"]:
            if os.path.exists(d):
                shutil.rmtree(d)
        free_gb = shutil.disk_usage(path).free / 1e9
        print(f"  After cleanup: {free_gb:.1f} GB free")
    if free_gb < 40:
        print("ERROR: Less than 40 GB free — aborting.")
        sys.exit(1)

check_disk("/", min_gb=80)

ADAPTER_DIR = "/tmp/wos_adapter"
MERGED_DIR  = "/tmp/wos_merged"
DATA_DIR    = "/tmp/wos_data"
for d in [ADAPTER_DIR, MERGED_DIR, DATA_DIR]:
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)

# ── data download ─────────────────────────────────────────────────────────────

from datasets import load_dataset, Dataset

SEED = 42
random.seed(SEED)

def to_text(conversations: list) -> str:
    parts = []
    for turn in conversations:
        role = turn.get("from", "")
        value = turn.get("value", "")
        if role == "system":
            parts.append(f"<|system|>\n{value}")
        elif role == "human":
            parts.append(f"<|user|>\n{value}")
        elif role == "gpt":
            parts.append(f"<|assistant|>\n{value}")
    return "\n".join(parts)

def build_coding_dataset(n=60_000) -> list[str]:
    SYSTEM = (
        "You are WOS Coding, an expert software engineer assistant. "
        "You write clean, correct, well-structured code, explain technical concepts clearly, "
        "debug issues systematically, and follow best practices."
    )
    def fmt(human, gpt):
        return f"<|system|>\n{SYSTEM}\n<|user|>\n{human}\n<|assistant|>\n{gpt}"

    samples = []

    print("  Downloading CodeFeedback-Filtered-Instruction...")
    ds = load_dataset("m-a-p/CodeFeedback-Filtered-Instruction", split="train")
    for row in tqdm(ds, desc="CodeFeedback"):
        q = row.get("query",""); a = row.get("answer","")
        if q and a and len(q) > 10 and len(a) > 20:
            samples.append(fmt(q, a))
        if len(samples) >= 40_000: break

    print("  Downloading CodeAlpaca-20k...")
    ds = load_dataset("sahil2801/CodeAlpaca-20k", split="train")
    c = 0
    for row in tqdm(ds, desc="CodeAlpaca"):
        inst = row.get("instruction",""); inp = row.get("input",""); out = row.get("output","")
        if inst and out:
            human = f"{inst}\n\n{inp}".strip() if inp else inst
            samples.append(fmt(human, out)); c += 1
        if c >= 12_000: break

    print("  Downloading Python Instructions...")
    try:
        ds = load_dataset("iamtarun/python_code_instructions_18k_alpaca", split="train")
        c = 0
        for row in tqdm(ds, desc="PythonInst"):
            inst = row.get("instruction",""); inp = row.get("input",""); out = row.get("output","")
            if inst and out:
                human = f"{inst}\n\n{inp}".strip() if inp else inst
                samples.append(fmt(human, out)); c += 1
            if c >= 8_000: break
    except Exception as e:
        print(f"  Python instructions skipped: {e}")

    random.shuffle(samples)
    return samples[:n]

def build_meeting_dataset() -> list[str]:
    SYSTEM = (
        "You are WOS Meeting, an expert meeting intelligence assistant. "
        "You excel at summarizing meeting transcripts, extracting action items, "
        "identifying key decisions, and answering questions about meeting content."
    )
    def fmt(human, gpt):
        return f"<|system|>\n{SYSTEM}\n<|user|>\n{human}\n<|assistant|>\n{gpt}"

    samples = []

    print("  Downloading DialogSum...")
    ds = load_dataset("knkarthick/dialogsum", split="train")
    for row in tqdm(ds, desc="DialogSum"):
        d = row.get("dialogue",""); s = row.get("summary","")
        if d and s:
            samples.append(fmt(f"Summarize this conversation and extract action items:\n\n{d}", s))

    print("  Downloading MeetingBank...")
    try:
        ds = load_dataset("huuuyeah/meetingbank", split="train")
        for row in tqdm(ds, desc="MeetingBank"):
            t = row.get("transcript","") or row.get("meeting_transcripts","")
            s = row.get("summary","")
            if t and s:
                if len(t) > 8000: t = t[:8000] + "\n[truncated]"
                human = (
                    "Below is a meeting transcript. Provide:\n"
                    "1. Concise summary\n2. Key decisions\n3. Action items\n\n"
                    f"TRANSCRIPT:\n{t}"
                )
                samples.append(fmt(human, s))
    except Exception as e:
        print(f"  MeetingBank skipped: {e}")

    print("  Downloading QMSum...")
    try:
        ds = load_dataset("yale-nlp/QMSum", split="train")
        for row in tqdm(ds, desc="QMSum"):
            meeting = row.get("meeting", row.get("transcript",""))
            query   = row.get("query", row.get("question",""))
            answer  = row.get("answer", row.get("summary",""))
            if meeting and answer:
                if len(meeting) > 6000: meeting = meeting[:6000] + "\n[truncated]"
                human = f"MEETING TRANSCRIPT:\n{meeting}\n\nQUESTION: {query}" if query else f"MEETING TRANSCRIPT:\n{meeting}\n\nSummarize this meeting."
                samples.append(fmt(human, answer))
    except Exception as e:
        print(f"  QMSum skipped: {e}")

    random.shuffle(samples)
    return samples

def build_main_dataset(n=80_000) -> list[str]:
    def fmt(system, human, gpt):
        return f"<|system|>\n{system}\n<|user|>\n{human}\n<|assistant|>\n{gpt}"

    samples = []

    print("  Downloading OpenHermes-2.5...")
    ds = load_dataset("teknium/OpenHermes-2.5", split="train")
    for row in tqdm(ds, desc="OpenHermes"):
        convs = row.get("conversations",[])
        system = next((c["value"] for c in convs if c.get("from")=="system"), "You are a helpful assistant.")
        turns = [c for c in convs if c.get("from") in ("human","gpt")]
        if len(turns) >= 2:
            h = turns[0]["value"]; g = turns[1]["value"]
            if len(h) > 10 and len(g) > 20:
                samples.append(fmt(system, h, g))
        if len(samples) >= 60_000: break

    print("  Downloading UltraFeedback...")
    try:
        ds = load_dataset("HuggingFaceH4/ultrafeedback_binarized", split="train_sft")
        c = 0
        for row in tqdm(ds, desc="UltraFeedback"):
            prompt = row.get("prompt","")
            chosen = row.get("chosen",[])
            resp = next((m["content"] for m in chosen if m.get("role")=="assistant"), "")
            if prompt and resp:
                samples.append(fmt("You are a helpful assistant.", prompt, resp)); c += 1
            if c >= 20_000: break
    except Exception as e:
        print(f"  UltraFeedback skipped: {e}")

    random.shuffle(samples)
    return samples[:n]

print(f"\nBuilding {args.task} dataset...")
if args.task == "coding":
    texts = build_coding_dataset()
elif args.task == "meeting":
    texts = build_meeting_dataset()
else:
    texts = build_main_dataset()

print(f"Dataset ready: {len(texts)} examples")

# Save to disk + load as HF Dataset
data_path = f"{DATA_DIR}/train.jsonl"
with open(data_path, "w") as f:
    for t in texts:
        f.write(json.dumps({"text": t}) + "\n")

ds_train = Dataset.from_json(data_path)
print(f"Loaded into HF Dataset: {len(ds_train)} rows")

check_disk("/", min_gb=60)

# ── tokenizer ─────────────────────────────────────────────────────────────────

from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import LoraConfig, get_peft_model
from trl import SFTTrainer, SFTConfig

print(f"\nLoading tokenizer: {args.base}")
tok = AutoTokenizer.from_pretrained(args.base, trust_remote_code=True)
if tok.pad_token is None:
    tok.pad_token = tok.eos_token
tok.padding_side = "right"

# ── model (bfloat16, no quantization — H200 has 141GB VRAM, fits all models) ──

# Use flash_attention_2 if installed, fall back to sdpa
try:
    import flash_attn  # noqa: F401
    attn_impl = "flash_attention_2"
    print("  flash-attn found — using flash_attention_2")
except ImportError:
    attn_impl = "sdpa"
    print("  flash-attn not found — using sdpa")

print(f"Loading model (bfloat16 LoRA, no quantization): {args.base}")
model = AutoModelForCausalLM.from_pretrained(
    args.base,
    device_map="auto",
    trust_remote_code=True,
    torch_dtype=torch.bfloat16,
    attn_implementation=attn_impl,
)
model.config.use_cache = False

# ── LoRA ──────────────────────────────────────────────────────────────────────

lora_cfg = LoraConfig(
    r=args.lora_r,
    lora_alpha=args.lora_r * 2,
    target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM",
)

# ── training ──────────────────────────────────────────────────────────────────

sft_cfg = SFTConfig(
    output_dir=ADAPTER_DIR,
    num_train_epochs=args.epochs,
    per_device_train_batch_size=args.bs,
    gradient_accumulation_steps=args.gas,
    learning_rate=args.lr,
    bf16=True, fp16=False,
    max_seq_length=args.maxlen,
    dataset_text_field="text",
    logging_steps=50,
    save_strategy="no",
    warmup_ratio=0.03,
    lr_scheduler_type="cosine",
    optim="adamw_torch",
    gradient_checkpointing=True,
    report_to="none",
)

trainer = SFTTrainer(
    model=model,
    args=sft_cfg,
    train_dataset=ds_train,
    peft_config=lora_cfg,
    tokenizer=tok,
)

print("\nStarting training...")
trainer.train()
print("Training complete.")

# ── merge → clean bfloat16 ────────────────────────────────────────────────────

print("\nMerging LoRA adapter into base weights...")
merged = trainer.model.merge_and_unload()
merged = merged.to(torch.bfloat16)
merged.config.use_cache = True

print(f"Saving to {MERGED_DIR}...")
merged.save_pretrained(MERGED_DIR, safe_serialization=True, max_shard_size=args.shard)
tok.save_pretrained(MERGED_DIR)

# ── verify ────────────────────────────────────────────────────────────────────

files = os.listdir(MERGED_DIR)
shards = [f for f in files if f.startswith("model-") and f.endswith(".safetensors")]
assert "adapter_config.json" not in files, "FAIL: adapter_config.json present — merge incomplete"
assert shards, "FAIL: no model shard files"
assert "model.safetensors.index.json" in files, "FAIL: index.json missing"
print(f"\nVerification passed: {len(shards)} clean bfloat16 shards, no adapter artifacts")

# ── upload ────────────────────────────────────────────────────────────────────

print(f"\nUploading to https://huggingface.co/{args.repo} ...")
merged.push_to_hub(args.repo, safe_serialization=True, max_shard_size=args.shard,
                   commit_message="Fine-tuned model (clean bfloat16, vLLM-compatible)")
tok.push_to_hub(args.repo)
print(f"Done: https://huggingface.co/{args.repo}")

# ── cleanup ───────────────────────────────────────────────────────────────────

for d in [MERGED_DIR, ADAPTER_DIR, DATA_DIR]:
    shutil.rmtree(d, ignore_errors=True)
print(f"Free disk: {shutil.disk_usage('/').free/1e9:.1f} GB")
print("\nAll done!")
