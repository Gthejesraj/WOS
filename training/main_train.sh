#!/bin/bash
# WOS Main Model Training — Qwen 32B + Mixtral 8x7B + Gemma 2-27B
# Run on RunPod H100 80GB (150GB volume disk)
# Usage: bash main_train.sh
LOG=/workspace/main_train.log
echo "=== WOS Main Model Training $(date) ===" | tee -a $LOG

cd /workspace/WOS && git pull 2>&1 | tee -a $LOG

export HF_HOME=/workspace/hf_cache
export TMPDIR=/workspace/tmp
mkdir -p /workspace/tmp
cd /workspace/WOS/training

# Download datasets (main + coding/meeting needed for task mixing)
echo "[setup] Downloading datasets..." | tee -a $LOG
python datasets/main/main_download.py 2>&1 | tee -a $LOG
python datasets/coding/coding_download.py 2>&1 | tee -a $LOG
python datasets/meeting/meeting_download.py 2>&1 | tee -a $LOG
df -h /workspace | tee -a $LOG

# ── Qwen 2.5-32B main ─────────────────────────────────────────────────────────
echo "[1/6] Training main qwen..." | tee -a $LOG
python finetune/qwen_finetune.py --model main 2>&1 | tee -a $LOG
echo "[2/6] Uploading main qwen..." | tee -a $LOG
huggingface-cli upload thejesraj/wos-main-32b checkpoints/wos-main-qwen/merged --repo-type model 2>&1 | tee -a $LOG
rm -rf checkpoints/wos-main-qwen/merged
rm -rf /workspace/hf_cache/hub/models--Qwen*
echo "[cleanup] Freed Qwen cache, disk now:" | tee -a $LOG
df -h /workspace | tee -a $LOG

# ── Mixtral 8x7B main ─────────────────────────────────────────────────────────
echo "[3/6] Training main mixtral..." | tee -a $LOG
python finetune/mixtral_finetune.py --model main 2>&1 | tee -a $LOG
echo "[4/6] Uploading main mixtral..." | tee -a $LOG
huggingface-cli upload thejesraj/wos-main-mixtral checkpoints/wos-main-mixtral/merged --repo-type model 2>&1 | tee -a $LOG
rm -rf checkpoints/wos-main-mixtral/merged
rm -rf /workspace/hf_cache/hub/models--mistralai*
echo "[cleanup] Freed Mixtral cache, disk now:" | tee -a $LOG
df -h /workspace | tee -a $LOG

# ── Gemma 2-27B main ──────────────────────────────────────────────────────────
echo "[5/6] Training main gemma..." | tee -a $LOG
python finetune/gemma_finetune.py --model main 2>&1 | tee -a $LOG
echo "[6/6] Uploading main gemma..." | tee -a $LOG
huggingface-cli upload thejesraj/wos-main-gemma checkpoints/wos-main-gemma/merged --repo-type model 2>&1 | tee -a $LOG
rm -rf checkpoints/wos-main-gemma/merged

echo "=== ALL DONE $(date) ===" | tee -a $LOG
echo "huggingface.co/thejesraj/wos-main-32b" | tee -a $LOG
echo "huggingface.co/thejesraj/wos-main-mixtral" | tee -a $LOG
echo "huggingface.co/thejesraj/wos-main-gemma" | tee -a $LOG
