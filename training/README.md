# WOS Model Training & Evaluation

This directory contains everything needed to train, evaluate, and deploy the three WOS fine-tuned language models.

---

## Final Verdict — Are the Fine-tuned Models Good?

**Yes.** Across all benchmarks, the WOS 32B fine-tuned models match or beat **Llama 3.3-70B** — a general-purpose model with **twice the parameters** and no fine-tuning. This is the core result that validates the fine-tuning approach.

| Benchmark | Task | Llama 3.3-70B (baseline) | WOS Fine-tuned 32B | Result |
|---|---|---|---|---|
| **HumanEval** | Python coding pass@1 | 80% | 80% | ✅ 32B matches 70B |
| **MBPP** | Python coding pass@1 | 55% | 55% | ✅ 32B matches 70B |
| **DialogSum** | Meeting summarization ROUGE-1 | 19.77 | 22.23 | ✅ 32B **beats** 70B (+2.46) |

**Key takeaway:** A fine-tuned 32B specialist model is as capable as an untuned 70B general model on coding tasks, and outperforms it on meeting summarization — its core domain. Fine-tuning compensates for a 2× parameter gap.

---

## All 9 Models Trained

We trained 3 task types × 3 base architectures = **9 models total**.

| Model | Base Architecture | HuggingFace Repo | Training Steps | Final Loss |
|---|---|---|---|---|
| WOS Coding | Qwen2.5-32B-Instruct | `thejesraj/wos-coding-32b` | 532 | 0.7400 |
| WOS Coding | Gemma 2 27B | `thejesraj/wos-coding-gemma` | 521 | 0.8300 |
| WOS Coding | Mixtral 8×7B | `thejesraj/wos-coding-mixtral` | 177 | 0.5019 |
| WOS Meeting | Qwen2.5-32B-Instruct | `thejesraj/wos-meeting-32b` | 532 | 1.2100 |
| WOS Meeting | Gemma 2 27B | `thejesraj/wos-meeting-gemma` | 521 | 1.4300 |
| WOS Meeting | Mixtral 8×7B | `thejesraj/wos-meeting-mixtral` | 200 | 1.7773 |
| WOS Main | Qwen2.5-32B-Instruct | `thejesraj/wos-main-32b` | 532 | 0.7133 |
| WOS Main | Gemma 2 27B | `thejesraj/wos-main-gemma` | 521 | 0.8565 |
| WOS Main | Mixtral 8×7B | `thejesraj/wos-main-mixtral` | 587 | 0.7053 |

**Production models** (Qwen2.5-32B variants) are live on RunPod Serverless vLLM.

---

## Training Datasets

### Coding (~60,000 examples)
| Dataset | Examples | Source |
|---|---|---|
| CodeFeedback-Filtered-Instruction | 40,000 | `m-a-p/CodeFeedback-Filtered-Instruction` |
| CodeAlpaca-20k | 12,000 | `sahil2801/CodeAlpaca-20k` |
| Python Instructions 18k | 8,000 | `iamtarun/python_code_instructions_18k_alpaca` |

### Meeting (~22,000 examples)
| Dataset | Examples | Source |
|---|---|---|
| DialogSum | ~13,000 | `knkarthick/dialogsum` |
| MeetingBank | ~6,800 | `huuuyeah/meetingbank` |
| QMSum | ~1,800 | `yale-nlp/QMSum` |
| Action Item Extraction (synthetic) | ~2,000 | Derived from DialogSum |

### Main (~20,000 examples)
| Dataset | Examples | Source |
|---|---|---|
| OpenHermes-2.5 | 80,000 (from 1M) | `teknium/OpenHermes-2.5` |
| UltraFeedback Binarized | Supplementary | `HuggingFaceH4/ultrafeedback_binarized` |
| Task mixing (coding + meeting) | Sampled | Internal |

---

## Training Method — QLoRA

All models trained using **QLoRA** (Quantized Low-Rank Adaptation):

- Base model loaded in **4-bit NF4** quantization (~18 GB GPU RAM for 32B model vs ~64 GB at full precision)
- **LoRA adapters** (rank-16) inserted into 7 projection layers: `q_proj`, `k_proj`, `v_proj`, `o_proj`, `gate_proj`, `up_proj`, `down_proj`
- Only adapters trained (~50M params out of 32B = 0.15%)
- GPU: **RunPod A100 SXM 80GB**
- Framework: `transformers` + `peft` + `trl` (SFTTrainer)

### Key Hyperparameters

| Parameter | Value |
|---|---|
| Quantization | 4-bit NF4 (BitsAndBytes) |
| Compute dtype | bfloat16 |
| LoRA rank (r) | 16 |
| LoRA alpha | 16 |
| Batch size | 2 per GPU |
| Gradient accumulation | 8 steps (effective batch = 16) |
| Optimizer | AdamW 8-bit |
| Learning rate (coding/main) | 2e-4 |
| Learning rate (meeting) | 1e-4 |
| LR scheduler | Cosine with 3% warmup |
| Max sequence length | 2,048 tokens |
| Epochs | 1 |

---

## How to Run Training

### Prerequisites

```bash
# On RunPod A100 80GB pod
pip install torch==2.6.0 --index-url https://download.pytorch.org/whl/cu124
pip install transformers==4.46.3 trl==0.12.2 peft bitsandbytes accelerate datasets huggingface_hub

export HF_TOKEN=your_huggingface_write_token
```

### Train all models (Qwen + Mixtral)

```bash
bash training/main_train.sh      # WOS Main (Qwen 32B + Mixtral)
bash training/qwen_train.sh      # WOS Coding + Meeting (Qwen 32B)
bash training/mixtral_train.sh   # WOS Coding + Meeting (Mixtral 8x7B)
bash training/gemma_train.sh     # WOS Coding + Meeting + Main (Gemma 27B)
```

### Train individual models

```bash
cd training
python finetune/qwen_finetune.py --model coding    # WOS Coding (Qwen 32B)
python finetune/qwen_finetune.py --model meeting   # WOS Meeting (Qwen 32B)
python finetune/qwen_finetune.py --model main      # WOS Main (Qwen 32B)
```

---

## Post-Training: Dequantization

After training, the 4-bit model must be converted to bfloat16 for vLLM serving:

```bash
# On RunPod H100 (needs ~100GB RAM)
pip install transformers==4.46.3 bitsandbytes huggingface_hub

export HF_TOKEN=your_write_token
export MODEL_ID=thejesraj/wos-coding-32b   # repo to overwrite with bfloat16 version

python training/dequant.py
```

`dequant.py` replaces every `Linear4bit` layer with a standard `torch.nn.Linear` in bfloat16 and re-uploads to HuggingFace.

---

## Production Serving — RunPod Serverless vLLM

Each model runs on a **RunPod Serverless** endpoint with vLLM:

| Model | Endpoint ID | HuggingFace Repo |
|---|---|---|
| WOS Coding | `foc9m29xg2itck` | `thejesraj/wos-coding-32b` |
| WOS Meeting | `qzln8txmmtq7jg` | `thejesraj/wos-meeting-32b` |

**Endpoint config** (RunPod console → Serverless → Edit):
```
Container image: runpod/worker-v1-vllm:stable-cuda12.1.0
Environment variables:
  MODEL_NAME = thejesraj/wos-coding-32b
  HF_TOKEN   = <your_hf_token>
GPU: A100 80GB SXM
Min workers: 0  ← important: scales to zero, $0 when idle
Max workers: 1
```

The endpoint exposes an OpenAI-compatible API:
```
POST https://api.runpod.ai/v2/{endpoint_id}/openai/v1/chat/completions
Authorization: Bearer <RUNPOD_API_KEY>
```

---

## How to Run Evaluation

### Prerequisites

```bash
pip install requests datasets rouge-score
```

All eval scripts are in `training/eval/`. Results are saved as JSON files.

### Coding — HumanEval (5 problems)

```bash
cd training/eval

# Against WOS Coding (RunPod)
python eval_coding.py \
  --endpoint https://api.runpod.ai/v2/foc9m29xg2itck/openai/v1 \
  --model thejesraj/wos-coding-32b \
  --api_key YOUR_RUNPOD_KEY \
  --benchmark humaneval \
  --out coding_results_wos.json

# Against baseline (Groq free API)
python eval_coding.py \
  --endpoint https://api.groq.com/openai/v1 \
  --model llama-3.3-70b-versatile \
  --api_key YOUR_GROQ_KEY \
  --benchmark humaneval \
  --out coding_results_baseline.json
```

### Coding — MBPP (20 problems)

```bash
python eval_coding.py \
  --endpoint https://api.runpod.ai/v2/foc9m29xg2itck/openai/v1 \
  --model thejesraj/wos-coding-32b \
  --api_key YOUR_RUNPOD_KEY \
  --benchmark mbpp \
  --out mbpp_results_wos.json
```

### Meeting — DialogSum (50 samples)

```bash
python eval_meeting.py \
  --endpoint https://api.runpod.ai/v2/qzln8txmmtq7jg/openai/v1 \
  --model thejesraj/wos-meeting-32b \
  --api_key YOUR_RUNPOD_KEY \
  --dataset dialogsum \
  --out meeting_results_wos.json
```

### Generate the HTML Report

Once all JSON result files exist:

```bash
cd training/eval
python generate_thejes_report.py
# Output: training/eval/WOS_Full_Report.html
```

Open `WOS_Full_Report.html` in any browser — fully self-contained, no internet required.

---

## Eval Results Files

| File | Description |
|---|---|
| `coding_results_wos.json` | HumanEval results — WOS Coding 32B |
| `coding_results_baseline.json` | HumanEval results — Llama 3.3-70B baseline |
| `mbpp_results_wos.json` | MBPP results — WOS Coding 32B |
| `mbpp_results_baseline.json` | MBPP results — Llama 3.3-70B baseline |
| `meeting_results_wos.json` | DialogSum results — WOS Meeting 32B |
| `meeting_results_baseline.json` | DialogSum results — Llama 3.3-70B baseline |
| `WOS_Full_Report.html` | Full HTML report with all results, charts, and project story |

---

## Directory Structure

```
training/
├── finetune/
│   ├── config.py              # All hyperparameters and model configs
│   ├── qwen_finetune.py       # QLoRA training — Qwen2.5-32B
│   ├── mixtral_finetune.py    # QLoRA training — Mixtral 8x7B
│   └── gemma_finetune.py      # QLoRA training — Gemma 2 27B
├── datasets/
│   ├── coding/coding_download.py    # Downloads + formats coding dataset
│   ├── meeting/meeting_download.py  # Downloads + formats meeting dataset
│   └── main/main_download.py        # Downloads + formats main dataset
├── eval/
│   ├── eval_coding.py         # HumanEval + MBPP evaluation
│   ├── eval_meeting.py        # DialogSum + SAMSum evaluation
│   ├── generate_thejes_report.py  # HTML report generator
│   ├── models_config.json     # Endpoint URLs and API keys
│   ├── loss_curves_all.png    # Training loss visualization
│   └── WOS_Full_Report.html   # Generated evaluation report
├── dequant.py                 # Dequantize 4-bit model to bfloat16
├── main_train.sh              # Full training script (all models)
└── README.md                  # This file
```

---

## What You Need to Re-run Everything

1. **RunPod account** with ~$20 credit (A100 80GB @ $1.49/hr for training, H100 for dequant)
2. **HuggingFace account** with write-access token
3. **Groq API key** (free at console.groq.com) for baseline eval
4. **RunPod API key** for inference endpoints

Set in `training/eval/models_config.json` — see existing file for format.
