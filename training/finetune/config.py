"""Shared training configuration for all 3 WOS fine-tuned models."""

BASE_MODEL = "Qwen/Qwen2.5-32B-Instruct"
HF_USERNAME = "thejesraj"

MODEL_CONFIGS = {
    "main": {
        "model_id": f"{HF_USERNAME}/wos-main-32b",
        "dataset_path": "../datasets/main/processed",
        "system_prompt": (
            "You are WOS Main, a highly capable general-purpose AI assistant. "
            "You reason carefully, follow instructions precisely, and provide accurate, "
            "helpful responses across all domains."
        ),
        "max_samples": 20_000,
        "num_train_epochs": 1,
        "learning_rate": 2e-4,
    },
    "meeting": {
        "model_id": f"{HF_USERNAME}/wos-meeting-32b",
        "dataset_path": "../datasets/meeting/processed",
        "system_prompt": (
            "You are WOS Meeting, an expert meeting intelligence assistant. "
            "You excel at summarizing meeting transcripts, extracting action items, "
            "identifying decisions, answering questions about meeting content, "
            "and creating structured meeting notes."
        ),
        "max_samples": 6_000,
        "num_train_epochs": 1,
        "learning_rate": 1e-4,
    },
    "coding": {
        "model_id": f"{HF_USERNAME}/wos-coding-32b",
        "dataset_path": "../datasets/coding/processed",
        "system_prompt": (
            "You are WOS Coding, an expert software engineer assistant. "
            "You write clean, correct, well-documented code, explain complex concepts clearly, "
            "debug issues systematically, and follow best practices across all languages."
        ),
        "max_samples": 6_000,
        "num_train_epochs": 1,
        "learning_rate": 2e-4,
    },
}

# QLoRA hyperparameters (shared)
LORA_CONFIG = {
    "r": 16,
    "lora_alpha": 16,
    "lora_dropout": 0.0,
    "bias": "none",
    "target_modules": [
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj",
    ],
}

TRAINING_ARGS = {
    "per_device_train_batch_size": 2,
    "gradient_accumulation_steps": 8,   # effective batch = 16
    "warmup_ratio": 0.03,
    "weight_decay": 0.01,
    "lr_scheduler_type": "cosine",
    "fp16": False,
    "bf16": True,                        # A100 supports bf16
    "optim": "adamw_8bit",
    "seed": 42,
    "max_seq_length": 2048,
    "logging_steps": 25,
    "save_steps": 200,
    "save_total_limit": 2,
    "output_dir": "./checkpoints",
}

# AWS S3 bucket for storing datasets and model weights
AWS_S3_BUCKET = "wos-capstone-models"
AWS_REGION = "us-east-1"
