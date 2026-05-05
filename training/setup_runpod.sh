#!/bin/bash
# WOS RunPod Setup — run this ONCE after launching a new pod
# Usage: bash setup_runpod.sh

set -e

echo "============================================================"
echo "WOS RunPod Setup"
echo "============================================================"

# Install Python packages
echo "[1/3] Installing packages..."
pip install -q torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124
pip install -q transformers==4.46.3 trl==0.12.2 peft bitsandbytes accelerate datasets huggingface_hub boto3 awscli
echo "Packages installed!"

# Clone repo
echo "[2/3] Cloning WOS repo..."
cd /workspace
if [ -d "WOS" ]; then
    echo "Repo already exists, pulling latest..."
    cd WOS && git pull && cd ..
else
    git clone https://github.com/Gthejesraj/WOS.git
fi
echo "Repo ready at /workspace/WOS"

# Verify GPU
echo "[3/3] GPU check:"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader

echo ""
echo "============================================================"
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "  export HF_TOKEN=your_token_here"
echo ""
echo "  # Then to train (example — Qwen 32B coding):"
echo "  cd /workspace/WOS/training"
echo "  python datasets/coding/download.py"
echo "  python datasets/toolcalling/download.py"
echo "  nohup python finetune/train.py --model coding > coding.log 2>&1 & echo PID: \$!"
echo "  tail -f coding.log"
echo "============================================================"
