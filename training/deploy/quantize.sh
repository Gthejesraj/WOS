#!/bin/bash
# Quantize merged model to GGUF Q4_K_M for efficient inference on HuggingFace Spaces.
# Run this on the Lambda Labs instance after training.
#
# Usage: ./quantize.sh <model_name>
# Example: ./quantize.sh coding

set -e

MODEL=$1
if [ -z "$MODEL" ]; then
  echo "Usage: ./quantize.sh <model_name>  (main | meeting | coding)"
  exit 1
fi

MERGED_PATH="./checkpoints/wos-${MODEL}/merged"
GGUF_PATH="./checkpoints/wos-${MODEL}/gguf"

echo "Quantizing WOS-${MODEL} model to GGUF Q4_K_M..."

# Install llama.cpp if not present
if [ ! -f "./llama.cpp/quantize" ]; then
  echo "Building llama.cpp..."
  git clone https://github.com/ggerganov/llama.cpp
  cd llama.cpp
  make -j$(nproc) LLAMA_CUDA=1
  cd ..
fi

mkdir -p "$GGUF_PATH"

# Convert safetensors → GGUF F16 first
echo "Step 1: Converting to GGUF F16..."
python llama.cpp/convert_hf_to_gguf.py \
  "$MERGED_PATH" \
  --outfile "$GGUF_PATH/wos-${MODEL}-f16.gguf" \
  --outtype f16

# Quantize F16 → Q4_K_M (~20GB for 32B)
echo "Step 2: Quantizing F16 → Q4_K_M..."
./llama.cpp/quantize \
  "$GGUF_PATH/wos-${MODEL}-f16.gguf" \
  "$GGUF_PATH/wos-${MODEL}-Q4_K_M.gguf" \
  Q4_K_M

echo ""
echo "Done! GGUF file: $GGUF_PATH/wos-${MODEL}-Q4_K_M.gguf"
ls -lh "$GGUF_PATH/"

# Upload to S3
echo ""
echo "Uploading to S3..."
aws s3 cp "$GGUF_PATH/wos-${MODEL}-Q4_K_M.gguf" \
  "s3://wos-capstone-models/gguf/wos-${MODEL}-Q4_K_M.gguf" \
  --region us-east-1

echo "Upload complete: s3://wos-capstone-models/gguf/wos-${MODEL}-Q4_K_M.gguf"
