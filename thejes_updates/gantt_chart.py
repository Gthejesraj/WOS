"""
WOS Capstone Project — Gantt Chart Generator
Run: python gantt_chart.py
Outputs: gantt_chart.png
"""

import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from datetime import datetime, timedelta
import numpy as np

# ── Task definitions ──────────────────────────────────────────────────────────
# (Phase, Task name, Start date, End date, Color)
tasks = [
    # Phase 1 — Research & Planning
    ("Phase 1: Research & Planning",  "Literature Review",               "2025-09-01", "2025-10-15", "#3b82f6"),
    ("Phase 1: Research & Planning",  "Technology Survey",               "2025-09-15", "2025-10-31", "#3b82f6"),
    ("Phase 1: Research & Planning",  "Requirements Definition",         "2025-10-01", "2025-10-31", "#3b82f6"),
    ("Phase 1: Research & Planning",  "Project Plan & WBS",              "2025-10-01", "2025-11-01", "#3b82f6"),

    # Phase 2 — Data Engineering
    ("Phase 2: Data Engineering",     "Dataset Research & Selection",    "2025-10-15", "2025-11-15", "#10b981"),
    ("Phase 2: Data Engineering",     "Data Collection Scripts",         "2025-11-01", "2025-11-30", "#10b981"),
    ("Phase 2: Data Engineering",     "Data Pre-processing & Cleaning",  "2025-11-15", "2025-12-15", "#10b981"),
    ("Phase 2: Data Engineering",     "Train / Eval Split Preparation",  "2025-12-01", "2025-12-31", "#10b981"),

    # Phase 3 — System Design
    ("Phase 3: System Design",        "Architecture Design",             "2025-11-01", "2025-12-15", "#f59e0b"),
    ("Phase 3: System Design",        "UI/UX Mockups",                   "2025-11-15", "2026-01-15", "#f59e0b"),
    ("Phase 3: System Design",        "Model Selection & Approach",      "2025-11-01", "2025-12-31", "#f59e0b"),

    # Phase 4 — App Development
    ("Phase 4: App Development",      "Electron App Core",               "2025-12-01", "2026-01-31", "#8b5cf6"),
    ("Phase 4: App Development",      "Meeting Intelligence Features",   "2026-01-01", "2026-02-28", "#8b5cf6"),
    ("Phase 4: App Development",      "Coding Assistant Features",       "2026-01-15", "2026-02-28", "#8b5cf6"),
    ("Phase 4: App Development",      "Automation System",               "2026-02-01", "2026-03-15", "#8b5cf6"),
    ("Phase 4: App Development",      "Model Integration Layer",         "2026-02-15", "2026-03-31", "#8b5cf6"),

    # Phase 5 — Model Fine-tuning
    ("Phase 5: Model Fine-tuning",    "QLoRA Infrastructure Setup",      "2026-02-01", "2026-02-28", "#ef4444"),
    ("Phase 5: Model Fine-tuning",    "Mixtral — Coding & Meeting",      "2026-03-01", "2026-03-20", "#ef4444"),
    ("Phase 5: Model Fine-tuning",    "Gemma 2 — Coding & Meeting",      "2026-03-20", "2026-04-10", "#ef4444"),
    ("Phase 5: Model Fine-tuning",    "Qwen 32B — Coding & Meeting",     "2026-04-01", "2026-04-25", "#ef4444"),
    ("Phase 5: Model Fine-tuning",    "Main Orchestrator Models (×3)",   "2026-04-20", "2026-05-06", "#ef4444"),

    # Phase 6 — Integration & Evaluation
    ("Phase 6: Integration & Eval",   "RunPod Serverless Deployment",    "2026-05-05", "2026-05-15", "#06b6d4"),
    ("Phase 6: Integration & Eval",   "App–Model Integration",           "2026-05-05", "2026-05-20", "#06b6d4"),
    ("Phase 6: Integration & Eval",   "Evaluation & Benchmarking",       "2026-05-15", "2026-05-25", "#06b6d4"),

    # Phase 7 — Report & Demo
    ("Phase 7: Report & Demo",        "Final Report Writing",            "2026-04-15", "2026-05-30", "#d946ef"),
    ("Phase 7: Report & Demo",        "Demo Video Recording",            "2026-05-20", "2026-05-28", "#d946ef"),
    ("Phase 7: Report & Demo",        "Presentation Preparation",        "2026-05-25", "2026-05-30", "#d946ef"),
]

# ── Setup ─────────────────────────────────────────────────────────────────────
proj_start = datetime(2025, 9, 1)
proj_end   = datetime(2026, 6, 1)

def to_x(dt_str):
    dt = datetime.strptime(dt_str, "%Y-%m-%d")
    return (dt - proj_start).days

task_names  = [t[1] for t in tasks]
n = len(tasks)

fig, ax = plt.subplots(figsize=(20, 14))
fig.patch.set_facecolor("#0f172a")
ax.set_facecolor("#111827")

# ── Draw bars ─────────────────────────────────────────────────────────────────
bar_height = 0.55
phase_colors = {}

for i, (phase, name, start, end, color) in enumerate(tasks):
    x_start = to_x(start)
    x_end   = to_x(end)
    y = n - 1 - i

    # Shadow
    ax.barh(y, x_end - x_start, left=x_start, height=bar_height,
            color=color, alpha=0.15, edgecolor="none")
    # Main bar
    ax.barh(y, x_end - x_start, left=x_start, height=bar_height * 0.75,
            color=color, alpha=0.9, edgecolor="none",
            linewidth=0, zorder=3)

    # Task label inside/outside bar
    bar_len = x_end - x_start
    label_x = x_start + bar_len / 2
    ax.text(label_x, y, name, va="center", ha="center",
            fontsize=7.2, color="white", fontweight="500", zorder=4,
            clip_on=True)

    phase_colors[phase] = color

# ── X axis — months ───────────────────────────────────────────────────────────
months = []
d = proj_start.replace(day=1)
while d <= proj_end:
    months.append(d)
    if d.month == 12:
        d = d.replace(year=d.year + 1, month=1)
    else:
        d = d.replace(month=d.month + 1)

tick_positions = [(m - proj_start).days for m in months]
tick_labels = [m.strftime("%b %Y") for m in months]

ax.set_xticks(tick_positions)
ax.set_xticklabels(tick_labels, rotation=35, ha="right",
                   fontsize=8.5, color="#94a3b8")
ax.set_xlim(0, (proj_end - proj_start).days)

# ── Y axis ────────────────────────────────────────────────────────────────────
ax.set_yticks(range(n))
ax.set_yticklabels(reversed([t[1] for t in tasks]),
                   fontsize=8, color="#e2e8f0")
ax.set_ylim(-0.7, n - 0.3)

# ── Grid ──────────────────────────────────────────────────────────────────────
for tp in tick_positions:
    ax.axvline(tp, color="#1f2937", linewidth=0.6, zorder=1)
ax.grid(axis="y", color="#1f2937", linewidth=0.4, zorder=1)

# ── Today marker ─────────────────────────────────────────────────────────────
today_x = (datetime(2026, 5, 5) - proj_start).days
ax.axvline(today_x, color="#f59e0b", linewidth=1.8, linestyle="--",
           zorder=5, alpha=0.9)
ax.text(today_x + 2, n - 0.1, "Today\nMay 5", color="#f59e0b",
        fontsize=7.5, va="top", fontweight="bold")

# ── Phase legend ─────────────────────────────────────────────────────────────
patches = [mpatches.Patch(color=c, label=p) for p, c in phase_colors.items()]
ax.legend(handles=patches, loc="lower right", fontsize=7.5,
          facecolor="#1e293b", edgecolor="#374151", labelcolor="#e2e8f0",
          framealpha=0.95, ncol=2)

# ── Title & labels ────────────────────────────────────────────────────────────
ax.set_title("WOS — AI Desktop Assistant · Capstone Project Schedule\n"
             "DATA 298A/B · Sep 2025 – May 2026",
             fontsize=14, fontweight="bold", color="#f1f5f9", pad=18)
ax.set_xlabel("Timeline", fontsize=9, color="#94a3b8", labelpad=8)

ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)
ax.spines["left"].set_color("#1f2937")
ax.spines["bottom"].set_color("#1f2937")
ax.tick_params(colors="#94a3b8")

plt.tight_layout()
plt.savefig("gantt_chart.png", dpi=180, bbox_inches="tight",
            facecolor=fig.get_facecolor())
print("Saved: gantt_chart.png")
plt.show()
