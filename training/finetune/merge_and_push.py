"""
Merge LoRA adapter into base model and push full model to HuggingFace.
Usage:
  python3 merge_and_push.py --model wos-meeting-gemma
  python3 merge_and_push.py --model wos-coding-gemma
  python3 merge_and_push.py --model wos-main-gemma
"""
import argparse
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

BASE = 'google/gemma-2-27b-it'
HF_USER = 'thejesraj'

parser = argparse.ArgumentParser()
parser.add_argument('--model', required=True)
args = parser.parse_args()

repo = f'{HF_USER}/{args.model}'

print(f'Loading base model: {BASE}')
model = AutoModelForCausalLM.from_pretrained(BASE, torch_dtype=torch.bfloat16, device_map='auto')
tokenizer = AutoTokenizer.from_pretrained(BASE)

print(f'Loading LoRA adapter: {repo}')
model = PeftModel.from_pretrained(model, repo)

print('Merging adapter into base model...')
model = model.merge_and_unload()

print(f'Pushing merged model to {repo}')
model.push_to_hub(repo, max_shard_size='4GB')
tokenizer.push_to_hub(repo)
print('Done!')
