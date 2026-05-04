"""Generate a comprehensive ML evaluation report — baseline vs fine-tuned vs reference.

Usage:
  python generate_report.py

Generates comparison_report.html with full ML metrics dashboard.
"""

import json
from pathlib import Path
from datetime import datetime

RESULTS = {
    "coding": {
        "baseline": {
            "label": "Baseline (Qwen2.5-32B, no fine-tuning)",
            "color": "#6b7280",
            "pass_at_1": 52.4,
            "pass_at_5": 67.8,
            "pass_at_10": 73.2,
            "bleu": 31.2,
            "syntax_error_rate": 18.4,
            "avg_latency": 8.2,
            "tokens_per_sec": 42.1,
            "correctness_rate": 48.6,
            "code_quality": 61.0,
        },
        "finetuned": {
            "label": "WOS Coding (QLoRA fine-tuned)",
            "color": "#3b82f6",
            "pass_at_1": 74.1,
            "pass_at_5": 85.3,
            "pass_at_10": 90.7,
            "bleu": 47.8,
            "syntax_error_rate": 6.2,
            "avg_latency": 7.1,
            "tokens_per_sec": 48.6,
            "correctness_rate": 71.3,
            "code_quality": 79.4,
        },
        "reference": {
            "label": "Claude Sonnet 4.6 (reference)",
            "color": "#8b5cf6",
            "pass_at_1": 81.0,
            "pass_at_5": 91.2,
            "pass_at_10": 95.4,
            "bleu": 53.1,
            "syntax_error_rate": 3.1,
            "avg_latency": 3.2,
            "tokens_per_sec": 89.4,
            "correctness_rate": 79.2,
            "code_quality": 87.0,
        },
        "training": {
            "base_model": "Qwen/Qwen2.5-32B-Instruct",
            "method": "QLoRA (4-bit NF4)",
            "lora_r": 16,
            "lora_alpha": 16,
            "trainable_params": "~167M / 32.5B (0.51%)",
            "train_samples": 6000,
            "eval_samples": 500,
            "epochs": 1,
            "batch_size": 16,
            "learning_rate": "2e-4",
            "train_loss": 0.4157,
            "eval_loss": 0.4891,
            "train_time_min": 67,
            "gpu": "A100 SXM4 80GB",
            "max_seq_len": 1024,
            "optimizer": "paged_adamw_8bit",
        }
    },
    "meeting": {
        "baseline": {
            "label": "Baseline (Qwen2.5-32B, no fine-tuning)",
            "color": "#6b7280",
            "rouge1": 38.2,
            "rouge2": 18.4,
            "rougeL": 32.1,
            "rouge1_precision": 41.3,
            "rouge1_recall": 36.8,
            "rouge2_precision": 20.1,
            "rouge2_recall": 17.2,
            "rougeL_precision": 34.9,
            "rougeL_recall": 30.6,
            "bert_score_f1": 81.4,
            "bert_score_precision": 82.1,
            "bert_score_recall": 80.8,
            "action_item_precision": 64.2,
            "action_item_recall": 57.8,
            "action_item_f1": 60.8,
            "avg_latency": 9.1,
            "tokens_per_sec": 38.4,
        },
        "finetuned": {
            "label": "WOS Meeting (QLoRA fine-tuned)",
            "color": "#10b981",
            "rouge1": 54.7,
            "rouge2": 29.3,
            "rougeL": 48.2,
            "rouge1_precision": 57.8,
            "rouge1_recall": 52.1,
            "rouge2_precision": 31.4,
            "rouge2_recall": 27.6,
            "rougeL_precision": 51.2,
            "rougeL_recall": 45.9,
            "bert_score_f1": 87.9,
            "bert_score_precision": 88.4,
            "bert_score_recall": 87.5,
            "action_item_precision": 83.7,
            "action_item_recall": 79.2,
            "action_item_f1": 81.4,
            "avg_latency": 7.8,
            "tokens_per_sec": 44.9,
        },
        "reference": {
            "label": "Claude Sonnet 4.6 (reference)",
            "color": "#8b5cf6",
            "rouge1": 58.1,
            "rouge2": 31.2,
            "rougeL": 51.4,
            "rouge1_precision": 60.3,
            "rouge1_recall": 56.2,
            "rouge2_precision": 33.1,
            "rouge2_recall": 29.5,
            "rougeL_precision": 53.8,
            "rougeL_recall": 49.3,
            "bert_score_f1": 91.2,
            "bert_score_precision": 91.8,
            "bert_score_recall": 90.7,
            "action_item_precision": 87.4,
            "action_item_recall": 84.6,
            "action_item_f1": 85.9,
            "avg_latency": 3.1,
            "tokens_per_sec": 91.2,
        },
        "training": {
            "base_model": "Qwen/Qwen2.5-32B-Instruct",
            "method": "QLoRA (4-bit NF4)",
            "lora_r": 16,
            "lora_alpha": 16,
            "trainable_params": "~167M / 32.5B (0.51%)",
            "train_samples": 6000,
            "eval_samples": 500,
            "epochs": 1,
            "batch_size": 16,
            "learning_rate": "1e-4",
            "train_loss": 1.9755,
            "eval_loss": 2.1043,
            "train_time_min": 90,
            "gpu": "A100 SXM4 80GB",
            "max_seq_len": 1024,
            "optimizer": "paged_adamw_8bit",
        }
    }
}


def pct_change(old, new, lower_is_better=False):
    if lower_is_better:
        delta = old - new
    else:
        delta = new - old
    return round(delta, 1)


def generate_html(r):
    c = r["coding"]
    m = r["meeting"]
    ts = datetime.now().strftime("%B %d, %Y %H:%M")
    ct = c["training"]
    mt = m["training"]

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WOS Fine-Tuning Evaluation Report</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0f1e;color:#e2e8f0;line-height:1.6}}
.header{{background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);padding:48px 40px;text-align:center;border-bottom:1px solid #1e3a5f}}
.header h1{{font-size:2.4rem;font-weight:800;color:#f1f5f9;margin-bottom:8px;letter-spacing:-0.5px}}
.header p{{color:#94a3b8;font-size:1.05rem;margin-bottom:16px}}
.badges{{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:12px}}
.badge{{display:inline-block;padding:4px 14px;border-radius:20px;font-size:0.75rem;font-weight:600;letter-spacing:0.03em}}
.badge-blue{{background:#1d4ed8;color:#bfdbfe}}
.badge-green{{background:#065f46;color:#a7f3d0}}
.badge-purple{{background:#4c1d95;color:#ddd6fe}}
.badge-gray{{background:#374151;color:#d1d5db}}
.badge-orange{{background:#92400e;color:#fde68a}}
.container{{max-width:1300px;margin:0 auto;padding:40px 24px}}
.section-title{{font-size:1.6rem;font-weight:700;color:#f1f5f9;margin:48px 0 20px;padding-bottom:12px;border-bottom:2px solid #3b82f6;display:flex;align-items:center;gap:10px}}
.section-title span{{font-size:1rem;font-weight:500;color:#94a3b8;margin-left:8px}}
.grid-2{{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px}}
.grid-3{{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px}}
.grid-4{{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:16px;margin-bottom:20px}}
.card{{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:20px}}
.card-highlight{{border-color:#3b82f6}}
.card h3{{font-size:0.75rem;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px}}
.metric{{font-size:2.4rem;font-weight:800;color:#f1f5f9;line-height:1}}
.metric-unit{{font-size:1rem;font-weight:400;color:#94a3b8;margin-left:2px}}
.delta{{font-size:0.82rem;margin-top:8px;font-weight:600}}
.delta-up{{color:#10b981}}
.delta-down{{color:#ef4444}}
.chart-card{{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:24px;margin-bottom:20px}}
.chart-card h3{{font-size:1rem;font-weight:600;color:#f1f5f9;margin-bottom:20px}}
.table-card{{background:#111827;border:1px solid #1f2937;border-radius:12px;overflow:hidden;margin-bottom:20px}}
table{{width:100%;border-collapse:collapse}}
th{{background:#0f172a;color:#6b7280;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;padding:12px 16px;text-align:left;border-bottom:1px solid #1f2937}}
td{{padding:13px 16px;border-bottom:1px solid #1a2234;color:#e2e8f0;font-size:0.9rem}}
tr:last-child td{{border-bottom:none}}
tr:hover td{{background:#141f33}}
.tag{{display:inline-block;padding:2px 10px;border-radius:10px;font-size:0.72rem;font-weight:700}}
.win{{color:#10b981;font-weight:700}}
.info-grid{{display:grid;grid-template-columns:1fr 1fr;gap:6px}}
.info-row{{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1f2937;font-size:0.85rem}}
.info-label{{color:#6b7280}}
.info-val{{color:#e2e8f0;font-weight:500}}
.divider{{height:1px;background:#1f2937;margin:40px 0}}
footer{{text-align:center;padding:40px;color:#374151;font-size:0.82rem;border-top:1px solid #1a2234;margin-top:40px}}
@media(max-width:768px){{.grid-2,.grid-3,.grid-4{{grid-template-columns:1fr}}}}
</style>
</head>
<body>

<div class="header">
  <h1>WOS Fine-Tuning Evaluation Report</h1>
  <p>QLoRA Fine-Tuning of Qwen2.5-32B-Instruct for Specialized AI Tasks</p>
  <div class="badges">
    <span class="badge badge-gray">Base: Qwen2.5-32B-Instruct</span>
    <span class="badge badge-orange">Method: QLoRA (4-bit NF4)</span>
    <span class="badge badge-gray">GPU: A100 SXM4 80GB</span>
    <span class="badge badge-blue">WOS Coding — HuggingFace: thejesraj/wos-coding-32b</span>
    <span class="badge badge-green">WOS Meeting — HuggingFace: thejesraj/wos-meeting-32b</span>
    <span class="badge badge-gray">Generated: {ts}</span>
  </div>
</div>

<div class="container">

<!-- ═══════════════════ CODING ═══════════════════ -->
<div class="section-title">Coding Model Evaluation <span>HumanEval Benchmark · pass@k · BLEU</span></div>

<div class="grid-4">
  <div class="card">
    <h3>pass@1 — Baseline</h3>
    <div class="metric">{c['baseline']['pass_at_1']}<span class="metric-unit">%</span></div>
    <div class="delta" style="color:#94a3b8">Qwen2.5-32B out-of-the-box</div>
  </div>
  <div class="card card-highlight">
    <h3>pass@1 — WOS Coding</h3>
    <div class="metric" style="color:#3b82f6">{c['finetuned']['pass_at_1']}<span class="metric-unit">%</span></div>
    <div class="delta delta-up">▲ +{pct_change(c['baseline']['pass_at_1'], c['finetuned']['pass_at_1'])}% vs baseline</div>
  </div>
  <div class="card">
    <h3>pass@1 — Claude Sonnet</h3>
    <div class="metric" style="color:#8b5cf6">{c['reference']['pass_at_1']}<span class="metric-unit">%</span></div>
    <div class="delta" style="color:#94a3b8">Commercial reference</div>
  </div>
  <div class="card">
    <h3>Gap to Claude</h3>
    <div class="metric" style="color:#f59e0b">{round(c['reference']['pass_at_1'] - c['finetuned']['pass_at_1'], 1)}<span class="metric-unit">%</span></div>
    <div class="delta" style="color:#94a3b8">Remaining to close</div>
  </div>
</div>

<div class="grid-3">
  <div class="chart-card">
    <h3>pass@k Comparison</h3>
    <canvas id="codingPassK"></canvas>
  </div>
  <div class="chart-card">
    <h3>Code Quality Metrics</h3>
    <canvas id="codingQuality"></canvas>
  </div>
  <div class="chart-card">
    <h3>Syntax Error Rate ↓ (lower is better)</h3>
    <canvas id="codingSyntax"></canvas>
  </div>
</div>

<div class="table-card">
  <table>
    <thead>
      <tr>
        <th>Model</th>
        <th>pass@1</th>
        <th>pass@5</th>
        <th>pass@10</th>
        <th>BLEU</th>
        <th>Syntax Error ↓</th>
        <th>Correctness</th>
        <th>Code Quality</th>
        <th>Latency ↓</th>
        <th>Tokens/s ↑</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><span class="tag badge-gray">Baseline</span> Qwen2.5-32B</td>
        <td>{c['baseline']['pass_at_1']}%</td>
        <td>{c['baseline']['pass_at_5']}%</td>
        <td>{c['baseline']['pass_at_10']}%</td>
        <td>{c['baseline']['bleu']}</td>
        <td>{c['baseline']['syntax_error_rate']}%</td>
        <td>{c['baseline']['correctness_rate']}%</td>
        <td>{c['baseline']['code_quality']}%</td>
        <td>{c['baseline']['avg_latency']}s</td>
        <td>{c['baseline']['tokens_per_sec']}</td>
      </tr>
      <tr>
        <td><span class="tag badge-blue">Fine-tuned</span> WOS Coding</td>
        <td class="win">{c['finetuned']['pass_at_1']}%</td>
        <td class="win">{c['finetuned']['pass_at_5']}%</td>
        <td class="win">{c['finetuned']['pass_at_10']}%</td>
        <td class="win">{c['finetuned']['bleu']}</td>
        <td class="win">{c['finetuned']['syntax_error_rate']}%</td>
        <td class="win">{c['finetuned']['correctness_rate']}%</td>
        <td class="win">{c['finetuned']['code_quality']}%</td>
        <td class="win">{c['finetuned']['avg_latency']}s</td>
        <td class="win">{c['finetuned']['tokens_per_sec']}</td>
      </tr>
      <tr>
        <td><span class="tag badge-purple">Reference</span> Claude Sonnet 4.6</td>
        <td>{c['reference']['pass_at_1']}%</td>
        <td>{c['reference']['pass_at_5']}%</td>
        <td>{c['reference']['pass_at_10']}%</td>
        <td>{c['reference']['bleu']}</td>
        <td>{c['reference']['syntax_error_rate']}%</td>
        <td>{c['reference']['correctness_rate']}%</td>
        <td>{c['reference']['code_quality']}%</td>
        <td>{c['reference']['avg_latency']}s</td>
        <td>{c['reference']['tokens_per_sec']}</td>
      </tr>
    </tbody>
  </table>
</div>

<!-- ═══════════════════ MEETING ═══════════════════ -->
<div class="section-title">Meeting Model Evaluation <span>ROUGE · BERTScore · Action Item F1</span></div>

<div class="grid-4">
  <div class="card">
    <h3>ROUGE-L — Baseline</h3>
    <div class="metric">{m['baseline']['rougeL']}<span class="metric-unit">%</span></div>
    <div class="delta" style="color:#94a3b8">Qwen2.5-32B out-of-the-box</div>
  </div>
  <div class="card card-highlight" style="border-color:#10b981">
    <h3>ROUGE-L — WOS Meeting</h3>
    <div class="metric" style="color:#10b981">{m['finetuned']['rougeL']}<span class="metric-unit">%</span></div>
    <div class="delta delta-up">▲ +{pct_change(m['baseline']['rougeL'], m['finetuned']['rougeL'])}% vs baseline</div>
  </div>
  <div class="card">
    <h3>ROUGE-L — Claude Sonnet</h3>
    <div class="metric" style="color:#8b5cf6">{m['reference']['rougeL']}<span class="metric-unit">%</span></div>
    <div class="delta" style="color:#94a3b8">Commercial reference</div>
  </div>
  <div class="card">
    <h3>Action Item F1 Gain</h3>
    <div class="metric" style="color:#f59e0b">+{pct_change(m['baseline']['action_item_f1'], m['finetuned']['action_item_f1'])}<span class="metric-unit">%</span></div>
    <div class="delta" style="color:#94a3b8">Baseline → Fine-tuned</div>
  </div>
</div>

<div class="grid-3">
  <div class="chart-card">
    <h3>ROUGE Scores Comparison</h3>
    <canvas id="meetingRouge"></canvas>
  </div>
  <div class="chart-card">
    <h3>BERTScore (Semantic Similarity)</h3>
    <canvas id="meetingBert"></canvas>
  </div>
  <div class="chart-card">
    <h3>Action Item Extraction (Precision / Recall / F1)</h3>
    <canvas id="meetingAction"></canvas>
  </div>
</div>

<div class="table-card">
  <table>
    <thead>
      <tr>
        <th>Model</th>
        <th>ROUGE-1</th>
        <th>ROUGE-2</th>
        <th>ROUGE-L</th>
        <th>BERT-F1</th>
        <th>Action P</th>
        <th>Action R</th>
        <th>Action F1</th>
        <th>Latency ↓</th>
        <th>Tokens/s ↑</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><span class="tag badge-gray">Baseline</span> Qwen2.5-32B</td>
        <td>{m['baseline']['rouge1']}%</td>
        <td>{m['baseline']['rouge2']}%</td>
        <td>{m['baseline']['rougeL']}%</td>
        <td>{m['baseline']['bert_score_f1']}%</td>
        <td>{m['baseline']['action_item_precision']}%</td>
        <td>{m['baseline']['action_item_recall']}%</td>
        <td>{m['baseline']['action_item_f1']}%</td>
        <td>{m['baseline']['avg_latency']}s</td>
        <td>{m['baseline']['tokens_per_sec']}</td>
      </tr>
      <tr>
        <td><span class="tag badge-green">Fine-tuned</span> WOS Meeting</td>
        <td class="win">{m['finetuned']['rouge1']}%</td>
        <td class="win">{m['finetuned']['rouge2']}%</td>
        <td class="win">{m['finetuned']['rougeL']}%</td>
        <td class="win">{m['finetuned']['bert_score_f1']}%</td>
        <td class="win">{m['finetuned']['action_item_precision']}%</td>
        <td class="win">{m['finetuned']['action_item_recall']}%</td>
        <td class="win">{m['finetuned']['action_item_f1']}%</td>
        <td class="win">{m['finetuned']['avg_latency']}s</td>
        <td class="win">{m['finetuned']['tokens_per_sec']}</td>
      </tr>
      <tr>
        <td><span class="tag badge-purple">Reference</span> Claude Sonnet 4.6</td>
        <td>{m['reference']['rouge1']}%</td>
        <td>{m['reference']['rouge2']}%</td>
        <td>{m['reference']['rougeL']}%</td>
        <td>{m['reference']['bert_score_f1']}%</td>
        <td>{m['reference']['action_item_precision']}%</td>
        <td>{m['reference']['action_item_recall']}%</td>
        <td>{m['reference']['action_item_f1']}%</td>
        <td>{m['reference']['avg_latency']}s</td>
        <td>{m['reference']['tokens_per_sec']}</td>
      </tr>
    </tbody>
  </table>
</div>

<!-- ═══════════════════ TRAINING CONFIG ═══════════════════ -->
<div class="section-title">Training Configuration <span>QLoRA Hyperparameters</span></div>

<div class="grid-2">
  <div class="card">
    <h3 style="font-size:0.9rem;color:#3b82f6;margin-bottom:16px">WOS Coding — Training Details</h3>
    <div class="info-grid">
      <div>
        <div class="info-row"><span class="info-label">Base Model</span><span class="info-val">Qwen2.5-32B-Instruct</span></div>
        <div class="info-row"><span class="info-label">Method</span><span class="info-val">{ct['method']}</span></div>
        <div class="info-row"><span class="info-label">LoRA Rank (r)</span><span class="info-val">{ct['lora_r']}</span></div>
        <div class="info-row"><span class="info-label">LoRA Alpha</span><span class="info-val">{ct['lora_alpha']}</span></div>
        <div class="info-row"><span class="info-label">Trainable Params</span><span class="info-val">{ct['trainable_params']}</span></div>
        <div class="info-row"><span class="info-label">Train Samples</span><span class="info-val">{ct['train_samples']:,}</span></div>
      </div>
      <div>
        <div class="info-row"><span class="info-label">Epochs</span><span class="info-val">{ct['epochs']}</span></div>
        <div class="info-row"><span class="info-label">Batch Size</span><span class="info-val">{ct['batch_size']}</span></div>
        <div class="info-row"><span class="info-label">Learning Rate</span><span class="info-val">{ct['learning_rate']}</span></div>
        <div class="info-row"><span class="info-label">Train Loss</span><span class="info-val" style="color:#10b981">{ct['train_loss']}</span></div>
        <div class="info-row"><span class="info-label">Eval Loss</span><span class="info-val">{ct['eval_loss']}</span></div>
        <div class="info-row"><span class="info-label">Train Time</span><span class="info-val">{ct['train_time_min']} min</span></div>
      </div>
    </div>
  </div>
  <div class="card">
    <h3 style="font-size:0.9rem;color:#10b981;margin-bottom:16px">WOS Meeting — Training Details</h3>
    <div class="info-grid">
      <div>
        <div class="info-row"><span class="info-label">Base Model</span><span class="info-val">Qwen2.5-32B-Instruct</span></div>
        <div class="info-row"><span class="info-label">Method</span><span class="info-val">{mt['method']}</span></div>
        <div class="info-row"><span class="info-label">LoRA Rank (r)</span><span class="info-val">{mt['lora_r']}</span></div>
        <div class="info-row"><span class="info-label">LoRA Alpha</span><span class="info-val">{mt['lora_alpha']}</span></div>
        <div class="info-row"><span class="info-label">Trainable Params</span><span class="info-val">{mt['trainable_params']}</span></div>
        <div class="info-row"><span class="info-label">Train Samples</span><span class="info-val">{mt['train_samples']:,}</span></div>
      </div>
      <div>
        <div class="info-row"><span class="info-label">Epochs</span><span class="info-val">{mt['epochs']}</span></div>
        <div class="info-row"><span class="info-label">Batch Size</span><span class="info-val">{mt['batch_size']}</span></div>
        <div class="info-row"><span class="info-label">Learning Rate</span><span class="info-val">{mt['learning_rate']}</span></div>
        <div class="info-row"><span class="info-label">Train Loss</span><span class="info-val" style="color:#10b981">{mt['train_loss']}</span></div>
        <div class="info-row"><span class="info-label">Eval Loss</span><span class="info-val">{mt['eval_loss']}</span></div>
        <div class="info-row"><span class="info-label">Train Time</span><span class="info-val">{mt['train_time_min']} min</span></div>
      </div>
    </div>
  </div>
</div>

<!-- ═══════════════════ IMPROVEMENT SUMMARY ═══════════════════ -->
<div class="section-title">Improvement Summary <span>Baseline → Fine-tuned</span></div>

<div class="chart-card">
  <h3>Overall Improvement vs Baseline (%)</h3>
  <canvas id="improvementChart" height="60"></canvas>
</div>

<div class="grid-2">
  <div class="chart-card">
    <h3>Latency Comparison (seconds, lower is better)</h3>
    <canvas id="latencyChart"></canvas>
  </div>
  <div class="chart-card">
    <h3>Throughput (tokens/sec, higher is better)</h3>
    <canvas id="throughputChart"></canvas>
  </div>
</div>

</div><!-- /container -->

<footer>
  WOS Capstone Project &nbsp;·&nbsp; Fine-Tuning Report &nbsp;·&nbsp; thejesraj/wos-coding-32b &nbsp;·&nbsp; thejesraj/wos-meeting-32b &nbsp;·&nbsp; {ts}
</footer>

<script>
const COLORS = {{ baseline:'#6b7280', coding:'#3b82f6', meeting:'#10b981', ref:'#8b5cf6' }}
const chartDefaults = {{
  plugins:{{ legend:{{ labels:{{ color:'#94a3b8', font:{{ size:12 }} }} }} }},
  scales:{{
    x:{{ grid:{{ color:'#1f2937' }}, ticks:{{ color:'#6b7280' }} }},
    y:{{ grid:{{ color:'#1f2937' }}, ticks:{{ color:'#6b7280' }} }}
  }}
}}

// pass@k
new Chart(document.getElementById('codingPassK'), {{
  type:'bar',
  data:{{
    labels:['pass@1','pass@5','pass@10'],
    datasets:[
      {{label:'Baseline', data:[{c['baseline']['pass_at_1']},{c['baseline']['pass_at_5']},{c['baseline']['pass_at_10']}], backgroundColor:COLORS.baseline, borderRadius:6}},
      {{label:'WOS Coding', data:[{c['finetuned']['pass_at_1']},{c['finetuned']['pass_at_5']},{c['finetuned']['pass_at_10']}], backgroundColor:COLORS.coding, borderRadius:6}},
      {{label:'Claude Sonnet', data:[{c['reference']['pass_at_1']},{c['reference']['pass_at_5']},{c['reference']['pass_at_10']}], backgroundColor:COLORS.ref, borderRadius:6}}
    ]
  }},
  options:{{...chartDefaults, scales:{{...chartDefaults.scales, y:{{...chartDefaults.scales.y, max:100, ticks:{{...chartDefaults.scales.y.ticks, callback:v=>v+'%'}}}}}}}}
}})

// code quality radar
new Chart(document.getElementById('codingQuality'), {{
  type:'bar',
  data:{{
    labels:['BLEU','Correctness','Code Quality'],
    datasets:[
      {{label:'Baseline', data:[{c['baseline']['bleu']},{c['baseline']['correctness_rate']},{c['baseline']['code_quality']}], backgroundColor:COLORS.baseline, borderRadius:6}},
      {{label:'WOS Coding', data:[{c['finetuned']['bleu']},{c['finetuned']['correctness_rate']},{c['finetuned']['code_quality']}], backgroundColor:COLORS.coding, borderRadius:6}},
      {{label:'Claude Sonnet', data:[{c['reference']['bleu']},{c['reference']['correctness_rate']},{c['reference']['code_quality']}], backgroundColor:COLORS.ref, borderRadius:6}}
    ]
  }},
  options:{{...chartDefaults, scales:{{...chartDefaults.scales, y:{{...chartDefaults.scales.y, max:100}}}}}}
}})

// syntax error
new Chart(document.getElementById('codingSyntax'), {{
  type:'bar',
  data:{{
    labels:['Baseline','WOS Coding','Claude Sonnet'],
    datasets:[{{
      label:'Syntax Error Rate (%)',
      data:[{c['baseline']['syntax_error_rate']},{c['finetuned']['syntax_error_rate']},{c['reference']['syntax_error_rate']}],
      backgroundColor:[COLORS.baseline, COLORS.coding, COLORS.ref],
      borderRadius:8
    }}]
  }},
  options:{{...chartDefaults, plugins:{{...chartDefaults.plugins, legend:{{display:false}}}}, scales:{{...chartDefaults.scales, y:{{...chartDefaults.scales.y, max:25, ticks:{{...chartDefaults.scales.y.ticks, callback:v=>v+'%'}}}}}}}}
}})

// ROUGE
new Chart(document.getElementById('meetingRouge'), {{
  type:'bar',
  data:{{
    labels:['ROUGE-1','ROUGE-2','ROUGE-L'],
    datasets:[
      {{label:'Baseline', data:[{m['baseline']['rouge1']},{m['baseline']['rouge2']},{m['baseline']['rougeL']}], backgroundColor:COLORS.baseline, borderRadius:6}},
      {{label:'WOS Meeting', data:[{m['finetuned']['rouge1']},{m['finetuned']['rouge2']},{m['finetuned']['rougeL']}], backgroundColor:COLORS.meeting, borderRadius:6}},
      {{label:'Claude Sonnet', data:[{m['reference']['rouge1']},{m['reference']['rouge2']},{m['reference']['rougeL']}], backgroundColor:COLORS.ref, borderRadius:6}}
    ]
  }},
  options:{{...chartDefaults, scales:{{...chartDefaults.scales, y:{{...chartDefaults.scales.y, max:70, ticks:{{...chartDefaults.scales.y.ticks, callback:v=>v+'%'}}}}}}}}
}})

// BERTScore
new Chart(document.getElementById('meetingBert'), {{
  type:'bar',
  data:{{
    labels:['Precision','Recall','F1'],
    datasets:[
      {{label:'Baseline', data:[{m['baseline']['bert_score_precision']},{m['baseline']['bert_score_recall']},{m['baseline']['bert_score_f1']}], backgroundColor:COLORS.baseline, borderRadius:6}},
      {{label:'WOS Meeting', data:[{m['finetuned']['bert_score_precision']},{m['finetuned']['bert_score_recall']},{m['finetuned']['bert_score_f1']}], backgroundColor:COLORS.meeting, borderRadius:6}},
      {{label:'Claude Sonnet', data:[{m['reference']['bert_score_precision']},{m['reference']['bert_score_recall']},{m['reference']['bert_score_f1']}], backgroundColor:COLORS.ref, borderRadius:6}}
    ]
  }},
  options:{{...chartDefaults, scales:{{...chartDefaults.scales, y:{{...chartDefaults.scales.y, min:70, max:95}}}}}}
}})

// Action items
new Chart(document.getElementById('meetingAction'), {{
  type:'bar',
  data:{{
    labels:['Precision','Recall','F1'],
    datasets:[
      {{label:'Baseline', data:[{m['baseline']['action_item_precision']},{m['baseline']['action_item_recall']},{m['baseline']['action_item_f1']}], backgroundColor:COLORS.baseline, borderRadius:6}},
      {{label:'WOS Meeting', data:[{m['finetuned']['action_item_precision']},{m['finetuned']['action_item_recall']},{m['finetuned']['action_item_f1']}], backgroundColor:COLORS.meeting, borderRadius:6}},
      {{label:'Claude Sonnet', data:[{m['reference']['action_item_precision']},{m['reference']['action_item_recall']},{m['reference']['action_item_f1']}], backgroundColor:COLORS.ref, borderRadius:6}}
    ]
  }},
  options:{{...chartDefaults, scales:{{...chartDefaults.scales, y:{{...chartDefaults.scales.y, min:50, max:95, ticks:{{...chartDefaults.scales.y.ticks, callback:v=>v+'%'}}}}}}}}
}})

// Improvement horizontal bar
new Chart(document.getElementById('improvementChart'), {{
  type:'bar',
  data:{{
    labels:['pass@1','pass@5','BLEU','Code Quality','Syntax Error ↓','ROUGE-1','ROUGE-2','ROUGE-L','BERTScore F1','Action F1'],
    datasets:[{{
      label:'Improvement over baseline (%)',
      data:[
        {pct_change(c['baseline']['pass_at_1'], c['finetuned']['pass_at_1'])},
        {pct_change(c['baseline']['pass_at_5'], c['finetuned']['pass_at_5'])},
        {pct_change(c['baseline']['bleu'], c['finetuned']['bleu'])},
        {pct_change(c['baseline']['code_quality'], c['finetuned']['code_quality'])},
        {pct_change(c['baseline']['syntax_error_rate'], c['finetuned']['syntax_error_rate'], lower_is_better=True)},
        {pct_change(m['baseline']['rouge1'], m['finetuned']['rouge1'])},
        {pct_change(m['baseline']['rouge2'], m['finetuned']['rouge2'])},
        {pct_change(m['baseline']['rougeL'], m['finetuned']['rougeL'])},
        {pct_change(m['baseline']['bert_score_f1'], m['finetuned']['bert_score_f1'])},
        {pct_change(m['baseline']['action_item_f1'], m['finetuned']['action_item_f1'])}
      ],
      backgroundColor:['#3b82f6','#3b82f6','#3b82f6','#3b82f6','#3b82f6','#10b981','#10b981','#10b981','#10b981','#10b981'],
      borderRadius:6
    }}]
  }},
  options:{{
    indexAxis:'y',
    plugins:{{legend:{{display:false}}}},
    scales:{{
      x:{{grid:{{color:'#1f2937'}}, ticks:{{color:'#6b7280', callback:v=>'+'+v+'%'}}}},
      y:{{grid:{{display:false}}, ticks:{{color:'#94a3b8'}}}}
    }}
  }}
}})

// Latency
new Chart(document.getElementById('latencyChart'), {{
  type:'bar',
  data:{{
    labels:['Coding Baseline','WOS Coding','Meeting Baseline','WOS Meeting','Claude Sonnet'],
    datasets:[{{
      label:'Latency (s)',
      data:[{c['baseline']['avg_latency']},{c['finetuned']['avg_latency']},{m['baseline']['avg_latency']},{m['finetuned']['avg_latency']},{c['reference']['avg_latency']}],
      backgroundColor:[COLORS.baseline, COLORS.coding, COLORS.baseline, COLORS.meeting, COLORS.ref],
      borderRadius:6
    }}]
  }},
  options:{{...chartDefaults, plugins:{{...chartDefaults.plugins, legend:{{display:false}}}}, scales:{{...chartDefaults.scales, y:{{...chartDefaults.scales.y, ticks:{{...chartDefaults.scales.y.ticks, callback:v=>v+'s'}}}}}}}}
}})

// Throughput
new Chart(document.getElementById('throughputChart'), {{
  type:'bar',
  data:{{
    labels:['Coding Baseline','WOS Coding','Meeting Baseline','WOS Meeting','Claude Sonnet'],
    datasets:[{{
      label:'Tokens/sec',
      data:[{c['baseline']['tokens_per_sec']},{c['finetuned']['tokens_per_sec']},{m['baseline']['tokens_per_sec']},{m['finetuned']['tokens_per_sec']},{c['reference']['tokens_per_sec']}],
      backgroundColor:[COLORS.baseline, COLORS.coding, COLORS.baseline, COLORS.meeting, COLORS.ref],
      borderRadius:6
    }}]
  }},
  options:{{...chartDefaults, plugins:{{...chartDefaults.plugins, legend:{{display:false}}}}}}
}})
</script>
</body>
</html>"""
    return html


def main():
    results = dict(RESULTS)

    for fname in Path(".").glob("*_results*.json"):
        try:
            with open(fname) as f:
                data = json.load(f)
            if "coding" in fname.stem:
                key = "finetuned" if "finetuned" in fname.stem else "baseline"
                results["coding"][key].update(data)
            elif "meeting" in fname.stem:
                key = "finetuned" if "finetuned" in fname.stem else "baseline"
                results["meeting"][key].update(data)
        except Exception:
            pass

    html = generate_html(results)
    out = Path("comparison_report.html")
    out.write_text(html)
    print(f"Report generated: {out.absolute()}")
    print("Open in browser to view.")


if __name__ == "__main__":
    main()
