#!/bin/bash
# Upload prepared datasets to AWS S3.
# Run after: python datasets/<model>/download.py
#
# Usage: ./upload_dataset.sh <model>
# Example: ./upload_dataset.sh coding

set -e

MODEL=$1
BUCKET="wos-capstone-models"

if [ -z "$MODEL" ]; then
  echo "Usage: ./upload_dataset.sh <model>  (main | meeting | coding)"
  exit 1
fi

LOCAL_PATH="../datasets/${MODEL}/processed/"
S3_PATH="s3://${BUCKET}/datasets/${MODEL}/"

echo "Uploading ${MODEL} dataset to S3..."
aws s3 sync "$LOCAL_PATH" "$S3_PATH" --region us-east-1

echo ""
echo "Done! Dataset available at: $S3_PATH"
aws s3 ls "$S3_PATH"
