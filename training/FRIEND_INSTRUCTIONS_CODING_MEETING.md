# WOS Coding & Meeting Model Training Instructions
### Train: `thejesraj/wos-coding-32b` and `thejesraj/wos-meeting-32b` on RunPod A100

Hey! Follow these steps to train the Coding and Meeting models for our Capstone project.
No prior ML experience needed — just follow step by step.

---

## IMPORTANT — About the Datasets

**You do NOT need Thejes to send you any dataset files.**
The datasets download automatically from public HuggingFace datasets when you run the download script.
Just run the script and wait ~10 minutes. That's it.

---

## STEP 1 — Create Accounts (15 min)

### RunPod (GPU cloud — where training runs)
1. Go to **runpod.io** → Sign up
2. Go to **Billing** → Add credit card → Add **$20** credits
3. Go to **Settings** → **SSH Public Keys** → Add SSH Key
   - On your Mac terminal run: `cat ~/.ssh/id_rsa.pub`
   - If error: run `ssh-keygen -t rsa -b 4096` first (press Enter for all prompts)
   - Then run `cat ~/.ssh/id_rsa.pub` and paste the output → name it `mypc`

### HuggingFace (where model gets saved)
1. Go to **huggingface.co** → Sign up
2. Go to **Settings → Access Tokens → New Token**
3. Name: `wos-training`, check **Read** and **Write** under Repositories
4. Click **Create** → copy the token, save it somewhere

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

---

## STEP 4 — Upload Training Files

Ask Thejes to send you the repo link. Then from your **Mac terminal** run:

```bash
scp -P <PORT> -i ~/.ssh/id_rsa -r /path/to/WOS/training root@<POD_IP>:/workspace/
```

Replace `<PORT>` and `<POD_IP>` from RunPod → Connect tab → SSH over TCP section.

Example: `ssh root@154.54.102.37 -p 14100` → IP is `154.54.102.37`, port is `14100`

---

## STEP 5 — Set Your HuggingFace Token

```bash
export HF_TOKEN=paste_your_token_here
```

---

## ============================================================
## TO TRAIN THE CODING MODEL
## ============================================================

### Download dataset (~10 min):
```bash
cd /workspace/training && python datasets/coding/download.py
```

### Start training (~2-4 hrs):
```bash
nohup python finetune/train.py --model coding --with-tools > coding.log 2>&1 & echo "PID: $!"
```

### Monitor progress:
```bash
tail -f /workspace/training/coding.log
```

### When done you will see:
```
WOS-CODING COMPLETE!
  HuggingFace: huggingface.co/thejesraj/wos-coding-32b
```

Screenshot the final output and send to Thejes.

---

## ============================================================
## TO TRAIN THE MEETING MODEL
## ============================================================

### Download dataset (~5 min):
```bash
cd /workspace/training && python datasets/meeting/download.py
```

### Start training (~1-2 hrs):
```bash
nohup python finetune/train.py --model meeting --with-tools > meeting.log 2>&1 & echo "PID: $!"
```

### Monitor progress:
```bash
tail -f /workspace/training/meeting.log
```

### When done you will see:
```
WOS-MEETING COMPLETE!
  HuggingFace: huggingface.co/thejesraj/wos-meeting-32b
```

Screenshot the final output and send to Thejes.

---

## STEP 6 — Stop the Instance

**As soon as training finishes → go to RunPod → Stop the pod immediately** to stop being charged.

---

## If Something Goes Wrong

- **Out of memory error** → restart pod, run same commands again
- **Any pip error** → copy the error and send to Thejes
- **Training stuck at 0%** → wait 10 min, it's loading the model
- **Connection closed** → reopen the web terminal, training is still running in background, check with `tail -f /workspace/training/coding.log`

**Contact Thejes if you get stuck at any step.**

---

## Summary of Commands

```bash
# Install deps
pip install torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cu124
pip install transformers==4.46.3 trl==0.12.2 peft bitsandbytes accelerate datasets huggingface_hub boto3 awscli

# Set token
export HF_TOKEN=your_token_here

# For CODING:
cd /workspace/training && python datasets/coding/download.py
python datasets/toolcalling/download.py
nohup python finetune/train.py --model coding --with-tools > coding.log 2>&1 & echo "PID: $!"
tail -f /workspace/training/coding.log

# For MEETING:
cd /workspace/training && python datasets/meeting/download.py
python datasets/toolcalling/download.py
nohup python finetune/train.py --model meeting --with-tools > meeting.log 2>&1 & echo "PID: $!"
tail -f /workspace/training/meeting.log
```
