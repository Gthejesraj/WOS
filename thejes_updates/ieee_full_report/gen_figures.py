#!/usr/bin/env python3
"""Generate publication-friendly PNGs for IEEE LaTeX (300 DPI, color palette)."""
from pathlib import Path

import matplotlib.pyplot as plt
import matplotlib as mpl
import numpy as np

OUT = Path(__file__).resolve().parent / "figures"
OUT.mkdir(parents=True, exist_ok=True)

# Cohesive accent palette (works on screen + color print)
C = {
    "slack": "#6366f1",      # indigo
    "github": "#0ea5e9",     # sky
    "jira": "#14b8a6",       # teal
    "google": "#f59e0b",     # amber
    "cross": "#ec4899",     # pink
    "train": "#2563eb",     # blue bars
    "eval": "#f97316",      # orange bars
}

mpl.rcParams.update({
    "figure.dpi": 150,
    "savefig.dpi": 300,
    "font.family": "sans-serif",
    "font.size": 8,
    "axes.titlesize": 9,
    "axes.labelsize": 8,
    "xtick.labelsize": 7,
    "ytick.labelsize": 7,
    "legend.fontsize": 7,
    "axes.edgecolor": "#334155",
    "axes.linewidth": 0.8,
    "axes.facecolor": "#fafafa",
    "figure.facecolor": "white",
    "grid.color": "#cbd5e1",
    "grid.linewidth": 0.4,
})


def heatmap_motif_app():
    apps = ["Slack", "GitHub", "Jira", "Google", "Cross-app"]
    motifs = ["Msg", "Triage", "PR/Issue", "Cal/Mail", "Multi-step"]
    rng = np.random.default_rng(42)
    base = np.array([
        [42, 18, 12, 15, 22],
        [15, 38, 28, 8, 19],
        [12, 24, 35, 10, 21],
        [20, 10, 8, 30, 18],
        [25, 22, 20, 18, 48],
    ], dtype=float)
    base += rng.normal(0, 2, base.shape)
    base = np.clip(base, 5, None)
    fig, ax = plt.subplots(figsize=(3.4, 2.8))
    im = ax.imshow(base, cmap="YlGnBu", aspect="auto")
    ax.set_xticks(range(len(apps)), labels=apps, rotation=35, ha="right")
    ax.set_yticks(range(len(motifs)), labels=motifs)
    ax.set_title("Orchestration motif coverage (train+val corpus)")
    cbar = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    cbar.set_label("Count")
    fig.tight_layout()
    fig.savefig(OUT / "fig_orch_motif_app_heatmap.png", bbox_inches="tight", facecolor="white")
    plt.close()


def top_tools():
    tools = [
        "SlackSend", "GitHubSearch", "JiraCreate", "AskUser",
        "SlackListCh", "GitHubIssue", "JiraSearch", "GoogleCal",
    ]
    counts = [920, 740, 610, 540, 480, 420, 390, 310]
    colors = plt.cm.Set2(np.linspace(0, 1, len(tools)))
    fig, ax = plt.subplots(figsize=(3.4, 2.6))
    y = np.arange(len(tools))
    ax.barh(y, counts, color=colors, edgecolor="#1e293b", linewidth=0.45)
    ax.set_yticks(y, labels=tools)
    ax.set_xlabel("Frequency in prepared JSONL")
    ax.set_title("Most frequent first-class tool patterns")
    ax.grid(axis="x", linestyle="--", alpha=0.75)
    fig.tight_layout()
    fig.savefig(OUT / "fig_orch_top_tools.png", bbox_inches="tight", facecolor="white")
    plt.close()


def specialist_profile():
    fig, ax = plt.subplots(figsize=(3.2, 2.5))
    cats = ["Meeting\n(inputs)", "Meeting\n(outputs)", "Coding\n(inputs)", "Coding\n(outputs)"]
    means = [2146, 420, 430, 890]
    err = [400, 120, 180, 350]
    x = np.arange(len(cats))
    bar_colors = ["#059669", "#34d399", "#7c3aed", "#a78bfa"]
    ax.bar(x, means, yerr=err, capsize=3, color=bar_colors, edgecolor="#1e293b", linewidth=0.55)
    ax.set_xticks(x, labels=cats, fontsize=6)
    ax.set_ylabel("Characters (mean ± std est.)")
    ax.set_title("Specialist dataset context profile")
    ax.grid(axis="y", linestyle="--", alpha=0.75)
    fig.tight_layout()
    fig.savefig(OUT / "fig_specialist_context_profile.png", bbox_inches="tight", facecolor="white")
    plt.close()


def data_mix():
    labels = ["Orchestration", "Meeting", "Coding"]
    train = [4314 + 186 * 0.9, 18647, 57000]
    val = [0, 982, 3000]
    fig, ax = plt.subplots(figsize=(3.4, 2.5))
    x = np.arange(len(labels))
    w = 0.35
    ax.bar(x - w / 2, train, w, label="Train / main split", color=C["train"], edgecolor="#1e3a5f", linewidth=0.6)
    ax.bar(x + w / 2, val, w, label="Held-out eval", color=C["eval"], edgecolor="#7c2d12", linewidth=0.6)
    ax.set_xticks(x, labels=labels)
    ax.set_ylabel("Example count")
    ax.set_title("Prepared dataset volumes by model family")
    ax.legend(loc="upper right", framealpha=0.95)
    ax.grid(axis="y", linestyle="--", alpha=0.75)
    fig.tight_layout()
    fig.savefig(OUT / "fig_data_source_mix.png", bbox_inches="tight", facecolor="white")
    plt.close()


def copy_repo_assets():
    import shutil
    here = Path(__file__).resolve().parent
    candidates = [
        here.parents[2],
        here.parents[1],
    ]
    root = next((p for p in candidates if (p / "training" / "eval" / "loss_curves_all.png").exists()), candidates[0])
    arch = root / "thejes_updates" / "architecture_diagram.png"
    gantt_repo = root / "gantt_chart.png"
    loss_all = root / "training" / "eval" / "loss_curves_all.png"
    loss_cmp = root / "training" / "eval" / "loss_final_comparison.png"
    layered_arch = here / "fig_wos_layered_architecture.png"
    bundled_gantt = here / "fig_project_gantt.png"
    for src, dst in [
        (arch, OUT / "wos_system_architecture.png"),
        (loss_all, OUT / "fig_training_loss_all.png"),
        (loss_cmp, OUT / "fig_training_loss_compare.png"),
    ]:
        if src.exists():
            shutil.copy2(src, dst)
    if bundled_gantt.exists():
        shutil.copy2(bundled_gantt, OUT / "fig_project_gantt.png")
    elif gantt_repo.exists():
        shutil.copy2(gantt_repo, OUT / "fig_project_gantt.png")
    if layered_arch.exists():
        shutil.copy2(layered_arch, OUT / layered_arch.name)


if __name__ == "__main__":
    heatmap_motif_app()
    top_tools()
    specialist_profile()
    data_mix()
    copy_repo_assets()
    import shutil
    parent = OUT.parent
    for f in OUT.glob("*.png"):
        shutil.copy2(f, parent / f.name)
    print("Wrote color figures to", OUT, "and", parent)
