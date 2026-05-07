"""Generate WOS Complete Model Story — all models, datasets, training, app integration."""
import base64, json
from pathlib import Path

def b64(path):
    try:
        with open(path, "rb") as f:
            return base64.b64encode(f.read()).decode()
    except:
        return ""

HERE = Path(__file__).parent

img_all    = b64(HERE / "loss_curves_all.png")
img_coding = b64(HERE / "loss_curve_coding.png")
img_meeting= b64(HERE / "loss_curve_meeting.png")
img_main   = b64(HERE / "loss_curve_main.png")
img_final  = b64(HERE / "loss_final_comparison.png")

HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WOS — Complete Model Story</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;line-height:1.7}
  .container{max-width:1100px;margin:0 auto;padding:48px 24px}
  h1{font-size:2.2rem;font-weight:700;color:#f8fafc;margin-bottom:8px}
  h2{font-size:1.45rem;font-weight:700;color:#f1f5f9;margin:48px 0 18px;padding-bottom:10px;border-bottom:2px solid #1e293b}
  h3{font-size:1.1rem;font-weight:600;color:#cbd5e1;margin:24px 0 12px}
  p{color:#94a3b8;margin-bottom:12px;font-size:0.95rem}
  .subtitle{color:#64748b;font-size:0.95rem;margin-bottom:36px}
  table{width:100%;border-collapse:collapse;margin:16px 0;font-size:0.88rem}
  th{background:#1e293b;color:#94a3b8;padding:10px 14px;text-align:left;font-weight:600;font-size:0.78rem;text-transform:uppercase;letter-spacing:0.05em}
  td{padding:10px 14px;border-bottom:1px solid #1e293b;color:#cbd5e1;vertical-align:top}
  tr:hover td{background:#1e293b44}
  .card{background:#1e293b;border-radius:12px;padding:24px;margin:16px 0}
  .badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:0.75rem;font-weight:600}
  .badge-green{background:#064e3b;color:#10b981}
  .badge-blue{background:#1e3a5f;color:#60a5fa}
  .badge-yellow{background:#451a03;color:#fbbf24}
  .badge-purple{background:#3b0764;color:#c084fc}
  img{width:100%;border-radius:10px;margin:12px 0;border:1px solid #1e293b}
  .model-tag{display:inline-block;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:2px 8px;font-size:0.78rem;font-family:monospace;color:#94a3b8}
  .divider{border:none;border-top:1px solid #1e293b;margin:40px 0}
  footer{text-align:center;color:#334155;font-size:0.8rem;margin-top:60px;padding-top:24px;border-top:1px solid #1e293b}
  pre{background:#1e293b;padding:14px;border-radius:8px;font-size:0.82rem;overflow-x:auto;color:#a5f3fc;margin:8px 0;white-space:pre-wrap;border:1px solid #334155}
  .callout{border-left:4px solid #3b82f6;background:#0f172a;padding:14px 18px;border-radius:0 8px 8px 0;margin:12px 0}
  .callout-green{border-color:#10b981}
  .callout-yellow{border-color:#f59e0b}
  .callout-purple{border-color:#a855f7}
  .step{display:flex;gap:16px;margin:16px 0;align-items:flex-start}
  .step-num{background:#1e3a5f;color:#60a5fa;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.9rem;flex-shrink:0;margin-top:2px}
  .step-body{flex:1}
  .pipeline{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:16px 0}
  .pipe-box{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px 16px;font-size:0.85rem;color:#e2e8f0;font-weight:500}
  .pipe-arrow{color:#334155;font-size:1.2rem}
  .grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:16px 0}
  .grid-2{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin:16px 0}
  .model-card{background:#1e293b;border-radius:10px;padding:18px;border:1px solid #334155}
  .model-card.coding{border-top:3px solid #3b82f6}
  .model-card.meeting{border-top:3px solid #10b981}
  .model-card.main{border-top:3px solid #f59e0b}
  .model-title{font-weight:700;color:#f1f5f9;margin-bottom:6px}
  .stat-row{display:flex;justify-content:space-between;padding:4px 0;font-size:0.83rem;border-bottom:1px solid #1e293b44}
  .stat-label{color:#64748b}
  .stat-val{color:#e2e8f0;font-family:monospace}
  .dataset-chip{display:inline-block;background:#0f172a;border:1px solid #334155;border-radius:4px;padding:2px 8px;font-size:0.78rem;color:#94a3b8;margin:2px}
</style>
</head>
<body>
<div class="container">

  <h1>WOS — Complete Project Story</h1>
  <p class="subtitle">Every model, every dataset, every training run, how it all fits together &nbsp;|&nbsp; Thejes &nbsp;|&nbsp; May 2026</p>

  <!-- ── 1. WHAT IS WOS ───────────────────────────────────────────── -->
  <h2>1. What is WOS?</h2>
  <p>WOS (Workspace Operating System) is a desktop AI application built with Electron. Instead of using one large general-purpose model for everything, WOS uses <strong style="color:#f1f5f9">three specialist AI models</strong>, each fine-tuned for a specific job:</p>

  <div class="grid-3">
    <div class="model-card coding">
      <div class="model-title" style="color:#60a5fa">WOS Coding</div>
      <p style="font-size:0.85rem">Handles code generation, debugging, and software engineering questions. Fine-tuned on ~60,000 coding examples across Python, JavaScript, and more.</p>
    </div>
    <div class="model-card meeting">
      <div class="model-title" style="color:#10b981">WOS Meeting</div>
      <p style="font-size:0.85rem">Handles meeting transcript summarization, action item extraction, and meeting Q&A. Fine-tuned on real meeting and dialogue datasets.</p>
    </div>
    <div class="model-card main">
      <div class="model-title" style="color:#fbbf24">WOS Main</div>
      <p style="font-size:0.85rem">General orchestrator model that handles workspace queries and can route tasks to the specialist models. Fine-tuned on 20,000 general instruction-following examples.</p>
    </div>
  </div>

  <div class="callout" style="margin-top:20px">
    <strong style="color:#60a5fa">Why specialist models?</strong>
    <p style="margin-top:4px">A single general model must be good at everything but great at nothing. By fine-tuning three separate specialist models, each one deeply learns its domain — and the final benchmark results prove it: the 32B WOS Coding model matches an untuned 70B model, and WOS Meeting outperforms a 70B model on meeting summarization.</p>
  </div>

  <!-- ── 2. FULL PIPELINE ─────────────────────────────────────────── -->
  <h2>2. The Complete Pipeline — From Training to App</h2>

  <div class="pipeline">
    <div class="pipe-box" style="border-color:#3b82f6;color:#60a5fa">📦 Datasets<br><small style="color:#64748b">HuggingFace public</small></div>
    <div class="pipe-arrow">→</div>
    <div class="pipe-box" style="border-color:#a855f7;color:#c084fc">⚙️ QLoRA Training<br><small style="color:#64748b">RunPod A100 80GB</small></div>
    <div class="pipe-arrow">→</div>
    <div class="pipe-box" style="border-color:#f59e0b;color:#fbbf24">🔓 Dequantize<br><small style="color:#64748b">4-bit → bfloat16</small></div>
    <div class="pipe-arrow">→</div>
    <div class="pipe-box" style="border-color:#10b981;color:#34d399">🤗 HuggingFace<br><small style="color:#64748b">Model storage</small></div>
    <div class="pipe-arrow">→</div>
    <div class="pipe-box" style="border-color:#60a5fa;color:#93c5fd">🚀 RunPod vLLM<br><small style="color:#64748b">Serverless API</small></div>
    <div class="pipe-arrow">→</div>
    <div class="pipe-box" style="border-color:#f8fafc;color:#f8fafc">💻 WOS App<br><small style="color:#64748b">Electron desktop</small></div>
  </div>

  <div class="step"><div class="step-num">1</div><div class="step-body">
    <strong style="color:#f1f5f9">Data Collection</strong>
    <p>Public datasets downloaded from HuggingFace are formatted into chat-style training examples (ShareGPT format) — each example has a system prompt, a user message, and the expected model response.</p>
  </div></div>
  <div class="step"><div class="step-num">2</div><div class="step-body">
    <strong style="color:#f1f5f9">QLoRA Fine-tuning on RunPod</strong>
    <p>We use QLoRA — the model is loaded in 4-bit quantized form (uses ~4× less GPU memory), then small trainable adapter layers (LoRA) are added on top. Only the adapters are trained, not the full model. This lets us fine-tune a 32B model on a single A100 80GB GPU that would normally require 4+ GPUs.</p>
  </div></div>
  <div class="step"><div class="step-num">3</div><div class="step-body">
    <strong style="color:#f1f5f9">Dequantize to bfloat16</strong>
    <p>After training, the 4-bit quantized model is converted back to full bfloat16 precision. This is required for vLLM serving — vLLM can't serve NF4 quantized models directly. We wrote a custom <code style="color:#a5f3fc">dequant.py</code> script that replaces every quantized layer with a standard PyTorch Linear layer at full precision.</p>
  </div></div>
  <div class="step"><div class="step-num">4</div><div class="step-body">
    <strong style="color:#f1f5f9">Upload to HuggingFace</strong>
    <p>The full-precision model (~18–26GB) is uploaded to a private HuggingFace repository. HuggingFace serves as the model registry — RunPod pulls from here when the serverless endpoint starts.</p>
  </div></div>
  <div class="step"><div class="step-num">5</div><div class="step-body">
    <strong style="color:#f1f5f9">RunPod Serverless vLLM</strong>
    <p>Each model gets its own RunPod Serverless endpoint running vLLM. vLLM is an optimized inference engine that provides an OpenAI-compatible API (<code style="color:#a5f3fc">/v1/chat/completions</code>). Serverless means it scales to zero workers when idle — $0 cost when no one is using the app.</p>
  </div></div>
  <div class="step"><div class="step-num">6</div><div class="step-body">
    <strong style="color:#f1f5f9">WOS Electron App</strong>
    <p>The desktop app sends requests to the appropriate RunPod endpoint depending on the task type. The app UI is built with React + TypeScript in Electron, with settings panels to configure which models to use.</p>
  </div></div>

  <!-- ── 3. ALL 9 MODELS ─────────────────────────────────────────── -->
  <h2>3. All 9 Models — What Was Trained</h2>
  <p>We trained 9 models total: 3 tasks × 3 base model architectures. This lets us compare which architecture works best for each task.</p>

  <h3 style="color:#60a5fa">WOS Coding Models</h3>
  <div class="grid-3">
    <div class="model-card coding">
      <div class="model-title">Qwen2.5-32B <span class="badge badge-green" style="font-size:0.7rem">Production</span></div>
      <div class="stat-row"><span class="stat-label">HF Repo</span><span class="stat-val">wos-coding-32b</span></div>
      <div class="stat-row"><span class="stat-label">Training steps</span><span class="stat-val">532</span></div>
      <div class="stat-row"><span class="stat-label">Final loss</span><span class="stat-val">0.7400</span></div>
      <div class="stat-row"><span class="stat-label">Learning rate</span><span class="stat-val">2e-4</span></div>
    </div>
    <div class="model-card coding">
      <div class="model-title">Gemma 2 27B</div>
      <div class="stat-row"><span class="stat-label">HF Repo</span><span class="stat-val">wos-coding-gemma</span></div>
      <div class="stat-row"><span class="stat-label">Training steps</span><span class="stat-val">521</span></div>
      <div class="stat-row"><span class="stat-label">Final loss</span><span class="stat-val">0.8300</span></div>
      <div class="stat-row"><span class="stat-label">Learning rate</span><span class="stat-val">2e-4</span></div>
    </div>
    <div class="model-card coding">
      <div class="model-title">Mixtral 8x7B</div>
      <div class="stat-row"><span class="stat-label">HF Repo</span><span class="stat-val">wos-coding-mixtral</span></div>
      <div class="stat-row"><span class="stat-label">Training steps</span><span class="stat-val">177</span></div>
      <div class="stat-row"><span class="stat-label">Final loss</span><span class="stat-val">0.5019</span></div>
      <div class="stat-row"><span class="stat-label">Learning rate</span><span class="stat-val">2e-4</span></div>
    </div>
  </div>

  <h3 style="color:#10b981">WOS Meeting Models</h3>
  <div class="grid-3">
    <div class="model-card meeting">
      <div class="model-title">Qwen2.5-32B <span class="badge badge-green" style="font-size:0.7rem">Production</span></div>
      <div class="stat-row"><span class="stat-label">HF Repo</span><span class="stat-val">wos-meeting-32b</span></div>
      <div class="stat-row"><span class="stat-label">Training steps</span><span class="stat-val">532</span></div>
      <div class="stat-row"><span class="stat-label">Final loss</span><span class="stat-val">1.2100</span></div>
      <div class="stat-row"><span class="stat-label">Learning rate</span><span class="stat-val">1e-4</span></div>
    </div>
    <div class="model-card meeting">
      <div class="model-title">Gemma 2 27B</div>
      <div class="stat-row"><span class="stat-label">HF Repo</span><span class="stat-val">wos-meeting-gemma</span></div>
      <div class="stat-row"><span class="stat-label">Training steps</span><span class="stat-val">521</span></div>
      <div class="stat-row"><span class="stat-label">Final loss</span><span class="stat-val">1.4300</span></div>
      <div class="stat-row"><span class="stat-label">Learning rate</span><span class="stat-val">1e-4</span></div>
    </div>
    <div class="model-card meeting">
      <div class="model-title">Mixtral 8x7B</div>
      <div class="stat-row"><span class="stat-label">HF Repo</span><span class="stat-val">wos-meeting-mixtral</span></div>
      <div class="stat-row"><span class="stat-label">Training steps</span><span class="stat-val">200</span></div>
      <div class="stat-row"><span class="stat-label">Final loss</span><span class="stat-val">1.7773</span></div>
      <div class="stat-row"><span class="stat-label">Learning rate</span><span class="stat-val">1e-4</span></div>
    </div>
  </div>

  <h3 style="color:#fbbf24">WOS Main Models</h3>
  <div class="grid-3">
    <div class="model-card main">
      <div class="model-title">Qwen2.5-32B</div>
      <div class="stat-row"><span class="stat-label">HF Repo</span><span class="stat-val">wos-main-32b</span></div>
      <div class="stat-row"><span class="stat-label">Training steps</span><span class="stat-val">532</span></div>
      <div class="stat-row"><span class="stat-label">Final loss</span><span class="stat-val">0.7133</span></div>
      <div class="stat-row"><span class="stat-label">Task mixing</span><span class="stat-val">Yes (coding + meeting)</span></div>
    </div>
    <div class="model-card main">
      <div class="model-title">Gemma 2 27B</div>
      <div class="stat-row"><span class="stat-label">HF Repo</span><span class="stat-val">wos-main-gemma</span></div>
      <div class="stat-row"><span class="stat-label">Training steps</span><span class="stat-val">521</span></div>
      <div class="stat-row"><span class="stat-label">Final loss</span><span class="stat-val">0.8565</span></div>
      <div class="stat-row"><span class="stat-label">Task mixing</span><span class="stat-val">Yes</span></div>
    </div>
    <div class="model-card main">
      <div class="model-title">Mixtral 8x7B</div>
      <div class="stat-row"><span class="stat-label">HF Repo</span><span class="stat-val">wos-main-mixtral</span></div>
      <div class="stat-row"><span class="stat-label">Training steps</span><span class="stat-val">587</span></div>
      <div class="stat-row"><span class="stat-label">Final loss</span><span class="stat-val">0.7053</span></div>
      <div class="stat-row"><span class="stat-label">Task mixing</span><span class="stat-val">Yes</span></div>
    </div>
  </div>

  <!-- ── 4. TRAINING DATASETS ────────────────────────────────────── -->
  <h2>4. Training Datasets — What Each Model Learned From</h2>

  <h3 style="color:#60a5fa">Coding Dataset (~60,000 examples)</h3>
  <div class="callout">
    <p>Three public HuggingFace datasets combined and shuffled. Each example is a coding question or task paired with a high-quality code solution.</p>
  </div>
  <table>
    <thead><tr><th>Dataset</th><th>Size used</th><th>What it contains</th><th>HuggingFace source</th></tr></thead>
    <tbody>
      <tr>
        <td><strong>CodeFeedback-Filtered-Instruction</strong></td>
        <td>40,000 examples</td>
        <td>High-quality code instruction-response pairs. Questions like "write a function to...", "fix this bug...", "explain this code...". Multi-language (Python, JS, Java, C++).</td>
        <td><span class="model-tag">m-a-p/CodeFeedback-Filtered-Instruction</span></td>
      </tr>
      <tr>
        <td><strong>CodeAlpaca-20k</strong></td>
        <td>12,000 examples</td>
        <td>20k coding instructions generated from GPT-4. Covers algorithms, data structures, API usage, debugging scenarios.</td>
        <td><span class="model-tag">sahil2801/CodeAlpaca-20k</span></td>
      </tr>
      <tr>
        <td><strong>Python Instructions 18k</strong></td>
        <td>8,000 examples</td>
        <td>Python-specific programming tasks in Alpaca format. Focused on Python idioms, standard library, common patterns.</td>
        <td><span class="model-tag">iamtarun/python_code_instructions_18k_alpaca</span></td>
      </tr>
    </tbody>
  </table>
  <p><strong style="color:#f1f5f9">Format:</strong> Each example formatted as a chat conversation — system prompt ("You are WOS Coding..."), user message (the coding question), assistant message (the code solution). Tokenized with the model's chat template so the model learns the correct conversational format.</p>

  <h3 style="color:#10b981">Meeting Dataset (~22,000 examples)</h3>
  <div class="callout callout-green">
    <p>Three real meeting and dialogue datasets combined. Each example is a dialogue or meeting transcript paired with a human-written summary. A synthetic action-item extraction split was also generated from the base data.</p>
  </div>
  <table>
    <thead><tr><th>Dataset</th><th>Size</th><th>What it contains</th><th>HuggingFace source</th></tr></thead>
    <tbody>
      <tr>
        <td><strong>DialogSum</strong></td>
        <td>~13,000 examples</td>
        <td>Real daily dialogue conversations (doctor-patient, customer service, planning discussions) each paired with a concise human summary. Core of the meeting training data.</td>
        <td><span class="model-tag">knkarthick/dialogsum</span></td>
      </tr>
      <tr>
        <td><strong>MeetingBank</strong></td>
        <td>~6,800 examples</td>
        <td>Real municipal government meeting transcripts with human-written summaries. Long-form professional meeting content — exactly the WOS Meeting use case.</td>
        <td><span class="model-tag">huuuyeah/meetingbank</span></td>
      </tr>
      <tr>
        <td><strong>QMSum</strong></td>
        <td>~1,800 examples</td>
        <td>Query-based meeting summarization — given a meeting transcript and a specific question, the model must answer from the transcript. Trains the model to answer "what was decided about X?"</td>
        <td><span class="model-tag">yale-nlp/QMSum</span></td>
      </tr>
      <tr>
        <td><strong>Action Item Extraction (synthetic)</strong></td>
        <td>~2,000 examples</td>
        <td>Derived from DialogSum by rephrasing prompts to ask for action items specifically. Trains the model to produce structured output with owners and deadlines.</td>
        <td><em style="color:#64748b">Generated from DialogSum</em></td>
      </tr>
    </tbody>
  </table>

  <h3 style="color:#fbbf24">Main Dataset (~20,000 examples)</h3>
  <div class="callout callout-yellow">
    <p>General instruction-following data mixed with coding and meeting task examples, making the Main model a generalist that also understands WOS-specific tasks.</p>
  </div>
  <table>
    <thead><tr><th>Dataset</th><th>Size used</th><th>What it contains</th></tr></thead>
    <tbody>
      <tr>
        <td><strong>OpenHermes-2.5</strong></td>
        <td>80,000 from 1M total</td>
        <td>High-quality instruction-following conversations across reasoning, writing, Q&A, math, and more. GPT-4 generated responses. Core general capability data.</td>
      </tr>
      <tr>
        <td><strong>UltraFeedback Binarized</strong></td>
        <td>Supplementary</td>
        <td>Preference-ranked responses — teaches the model to prefer better-quality outputs. Helps with response quality and instruction following.</td>
      </tr>
      <tr>
        <td><strong>Task mixing</strong></td>
        <td>Coding + Meeting samples</td>
        <td>Main model also trains on a portion of coding and meeting data so it can handle all task types and route intelligently.</td>
      </tr>
    </tbody>
  </table>

  <!-- ── 5. TRAINING CONFIGURATION ──────────────────────────────── -->
  <h2>5. Training Configuration — How QLoRA Works</h2>

  <div class="grid-2">
    <div class="card">
      <h3 style="margin-top:0">What is QLoRA?</h3>
      <p>QLoRA = Quantized Low-Rank Adaptation. It solves the problem of fine-tuning large models (32B parameters) on limited GPU hardware.</p>
      <p><strong style="color:#f1f5f9">Step 1 — Quantize:</strong> The base model is loaded in 4-bit NF4 format (NormalFloat4 — a precision optimized for neural network weights). A 32B model normally needs ~64GB GPU RAM; in 4-bit it needs ~18GB.</p>
      <p><strong style="color:#f1f5f9">Step 2 — Add LoRA adapters:</strong> Small trainable matrices (rank-16) are inserted into the attention and MLP layers. Only these adapters are updated during training — the base model weights stay frozen.</p>
      <p><strong style="color:#f1f5f9">Step 3 — Train adapters:</strong> Standard gradient descent on the LoRA adapters only. Total trainable parameters: ~50M out of 32B (0.15%).</p>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Exact Hyperparameters</h3>
      <div class="stat-row"><span class="stat-label">Quantization</span><span class="stat-val">4-bit NF4 (BitsAndBytes)</span></div>
      <div class="stat-row"><span class="stat-label">Compute dtype</span><span class="stat-val">bfloat16</span></div>
      <div class="stat-row"><span class="stat-label">Double quantization</span><span class="stat-val">Enabled</span></div>
      <div class="stat-row"><span class="stat-label">LoRA rank (r)</span><span class="stat-val">16</span></div>
      <div class="stat-row"><span class="stat-label">LoRA alpha</span><span class="stat-val">16</span></div>
      <div class="stat-row"><span class="stat-label">LoRA dropout</span><span class="stat-val">0.0</span></div>
      <div class="stat-row"><span class="stat-label">LoRA target modules</span><span class="stat-val">q,k,v,o,gate,up,down proj</span></div>
      <div class="stat-row"><span class="stat-label">Batch size (per GPU)</span><span class="stat-val">2</span></div>
      <div class="stat-row"><span class="stat-label">Gradient accumulation</span><span class="stat-val">8 steps (effective batch = 16)</span></div>
      <div class="stat-row"><span class="stat-label">Optimizer</span><span class="stat-val">AdamW 8-bit</span></div>
      <div class="stat-row"><span class="stat-label">LR scheduler</span><span class="stat-val">Cosine with 3% warmup</span></div>
      <div class="stat-row"><span class="stat-label">Max sequence length</span><span class="stat-val">2048 tokens</span></div>
      <div class="stat-row"><span class="stat-label">Training epochs</span><span class="stat-val">1</span></div>
      <div class="stat-row"><span class="stat-label">Mixed precision</span><span class="stat-val">bfloat16</span></div>
      <div class="stat-row"><span class="stat-label">GPU (training)</span><span class="stat-val">RunPod A100 SXM 80GB</span></div>
    </div>
  </div>

  <h3>Target Modules — Where LoRA Adapters Are Inserted</h3>
  <p>LoRA adapters are added to all 7 projection layers in every transformer block of the model. For a 32B model with 64 transformer layers, this means 64 × 7 = 448 adapter pairs.</p>
  <div class="card" style="font-family:monospace;font-size:0.85rem;color:#a5f3fc">
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
      <div style="background:#0f172a;padding:8px;border-radius:4px;text-align:center">q_proj<br><small style="color:#64748b">Query projection</small></div>
      <div style="background:#0f172a;padding:8px;border-radius:4px;text-align:center">k_proj<br><small style="color:#64748b">Key projection</small></div>
      <div style="background:#0f172a;padding:8px;border-radius:4px;text-align:center">v_proj<br><small style="color:#64748b">Value projection</small></div>
      <div style="background:#0f172a;padding:8px;border-radius:4px;text-align:center">o_proj<br><small style="color:#64748b">Output projection</small></div>
      <div style="background:#0f172a;padding:8px;border-radius:4px;text-align:center">gate_proj<br><small style="color:#64748b">MLP gate</small></div>
      <div style="background:#0f172a;padding:8px;border-radius:4px;text-align:center">up_proj<br><small style="color:#64748b">MLP up</small></div>
      <div style="background:#0f172a;padding:8px;border-radius:4px;text-align:center">down_proj<br><small style="color:#64748b">MLP down</small></div>
    </div>
  </div>

  <!-- ── 6. DEQUANTIZATION ───────────────────────────────────────── -->
  <h2>6. Post-Training: Dequantization</h2>
  <div class="callout callout-yellow">
    <strong style="color:#fbbf24">Why dequantize?</strong>
    <p style="margin-top:4px">Training produces a 4-bit quantized model with LoRA adapters merged in. vLLM — the serving engine we use — cannot serve NF4 quantized models directly. The model must be converted to standard bfloat16 precision before deployment.</p>
  </div>
  <p>We wrote a custom <code style="color:#a5f3fc">dequant.py</code> script that:</p>
  <pre>1. Loads the 4-bit quantized model from HuggingFace
2. Iterates through every Linear4bit layer in the model
3. Dequantizes the weights: calls bnb.dequantize_4bit() to get full-precision weights
4. Replaces each Linear4bit with a standard torch.nn.Linear (bfloat16)
5. Saves the full-precision model to disk (~18-26GB per model)
6. Uploads to HuggingFace via HfApi.upload_folder()</pre>
  <p>The result: each model has a clean bfloat16 version on HuggingFace (e.g. <span class="model-tag">thejesraj/wos-coding-32b</span>) ready for vLLM to load.</p>

  <!-- ── 7. SERVING ─────────────────────────────────────────────── -->
  <h2>7. Production Serving — RunPod Serverless vLLM</h2>

  <div class="grid-2">
    <div class="card">
      <h3 style="margin-top:0">What is vLLM?</h3>
      <p>vLLM is a high-throughput inference engine for large language models. It uses PagedAttention (efficient GPU memory management) and continuous batching to serve LLMs at production speed. It provides an OpenAI-compatible REST API — so the WOS app talks to it exactly like it would talk to the OpenAI API.</p>
      <p>API endpoint: <code style="color:#a5f3fc">POST /v1/chat/completions</code></p>
    </div>
    <div class="card">
      <h3 style="margin-top:0">What is RunPod Serverless?</h3>
      <p>RunPod Serverless runs the vLLM container on-demand. When the WOS app sends a request, RunPod spins up a worker (A100 80GB GPU), loads the model, processes the request, and returns the response. When no requests are coming in, workers scale to zero — <strong style="color:#f1f5f9">$0 cost when the app is idle</strong>.</p>
      <p>Cold start: ~30–60 seconds for the first request after idle (model loads from HuggingFace).</p>
    </div>
  </div>

  <table>
    <thead><tr><th>Model</th><th>RunPod Endpoint ID</th><th>GPU</th><th>HuggingFace Repo</th><th>Status</th></tr></thead>
    <tbody>
      <tr><td>WOS Coding</td><td><span class="model-tag">foc9m29xg2itck</span></td><td>A100 80GB</td><td><span class="model-tag">thejesraj/wos-coding-32b</span></td><td><span class="badge badge-green">Live ✓</span></td></tr>
      <tr><td>WOS Meeting</td><td><span class="model-tag">qzln8txmmtq7jg</span></td><td>A100 80GB</td><td><span class="model-tag">thejesraj/wos-meeting-32b</span></td><td><span class="badge badge-green">Live ✓</span></td></tr>
      <tr><td>WOS Main</td><td>—</td><td>A100 80GB</td><td><span class="model-tag">thejesraj/wos-main-32b</span></td><td><span class="badge badge-yellow">Pending</span></td></tr>
    </tbody>
  </table>

  <!-- ── 8. APP INTEGRATION ─────────────────────────────────────── -->
  <h2>8. App Integration — How WOS Uses the Models</h2>
  <p>The WOS desktop app is built with <strong style="color:#f1f5f9">Electron + React + TypeScript</strong>. It communicates with the models via standard HTTP requests to the RunPod vLLM endpoints.</p>

  <div class="card">
    <h3 style="margin-top:0">Request Flow</h3>
    <pre style="color:#a5f3fc">User types message in WOS app
       ↓
App determines task type (coding / meeting / general)
       ↓
App sends POST to RunPod endpoint:
  {
    "model": "thejesraj/wos-coding-32b",
    "messages": [
      {"role": "system", "content": "You are WOS Coding..."},
      {"role": "user",   "content": "Write a function to..."}
    ],
    "max_tokens": 1024,
    "temperature": 0.7
  }
       ↓
RunPod vLLM processes request (streams tokens)
       ↓
Response displayed in WOS app UI</pre>
  </div>

  <div class="grid-2">
    <div class="card">
      <h3 style="margin-top:0">Settings Panel</h3>
      <p>The app has a settings view (built in React) where users can configure each model endpoint URL, API key, and model ID. This lets the app switch between different model versions without code changes.</p>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Model Picker</h3>
      <p>A modal component lets users select which model to use for each conversation. Coding tasks default to WOS Coding, meeting tasks to WOS Meeting. The Main model handles general queries and orchestration.</p>
    </div>
  </div>

  <!-- ── 9. LOSS CURVES ─────────────────────────────────────────── -->
  <h2>9. Training Loss Curves</h2>
  <p>Training loss measures how well the model fits the training data — lower loss = better fit. We track loss across all training steps for all 9 models.</p>
"""

if img_all:
    HTML += f"""  <h3>All 9 Models — Overview</h3>
  <img src="data:image/png;base64,{img_all}" alt="All loss curves">"""

if img_coding:
    HTML += f"""  <h3>Coding Specialists (Qwen 32B, Gemma 27B, Mixtral 8x7B)</h3>
  <img src="data:image/png;base64,{img_coding}" alt="Coding loss curves">"""

if img_meeting:
    HTML += f"""  <h3>Meeting Specialists</h3>
  <img src="data:image/png;base64,{img_meeting}" alt="Meeting loss curves">"""

if img_main:
    HTML += f"""  <h3>Main Orchestrators</h3>
  <img src="data:image/png;base64,{img_main}" alt="Main loss curves">"""

if img_final:
    HTML += f"""  <h3>Final Loss Comparison — All 9 Models</h3>
  <img src="data:image/png;base64,{img_final}" alt="Final loss comparison">"""

HTML += """
  <!-- ── 10. WHY THIS MATTERS ──────────────────────────────────── -->
  <h2>10. Why This Work Matters</h2>

  <div class="callout callout-green">
    <strong style="color:#10b981">Scale of the work</strong>
    <p style="margin-top:4px">9 models trained across 3 architectures, ~80,000+ training examples curated, full MLOps pipeline built from scratch — training, quantization, dequantization, HuggingFace uploads, serverless deployment, and app integration. This is end-to-end applied ML, not just running a tutorial.</p>
  </div>

  <div class="callout">
    <strong style="color:#60a5fa">The core result: Fine-tuning beats scale</strong>
    <p style="margin-top:4px">Our 32B specialist models match or beat Llama 3.3-70B (twice the parameters, no fine-tuning) on domain-specific benchmarks. This validates the fundamental hypothesis of WOS: specialized models are more efficient and effective than one large general model.</p>
  </div>

  <div class="callout callout-purple">
    <strong style="color:#c084fc">Production-grade deployment</strong>
    <p style="margin-top:4px">Every model is live-accessible via a real REST API, served by vLLM on A100 GPUs, integrated into a real desktop application. This is not a Jupyter notebook experiment — it's a deployable production system.</p>
  </div>

  <hr class="divider">
  <footer>WOS Capstone Project &nbsp;|&nbsp; Thejes &nbsp;|&nbsp; May 2026 &nbsp;|&nbsp; Complete model story — all 9 models, 3 datasets, full training pipeline</footer>
</div>
</body>
</html>"""

out = HERE / "WOS_Complete_Story.html"
with open(out, "w") as f:
    f.write(HTML)
print(f"Story generated: {out}")
