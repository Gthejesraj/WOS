#!/bin/bash
# WOS Mixtral Training — Mixtral 8x7B Instruct v0.1
# Run on RunPod H100 80GB (150GB volume disk)
# Usage: bash mixtral_train.sh
LOG=/workspace/mixtral_train.log
echo "=== WOS Mixtral Training $(date) ===" | tee -a $LOG

cd /workspace/WOS && git pull 2>&1 | tee -a $LOG

export HF_HOME=/workspace/hf_cache
export TMPDIR=/workspace/tmp
mkdir -p /workspace/tmp
cd /workspace/WOS/training

# Train + upload coding mixtral
echo "[1/4] Training coding mixtral..." | tee -a $LOG
python finetune/mixtral_finetune.py --model coding 2>&1 | tee -a $LOG
echo "[2/4] Uploading coding mixtral..." | tee -a $LOG
huggingface-cli upload thejesraj/wos-coding-mixtral checkpoints/wos-coding-mixtral/merged --repo-type model 2>&1 | tee -a $LOG
rm -rf checkpoints/wos-coding-mixtral/merged

# Train + upload meeting mixtral
echo "[3/4] Training meeting mixtral..." | tee -a $LOG
python finetune/mixtral_finetune.py --model meeting 2>&1 | tee -a $LOG
echo "[4/4] Uploading meeting mixtral..." | tee -a $LOG
huggingface-cli upload thejesraj/wos-meeting-mixtral checkpoints/wos-meeting-mixtral/merged --repo-type model 2>&1 | tee -a $LOG

echo "=== ALL DONE $(date) ===" | tee -a $LOG
echo "huggingface.co/thejesraj/wos-coding-mixtral" | tee -a $LOG
echo "huggingface.co/thejesraj/wos-meeting-mixtral" | tee -a $LOG
