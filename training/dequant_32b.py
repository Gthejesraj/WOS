import os, gc, shutil, subprocess, torch, bitsandbytes as bnb
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

os.environ["HF_HOME"] = "/workspace/hf_cache"

REPO_ID = "thejesraj/wos-main-32b"
OUTPUT  = "/workspace/wos-main-32b-bf16"


def disk():
    r = subprocess.run(["df", "-h", "/workspace"], capture_output=True, text=True)
    return r.stdout.strip().split("\n")[1]


print("Disk:", disk())
print("Loading 4-bit model from HuggingFace onto GPU...")

model = AutoModelForCausalLM.from_pretrained(
    REPO_ID,
    quantization_config=BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    ),
    device_map="auto",
)
tokenizer = AutoTokenizer.from_pretrained(REPO_ID)
print(f"Loaded. Disk: {disk()}")

print("Dequantizing all layers to CPU bfloat16...")
replacements = []
for name, module in model.named_modules():
    if isinstance(module, bnb.nn.Linear4bit):
        w = module.weight.dequantize().to(torch.bfloat16).cpu()
        b = module.bias.to(torch.bfloat16).cpu() if module.bias is not None else None
        replacements.append((name, w, b, module.in_features, module.out_features))

print(f"Dequantized {len(replacements)} layers. Replacing in model...")
for name, w, b, in_f, out_f in replacements:
    new_lin = torch.nn.Linear(in_f, out_f, bias=b is not None, dtype=torch.bfloat16, device="cpu")
    new_lin.weight = torch.nn.Parameter(w)
    if b is not None:
        new_lin.bias = torch.nn.Parameter(b)
    parent = model
    parts = name.split(".")
    for p in parts[:-1]:
        parent = getattr(parent, p)
    setattr(parent, parts[-1], new_lin)

torch.cuda.empty_cache()
gc.collect()
model = model.cpu().to(torch.bfloat16)
print("Model is now bfloat16 on CPU.")

print("Freeing hf_cache...")
shutil.rmtree("/workspace/hf_cache/hub", ignore_errors=True)
print(f"Disk after freeing: {disk()}")

print("Saving bfloat16 model (~65GB)...")
os.makedirs(OUTPUT, exist_ok=True)
model.save_pretrained(OUTPUT, safe_serialization=True, max_shard_size="4GB")
tokenizer.save_pretrained(OUTPUT)
print(f"Done! Disk: {disk()}")
print(f"\nNow run:")
print(f"  huggingface-cli upload thejesraj/wos-main-32b {OUTPUT} --repo-type model")
