#!/bin/bash
# Lambda Labs A100 instance setup script.
# Run this once after SSH-ing into your instance.
#
# Instance type: 1x A100 SXM4 80GB  (~$2.49/hr at Lambda Labs)
#
# Usage:
#   ssh ubuntu@<your-lambda-ip>
#   git clone <your-repo> && cd WOS/training
#   chmod +x setup_lambda.sh && ./setup_lambda.sh

set -e

echo "Setting up Lambda Labs instance for WOS training..."
echo "CUDA: $(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null || echo 'checking...')"

# Update system
sudo apt-get update -qq
sudo apt-get install -y git-lfs awscli screen htop

# Install Python dependencies
pip install --upgrade pip
pip install "unsloth[cu124-torch230] @ git+https://github.com/unslothai/unsloth.git"
pip install trl peft bitsandbytes accelerate transformers datasets huggingface_hub
pip install evaluate rouge_score bert_score pandas tqdm requests boto3

echo ""
echo "Setting up environment variables..."
echo "Enter your HuggingFace token (from huggingface.co/settings/tokens):"
read -s HF_TOKEN
export HF_TOKEN=$HF_TOKEN
echo "export HF_TOKEN=$HF_TOKEN" >> ~/.bashrc

echo "Enter your AWS Access Key ID:"
read AWS_KEY
echo "Enter your AWS Secret Access Key:"
read -s AWS_SECRET
aws configure set aws_access_key_id $AWS_KEY
aws configure set aws_secret_access_key $AWS_SECRET
aws configure set default.region us-east-1

echo ""
echo "Verifying GPU..."
nvidia-smi
python -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}, GPU: {torch.cuda.get_device_name(0)}')"

echo ""
echo "Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Download datasets:"
echo "       python datasets/main/download.py"
echo "       python datasets/meeting/download.py"
echo "       python datasets/coding/download.py"
echo ""
echo "  2. Train models (run each in a screen session):"
echo "       screen -S main    && python finetune/train.py --model main"
echo "       screen -S meeting && python finetune/train.py --model meeting"
echo "       screen -S coding  && python finetune/train.py --model coding"
echo ""
echo "  3. Quantize after training:"
echo "       ./deploy/quantize.sh main"
echo "       ./deploy/quantize.sh meeting"
echo "       ./deploy/quantize.sh coding"
echo ""
echo "  4. Push to HuggingFace:"
echo "       HF_TOKEN=\$HF_TOKEN python deploy/push_to_hub.py --model coding"
