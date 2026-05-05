#!/bin/bash
# WOS Qwen Training — Qwen 2.5-32B Instruct
# Run on RunPod H100 80GB (150GB volume disk)
# Usage: bash qwen_train.sh
LOG=/workspace/qwen_train.log
echo "=== WOS Qwen Training $(date) ===" | tee -a $LOG

cd /workspace/WOS && git pull 2>&1 | tee -a $LOG

export HF_HOME=/workspace/hf_cache
export TMPDIR=/workspace/tmp
mkdir -p /workspace/tmp
cd /workspace/WOS/training

# Train + upload coding qwen
echo "[1/6] Training coding qwen..." | tee -a $LOG
python finetune/qwen_finetune.py --model coding 2>&1 | tee -a $LOG
echo "[2/6] Uploading coding qwen..." | tee -a $LOG
huggingface-cli upload thejesraj/wos-coding-32b checkpoints/wos-coding-qwen/merged --repo-type model 2>&1 | tee -a $LOG
rm -rf checkpoints/wos-coding-qwen/merged

# Train + upload meeting qwen
echo "[3/6] Training meeting qwen..." | tee -a $LOG
python finetune/qwen_finetune.py --model meeting 2>&1 | tee -a $LOG
echo "[4/6] Uploading meeting qwen..." | tee -a $LOG
huggingface-cli upload thejesraj/wos-meeting-32b checkpoints/wos-meeting-qwen/merged --repo-type model 2>&1 | tee -a $LOG
rm -rf checkpoints/wos-meeting-qwen/merged

# Train + upload main qwen
echo "[5/6] Training main qwen..." | tee -a $LOG
python finetune/qwen_finetune.py --model main 2>&1 | tee -a $LOG
echo "[6/6] Uploading main qwen..." | tee -a $LOG
huggingface-cli upload thejesraj/wos-main-32b checkpoints/wos-main-qwen/merged --repo-type model 2>&1 | tee -a $LOG

echo "=== ALL DONE $(date) ===" | tee -a $LOG
echo "huggingface.co/thejesraj/wos-coding-32b" | tee -a $LOG
echo "huggingface.co/thejesraj/wos-meeting-32b" | tee -a $LOG
echo "huggingface.co/thejesraj/wos-main-32b" | tee -a $LOG
