#!/bin/bash
LOG=/workspace/gemma_auto.log
echo "=== WOS Gemma Auto-Training $(date) ===" | tee -a $LOG

# Free space
echo "[cleanup] Freeing disk..." | tee -a $LOG
rm -rf /workspace/hf_cache/hub/models--mistralai*
rm -rf /workspace/WOS/training/checkpoints/wos-coding-mixtral/merged
rm -rf /workspace/WOS/training/checkpoints/wos-meeting-mixtral/merged
df -h /workspace | tee -a $LOG

export HF_HOME=/workspace/hf_cache
export TMPDIR=/workspace/tmp
mkdir -p /workspace/tmp
cd /workspace/WOS/training

# Train + upload coding gemma
echo "[1/4] Training coding gemma..." | tee -a $LOG
python finetune/train.py --model coding --base gemma 2>&1 | tee -a $LOG
echo "[2/4] Uploading coding gemma..." | tee -a $LOG
huggingface-cli upload thejesraj/wos-coding-gemma checkpoints/wos-coding-gemma/merged --repo-type model 2>&1 | tee -a $LOG
rm -rf checkpoints/wos-coding-gemma/merged

# Train + upload meeting gemma
echo "[3/4] Training meeting gemma..." | tee -a $LOG
python finetune/train.py --model meeting --base gemma 2>&1 | tee -a $LOG
echo "[4/4] Uploading meeting gemma..." | tee -a $LOG
huggingface-cli upload thejesraj/wos-meeting-gemma checkpoints/wos-meeting-gemma/merged --repo-type model 2>&1 | tee -a $LOG

echo "=== ALL DONE $(date) ===" | tee -a $LOG
echo "huggingface.co/thejesraj/wos-coding-gemma" | tee -a $LOG
echo "huggingface.co/thejesraj/wos-meeting-gemma" | tee -a $LOG
