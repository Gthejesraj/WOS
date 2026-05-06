"""
Usage: python training/dequant.py <hf_repo_id>
Example: python training/dequant.py thejesraj/wos-coding-gemma
"""
import sys, os, gc, shutil, subprocess, torch, bitsandbytes as bnb
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

if len(sys.argv) < 2:
    print("Usage: python training/dequant.py thejesraj/<model-name>")
    sys.exit(1)

REPO_ID = sys.argv[1]
MODEL_NAME = REPO_ID.split("/")[-1]
OUTPUT = f"/workspace/{MODEL_NAME}-bf16"

os.environ["HF_HOME"] = "/workspace/hf_cache"


def disk():
    r = subprocess.run(["df", "-h", "/workspace"], capture_output=True, text=True)
    return r.stdout.strip().split("\n")[1]


print(f"\n=== Dequantizing {REPO_ID} ===")
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

print(f"Found {len(replacements)} quantized layers. Replacing...")
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

# Clear bitsandbytes flags so .to() doesn't raise
model.is_loaded_in_4bit = False
model.is_loaded_in_8bit = False
model.is_quantized = False
if hasattr(model.config, "quantization_config"):
    del model.config.quantization_config
model.config.torch_dtype = "bfloat16"
model.config.use_cache = True

# Move all remaining GPU params to CPU bfloat16 using base nn.Module.to
torch.nn.Module.to(model, device="cpu", dtype=torch.bfloat16)
print("Model is now bfloat16 on CPU.")

print("Freeing hf_cache...")
shutil.rmtree("/workspace/hf_cache/hub", ignore_errors=True)
print(f"Disk after freeing: {disk()}")

print(f"Saving bfloat16 model to {OUTPUT}...")
os.makedirs(OUTPUT, exist_ok=True)
model.save_pretrained(OUTPUT, safe_serialization=True, max_shard_size="4GB")
tokenizer.save_pretrained(OUTPUT)
print(f"Saved. Disk: {disk()}")

print("Uploading to HuggingFace...")
os.system(f"huggingface-cli upload {REPO_ID} {OUTPUT} --repo-type model")

print("Cleaning up local copy...")
shutil.rmtree(OUTPUT, ignore_errors=True)
print(f"Done! Disk: {disk()}")
print(f"\n{REPO_ID} is now bfloat16 on HuggingFace.")
