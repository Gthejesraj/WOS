"""Quick sanity test — base model vs fine-tuned adapter.

Usage:
  python quick_test.py --model coding
  python quick_test.py --model meeting
"""

import argparse
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import PeftModel

BASE_MODEL = "Qwen/Qwen2.5-32B-Instruct"

PROMPTS = {
    "coding": [
        ("Write a Python function that returns the two numbers in a list that add up to a target sum.", "coding"),
        ("Debug this code:\ndef factorial(n):\n    if n == 0: return 1\n    return n * factorial(n)", "coding"),
        ("Write a Python class for a stack with push, pop, and peek methods.", "coding"),
    ],
    "meeting": [
        (
            "Summarize this meeting transcript:\n"
            "Alice: We need to finalize the Q3 budget by Friday.\n"
            "Bob: I can have the numbers ready by Thursday.\n"
            "Alice: Great. Also, the client demo is moved to next Tuesday.\n"
            "Bob: Noted, I'll prepare the slides.",
            "meeting"
        ),
        (
            "Extract action items from:\n"
            "John: Let's assign the new feature to Sarah.\n"
            "Sarah: I'll need the design files first.\n"
            "Mike: I'll send them today.\n"
            "John: Sarah, can you have a prototype by next Monday?",
            "meeting"
        ),
        (
            "What decisions were made in this meeting?\n"
            "Team discussed two approaches: microservices vs monolith. "
            "After 30 min discussion, decided to go with microservices for scalability. "
            "Budget approved for 3 new engineers.",
            "meeting"
        ),
    ],
}

SYSTEMS = {
    "coding": (
        "You are WOS Coding, an expert software engineer assistant. "
        "Write clean, correct, well-documented code."
    ),
    "meeting": (
        "You are WOS Meeting, an expert meeting intelligence assistant. "
        "You excel at summarizing meeting transcripts and extracting action items."
    ),
}


def load_model(adapter_path: str):
    bnb = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
    )
    print("Loading base model (10-15 min)...")
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)
    base = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        quantization_config=bnb,
        device_map="auto",
        torch_dtype=torch.bfloat16,
        trust_remote_code=True,
    )
    print(f"Applying adapter from {adapter_path}...")
    model = PeftModel.from_pretrained(base, adapter_path)
    model.eval()
    return model, tokenizer


def infer(model, tokenizer, system: str, prompt: str) -> str:
    messages = [{"role": "system", "content": system}, {"role": "user", "content": prompt}]
    inputs = tokenizer.apply_chat_template(
        messages, tokenize=True, add_generation_prompt=True, return_tensors="pt"
    ).to(model.device)
    with torch.no_grad():
        out = model.generate(
            inputs,
            max_new_tokens=300,
            temperature=0.1,
            do_sample=True,
            pad_token_id=tokenizer.eos_token_id,
        )
    generated = out[0][inputs.shape[1]:]
    return tokenizer.decode(generated, skip_special_tokens=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=["coding", "meeting"], required=True)
    args = parser.parse_args()

    adapter_path = f"./checkpoints/wos-{args.model}/adapter"
    model, tokenizer = load_model(adapter_path)
    system = SYSTEMS[args.model]
    prompts = PROMPTS[args.model]

    print(f"\n{'='*60}")
    print(f"Testing WOS-{args.model.upper()} (fine-tuned adapter)")
    print(f"{'='*60}")

    for i, (prompt, _) in enumerate(prompts):
        print(f"\n--- Prompt {i+1} ---")
        print(f"Q: {prompt[:120]}{'...' if len(prompt) > 120 else ''}")
        response = infer(model, tokenizer, system, prompt)
        print(f"A: {response[:600]}")
        print()

    print("Done.")


if __name__ == "__main__":
    main()
