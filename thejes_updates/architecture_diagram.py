"""
WOS System Architecture Diagram
Run: python3 thejes_updates/architecture_diagram.py
Output: thejes_updates/architecture_diagram.png
"""

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import matplotlib.patheffects as pe

BG      = "#0a0f1e"
C_USER  = "#1e3a5f"
C_APP   = "#4c1d95"
C_CORE  = "#1e3a5f"
C_INT   = "#374151"
C_ROUTE = "#065f46"
C_CODE  = "#1d4ed8"
C_MEET  = "#065f46"
C_MAIN  = "#4c1d95"
C_HF    = "#92400e"
C_TRAIN = "#7f1d1d"
C_EVAL  = "#1e3a5f"
C_DATA  = "#1f2937"
C_ARROW = "#475569"
C_ARROW_BRIGHT = "#64748b"

fig, ax = plt.subplots(figsize=(26, 20))
fig.patch.set_facecolor(BG)
ax.set_facecolor(BG)
ax.set_xlim(0, 26)
ax.set_ylim(0, 20)
ax.axis('off')


# ── Helpers ───────────────────────────────────────────────────────────────────

def box(x, y, w, h, color, lines, sizes=None, alpha=0.92, border=None, border_w=1.2):
    patch = FancyBboxPatch(
        (x, y), w, h,
        boxstyle="round,pad=0.12",
        facecolor=color,
        edgecolor=border if border else color,
        linewidth=border_w,
        alpha=alpha, zorder=3
    )
    ax.add_patch(patch)
    if isinstance(lines, str):
        lines = [lines]
    if sizes is None:
        sizes = [8.5] * len(lines)
    n = len(lines)
    step = h / (n + 1)
    for i, (txt, sz) in enumerate(zip(lines, sizes)):
        ax.text(x + w / 2, y + h - step * (i + 1),
                txt, ha='center', va='center',
                fontsize=sz, color='white', fontweight='bold',
                zorder=4)


def label(x, y, txt, sz=7.5, color='#94a3b8', ha='center'):
    ax.text(x, y, txt, ha=ha, va='center', fontsize=sz, color=color, zorder=4)


def arrow(x1, y1, x2, y2, color=C_ARROW, lw=1.4, style='->'):
    ax.annotate('', xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle=style, color=color,
                                lw=lw, connectionstyle='arc3,rad=0.0'),
                zorder=2)


def section_bg(x, y, w, h, color, title, title_sz=8):
    patch = FancyBboxPatch(
        (x, y), w, h,
        boxstyle="round,pad=0.15",
        facecolor=color, edgecolor='#1e293b',
        linewidth=1.0, alpha=0.35, zorder=1
    )
    ax.add_patch(patch)
    ax.text(x + 0.18, y + h - 0.22, title,
            ha='left', va='top', fontsize=title_sz,
            color='#94a3b8', fontweight='bold', zorder=4,
            style='italic')


# ══════════════════════════════════════════════════════════════════════════════
# TITLE
# ══════════════════════════════════════════════════════════════════════════════
ax.text(13, 19.55, "WOS — AI Desktop Assistant · System Architecture",
        ha='center', va='top', fontsize=16, color='#f1f5f9',
        fontweight='bold', zorder=5)
ax.text(13, 19.15, "DATA 298A/B Capstone · QLoRA Fine-Tuning · HuggingFace Inference Endpoints",
        ha='center', va='top', fontsize=9, color='#64748b', zorder=5)

# ══════════════════════════════════════════════════════════════════════════════
# ROW 1 — USER
# ══════════════════════════════════════════════════════════════════════════════
box(10.5, 17.8, 5, 0.9, C_USER,
    ["👤  User / Developer"],
    sizes=[10], border='#3b82f6')

# ══════════════════════════════════════════════════════════════════════════════
# ROW 2 — ELECTRON APP (big container)
# ══════════════════════════════════════════════════════════════════════════════
section_bg(1.5, 14.8, 23, 2.65, '#1e1b4b', "Electron Desktop App  (React + TypeScript + Vite)", 8.5)

box(2.2,  15.1, 4.8, 1.8, "#1e3a8a",
    ["Meeting Intelligence", "• Live transcript capture",
     "• Auto summarisation", "• Action item extraction"],
    sizes=[8.5, 7, 7, 7])

box(7.4,  15.1, 4.8, 1.8, "#1e3a8a",
    ["Coding Assistant", "• Code completion",
     "• Inline suggestions", "• Debugging help"],
    sizes=[8.5, 7, 7, 7])

box(12.6, 15.1, 4.8, 1.8, "#1e3a8a",
    ["Projects & Tasks", "• Task management",
     "• Decisions tracker", "• Risk log"],
    sizes=[8.5, 7, 7, 7])

box(17.8, 15.1, 4.8, 1.8, "#1e3a8a",
    ["Automation System", "• Jira integration",
     "• Google Calendar", "• Slack notifications"],
    sizes=[8.5, 7, 7, 7])

# ══════════════════════════════════════════════════════════════════════════════
# ROW 3 — APP CORE
# ══════════════════════════════════════════════════════════════════════════════
section_bg(1.5, 12.3, 23, 2.2, '#0f172a', "Electron Main Process  (Node.js + IPC)", 8.5)

box(2.2,  12.6, 5.5, 1.6, C_INT,
    ["External Integrations", "Jira API  |  Google Calendar API",
     "Slack API  |  OAuth 2.0"],
    sizes=[8.5, 7.5, 7.5], border='#374151')

box(9.0,  12.6, 7.8, 1.6, "#1e293b",
    ["IPC Bridge  (ipcMain / ipcRenderer)",
     "Preload Scripts  →  Context Isolation",
     "Keystore  (encrypted API key storage)"],
    sizes=[8.5, 7.5, 7.5], border='#334155')

box(18.1, 12.6, 5.8, 1.6, C_CORE,
    ["vLLM Provider  (vllm.ts)",
     "OpenAI-compat /v1/chat/completions",
     "Per-model endpoint routing"],
    sizes=[8.5, 7.5, 7.5], border='#3b82f6')

# ══════════════════════════════════════════════════════════════════════════════
# ROW 4 — MODEL ROUTER
# ══════════════════════════════════════════════════════════════════════════════
box(7.0, 10.7, 12, 1.25, C_ROUTE,
    ["Model Router  —  Main Orchestrator",
     "Classifies task type → routes to Coding / Meeting / General specialist"],
    sizes=[9.5, 8], border='#10b981')

# ══════════════════════════════════════════════════════════════════════════════
# ROW 5 — 9 FINE-TUNED MODELS (3 groups × 3 architectures)
# ══════════════════════════════════════════════════════════════════════════════
section_bg(0.5, 7.5, 25, 2.85, '#0c1a35',
           "9 Fine-tuned WOS Models  (QLoRA 4-bit NF4 · HuggingFace Inference Endpoints)", 8.5)

# — Coding column
box(1.0,  7.85, 7.5, 2.25, C_CODE,
    ["Coding Specialists  (×3)",
     "wos-coding-32b   |  Qwen 2.5-32B",
     "wos-coding-gemma |  Gemma 2-27B",
     "wos-coding-mixtral| Mixtral 8x7B",
     "Metric: HumanEval pass@1"],
    sizes=[8.5, 7.5, 7.5, 7.5, 7], border='#3b82f6')

# — Meeting column
box(9.25, 7.85, 7.5, 2.25, C_MEET,
    ["Meeting Specialists  (×3)",
     "wos-meeting-32b   |  Qwen 2.5-32B",
     "wos-meeting-gemma |  Gemma 2-27B",
     "wos-meeting-mixtral| Mixtral 8x7B",
     "Metric: ROUGE-L + BERTScore"],
    sizes=[8.5, 7.5, 7.5, 7.5, 7], border='#10b981')

# — Main/Orchestrator column
box(17.5, 7.85, 7.5, 2.25, C_MAIN,
    ["Main Orchestrators  (×3)",
     "wos-main-32b   |  Qwen 2.5-32B",
     "wos-main-gemma |  Gemma 2-27B",
     "wos-main-mixtral| Mixtral 8x7B",
     "Metric: ROUGE-L (all domains)"],
    sizes=[8.5, 7.5, 7.5, 7.5, 7], border='#8b5cf6')

# ══════════════════════════════════════════════════════════════════════════════
# ROW 6 — HUGGINGFACE
# ══════════════════════════════════════════════════════════════════════════════
box(5.0, 6.0, 16, 1.2, C_HF,
    ["HuggingFace  —  Model Storage + Inference Endpoints",
     "huggingface.co/thejesraj  ·  9 repos  ·  OpenAI-compatible /v1 API  ·  Scales to zero"],
    sizes=[9, 7.5], border='#f59e0b')

# ══════════════════════════════════════════════════════════════════════════════
# ROW 7 — TRAINING  +  EVALUATION (side by side)
# ══════════════════════════════════════════════════════════════════════════════

# Training pipeline
section_bg(0.5, 3.2, 11.5, 2.55, '#1a0a00', "Training Pipeline", 8)

box(1.0, 3.55, 5.0, 1.9, C_TRAIN,
    ["RunPod H100 80GB",
     "QLoRA  4-bit NF4",
     "LoRA r=16 (task)  r=32 (main)",
     "paged_adamw_8bit · cosine LR",
     "1 epoch · eff. batch 16"],
    sizes=[8.5, 8, 7.5, 7.5, 7.5], border='#ef4444')

box(6.5, 3.55, 5.0, 1.9, "#2d1515",
    ["Auto-resume  (checkpoints)",
     "Auto batch-size scaling",
     "HF upload on completion",
     "3 base models trained",
     "→ 9 fine-tuned adapters"],
    sizes=[8, 7.5, 7.5, 7.5, 7.5], border='#7f1d1d')

# Evaluation pipeline
section_bg(13.0, 3.2, 12.5, 2.55, '#001a1a', "Evaluation Pipeline", 8)

box(13.5, 3.55, 5.5, 1.9, C_EVAL,
    ["eval_coding.py",
     "HumanEval  164 problems",
     "pass@1 / pass@5 / pass@10",
     "BLEU · Syntax Error Rate",
     "Code Quality score"],
    sizes=[8.5, 7.5, 7.5, 7.5, 7.5], border='#06b6d4')

box(19.5, 3.55, 5.5, 1.9, C_EVAL,
    ["eval_meeting.py  +  eval_main.py",
     "ROUGE-1/2/L  ·  BERTScore F1",
     "Action Item P/R/F1",
     "eval_compare.py  (cross-model)",
     "→  comparison_report.html"],
    sizes=[8.5, 7.5, 7.5, 7.5, 7.5], border='#06b6d4')

# ══════════════════════════════════════════════════════════════════════════════
# ROW 8 — DATASETS
# ══════════════════════════════════════════════════════════════════════════════
section_bg(0.5, 0.9, 25, 2.1, '#111827', "Training Datasets", 8)

box(1.0,  1.15, 7.5, 1.55, C_DATA,
    ["Coding Dataset  (60k samples)",
     "CodeFeedback 40k  +  CodeAlpaca 12k",
     "Python18k  ·  80/20 train/eval split"],
    sizes=[8.5, 7.5, 7.5], border='#3b82f6')

box(9.25, 1.15, 7.5, 1.55, C_DATA,
    ["Meeting Dataset  (22k samples)",
     "DialogSum  +  MeetingBank  +  QMSum",
     "Transcript summaries + action items"],
    sizes=[8.5, 7.5, 7.5], border='#10b981')

box(17.5, 1.15, 7.5, 1.55, C_DATA,
    ["Main Dataset  (25k samples)",
     "OpenHermes 20k  +  Coding 2.5k  +  Meeting 2.5k",
     "General + task-mixed instruction tuning"],
    sizes=[8.5, 7.5, 7.5], border='#8b5cf6')


# ══════════════════════════════════════════════════════════════════════════════
# ARROWS
# ══════════════════════════════════════════════════════════════════════════════

# User → App
arrow(13, 17.8, 13, 17.45, color='#3b82f6')

# App → Core (IPC)
arrow(13, 14.8, 13, 14.5, color=C_ARROW_BRIGHT)

# Core (vLLM) → Router
arrow(21, 12.6, 16, 11.95, color='#3b82f6')
arrow(13, 12.6, 13, 11.95, color=C_ARROW_BRIGHT)

# Router → 3 model groups
arrow(10, 10.7, 5.0, 10.1, color='#3b82f6')   # → coding
arrow(13, 10.7, 13, 10.1, color='#10b981')     # → meeting
arrow(16, 10.7, 21, 10.1, color='#8b5cf6')     # → main

# Models → HuggingFace
arrow(5.0,  7.85, 9.0,  7.2, color='#f59e0b')
arrow(13,   7.85, 13,   7.2, color='#f59e0b')
arrow(21.0, 7.85, 17.0, 7.2, color='#f59e0b')

# HuggingFace ← Training (upload)
arrow(6.5, 4.55, 6.5, 6.0,  color='#ef4444')
label(5.5, 5.3, "upload", sz=7, color='#ef4444')

# HuggingFace → Eval
arrow(19.5, 6.0, 19.5, 5.45, color='#06b6d4')
label(20.8, 5.7, "inference", sz=7, color='#06b6d4')

# Datasets → Training
arrow(5.0, 2.7, 5.0, 3.55, color='#f59e0b')
label(3.8, 3.1, "60k samples", sz=7, color='#f59e0b')

arrow(13,  2.7, 8.0, 3.55, color='#10b981')
label(10.8, 3.0, "22k samples", sz=7, color='#10b981')

arrow(21.0, 2.7, 8.5, 3.55, color='#8b5cf6')
label(15.5, 2.85, "25k samples", sz=7, color='#8b5cf6')


# ══════════════════════════════════════════════════════════════════════════════
# LEGEND
# ══════════════════════════════════════════════════════════════════════════════
legend_items = [
    (C_USER,  "User Interface"),
    (C_APP,   "Electron App (UI)"),
    (C_CORE,  "App Core / IPC"),
    (C_ROUTE, "Model Router"),
    (C_CODE,  "Coding Models"),
    (C_MEET,  "Meeting Models"),
    (C_MAIN,  "Main Models"),
    (C_HF,    "HuggingFace"),
    (C_TRAIN, "Training"),
    (C_EVAL,  "Evaluation"),
    (C_DATA,  "Datasets"),
]
patches = [mpatches.Patch(color=c, label=l) for c, l in legend_items]
ax.legend(handles=patches, loc='upper left', bbox_to_anchor=(0.0, 0.995),
          fontsize=7.5, facecolor='#1e293b', edgecolor='#334155',
          labelcolor='#e2e8f0', framealpha=0.95,
          ncol=1, handlelength=1.2, handleheight=1.0)


plt.tight_layout(pad=0.3)
plt.savefig("thejes_updates/architecture_diagram.png",
            dpi=160, bbox_inches='tight',
            facecolor=fig.get_facecolor())
print("Saved: thejes_updates/architecture_diagram.png")
plt.show()
