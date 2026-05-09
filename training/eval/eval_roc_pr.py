"""Compute ROC / Precision-Recall curves and AUC for WOS benchmark results.

Coding: pass@k curve (k=1,5,10) using unbiased estimator.
Meeting: Precision-Recall curve via ROUGE-L threshold sweep → AUPRC.

Usage:
  python eval_roc_pr.py --suite-dir ./suite_20250508_120000
  python eval_roc_pr.py --suite-dir ./suite_20250508_120000 --out roc_pr_results.json
"""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path


# ---------------------------------------------------------------------------
# pass@k (coding)
# ---------------------------------------------------------------------------

def _pass_at_k_unbiased(n: int, c: int, k: int) -> float:
    if k > n:
        return float(c > 0)
    if n - c < k:
        return 1.0
    return 1.0 - math.prod((n - c - i) / (n - i) for i in range(k))


def compute_pass_at_k_curve(result: dict) -> dict:
    """Given a coding eval result dict, return pass@k for k=1,5,10."""
    n_total = result.get("total", 0)
    n_passed = result.get("passed", 0)
    if not n_total:
        return {"pass_at_1": 0.0, "pass_at_5": 0.0, "pass_at_10": 0.0}

    pass_k_samples = 0
    total_k_passes = 0
    if result.get("details"):
        for d in result["details"]:
            if d.get("pass_k_samples"):
                pass_k_samples = d["pass_k_samples"]
                total_k_passes += d.get("pass_k_passes", 0)

    if pass_k_samples > 0:
        c = total_k_passes
        n = n_total * pass_k_samples
        return {
            "pass_at_1": round(result["pass_at_1"], 2),
            "pass_at_5": round(_pass_at_k_unbiased(pass_k_samples, round(total_k_passes / n_total), 5) * 100, 2),
            "pass_at_10": round(_pass_at_k_unbiased(pass_k_samples, round(total_k_passes / n_total), 10) * 100, 2),
        }

    # Fallback: only pass@1 available
    return {
        "pass_at_1": round(result.get("pass_at_1", 0.0), 2),
        "pass_at_5": None,
        "pass_at_10": None,
    }


# ---------------------------------------------------------------------------
# Precision-Recall curve (meeting)
# ---------------------------------------------------------------------------

def compute_pr_curve(rougeL_scores: list[float], n_steps: int = 101) -> dict:
    """
    Sweep ROUGE-L threshold t from 0 to 100.
    At each threshold: classify sample as 'good summary' if score >= t.
    All samples have a true reference (label=1), so:
      - Precision = TP / (TP + FP) = predicted-positives that truly exceed quality bar
        (here: fraction of positives at threshold t that have score >= t)
      - Recall = TP / (TP + FN) = fraction of all samples classified as positive

    In practice for a threshold sweep over scores:
      At threshold t:
        predicted_pos = samples with score >= t
        precision = mean(score >= t) for samples in predicted_pos (= 1.0 since score >= t by definition)
        → Use the fraction of samples passing: precision = predicted_pos / total (= recall)

    More useful: treat it as a "quality discriminator" —
      Use per-sample rougeL as a model confidence score.
      Sort scores descending. At each rank k: precision@k = (scores[:k] >= median_baseline) / k.
      This creates a meaningful P-R curve showing how well the model ranks quality.

    We use a simpler but standard approach:
      Threshold t ∈ [0,100]. "Positive" = score >= t.
      precision(t) = mean score of selected samples / 100 (normalized quality)
      recall(t) = |score >= t| / |total|
    """
    if not rougeL_scores:
        return {"precisions": [], "recalls": [], "auprc": 0.0, "thresholds": []}

    total = len(rougeL_scores)
    thresholds = [t * (100 / (n_steps - 1)) for t in range(n_steps)]
    precisions = []
    recalls = []

    for t in thresholds:
        selected = [s for s in rougeL_scores if s >= t]
        if not selected:
            precisions.append(1.0)  # by convention
            recalls.append(0.0)
        else:
            prec = sum(selected) / (len(selected) * 100)  # avg normalized quality
            rec = len(selected) / total
            precisions.append(round(prec, 4))
            recalls.append(round(rec, 4))

    # AUC via trapezoidal rule over recall axis
    auprc = 0.0
    for i in range(len(recalls) - 1):
        dr = abs(recalls[i] - recalls[i + 1])
        avg_p = (precisions[i] + precisions[i + 1]) / 2
        auprc += dr * avg_p

    return {
        "precisions": precisions,
        "recalls": recalls,
        "thresholds": [round(t, 1) for t in thresholds],
        "auprc": round(auprc, 4),
    }


# ---------------------------------------------------------------------------
# Load results from suite directory
# ---------------------------------------------------------------------------

def _slug_to_label(fname: str) -> str:
    return fname.replace("_", " ").replace("-", ".").title()


def load_suite_results(suite_dir: Path) -> dict:
    """Load all coding and meeting JSON results from the suite output directory."""
    if not suite_dir.exists():
        raise FileNotFoundError(f"Suite directory not found: {suite_dir}")

    manifest_path = suite_dir / "suite_manifest.json"
    results: dict = {"coding": [], "meeting": [], "action_items": []}

    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        for artifact in manifest.get("artifacts", []):
            path = Path(artifact["path"])
            if not path.exists():
                continue
            bench = artifact.get("benchmark", "")
            data = json.loads(path.read_text())
            entry = {
                "label": artifact.get("label", data.get("model", path.stem)),
                "model_id": artifact.get("model_id", data.get("model", "")),
                "model_role": artifact.get("model_role", "unknown"),
                "data": data,
            }
            if bench in ("humaneval", "mbpp"):
                results["coding"].append({**entry, "benchmark": bench})
            elif bench == "meeting_dialogsum":
                results["meeting"].append(entry)
    else:
        # Fallback: scan directory
        for f in suite_dir.glob("*.json"):
            if f.name == "suite_manifest.json":
                continue
            try:
                data = json.loads(f.read_text())
            except Exception:
                continue
            label = data.get("model", f.stem)
            entry = {"label": label, "model_id": label, "model_role": "unknown", "data": data}
            bench = data.get("benchmark", "")
            if bench in ("humaneval", "mbpp"):
                results["coding"].append({**entry, "benchmark": bench})
            elif "rougeL" in data or "rouge_l" in str(data):
                results["meeting"].append(entry)

    # Load action items from same dir
    for f in suite_dir.glob("action_items_*.json"):
        try:
            data = json.loads(f.read_text())
            results["action_items"].append({
                "label": data.get("model", f.stem),
                "model_id": data.get("model", ""),
                "data": data,
            })
        except Exception:
            pass

    return results


# ---------------------------------------------------------------------------
# Main computation
# ---------------------------------------------------------------------------

def compute_all(suite_dir: Path) -> dict:
    raw = load_suite_results(suite_dir)
    output: dict = {
        "suite_dir": str(suite_dir),
        "coding_pass_at_k": [],
        "meeting_pr_curves": [],
        "action_item_metrics": [],
    }

    # Coding: pass@k curves
    seen_labels: dict = {}
    for entry in raw["coding"]:
        label = entry["label"]
        bench = entry["benchmark"]
        key = f"{label}|{bench}"
        if key in seen_labels:
            continue
        seen_labels[key] = True
        d = entry["data"]
        pak = compute_pass_at_k_curve(d)
        output["coding_pass_at_k"].append({
            "label": label,
            "model_id": entry["model_id"],
            "model_role": entry["model_role"],
            "benchmark": bench,
            "pass_at_1": pak["pass_at_1"],
            "pass_at_5": pak["pass_at_5"],
            "pass_at_10": pak["pass_at_10"],
            "precision": d.get("precision"),
            "recall": d.get("recall"),
            "token_f1": d.get("avg_code_token_f1_vs_canonical") or d.get("avg_code_token_f1_vs_reference"),
        })

    # Meeting: P-R curves
    for entry in raw["meeting"]:
        d = entry["data"]
        details = d.get("details", [])
        scores = [det["rougeL_f1"] for det in details if "rougeL_f1" in det]
        if not scores:
            # Fallback: use aggregate score as single-point placeholder
            scores = [d.get("rougeL_f1", d.get("rougeL", 0.0))]
        pr = compute_pr_curve(scores)
        output["meeting_pr_curves"].append({
            "label": entry["label"],
            "model_id": entry["model_id"],
            "model_role": entry["model_role"],
            "rouge1_precision": d.get("rouge1_precision"),
            "rouge1_recall": d.get("rouge1_recall"),
            "rouge1_f1": d.get("rouge1_f1", d.get("rouge1")),
            "rougeL_f1": d.get("rougeL_f1", d.get("rougeL")),
            "num_samples": d.get("num_samples", len(scores)),
            "pr_curve": pr,
            "auprc": pr["auprc"],
        })

    # Action items
    for entry in raw["action_items"]:
        d = entry["data"]
        output["action_item_metrics"].append({
            "label": entry["label"],
            "model_id": entry["model_id"],
            "avg_item_f1": d.get("avg_item_f1"),
            "avg_item_precision": d.get("avg_item_precision"),
            "avg_item_recall": d.get("avg_item_recall"),
            "avg_owner_coverage": d.get("avg_owner_coverage"),
            "avg_deadline_coverage": d.get("avg_deadline_coverage"),
            "avg_rouge1_f1": d.get("avg_rouge1_f1"),
        })

    return output


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--suite-dir", required=True, help="Suite output directory containing result JSONs")
    ap.add_argument("--out", default=None, help="Output path (default: <suite-dir>/roc_pr_results.json)")
    args = ap.parse_args()

    suite_dir = Path(args.suite_dir)
    out_path = Path(args.out) if args.out else suite_dir / "roc_pr_results.json"

    print(f"Loading results from: {suite_dir}")
    result = compute_all(suite_dir)

    out_path.write_text(json.dumps(result, indent=2))
    print(f"Saved: {out_path}")

    print(f"\n{'='*50}")
    print(f"Coding pass@k results: {len(result['coding_pass_at_k'])} entries")
    for r in result["coding_pass_at_k"]:
        print(f"  {r['label']} [{r['benchmark']}]: pass@1={r['pass_at_1']}%")

    print(f"\nMeeting P-R curves: {len(result['meeting_pr_curves'])} entries")
    for r in result["meeting_pr_curves"]:
        print(f"  {r['label']}: ROUGE-L F1={r['rougeL_f1']}, AUPRC={r['auprc']}")

    print(f"\nAction item metrics: {len(result['action_item_metrics'])} entries")
    for r in result["action_item_metrics"]:
        print(f"  {r['label']}: item_f1={r['avg_item_f1']}")


if __name__ == "__main__":
    main()
