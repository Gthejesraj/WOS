"""Run test prompts on any model and save outputs for comparison.

Run BEFORE training (baseline):
  python test_prompts.py --model Qwen/Qwen2.5-32B-Instruct --tag baseline

Run AFTER training (fine-tuned):
  python test_prompts.py --model thejesraj/wos-coding-32b --tag finetuned_coding
  python test_prompts.py --model thejesraj/wos-meeting-32b --tag finetuned_meeting

Then compare:
  python test_prompts.py --compare
"""

import argparse
import json
import os
import time
from pathlib import Path
from datetime import datetime

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

OUT_DIR = Path("./eval_outputs")
OUT_DIR.mkdir(exist_ok=True)

# ── Test prompts ──────────────────────────────────────────────────────────────
CODING_PROMPTS = [
    "Write a Python function that finds the two numbers in a list that add up to a target sum.",
    "Debug this code:\ndef factorial(n):\n    if n == 0: return 1\n    return n * factorial(n)",
    "Write a REST API endpoint in FastAPI that accepts a JSON body and returns a processed response.",
    "Explain what a decorator is in Python and give an example.",
    "Write a SQL query to find the top 5 customers by total order value.",
]

MEETING_PROMPTS = [
    "Summarize this meeting transcript:\nAlice: We need to finalize the Q3 budget by Friday.\nBob: I can have the numbers ready by Thursday.\nAlice: Great. Also, the client demo is moved to next Tuesday.\nBob: Noted, I'll prepare the slides.",
    "Extract action items from:\nJohn: Let's assign the new feature to Sarah.\nSarah: I'll need the design files first.\nMike: I'll send them today.\nJohn: Sarah, can you have a prototype by next Monday?",
    "What decisions were made in this meeting?\nTeam discussed two approaches: microservices vs monolith. After 30 min discussion, decided to go with microservices for scalability. Budget approved for 3 new engineers.",
    "Write meeting notes for:\nAgenda: Sprint planning. Discussed 5 user stories. Story points assigned. Velocity set at 40 points. Next sprint starts Monday.",
    "Who is responsible for what based on this transcript?\nMark: I'll handle the backend API. Lisa: I'll do the frontend. Tom: I can manage deployment and CI/CD.",
]

ALL_PROMPTS = {
    "coding": CODING_PROMPTS,
    "meeting": MEETING_PROMPTS,
}


def run_inference(model, tokenizer, prompt: str, system: str) -> tuple[str, float]:
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": prompt},
    ]
    inputs = tokenizer.apply_chat_template(
        messages, tokenize=True, add_generation_prompt=True, return_tensors="pt"
    ).to(model.device)

    start = time.time()
    with torch.no_grad():
        outputs = model.generate(
            inputs,
            max_new_tokens=512,
            temperature=0.1,
            do_sample=True,
            pad_token_id=tokenizer.eos_token_id,
        )
    latency = time.time() - start

    generated = outputs[0][inputs.shape[1]:]
    return tokenizer.decode(generated, skip_special_tokens=True), round(latency, 2)


def run_evaluation(model_name: str, tag: str):
    print(f"\nLoading model: {model_name}")

    hf_token = os.environ.get("HF_TOKEN")

    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
    )

    tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True, token=hf_token)
    model = AutoModelForCausalLM.from_pretrained(
        model_name,
        quantization_config=bnb_config,
        device_map="auto",
        trust_remote_code=True,
        torch_dtype=torch.bfloat16,
        token=hf_token,
    )
    model.eval()

    results = {"model": model_name, "tag": tag, "timestamp": datetime.now().isoformat(), "results": {}}

    for category, prompts in ALL_PROMPTS.items():
        system = (
            "You are an expert software engineer." if category == "coding"
            else "You are an expert meeting assistant."
        )
        results["results"][category] = []
        print(f"\n--- {category.upper()} prompts ---")
        for i, prompt in enumerate(prompts):
            print(f"  Prompt {i+1}/{len(prompts)}...", end=" ", flush=True)
            response, latency = run_inference(model, tokenizer, prompt, system)
            results["results"][category].append({
                "prompt": prompt,
                "response": response,
                "latency_sec": latency,
            })
            print(f"done ({latency}s)")

    out_file = OUT_DIR / f"{tag}.json"
    with open(out_file, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved to {out_file}")

    del model
    torch.cuda.empty_cache()


def compare_results():
    files = list(OUT_DIR.glob("*.json"))
    if len(files) < 2:
        print("Need at least 2 result files to compare.")
        return

    all_results = {}
    for f in files:
        with open(f) as fp:
            data = json.load(fp)
        all_results[data["tag"]] = data

    tags = list(all_results.keys())
    categories = list(ALL_PROMPTS.keys())

    print(f"\n{'='*70}")
    print("MODEL COMPARISON RESULTS")
    print(f"{'='*70}")

    for category in categories:
        print(f"\n## {category.upper()} PROMPTS\n")
        num_prompts = len(ALL_PROMPTS[category])
        for i in range(num_prompts):
            print(f"Prompt {i+1}: {ALL_PROMPTS[category][i][:80]}...")
            for tag in tags:
                if category in all_results[tag]["results"]:
                    entry = all_results[tag]["results"][category][i]
                    print(f"\n  [{tag}] ({entry['latency_sec']}s):")
                    print(f"  {entry['response'][:300]}...")
            print("-" * 70)

    # Save comparison report
    report_path = OUT_DIR / "comparison_report.json"
    with open(report_path, "w") as f:
        json.dump({"tags": tags, "results": all_results}, f, indent=2)
    print(f"\nFull report saved: {report_path}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", help="HuggingFace model ID to test")
    parser.add_argument("--tag", help="Label for this run (e.g. baseline, finetuned_coding)")
    parser.add_argument("--compare", action="store_true", help="Compare all saved results")
    args = parser.parse_args()

    if args.compare:
        compare_results()
    elif args.model and args.tag:
        run_evaluation(args.model, args.tag)
    else:
        print("Usage:")
        print("  python test_prompts.py --model Qwen/Qwen2.5-32B-Instruct --tag baseline")
        print("  python test_prompts.py --model thejesraj/wos-coding-32b --tag finetuned_coding")
        print("  python test_prompts.py --compare")


if __name__ == "__main__":
    main()
