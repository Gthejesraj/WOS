import os
import shutil
import subprocess
import torch

os.environ["HF_HOME"] = "/workspace/hf_cache"
os.environ["TMPDIR"] = "/workspace/tmp"
os.makedirs("/workspace/tmp", exist_ok=True)

from peft import AutoPeftModelForCausalLM
from transformers import AutoTokenizer


ADAPTER_PATH = "./training/checkpoints/wos-main-mixtral/adapter"
MERGED_PATH = "./training/checkpoints/wos-main-mixtral/merged"


def disk():
    r = subprocess.run(["df", "-h", "/workspace"], capture_output=True, text=True)
    return r.stdout.strip().split("\n")[1]


print("Disk at start:", disk())

print("Loading model (bfloat16, CPU)...")
model = AutoPeftModelForCausalLM.from_pretrained(
    ADAPTER_PATH,
    device_map="cpu",
    low_cpu_mem_usage=True,
    torch_dtype=torch.bfloat16,
)
model = model.merge_and_unload()
model = model.to(torch.bfloat16)

print(f"Model dtype: {next(model.parameters()).dtype}")
print("Disk after load:", disk())

# Clone all tensors into real RAM to break mmap references to hf_cache files.
# Without this, Linux keeps the hf_cache disk blocks allocated even after rmtree.
print("Cloning tensors into RAM (breaks mmap)...")
for param in model.parameters():
    param.data = param.data.clone()
for buf in model.buffers():
    buf.data = buf.data.clone()

print("Freeing hf_cache...")
shutil.rmtree("/workspace/hf_cache", ignore_errors=False)
print("Disk after freeing:", disk())

print("Saving merged model (bfloat16)...")
os.makedirs(MERGED_PATH, exist_ok=True)
model.save_pretrained(MERGED_PATH, safe_serialization=True, max_shard_size="4GB")
AutoTokenizer.from_pretrained(ADAPTER_PATH).save_pretrained(MERGED_PATH)
print("Done!")
print(f"Now run: huggingface-cli upload thejesraj/wos-main-mixtral {MERGED_PATH} --repo-type model")
