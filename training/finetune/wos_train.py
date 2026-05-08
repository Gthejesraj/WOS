#!/usr/bin/env python3
"""
WOS Fine-Tuning Script
======================
QLoRA fine-tune → merge adapter → save clean bfloat16 → push to HF.
The merged model loads in vLLM with no issues (no quantization artifacts).

Usage (one command per RunPod pod):

  python3 wos_train.py --base google/gemma-2-27b \
    --data thejesraj/wos-coding-dataset --col text \
    --repo thejesraj/wos-coding-gemma

  python3 wos_train.py --base mistralai/Mixtral-8x7B-v0.1 \
    --data thejesraj/wos-meeting-dataset --col text \
    --repo thejesraj/wos-meeting-mixtral

  python3 wos_train.py --base Qwen/Qwen2.5-32B \
    --data thejesraj/wos-main-dataset --col text \
    --repo thejesraj/wos-main
"""

import os, sys, shutil, argparse
import torch

# ── parse args ────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser()
parser.add_argument("--base",    required=True,  help="HF base model id")
parser.add_argument("--data",    required=True,  help="HF dataset id")
parser.add_argument("--repo",    required=True,  help="HF output repo to push to")
parser.add_argument("--col",     default="text", help="Dataset column with training text")
parser.add_argument("--split",   default="train")
parser.add_argument("--epochs",  type=int,   default=1)
parser.add_argument("--lr",      type=float, default=2e-4)
parser.add_argument("--bs",      type=int,   default=2,  help="per_device_train_batch_size")
parser.add_argument("--gas",     type=int,   default=8,  help="gradient_accumulation_steps")
parser.add_argument("--maxlen",  type=int,   default=2048)
parser.add_argument("--lora_r",  type=int,   default=16)
parser.add_argument("--shard",   default="4GB", help="max shard size for HF upload")
parser.add_argument("--hf_token", default=os.environ.get("HF_TOKEN", ""))
args = parser.parse_args()

# ── login ─────────────────────────────────────────────────────────────────────

if args.hf_token:
    from huggingface_hub import login
    login(token=args.hf_token)
    print("Logged in to HuggingFace.")
else:
    print("WARNING: HF_TOKEN not set — private repos and gated models will fail.")

# ── disk check + cleanup ──────────────────────────────────────────────────────

def check_disk(path="/", min_gb=80):
    free_gb = shutil.disk_usage(path).free / 1e9
    print(f"\nDisk: {free_gb:.1f} GB free on {path}")
    if free_gb < min_gb:
        print(f"  Low disk — clearing HF cache...")
        hf_cache = os.path.expanduser("~/.cache/huggingface/hub")
        if os.path.exists(hf_cache):
            shutil.rmtree(hf_cache)
            print(f"  Cleared {hf_cache}")
        # also clear any leftover tmp dirs
        for d in ["/tmp/wos_adapter", "/tmp/wos_merged"]:
            if os.path.exists(d):
                shutil.rmtree(d)
        free_gb = shutil.disk_usage(path).free / 1e9
        print(f"  Now: {free_gb:.1f} GB free")
    if free_gb < 40:
        print("ERROR: Still less than 40 GB free — aborting to avoid disk-full crash.")
        sys.exit(1)

check_disk("/", min_gb=80)

# ── output dirs ───────────────────────────────────────────────────────────────

ADAPTER_DIR = "/tmp/wos_adapter"
MERGED_DIR  = "/tmp/wos_merged"
for d in [ADAPTER_DIR, MERGED_DIR]:
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)

# ── imports (after login so gated model downloads work) ───────────────────────

from datasets import load_dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
)
from peft import LoraConfig, prepare_model_for_kbit_training
from trl import SFTTrainer, SFTConfig

# ── tokenizer ─────────────────────────────────────────────────────────────────

print(f"\nLoading tokenizer: {args.base}")
tok = AutoTokenizer.from_pretrained(args.base, trust_remote_code=True)
if tok.pad_token is None:
    tok.pad_token = tok.eos_token
tok.padding_side = "right"

# ── dataset ───────────────────────────────────────────────────────────────────

print(f"Loading dataset: {args.data} (split={args.split})")
ds = load_dataset(args.data, split=args.split)
print(f"  Columns: {ds.column_names}")
print(f"  Size:    {len(ds)} examples")

# auto-detect column if needed
if args.col not in ds.column_names:
    if "text" in ds.column_names:
        args.col = "text"
    elif "instruction" in ds.column_names and "output" in ds.column_names:
        def fmt(x):
            return {"text": f"### Instruction:\n{x['instruction']}\n\n### Response:\n{x['output']}"}
        ds = ds.map(fmt, remove_columns=ds.column_names)
        args.col = "text"
    elif "messages" in ds.column_names:
        def fmt_chat(x):
            parts = [f"<|{m['role']}|>\n{m['content']}" for m in x["messages"]]
            return {"text": "\n".join(parts)}
        ds = ds.map(fmt_chat, remove_columns=ds.column_names)
        args.col = "text"
    elif "prompt" in ds.column_names and "completion" in ds.column_names:
        def fmt_pc(x):
            return {"text": x["prompt"] + x["completion"]}
        ds = ds.map(fmt_pc, remove_columns=ds.column_names)
        args.col = "text"
    else:
        print(f"ERROR: column '{args.col}' not found. Available: {ds.column_names}")
        sys.exit(1)

print(f"  Using column: '{args.col}'")

# ── model (4-bit QLoRA) ───────────────────────────────────────────────────────

print(f"\nLoading model (4-bit QLoRA): {args.base}")
bnb_cfg = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16,
    bnb_4bit_use_double_quant=True,
)

model = AutoModelForCausalLM.from_pretrained(
    args.base,
    quantization_config=bnb_cfg,
    device_map="auto",
    trust_remote_code=True,
    torch_dtype=torch.bfloat16,
    attn_implementation="flash_attention_2",
)
model = prepare_model_for_kbit_training(model)
model.config.use_cache = False

# ── LoRA config ───────────────────────────────────────────────────────────────

lora_cfg = LoraConfig(
    r=args.lora_r,
    lora_alpha=args.lora_r * 2,
    target_modules=[
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj",
    ],
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
    bf16=True,
    fp16=False,
    max_seq_length=args.maxlen,
    dataset_text_field=args.col,
    logging_steps=50,
    save_strategy="no",
    warmup_ratio=0.03,
    lr_scheduler_type="cosine",
    optim="paged_adamw_8bit",
    gradient_checkpointing=True,
    report_to="none",
)

trainer = SFTTrainer(
    model=model,
    args=sft_cfg,
    train_dataset=ds,
    peft_config=lora_cfg,
    tokenizer=tok,
)

print("\nStarting training...")
trainer.train()
print("Training done.")

# ── merge adapter → clean bfloat16 ───────────────────────────────────────────
# This is the critical step — merge while loaded, BEFORE saving.
# Never save the 4-bit model and try to convert later (that's what broke Gemma).

print("\nMerging LoRA adapter into base weights (bfloat16)...")
merged = trainer.model.merge_and_unload()
merged = merged.to(torch.bfloat16)
merged.config.use_cache = True

# remove any quantization config from the saved config
if hasattr(merged.config, "quantization_config"):
    del merged.config.quantization_config

print(f"Saving merged model to {MERGED_DIR}...")
merged.save_pretrained(
    MERGED_DIR,
    safe_serialization=True,
    max_shard_size=args.shard,
)
tok.save_pretrained(MERGED_DIR)

# ── verify ───────────────────────────────────────────────────────────────────

files = os.listdir(MERGED_DIR)
print(f"\nFiles saved: {sorted(files)}")

assert "adapter_config.json" not in files, \
    "FAIL: adapter_config.json present — merge did not complete cleanly."
assert any(f.startswith("model-") and f.endswith(".safetensors") for f in files), \
    "FAIL: no model shard files found."
assert "model.safetensors.index.json" in files, \
    "FAIL: index.json missing."

shards = [f for f in files if f.startswith("model-") and f.endswith(".safetensors")]
print(f"\nVerification passed:")
print(f"  {len(shards)} clean bfloat16 shards")
print(f"  index.json present")
print(f"  no adapter artifacts")

# ── upload to HF ─────────────────────────────────────────────────────────────

print(f"\nUploading to: https://huggingface.co/{args.repo}")
merged.push_to_hub(
    args.repo,
    safe_serialization=True,
    max_shard_size=args.shard,
    commit_message="Add fine-tuned model (clean bfloat16, vLLM-compatible)",
)
tok.push_to_hub(args.repo)
print(f"Upload complete: https://huggingface.co/{args.repo}")

# ── cleanup ───────────────────────────────────────────────────────────────────

print("\nCleaning up...")
shutil.rmtree(MERGED_DIR, ignore_errors=True)
shutil.rmtree(ADAPTER_DIR, ignore_errors=True)
free_gb = shutil.disk_usage("/").free / 1e9
print(f"Free disk: {free_gb:.1f} GB")
print("\nDone!")
