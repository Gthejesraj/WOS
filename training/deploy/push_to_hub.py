"""Push fine-tuned model weights and GGUF to HuggingFace Hub.

Usage:
  HF_TOKEN=<your_token> python push_to_hub.py --model coding
"""

import argparse
import os
from pathlib import Path
from huggingface_hub import HfApi, login

HF_USERNAME = "thejesraj"


def push_model(model: str, token: str):
    login(token=token)
    api = HfApi()

    adapter_path = Path(f"./checkpoints/wos-{model}/adapter")
    gguf_path = Path(f"./checkpoints/wos-{model}/gguf")
    repo_id = f"{HF_USERNAME}/wos-{model}-32b"

    # Create repo if needed
    try:
        api.create_repo(repo_id=repo_id, repo_type="model", exist_ok=True)
        print(f"Repo: https://huggingface.co/{repo_id}")
    except Exception as e:
        print(f"Repo create warning: {e}")

    # Push adapter weights
    if adapter_path.exists():
        print(f"Uploading adapter weights...")
        api.upload_folder(
            folder_path=str(adapter_path),
            repo_id=repo_id,
            path_in_repo="adapter",
            commit_message=f"Add WOS-{model} QLoRA adapter",
        )

    # Push GGUF quantized model
    gguf_file = gguf_path / f"wos-{model}-Q4_K_M.gguf"
    if gguf_file.exists():
        print(f"Uploading GGUF (this may take a while for 32B)...")
        api.upload_file(
            path_or_fileobj=str(gguf_file),
            path_in_repo=f"wos-{model}-Q4_K_M.gguf",
            repo_id=repo_id,
            commit_message=f"Add GGUF Q4_K_M quantized model",
        )
        print(f"GGUF uploaded: https://huggingface.co/{repo_id}/resolve/main/wos-{model}-Q4_K_M.gguf")

    # Push model card
    card = f"""---
base_model: Qwen/Qwen2.5-32B-Instruct
language:
- en
license: apache-2.0
tags:
- qwen
- qlora
- fine-tuned
- wos-capstone
---

# WOS-{model.title()}-32B

Fine-tuned version of Qwen2.5-32B-Instruct specialized for **{model}** tasks.

## Training
- Base model: Qwen/Qwen2.5-32B-Instruct
- Method: QLoRA (rank=16, alpha=16, 4-bit quantization)
- Framework: Unsloth + TRL
- Hardware: Lambda Labs A100 80GB

## Usage
Load the adapter with PEFT or use the GGUF file directly with llama.cpp / Ollama.

## Part of WOS Capstone
This model is one of three specialized models (main, meeting, coding) built for the WOS AI agent desktop app.
"""
    api.upload_file(
        path_or_fileobj=card.encode(),
        path_in_repo="README.md",
        repo_id=repo_id,
        commit_message="Add model card",
    )

    print(f"\nDone! Model available at: https://huggingface.co/{repo_id}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=["main", "meeting", "coding"], required=True)
    args = parser.parse_args()

    token = os.environ.get("HF_TOKEN")
    if not token:
        raise ValueError("Set HF_TOKEN environment variable")

    push_model(args.model, token)


if __name__ == "__main__":
    main()
