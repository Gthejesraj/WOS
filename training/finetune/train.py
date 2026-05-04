"""QLoRA fine-tuning — coding and meeting models.

Usage:
  python train.py --model coding
  python train.py --model meeting
"""

import argparse
import os
import json
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).parent))
from config import BASE_MODEL, MODEL_CONFIGS, LORA_CONFIG, AWS_S3_BUCKET


def load_jsonl(path: str):
    from datasets import Dataset
    records = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return Dataset.from_list(records)


def format_sample(example, tokenizer):
    convs = example["conversations"]
    messages = []
    role_map = {"system": "system", "human": "user", "gpt": "assistant"}
    if isinstance(convs, dict):
        for f, v in zip(convs["from"], convs["value"]):
            messages.append({"role": role_map.get(f, f), "content": v})
    else:
        for turn in convs:
            messages.append({"role": role_map.get(turn["from"], turn["from"]), "content": turn["value"]})
    return {"text": tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", choices=["coding", "meeting", "main"], required=True)
    args = parser.parse_args()

    cfg = MODEL_CONFIGS[args.model]

    print(f"\n{'='*60}")
    print(f"Training WOS-{args.model.upper()} model")
    print(f"Base:    {BASE_MODEL}")
    print(f"Target:  {cfg['model_id']}")
    print(f"PyTorch: {torch.__version__}")
    print(f"GPU:     {torch.cuda.get_device_name(0)}")
    print(f"{'='*60}\n")

    # HF login
    hf_token = os.environ.get("HF_TOKEN")
    if hf_token:
        from huggingface_hub import login
        login(token=hf_token)
        print("HuggingFace: logged in")
    else:
        print("WARNING: HF_TOKEN not set. Run: export HF_TOKEN=your_token")

    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        BitsAndBytesConfig,
        TrainingArguments,
    )
    from peft import LoraConfig, get_peft_model, TaskType, prepare_model_for_kbit_training
    from trl import SFTTrainer

    # 4-bit quantization
    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_use_double_quant=True,
    )

    # Tokenizer
    print("Loading tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = "right"

    # Model in 4-bit
    print("Loading model in 4-bit (takes ~10 min for 32B)...")
    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        quantization_config=bnb_config,
        device_map="auto",
        trust_remote_code=True,
        torch_dtype=torch.bfloat16,
    )
    model.config.use_cache = False
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    model.enable_input_require_grads()

    # LoRA
    lora_config = LoraConfig(
        r=LORA_CONFIG["r"],
        lora_alpha=LORA_CONFIG["lora_alpha"],
        target_modules=LORA_CONFIG["target_modules"],
        lora_dropout=LORA_CONFIG["lora_dropout"],
        bias=LORA_CONFIG["bias"],
        task_type=TaskType.CAUSAL_LM,
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    # Dataset
    dataset_dir = Path(__file__).parent.parent / "datasets" / args.model / "processed"
    train_dataset = load_jsonl(str(dataset_dir / "train_split.jsonl"))
    eval_dataset  = load_jsonl(str(dataset_dir / "eval_split.jsonl"))

    if cfg.get("max_samples") and len(train_dataset) > cfg["max_samples"]:
        train_dataset = train_dataset.select(range(cfg["max_samples"]))

    print(f"Formatting {len(train_dataset)} train + {len(eval_dataset)} eval samples...")

    def fmt(example):
        return format_sample(example, tokenizer)

    train_dataset = train_dataset.map(fmt, remove_columns=train_dataset.column_names)
    eval_dataset  = eval_dataset.map(fmt,  remove_columns=eval_dataset.column_names)
    print(f"Preview:\n{train_dataset[0]['text'][:300]}\n")

    # Training
    output_dir = f"./checkpoints/wos-{args.model}"

    training_args = TrainingArguments(
        output_dir=output_dir,
        num_train_epochs=cfg["num_train_epochs"],
        per_device_train_batch_size=4,
        gradient_accumulation_steps=4,
        warmup_ratio=0.03,
        learning_rate=cfg["learning_rate"],
        weight_decay=0.01,
        lr_scheduler_type="cosine",
        bf16=True,
        optim="paged_adamw_8bit",
        seed=42,
        logging_steps=10,
        save_steps=100,
        save_total_limit=2,
        evaluation_strategy="steps",
        eval_steps=100,
        report_to="none",
        gradient_checkpointing=True,
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=train_dataset,
        eval_dataset=eval_dataset,
        dataset_text_field="text",
        max_seq_length=1024,
        packing=True,
        args=training_args,
    )

    print("\nStarting training...")
    stats = trainer.train()
    print(f"\nDone! Time: {stats.metrics['train_runtime']:.0f}s | Loss: {stats.metrics['train_loss']:.4f}")

    # Save adapter
    adapter_path = f"{output_dir}/adapter"
    model.save_pretrained(adapter_path)
    tokenizer.save_pretrained(adapter_path)
    print(f"Adapter saved: {adapter_path}")

    # Merge LoRA into full model
    print("\nMerging LoRA into base model...")
    merged_model = model.merge_and_unload()
    merged_path = f"{output_dir}/merged"
    print(f"Saving full model to {merged_path} (takes ~10 min)...")
    merged_model.save_pretrained(merged_path, safe_serialization=True, max_shard_size="4GB")
    tokenizer.save_pretrained(merged_path)
    print(f"Full model saved!")

    # Push full model to HuggingFace
    if hf_token:
        print(f"\nPushing full model to HuggingFace: {cfg['model_id']}")
        print("This takes 20-40 min for 32B...")
        merged_model.push_to_hub(cfg["model_id"], private=False, max_shard_size="4GB")
        tokenizer.push_to_hub(cfg["model_id"], private=False)
        print(f"Done! Model live at: huggingface.co/{cfg['model_id']}")

    # Upload to S3
    print("\nUploading to S3...")
    os.system(
        f"aws s3 sync {merged_path} "
        f"s3://{AWS_S3_BUCKET}/models/wos-{args.model}/merged/ --region us-east-1"
    )

    print(f"\n{'='*60}")
    print(f"WOS-{args.model.upper()} COMPLETE!")
    print(f"  Full model:  {merged_path}")
    print(f"  HuggingFace: huggingface.co/{cfg['model_id']}")
    print(f"  S3:          s3://{AWS_S3_BUCKET}/models/wos-{args.model}/")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
