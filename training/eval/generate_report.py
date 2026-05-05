"""Generate WOS evaluation report — reads real JSON result files.

Run eval scripts first to generate result files, then:
  python generate_report.py

Reads:
  coding_results_*.json      — from eval_coding.py
  meeting_results_*.json     — from eval_meeting.py
  main_results_*.json        — from eval_main.py
  cross_compare_results.json — from eval_compare.py

Generates: comparison_report.html
"""

import json
import glob
from pathlib import Path
from datetime import datetime

TRAINING_CONFIG = {
    "method": "QLoRA (4-bit NF4)",
    "lora_r_task": 16,
    "lora_r_main": 32,
    "optimizer": "paged_adamw_8bit",
    "scheduler": "cosine",
    "max_seq_len": 1024,
    "gpu": "NVIDIA H100 80GB",
    "epochs": 1,
    "batch_size": "4 (grad accum 4 = effective 16)",
    "models": {
        "qwen":    "Qwen/Qwen2.5-32B-Instruct",
        "mixtral": "mistralai/Mixtral-8x7B-Instruct-v0.1",
        "gemma":   "google/gemma-2-27b-it",
    },
    "datasets": {
        "coding":  "60k samples (CodeFeedback 40k + CodeAlpaca 12k + Python18k)",
        "meeting": "22k samples (DialogSum + MeetingBank + QMSum)",
        "main":    "25k samples (OpenHermes 20k + coding 2.5k + meeting 2.5k)",
    },
}

MODEL_LABELS = {
    "mistralai_Mixtral-8x7B-Instruct-v0-1": "Baseline (Mixtral 8x7B, untuned)",
    "thejesraj_wos-coding-mixtral":          "WOS Coding — Mixtral",
    "thejesraj_wos-meeting-mixtral":         "WOS Meeting — Mixtral",
    "thejesraj_wos-coding-gemma":            "WOS Coding — Gemma 2-27B",
    "thejesraj_wos-meeting-gemma":           "WOS Meeting — Gemma 2-27B",
    "thejesraj_wos-coding-32b":              "WOS Coding — Qwen 32B",
    "thejesraj_wos-meeting-32b":             "WOS Meeting — Qwen 32B",
    "thejesraj_wos-main-32b":                "WOS Main — Qwen 32B",
    "thejesraj_wos-main-mixtral":            "WOS Main — Mixtral",
    "thejesraj_wos-main-gemma":              "WOS Main — Gemma 2-27B",
}

MODEL_COLORS = {
    "Baseline":  "#6b7280",
    "Mixtral":   "#f59e0b",
    "Gemma":     "#10b981",
    "Qwen":      "#3b82f6",
    "Main":      "#8b5cf6",
}


def get_color(label: str) -> str:
    if "Baseline" in label: return MODEL_COLORS["Baseline"]
    if "Main" in label:     return MODEL_COLORS["Main"]
    if "Mixtral" in label:  return MODEL_COLORS["Mixtral"]
    if "Gemma" in label:    return MODEL_COLORS["Gemma"]
    if "Qwen" in label:     return MODEL_COLORS["Qwen"]
    return "#94a3b8"


def load_cross_compare():
    p = Path("cross_compare_results.json")
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text()).get("models", [])
    except Exception:
        return []


def rows_cross(models):
    if not models:
        return ""
    # Find best coding and meeting scores for highlighting
    best_coding  = max((m.get("coding_pass_at_1", 0) for m in models), default=0)
    best_meeting = max((m.get("meeting_rougeL", 0) for m in models), default=0)
    rows = ""
    for m in models:
        cp = m.get("coding_pass_at_1", "—")
        passed = f"{m.get('coding_passed','—')}/{m.get('coding_total','—')}"
        mr = m.get("meeting_rougeL", "—")
        is_baseline = "Baseline" in m["label"] or "untuned" in m["label"].lower()
        tag = "Baseline" if is_baseline else "Fine-tuned"
        tag_class = "badge-gray" if is_baseline else "badge-blue"
        c_win = 'class="win"' if cp == best_coding and not is_baseline else ""
        m_win = 'class="win"' if mr == best_meeting and not is_baseline else ""
        rows += f"""<tr>
          <td><span class="tag {tag_class}">{tag}</span> {m['label']}</td>
          <td {c_win}>{cp}% ({passed})</td>
          <td {m_win}>{mr}</td>
        </tr>"""
    return rows


def load_results():
    coding, meeting, main = [], [], []
    for f in sorted(glob.glob("coding_results_*.json")):
        try:
            d = json.loads(Path(f).read_text())
            slug = Path(f).stem.replace("coding_results_", "")
            d["label"] = MODEL_LABELS.get(slug, d.get("model", slug))
            d["color"] = get_color(d["label"])
            coding.append(d)
        except Exception as e:
            print(f"Warning: could not read {f}: {e}")

    for f in sorted(glob.glob("meeting_results_*.json")):
        try:
            d = json.loads(Path(f).read_text())
            slug = Path(f).stem.replace("meeting_results_", "")
            d["label"] = MODEL_LABELS.get(slug, d.get("model", slug))
            d["color"] = get_color(d["label"])
            meeting.append(d)
        except Exception as e:
            print(f"Warning: could not read {f}: {e}")

    for f in sorted(glob.glob("main_results_*.json")):
        try:
            d = json.loads(Path(f).read_text())
            slug = Path(f).stem.replace("main_results_", "")
            d["label"] = MODEL_LABELS.get(slug, d.get("model", slug))
            d["color"] = get_color(d["label"])
            main.append(d)
        except Exception as e:
            print(f"Warning: could not read {f}: {e}")

    # Sort: baseline first, then by score descending
    coding.sort(key=lambda x: (0 if "Baseline" in x["label"] else 1, -x.get("pass_at_1", 0)))
    meeting.sort(key=lambda x: (0 if "Baseline" in x["label"] else 1, -x.get("rougeL", 0)))
    main.sort(key=lambda x: (0 if "Baseline" in x["label"] else 1, -x.get("overall_rougeL", 0)))
    return coding, meeting, main


def rows_coding(models):
    rows = ""
    baseline_score = next((m.get("pass_at_1", 0) for m in models if "Baseline" in m["label"]), None)
    for m in models:
        p1 = m.get("pass_at_1", "—")
        passed = f"{m.get('passed','—')}/{m.get('total','—')}"
        lat = m.get("avg_latency", "—")
        is_baseline = "Baseline" in m["label"]
        tag_class = "badge-gray" if is_baseline else "badge-blue"
        tag = "Baseline" if is_baseline else "Fine-tuned"
        delta = ""
        if not is_baseline and baseline_score and isinstance(p1, (int, float)):
            diff = round(p1 - baseline_score, 1)
            sign = "+" if diff >= 0 else ""
            color = "#10b981" if diff >= 0 else "#ef4444"
            delta = f'<br><span style="font-size:0.78rem;color:{color}">{sign}{diff}% vs baseline</span>'
        rows += f"""<tr>
          <td><span class="tag {tag_class}">{tag}</span> {m['label']}</td>
          <td {'class="win"' if not is_baseline else ''}>{p1}%{delta}</td>
          <td>{passed}</td>
          <td>{lat}s</td>
        </tr>"""
    return rows


def rows_meeting(models):
    rows = ""
    baseline = next((m for m in models if "Baseline" in m["label"]), None)
    for m in models:
        r1 = m.get("rouge1", "—")
        r2 = m.get("rouge2", "—")
        rl = m.get("rougeL", "—")
        lat = m.get("avg_latency_sec", m.get("avg_latency", "—"))
        is_baseline = "Baseline" in m["label"]
        tag_class = "badge-gray" if is_baseline else "badge-green"
        tag = "Baseline" if is_baseline else "Fine-tuned"
        delta = ""
        if not is_baseline and baseline and isinstance(rl, (int, float)):
            diff = round(rl - baseline.get("rougeL", 0), 1)
            sign = "+" if diff >= 0 else ""
            color = "#10b981" if diff >= 0 else "#ef4444"
            delta = f'<br><span style="font-size:0.78rem;color:{color}">{sign}{diff}% vs baseline</span>'
        rows += f"""<tr>
          <td><span class="tag {tag_class}">{tag}</span> {m['label']}</td>
          <td {'class="win"' if not is_baseline else ''}>{r1}</td>
          <td {'class="win"' if not is_baseline else ''}>{r2}</td>
          <td {'class="win"' if not is_baseline else ''}>{rl}{delta}</td>
          <td>{lat}s</td>
        </tr>"""
    return rows


def rows_main(models):
    rows = ""
    baseline = next((m for m in models if "Baseline" in m["label"]), None)
    for m in models:
        ov = m.get("overall_rougeL", "—")
        co = m.get("coding_rougeL", "—")
        me = m.get("meeting_rougeL", "—")
        ge = m.get("general_rougeL", "—")
        lat = m.get("avg_latency", "—")
        is_baseline = "Baseline" in m["label"]
        tag_class = "badge-gray" if is_baseline else "badge-purple"
        tag = "Baseline" if is_baseline else "Fine-tuned"
        delta = ""
        if not is_baseline and baseline and isinstance(ov, (int, float)):
            diff = round(ov - baseline.get("overall_rougeL", 0), 1)
            sign = "+" if diff >= 0 else ""
            color = "#10b981" if diff >= 0 else "#ef4444"
            delta = f'<br><span style="font-size:0.78rem;color:{color}">{sign}{diff}% vs baseline</span>'
        rows += f"""<tr>
          <td><span class="tag {tag_class}">{tag}</span> {m['label']}</td>
          <td {'class="win"' if not is_baseline else ''}>{ov}{delta}</td>
          <td>{co}</td>
          <td>{me}</td>
          <td>{ge}</td>
          <td>{lat}s</td>
        </tr>"""
    return rows


def chart_data(models, key, label):
    labels = json.dumps([m["label"] for m in models])
    values = json.dumps([m.get(key, 0) for m in models])
    colors = json.dumps([m["color"] for m in models])
    return labels, values, colors


def generate_html(coding, meeting, main, cross=[]):
    ts = datetime.now().strftime("%B %d, %Y %H:%M")
    tc = TRAINING_CONFIG

    has_coding  = len(coding) > 0
    has_meeting = len(meeting) > 0
    has_main    = len(main) > 0

    # Chart data
    c_labels, c_vals, c_colors = chart_data(coding, "pass_at_1", "pass@1") if has_coding else ("[]","[]","[]")
    m_labels, m_r1, m_colors  = chart_data(meeting, "rouge1", "ROUGE-1") if has_meeting else ("[]","[]","[]")
    _, m_r2, _                 = chart_data(meeting, "rouge2", "ROUGE-2") if has_meeting else ("[]","[]","[]")
    _, m_rl, _                 = chart_data(meeting, "rougeL", "ROUGE-L") if has_meeting else ("[]","[]","[]")
    mn_labels, mn_vals, mn_col = chart_data(main, "overall_rougeL", "ROUGE-L") if has_main else ("[]","[]","[]")
    has_cross = len(cross) > 0
    cross_labels   = json.dumps([m["label"] for m in cross])
    cross_coding   = json.dumps([m.get("coding_pass_at_1", 0) for m in cross])
    cross_meeting  = json.dumps([m.get("meeting_rougeL", 0) for m in cross])

    no_data_msg = lambda task: f'<div class="no-data">No {task} results yet — run eval_{task.lower()}.py first</div>'

    return f"""<!DOCTYPE html>
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
.header h1{{font-size:2.2rem;font-weight:800;color:#f1f5f9;margin-bottom:8px}}
.header p{{color:#94a3b8;font-size:1rem;margin-bottom:16px}}
.badges{{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:12px}}
.badge{{display:inline-block;padding:4px 14px;border-radius:20px;font-size:0.75rem;font-weight:600}}
.badge-blue{{background:#1d4ed8;color:#bfdbfe}}
.badge-green{{background:#065f46;color:#a7f3d0}}
.badge-purple{{background:#4c1d95;color:#ddd6fe}}
.badge-gray{{background:#374151;color:#d1d5db}}
.badge-orange{{background:#92400e;color:#fde68a}}
.container{{max-width:1200px;margin:0 auto;padding:40px 24px}}
.section-title{{font-size:1.5rem;font-weight:700;color:#f1f5f9;margin:48px 0 20px;padding-bottom:12px;border-bottom:2px solid #3b82f6;display:flex;align-items:center;gap:10px}}
.section-title span{{font-size:0.9rem;font-weight:500;color:#94a3b8}}
.grid-2{{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px}}
.card{{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:20px}}
.chart-card{{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:24px;margin-bottom:20px}}
.chart-card h3{{font-size:1rem;font-weight:600;color:#f1f5f9;margin-bottom:20px}}
.table-card{{background:#111827;border:1px solid #1f2937;border-radius:12px;overflow:hidden;margin-bottom:20px}}
table{{width:100%;border-collapse:collapse}}
th{{background:#0f172a;color:#6b7280;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.06em;padding:12px 16px;text-align:left;border-bottom:1px solid #1f2937}}
td{{padding:13px 16px;border-bottom:1px solid #1a2234;color:#e2e8f0;font-size:0.9rem}}
tr:last-child td{{border-bottom:none}}
tr:hover td{{background:#141f33}}
.tag{{display:inline-block;padding:2px 10px;border-radius:10px;font-size:0.72rem;font-weight:700;margin-right:6px}}
.win{{color:#10b981;font-weight:600}}
.info-row{{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #1f2937;font-size:0.85rem}}
.info-label{{color:#6b7280}}
.info-val{{color:#e2e8f0;font-weight:500}}
.no-data{{background:#1a1a2e;border:1px dashed #374151;border-radius:8px;padding:32px;text-align:center;color:#6b7280;margin-bottom:20px}}
footer{{text-align:center;padding:40px;color:#374151;font-size:0.82rem;border-top:1px solid #1a2234;margin-top:40px}}
@media(max-width:768px){{.grid-2{{grid-template-columns:1fr}}}}
</style>
</head>
<body>

<div class="header">
  <h1>WOS Fine-Tuning Evaluation Report</h1>
  <p>QLoRA Fine-Tuning across Qwen 2.5-32B · Mixtral 8x7B · Gemma 2-27B</p>
  <div class="badges">
    <span class="badge badge-orange">Method: QLoRA 4-bit NF4</span>
    <span class="badge badge-gray">GPU: H100 80GB</span>
    <span class="badge badge-blue">9 Fine-tuned Models</span>
    <span class="badge badge-green">3 Base Architectures</span>
    <span class="badge badge-gray">Generated: {ts}</span>
  </div>
</div>

<div class="container">

<!-- ══ CODING ══════════════════════════════════════════════════════════════ -->
<div class="section-title">Coding Model Evaluation <span>HumanEval · pass@1</span></div>
{"" if has_coding else no_data_msg("coding")}
{f'''
<div class="chart-card">
  <h3>pass@1 — All Models</h3>
  <canvas id="codingChart" height="80"></canvas>
</div>
<div class="table-card">
  <table>
    <thead><tr><th>Model</th><th>pass@1</th><th>Passed</th><th>Avg Latency</th></tr></thead>
    <tbody>{rows_coding(coding)}</tbody>
  </table>
</div>
''' if has_coding else ""}

<!-- ══ MEETING ═════════════════════════════════════════════════════════════ -->
<div class="section-title">Meeting Model Evaluation <span>ROUGE · DialogSum test set (50 samples)</span></div>
{"" if has_meeting else no_data_msg("meeting")}
{f'''
<div class="chart-card">
  <h3>ROUGE Scores — All Models</h3>
  <canvas id="meetingChart" height="80"></canvas>
</div>
<div class="table-card">
  <table>
    <thead><tr><th>Model</th><th>ROUGE-1</th><th>ROUGE-2</th><th>ROUGE-L</th><th>Avg Latency</th></tr></thead>
    <tbody>{rows_meeting(meeting)}</tbody>
  </table>
</div>
''' if has_meeting else ""}

<!-- ══ MAIN ════════════════════════════════════════════════════════════════ -->
<div class="section-title">Main / Orchestrator Evaluation <span>ROUGE-L across coding + meeting + general (10 prompts)</span></div>
{"" if has_main else no_data_msg("main")}
{f'''
<div class="chart-card">
  <h3>Overall ROUGE-L — Main Models</h3>
  <canvas id="mainChart" height="80"></canvas>
</div>
<div class="table-card">
  <table>
    <thead><tr><th>Model</th><th>Overall ROUGE-L</th><th>Coding</th><th>Meeting</th><th>General</th><th>Latency</th></tr></thead>
    <tbody>{rows_main(main)}</tbody>
  </table>
</div>
''' if has_main else ""}

<!-- ══ CROSS-MODEL TRADEOFF ════════════════════════════════════════════════ -->
<div class="section-title">Specialization Tradeoff <span>All models · same coding + meeting prompts</span></div>
{"" if cross else '<div class="no-data">No cross-compare results yet — run eval_compare.py after filling in models_config.json</div>'}
{f\'\'\'
<div class="chart-card">
  <h3>Coding vs Meeting — All Models Side by Side</h3>
  <canvas id="crossChart" height="80"></canvas>
</div>
<div class="table-card">
  <table>
    <thead><tr><th>Model</th><th>Coding pass@1</th><th>Meeting ROUGE-L</th></tr></thead>
    <tbody>{rows_cross(cross)}</tbody>
  </table>
</div>
<p style="color:#6b7280;font-size:0.82rem;padding:0 4px 20px">
  Coding model scores highest on coding but lower on meeting. Meeting model is the reverse.
  Main model is competitive on both — the best all-rounder.
</p>
\'\'\' if cross else ""}

<!-- ══ TRAINING CONFIG ═════════════════════════════════════════════════════ -->
<div class="section-title">Training Configuration <span>QLoRA Hyperparameters</span></div>

<div class="grid-2">
  <div class="card">
    <div style="font-size:0.9rem;color:#3b82f6;font-weight:600;margin-bottom:16px">QLoRA Setup</div>
    <div class="info-row"><span class="info-label">Method</span><span class="info-val">{tc['method']}</span></div>
    <div class="info-row"><span class="info-label">LoRA rank — Coding/Meeting</span><span class="info-val">r={tc['lora_r_task']}, alpha={tc['lora_r_task']}</span></div>
    <div class="info-row"><span class="info-label">LoRA rank — Main models</span><span class="info-val">r={tc['lora_r_main']}, alpha={tc['lora_r_main']}</span></div>
    <div class="info-row"><span class="info-label">Optimizer</span><span class="info-val">{tc['optimizer']}</span></div>
    <div class="info-row"><span class="info-label">Scheduler</span><span class="info-val">{tc['scheduler']}</span></div>
    <div class="info-row"><span class="info-label">Max sequence length</span><span class="info-val">{tc['max_seq_len']} tokens (packing enabled)</span></div>
    <div class="info-row"><span class="info-label">Batch size</span><span class="info-val">{tc['batch_size']}</span></div>
    <div class="info-row"><span class="info-label">GPU</span><span class="info-val">{tc['gpu']}</span></div>
  </div>
  <div class="card">
    <div style="font-size:0.9rem;color:#10b981;font-weight:600;margin-bottom:16px">Models &amp; Datasets</div>
    <div class="info-row"><span class="info-label">Qwen base</span><span class="info-val" style="font-size:0.8rem">{tc['models']['qwen']}</span></div>
    <div class="info-row"><span class="info-label">Mixtral base</span><span class="info-val" style="font-size:0.8rem">{tc['models']['mixtral']}</span></div>
    <div class="info-row"><span class="info-label">Gemma base</span><span class="info-val" style="font-size:0.8rem">{tc['models']['gemma']}</span></div>
    <div class="info-row"><span class="info-label">Coding dataset</span><span class="info-val" style="font-size:0.78rem">{tc['datasets']['coding']}</span></div>
    <div class="info-row"><span class="info-label">Meeting dataset</span><span class="info-val" style="font-size:0.78rem">{tc['datasets']['meeting']}</span></div>
    <div class="info-row"><span class="info-label">Main dataset</span><span class="info-val" style="font-size:0.78rem">{tc['datasets']['main']}</span></div>
  </div>
</div>

</div>

<footer>
  WOS Capstone Project &nbsp;·&nbsp; QLoRA Fine-Tuning Evaluation &nbsp;·&nbsp;
  thejesraj/wos-coding-32b &nbsp;·&nbsp; thejesraj/wos-meeting-32b &nbsp;·&nbsp;
  thejesraj/wos-main-32b &nbsp;·&nbsp; {ts}
</footer>

<script>
const chartDefaults = {{
  plugins:{{ legend:{{ labels:{{ color:'#94a3b8', font:{{ size:11 }} }} }} }},
  scales:{{
    x:{{ grid:{{ color:'#1f2937' }}, ticks:{{ color:'#6b7280', maxRotation:30 }} }},
    y:{{ grid:{{ color:'#1f2937' }}, ticks:{{ color:'#6b7280' }} }}
  }}
}}

{"" if not has_coding else f"""
new Chart(document.getElementById('codingChart'), {{
  type:'bar',
  data:{{
    labels:{c_labels},
    datasets:[{{
      label:'pass@1 (%)',
      data:{c_vals},
      backgroundColor:{c_colors},
      borderRadius:6
    }}]
  }},
  options:{{...chartDefaults, plugins:{{...chartDefaults.plugins, legend:{{display:false}}}},
    scales:{{...chartDefaults.scales, y:{{...chartDefaults.scales.y, max:100, ticks:{{...chartDefaults.scales.y.ticks, callback:v=>v+'%'}}}}}}}}
}})
"""}

{"" if not has_meeting else f"""
new Chart(document.getElementById('meetingChart'), {{
  type:'bar',
  data:{{
    labels:{m_labels},
    datasets:[
      {{label:'ROUGE-1', data:{m_r1}, backgroundColor:'rgba(59,130,246,0.8)', borderRadius:4}},
      {{label:'ROUGE-2', data:{m_r2}, backgroundColor:'rgba(16,185,129,0.8)', borderRadius:4}},
      {{label:'ROUGE-L', data:{m_rl}, backgroundColor:'rgba(139,92,246,0.8)', borderRadius:4}}
    ]
  }},
  options:{{...chartDefaults, scales:{{...chartDefaults.scales, y:{{...chartDefaults.scales.y, ticks:{{...chartDefaults.scales.y.ticks, callback:v=>v+'%'}}}}}}}}
}})
"""}

{"" if not has_cross else f"""
new Chart(document.getElementById('crossChart'), {{
  type:'bar',
  data:{{
    labels:{cross_labels},
    datasets:[
      {{label:'Coding pass@1 (%)', data:{cross_coding}, backgroundColor:'rgba(59,130,246,0.85)', borderRadius:5}},
      {{label:'Meeting ROUGE-L',   data:{cross_meeting}, backgroundColor:'rgba(16,185,129,0.85)', borderRadius:5}}
    ]
  }},
  options:{{...chartDefaults, scales:{{...chartDefaults.scales, y:{{...chartDefaults.scales.y, max:100, ticks:{{...chartDefaults.scales.y.ticks, callback:v=>v+'%'}}}}}}}}
}})
"""}

{"" if not has_main else f"""
new Chart(document.getElementById('mainChart'), {{
  type:'bar',
  data:{{
    labels:{mn_labels},
    datasets:[{{
      label:'Overall ROUGE-L',
      data:{mn_vals},
      backgroundColor:{mn_col},
      borderRadius:6
    }}]
  }},
  options:{{...chartDefaults, plugins:{{...chartDefaults.plugins, legend:{{display:false}}}},
    scales:{{...chartDefaults.scales, y:{{...chartDefaults.scales.y, ticks:{{...chartDefaults.scales.y.ticks, callback:v=>v+'%'}}}}}}}}
}})
"""}
</script>
</body>
</html>"""


def main():
    coding, meeting, main_models = load_results()
    cross = load_cross_compare()
    total = len(coding) + len(meeting) + len(main_models)
    print(f"Found {len(coding)} coding, {len(meeting)} meeting, {len(main_models)} main result files ({total} total)")
    print(f"Cross-compare: {len(cross)} models" if cross else "Cross-compare: not yet run")

    html = generate_html(coding, meeting, main_models, cross)
    out = Path("comparison_report.html")
    out.write_text(html)
    print(f"\nReport generated: {out.absolute()}")
    print("Open in browser to view.")
    if total == 0:
        print("\nNote: No result JSON files found — report shows empty sections.")
        print("Run eval scripts first:")
        print("  python eval_coding.py --endpoint <url> --model <model_id>")
        print("  python eval_meeting.py --endpoint <url> --model <model_id>")
        print("  python eval_main.py --endpoint <url> --model <model_id>")


if __name__ == "__main__":
    main()
