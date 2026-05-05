# WOS Main Model Training — Instructions
### Train: `thejesraj/wos-main-32b` on RunPod A100

Hey! Follow these steps exactly to train the Main model for our Capstone project.
No prior ML experience needed — just follow step by step.

---

## What You're Doing
You are fine-tuning a 32B AI model (Qwen2.5-32B) to be a better general assistant.
Training runs on a cloud GPU. Takes about **2-4 hours**. Costs about **$5-8**.

---

## STEP 1 — Create Accounts (15 min)

### RunPod (GPU cloud — where training runs)
1. Go to **runpod.io** → Sign up
2. Go to **Billing** → Add credit card → Add **$20** credits
3. Go to **Settings** → **SSH Public Keys** → Add SSH Key
   - On your Mac/PC terminal run: `cat ~/.ssh/id_rsa.pub`
   - If error: run `ssh-keygen -t rsa -b 4096` first (press Enter for all prompts)
   - Then run `cat ~/.ssh/id_rsa.pub` and paste the output → name it `mypc`

### HuggingFace (where model gets saved)
1. Go to **huggingface.co** → Sign up with your email
2. Pick any username
3. Go to **Settings → Access Tokens → New Token**
4. Name: `wos-training`, check **Read** and **Write** under Repositories
5. Click **Create** → copy the token, save it somewhere

---

## STEP 2 — Launch GPU Instance

1. Go to RunPod → **Pods** → **+ New Pod**
2. Select **A100 SXM 80GB** ($1.49/hr) — if unavailable pick **A100 PCIe 80GB**
3. Template: **RunPod PyTorch 2.4.0** (default)
4. GPU count: **1**
5. Storage: set Container Disk to **200 GB**
6. Check **SSH terminal access**
7. Click **Deploy On-Demand**
8. Wait 2-3 minutes → click **Connect** → enable **Web Terminal**

---

## STEP 3 — Install Dependencies

In the **RunPod web terminal**, run these **one at a time**:

```bash
pip install torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124
```
Wait for it to finish, then:
```bash
pip install transformers==4.46.3 trl==0.12.2 peft bitsandbytes accelerate datasets huggingface_hub boto3 awscli
```
Wait for it to finish.

---

## STEP 4 — Update Your HuggingFace Username

Before uploading, open `training/finetune/config.py` on your computer and change line 4:

```python
HF_USERNAME = "your_huggingface_username"   # replace with YOUR username
```

Save the file. This makes the model push to YOUR HuggingFace account.

---

## STEP 4 — Upload Training Files

**Ask Thejes to send you the `training` folder** (zip it and send via Drive/WhatsApp).

Once you have it, unzip it and from your **Mac/PC terminal** run:

```bash
scp -P <PORT> -i ~/.ssh/id_rsa -r /path/to/training root@<POD_IP>:/workspace/
```

Replace `<PORT>` and `<POD_IP>` with the values from RunPod → Connect tab → SSH over TCP section.

Example: `ssh root@154.54.102.37 -p 14100` → IP is `154.54.102.37`, port is `14100`

---

## STEP 5 — Download the Dataset

The Main model is trained on these 2 public datasets from HuggingFace:
- **OpenHermes-2.5** — huggingface.co/datasets/teknium/OpenHermes-2.5 (general instruction following, 1M samples)
- **UltraFeedback** — huggingface.co/datasets/HuggingFaceH4/ultrafeedback_binarized (preference-ranked responses)

The download script handles everything automatically. In **RunPod web terminal**:

```bash
cd /workspace/training && python datasets/main/download.py
```

Takes 20-30 minutes. Wait for it to finish.

---

## STEP 6 — Set Your HuggingFace Token

In **RunPod web terminal**, paste your own token from Step 1:

```bash
export HF_TOKEN=paste_your_own_token_here
```

---

## STEP 7 — Start Training

In **RunPod web terminal**:

```bash
cd /workspace/training && python datasets/toolcalling/download.py
```
Wait for it to finish (5 min). Then:

```bash
nohup python finetune/train.py --model main --with-tools > main.log 2>&1 & echo "PID: $!"
```

Monitor:
```bash
tail -f /workspace/training/main.log
```

You will see:
- Model downloading (first 10 min)
- `trainable params: 134,217,728` — good, training starting
- Loss numbers every 10 steps — this is normal

**Expected time: 2-4 hours**

---

## STEP 8 — When Training Finishes

You will see:
```
WOS-MAIN training complete!
  Full model: ./checkpoints/wos-main/merged
  HF Hub: thejesraj/wos-main-32b
```

The model is automatically pushed to HuggingFace. 

**Screenshot the final output and send to Thejes.**

Then go to RunPod → your pod → **Stop** the instance immediately to stop being charged.

---

## If Something Goes Wrong

- **Out of memory error** → restart pod, run same commands again
- **Any pip error** → copy the error and send to Thejes
- **Training stuck at 0%** → wait 10 min, it's loading the model

**Contact Thejes if you get stuck at any step.**

---

## Summary of Commands (in order)

```bash
# 1. Install dependencies
pip install torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124
pip install transformers==4.46.3 trl==0.12.2 peft bitsandbytes accelerate datasets huggingface_hub boto3 awscli

# 2. Download dataset
cd /workspace/training && python datasets/main/download.py

# 3. Set HF token
export HF_TOKEN=paste_token_here

# 4. Download tool-calling data
cd /workspace/training && python datasets/toolcalling/download.py

# 5. Train (runs in background, safe to close terminal)
nohup python finetune/train.py --model main --with-tools > main.log 2>&1 & echo "PID: $!"
tail -f /workspace/training/main.log
```

That's it!
