import os
import sys
import argparse
import torch
from pathlib import Path
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import PeftModel
from huggingface_hub import login

sys.path.insert(0, str(Path(__file__).parent.parent / "finetune"))
from config import BASE_MODEL, MODEL_CONFIGS

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=["coding", "meeting", "main"], required=True)
    args = parser.parse_args()

    cfg = MODEL_CONFIGS[args.model]
    adapter_path = f"./checkpoints/wos-{args.model}/adapter"

    hf_token = os.environ.get("HF_TOKEN")
    if not hf_token:
        raise ValueError("Set HF_TOKEN first: export HF_TOKEN=your_token")
    login(token=hf_token)

    print("Loading base model...")
    bnb = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
    )
    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        quantization_config=bnb,
        device_map="auto",
        torch_dtype=torch.bfloat16,
        trust_remote_code=True,
    )
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)

    print(f"Merging adapter from {adapter_path}...")
    model = PeftModel.from_pretrained(model, adapter_path)
    model = model.merge_and_unload()

    print(f"Pushing to HuggingFace: {cfg['model_id']}")
    print("This takes 20-40 min for 32B...")
    model.push_to_hub(cfg["model_id"], private=False, max_shard_size="4GB")
    tokenizer.push_to_hub(cfg["model_id"], private=False)

    print(f"DONE. Model live at: huggingface.co/{cfg['model_id']}")

if __name__ == "__main__":
    main()
