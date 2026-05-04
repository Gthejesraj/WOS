#!/bin/bash
# AWS S3 setup for WOS Capstone — stores datasets, model weights, and eval results.
# This gives us legitimate AWS cloud usage for the project writeup.
#
# Prerequisites:
#   aws configure  (set your AWS credentials first)
#
# Run once: ./setup_s3.sh

set -e

BUCKET="wos-capstone-models"
REGION="us-east-1"

echo "Setting up AWS S3 for WOS Capstone..."

# Create bucket
aws s3api create-bucket \
  --bucket "$BUCKET" \
  --region "$REGION" \
  2>/dev/null || echo "Bucket already exists"

# Enable versioning (keeps model checkpoints safe)
aws s3api put-bucket-versioning \
  --bucket "$BUCKET" \
  --versioning-configuration Status=Enabled

# Set lifecycle: auto-delete large temp files after 30 days
aws s3api put-bucket-lifecycle-configuration \
  --bucket "$BUCKET" \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "expire-temp",
      "Filter": {"Prefix": "temp/"},
      "Status": "Enabled",
      "Expiration": {"Days": 30}
    }]
  }'

echo ""
echo "S3 bucket created: s3://$BUCKET"
echo ""
echo "Folder structure:"
echo "  s3://$BUCKET/datasets/main/     — training data for main model"
echo "  s3://$BUCKET/datasets/meeting/  — training data for meeting model"
echo "  s3://$BUCKET/datasets/coding/   — training data for coding model"
echo "  s3://$BUCKET/models/main/       — fine-tuned adapter weights"
echo "  s3://$BUCKET/models/meeting/"
echo "  s3://$BUCKET/models/coding/"
echo "  s3://$BUCKET/gguf/              — GGUF quantized models"
echo "  s3://$BUCKET/eval/              — benchmark results"
