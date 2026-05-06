import os
import shutil

os.environ["HF_HOME"] = "/workspace/hf_cache"

from peft import AutoPeftModelForCausalLM
from transformers import AutoTokenizer

ADAPTER_PATH = "./training/checkpoints/wos-main-mixtral/adapter"
MERGED_PATH = "./training/checkpoints/wos-main-mixtral/merged"
HF_CACHE_MIXTRAL = "/workspace/hf_cache/hub/models--mistralai__Mixtral-8x7B-Instruct-v0.1"

print("Loading adapter + base model into RAM (CPU)...")
model = AutoPeftModelForCausalLM.from_pretrained(
    ADAPTER_PATH,
    device_map="cpu",
    low_cpu_mem_usage=True,
)
model = model.merge_and_unload()
print("Merge complete.")

print("Freeing hf_cache to make room for merged output...")
shutil.rmtree(HF_CACHE_MIXTRAL, ignore_errors=True)

print("Saving merged model...")
os.makedirs(MERGED_PATH, exist_ok=True)
model.save_pretrained(MERGED_PATH, safe_serialization=True, max_shard_size="4GB")
AutoTokenizer.from_pretrained(ADAPTER_PATH).save_pretrained(MERGED_PATH)
print("Done! Now run:")
print(f"  huggingface-cli upload thejesraj/wos-main-mixtral {MERGED_PATH} --repo-type model")
