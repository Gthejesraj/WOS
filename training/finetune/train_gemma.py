#!/usr/bin/env python3
"""
WOS Gemma 2-27B Fine-Tuning
Trains coding → meeting → main sequentially, pushes each to HF.

Setup (run once before this script):
  pip install "torch==2.6.0" --index-url https://download.pytorch.org/whl/cu124 -q
  pip install transformers peft trl datasets accelerate safetensors huggingface_hub tqdm liger-kernel -q
  pip uninstall torchvision torchaudio -y

Run:
  HF_TOKEN=hf_... python3 train_gemma.py
"""

# ── workspace redirect — MUST be before all other imports ────────────────────
import os, sys
for _d in ["/dev/shm/hf_cache", "/dev/shm/wos_tmp", "/dev/shm/.huggingface"]:
    os.makedirs(_d, exist_ok=True)
os.environ["HOME"]                 = "/dev/shm"
os.environ["HF_HOME"]                 = "/dev/shm/hf_cache"
os.environ["TRANSFORMERS_CACHE"]      = "/dev/shm/hf_cache"
os.environ["HUGGINGFACE_HUB_CACHE"]   = "/dev/shm/hf_cache"
os.environ["TMPDIR"]                  = "/dev/shm/wos_tmp"
os.environ["TEMP"]                    = "/dev/shm/wos_tmp"
os.environ["TMP"]                     = "/dev/shm/wos_tmp"
os.environ["HF_HUB_DISABLE_XET"]      = "1"   # use standard download, respects HF_HOME

HF_TOKEN = os.environ.get("HF_TOKEN", "")
if not HF_TOKEN:
    print("ERROR: set HF_TOKEN env var before running")
    sys.exit(1)

import shutil, json, random, torch
from tqdm import tqdm
from datasets import load_dataset, Dataset
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import LoraConfig
from trl import SFTTrainer, SFTConfig

# ── check GPU ─────────────────────────────────────────────────────────────────
if not torch.cuda.is_available():
    print("ERROR: CUDA not available. Run:")
    print('  pip install "torch==2.6.0" --index-url https://download.pytorch.org/whl/cu124 -q')
    sys.exit(1)
print(f"GPU: {torch.cuda.get_device_name(0)} — {torch.cuda.get_device_properties(0).total_memory/1e9:.0f}GB")

BASE_MODEL = "google/gemma-2-27b"
JOBS = [
    {"task": "coding",  "repo": "thejesraj/wos-coding-gemma"},
    {"task": "meeting", "repo": "thejesraj/wos-meeting-gemma"},
    {"task": "main",    "repo": "thejesraj/wos-main-gemma"},
]

# ── dataset builders ──────────────────────────────────────────────────────────

def build_coding():
    SYSTEM = ("You are WOS Coding, an expert software engineer assistant. "
              "You write clean, correct, well-structured code and debug issues systematically.")
    def fmt(h, g): return f"<|system|>\n{SYSTEM}\n<|user|>\n{h}\n<|assistant|>\n{g}"
    samples = []
    print("  CodeFeedback...")
    ds = load_dataset("m-a-p/CodeFeedback-Filtered-Instruction", split="train")
    for r in tqdm(ds, desc="CodeFeedback"):
        q, a = r.get("query",""), r.get("answer","")
        if q and a and len(q)>10 and len(a)>20: samples.append(fmt(q,a))
        if len(samples)>=40000: break
    print("  CodeAlpaca...")
    ds = load_dataset("sahil2801/CodeAlpaca-20k", split="train")
    c=0
    for r in tqdm(ds, desc="CodeAlpaca"):
        i,inp,o = r.get("instruction",""),r.get("input",""),r.get("output","")
        if i and o: samples.append(fmt(f"{i}\n\n{inp}".strip() if inp else i, o)); c+=1
        if c>=12000: break
    print("  PythonInst...")
    try:
        ds = load_dataset("iamtarun/python_code_instructions_18k_alpaca", split="train")
        c=0
        for r in tqdm(ds, desc="PythonInst"):
            i,inp,o = r.get("instruction",""),r.get("input",""),r.get("output","")
            if i and o: samples.append(fmt(f"{i}\n\n{inp}".strip() if inp else i, o)); c+=1
            if c>=8000: break
    except: pass
    random.shuffle(samples)
    return samples[:60000]

def build_meeting():
    SYSTEM = ("You are WOS Meeting, an expert meeting intelligence assistant. "
              "You summarize transcripts, extract action items, and identify key decisions.")
    def fmt(h, g): return f"<|system|>\n{SYSTEM}\n<|user|>\n{h}\n<|assistant|>\n{g}"
    samples = []
    print("  DialogSum...")
    ds = load_dataset("knkarthick/dialogsum", split="train")
    for r in tqdm(ds, desc="DialogSum"):
        d,s = r.get("dialogue",""),r.get("summary","")
        if d and s: samples.append(fmt(f"Summarize and extract action items:\n\n{d}", s))
    print("  MeetingBank...")
    try:
        ds = load_dataset("huuuyeah/meetingbank", split="train")
        for r in tqdm(ds, desc="MeetingBank"):
            t = r.get("transcript","") or r.get("meeting_transcripts","")
            s = r.get("summary","")
            if t and s:
                if len(t)>8000: t=t[:8000]+"\n[truncated]"
                samples.append(fmt(f"Summarize this meeting transcript:\n\n{t}", s))
    except: pass
    print("  QMSum...")
    try:
        ds = load_dataset("yale-nlp/QMSum", split="train")
        for r in tqdm(ds, desc="QMSum"):
            m = r.get("meeting", r.get("transcript",""))
            q = r.get("query", r.get("question",""))
            a = r.get("answer", r.get("summary",""))
            if m and a:
                if len(m)>6000: m=m[:6000]+"\n[truncated]"
                samples.append(fmt(f"TRANSCRIPT:\n{m}\n\n{'QUESTION: '+q if q else 'Summarize.'}", a))
    except: pass
    random.shuffle(samples)
    return samples

def build_main():
    def fmt(sys, h, g): return f"<|system|>\n{sys}\n<|user|>\n{h}\n<|assistant|>\n{g}"
    samples = []
    print("  OpenHermes...")
    ds = load_dataset("teknium/OpenHermes-2.5", split="train")
    for r in tqdm(ds, desc="OpenHermes"):
        convs = r.get("conversations",[])
        sys_ = next((c["value"] for c in convs if c.get("from")=="system"), "You are a helpful assistant.")
        turns = [c for c in convs if c.get("from") in ("human","gpt")]
        if len(turns)>=2 and len(turns[0]["value"])>10 and len(turns[1]["value"])>20:
            samples.append(fmt(sys_, turns[0]["value"], turns[1]["value"]))
        if len(samples)>=60000: break
    print("  UltraFeedback...")
    try:
        ds = load_dataset("HuggingFaceH4/ultrafeedback_binarized", split="train_sft")
        c=0
        for r in tqdm(ds, desc="UltraFeedback"):
            p = r.get("prompt","")
            resp = next((m["content"] for m in r.get("chosen",[]) if m.get("role")=="assistant"), "")
            if p and resp: samples.append(fmt("You are a helpful assistant.", p, resp)); c+=1
            if c>=20000: break
    except: pass
    random.shuffle(samples)
    return samples[:80000]

# ── train one model ───────────────────────────────────────────────────────────

def train(task, repo):
    print(f"\n{'='*60}")
    print(f"Training: {task} → {repo}")
    print(f"{'='*60}")

    WORK = f"/dev/shm/wos_{task}"
    MERGED = f"{WORK}/merged"
    for d in [WORK, MERGED]:
        shutil.rmtree(d, ignore_errors=True); os.makedirs(d)

    random.seed(42)
    print("Building dataset...")
    texts = {"coding": build_coding, "meeting": build_meeting, "main": build_main}[task]()
    print(f"  {len(texts)} examples")
    data_path = f"{WORK}/train.jsonl"
    with open(data_path,"w") as f:
        for t in texts: f.write(json.dumps({"text":t})+"\n")
    ds = Dataset.from_json(data_path)

    print("Loading tokenizer...")
    tok = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True, token=HF_TOKEN)
    if tok.pad_token is None: tok.pad_token = tok.eos_token
    tok.padding_side = "right"

    print("Loading model (bfloat16)...")
    try:
        import flash_attn; attn = "flash_attention_2"
    except ImportError:
        attn = "sdpa"
    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL, device_map="auto", trust_remote_code=True,
        torch_dtype=torch.bfloat16, attn_implementation=attn, token=HF_TOKEN,
    )
    model.config.use_cache = False

    lora = LoraConfig(r=16, lora_alpha=32,
        target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"],
        lora_dropout=0.05, bias="none", task_type="CAUSAL_LM")

    cfg = SFTConfig(
        output_dir=f"{WORK}/adapter",
        num_train_epochs=1, per_device_train_batch_size=4,
        gradient_accumulation_steps=8, learning_rate=2e-4,
        bf16=True, fp16=False, dataset_text_field="text",
        logging_steps=50, save_strategy="no", warmup_ratio=0.03,
        lr_scheduler_type="cosine", optim="adamw_torch",
        gradient_checkpointing=True, report_to="none",
    )
    trainer = SFTTrainer(model=model, args=cfg, train_dataset=ds,
                         peft_config=lora, tokenizer=tok, max_seq_length=2048)
    print("Training...")
    trainer.train()

    print("Merging adapter...")
    merged = trainer.model.merge_and_unload()
    merged = merged.to(torch.bfloat16)
    merged.config.use_cache = True
    merged.save_pretrained(MERGED, safe_serialization=True, max_shard_size="4GB")
    tok.save_pretrained(MERGED)

    files = os.listdir(MERGED)
    shards = [f for f in files if f.startswith("model-") and f.endswith(".safetensors")]
    assert "adapter_config.json" not in files, "Merge failed"
    assert shards, "No shard files"
    print(f"  {len(shards)} clean bfloat16 shards ✓")

    print(f"Uploading to {repo}...")
    merged.push_to_hub(repo, safe_serialization=True, max_shard_size="4GB",
                       token=HF_TOKEN, commit_message="WOS fine-tune (bfloat16, vLLM-ready)")
    tok.push_to_hub(repo, token=HF_TOKEN)
    print(f"Done: https://huggingface.co/{repo}")

    shutil.rmtree(WORK, ignore_errors=True)
    del model, merged, trainer
    torch.cuda.empty_cache()
    print(f"Free VRAM: {torch.cuda.mem_get_info()[0]/1e9:.1f}GB")

# ── run all 3 ─────────────────────────────────────────────────────────────────

for job in JOBS:
    train(job["task"], job["repo"])

print("\nAll 3 Gemma models done!")
