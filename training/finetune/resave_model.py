import torch
import argparse
from transformers import AutoModelForCausalLM, AutoTokenizer

HF_USER = 'thejesraj'
parser = argparse.ArgumentParser()
parser.add_argument('--model', required=True)
args = parser.parse_args()
repo = f'{HF_USER}/{args.model}'

print(f'Loading existing model from {repo}...')
model = AutoModelForCausalLM.from_pretrained(repo, torch_dtype=torch.bfloat16, device_map='auto')
tokenizer = AutoTokenizer.from_pretrained(repo)

print('Re-saving in clean bfloat16 format...')
model.push_to_hub(repo, max_shard_size='4GB')
tokenizer.push_to_hub(repo)
print('Done!')
