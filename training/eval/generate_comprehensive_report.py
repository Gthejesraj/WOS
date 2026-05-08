#!/usr/bin/env python3
"""
Build a single self-contained HTML report from suite_manifest.json
(produced by run_wos_evaluation_suite.py).

Primary narrative: long-form meeting showcase (qualitative).
Secondary: HumanEval / MBPP / DialogSum ROUGE / main orchestration ROUGE tables.

Usage:
  python generate_comprehensive_report.py --manifest suite_20260508_120000/suite_manifest.json
  # writes suite_.../WOS_Comprehensive_Report.html next to manifest
"""

from __future__ import annotations

import argparse
import html
import json
from collections import defaultdict
from pathlib import Path


def arch_from_model_id(mid: str) -> str:
    m = mid.lower()
    if "mixtral" in m:
        return "Mixtral 8×7B"
    if "gemma" in m:
        return "Gemma 2 27B"
    if "qwen3" in m:
        return "Qwen3 32B-class"
    if "qwen" in m or ("wos-" in m and "32b" in m):
        return "Qwen2.5 32B-class"
    return "Other"


def load_json(p: Path) -> dict | None:
    try:
        return json.loads(p.read_text())
    except Exception:
        return None


def _tbl(rows: list[tuple], headers: tuple[str, ...]) -> str:
    h = "".join(f"<th>{html.escape(x)}</th>" for x in headers)
    body = ""
    for r in rows:
        body += "<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>"
    return f"<table><thead><tr>{h}</tr></thead><tbody>{body}</tbody></table>"


def build_tables(artifacts: list[dict]) -> dict[str, str]:
    """Collect JSON artifacts into HTML table fragments + baseline deltas."""
    he: dict[str, dict] = {}
    mbpp: dict[str, dict] = {}
    meet: dict[str, dict] = {}
    main: dict[str, dict] = {}
    tool: dict[str, dict] = {}
    faith: dict[str, dict] = {}
    meta: dict[str, str] = {}
    for a in artifacts:
        mid0 = a.get("model_id")
        if mid0 and a.get("model_role"):
            meta[mid0] = a["model_role"]

    for a in artifacts:
        p = Path(a["path"])
        if not p.exists():
            continue
        data = load_json(p)
        if not data:
            continue
        mid = a.get("model_id", data.get("model", ""))
        label = a.get("label", mid)
        bench = a.get("benchmark", "")
        if bench == "humaneval" and "pass_at_1" in data:
            he[mid] = {"label": label, **data}
        elif bench == "mbpp" and "pass_at_1" in data:
            mbpp[mid] = {"label": label, **data}
        elif bench == "meeting_dialogsum" and "rougeL" in data:
            meet[mid] = {"label": label, **data}
        elif bench == "main_orchestration" and "overall_rougeL" in data:
            main[mid] = {"label": label, **data}
        elif bench == "tool_use" and "tool_call_rate_pct" in data:
            tool[mid] = {"label": label, **data}
        elif bench == "meeting_faithfulness" and "avg_coverage_keyword_pct" in data:
            faith[mid] = {"label": label, **data}

    he_rows = []
    for mid, d in sorted(he.items(), key=lambda x: x[1].get("label", "")):
        he_rows.append(
            (
                html.escape(d["label"]),
                html.escape(arch_from_model_id(mid)),
                f"{d['pass_at_1']}%",
                str(d.get("passed", "")) + "/" + str(d.get("total", "")),
                "—" if d.get("avg_code_token_f1_vs_canonical") is None else str(d["avg_code_token_f1_vs_canonical"]),
                str(d.get("avg_latency", "")),
            )
        )
    he_html = _tbl(
        he_rows,
        ("Model", "Architecture", "HumanEval pass@1", "Passed", "Code F1 vs gold", "Avg latency s"),
    )

    mb_rows = []
    for mid, d in sorted(mbpp.items(), key=lambda x: x[1].get("label", "")):
        mb_rows.append(
            (
                html.escape(d["label"]),
                html.escape(arch_from_model_id(mid)),
                f"{d['pass_at_1']}%",
                str(d.get("passed", "")) + "/" + str(d.get("total", "")),
                "—" if d.get("avg_code_token_f1_vs_reference") is None else str(d["avg_code_token_f1_vs_reference"]),
            )
        )
    mb_html = _tbl(mb_rows, ("Model", "Architecture", "MBPP pass@1", "Passed", "Code F1 vs ref"))

    mt_rows = []
    for mid, d in sorted(meet.items(), key=lambda x: x[1].get("label", "")):
        mt_rows.append(
            (
                html.escape(d["label"]),
                html.escape(arch_from_model_id(mid)),
                f"{d.get('rouge1_f1', d.get('rouge1', 0)):.2f}",
                f"{d.get('rouge1_precision', 0):.2f}",
                f"{d.get('rouge1_recall', 0):.2f}",
                f"{d.get('rougeL_f1', d.get('rougeL', 0)):.2f}",
                str(d.get("num_samples", "")),
            )
        )
    mt_html = _tbl(
        mt_rows,
        ("Model", "Arch", "R1-F1", "R1-P", "R1-R", "RL-F1", "Samples"),
    )

    mn_rows = []
    for mid, d in sorted(main.items(), key=lambda x: x[1].get("label", "")):
        mn_rows.append(
            (
                html.escape(d["label"]),
                html.escape(arch_from_model_id(mid)),
                str(d.get("overall_rouge1_f1", d.get("overall_rougeL", 0))),
                f"{d.get('overall_rouge1_precision', 0):.1f}",
                f"{d.get('overall_rouge1_recall', 0):.1f}",
                str(d.get("overall_rougeL", 0)),
                str(d.get("coding_rougeL", 0)),
                str(d.get("meeting_rougeL", 0)),
                str(d.get("general_rougeL", 0)),
            )
        )
    mn_html = _tbl(
        mn_rows,
        ("Model", "Arch", "R1-F1", "R1-P", "R1-R", "R-L", "Cod-R-L", "Meet-R-L", "Gen-R-L"),
    )

    tu_rows = []
    for mid, d in sorted(tool.items(), key=lambda x: x[1].get("label", "")):
        tu_rows.append(
            (
                html.escape(d["label"]),
                html.escape(arch_from_model_id(mid)),
                f"{d.get('tool_call_rate_pct', 0)}%",
                f"{d.get('tool_plus_args_rate_pct', 0)}%",
                str(d.get("avg_latency_sec", "")),
            )
        )
    tu_html = _tbl(tu_rows, ("Model", "Arch", "Tool call rate", "Tool+args match", "Avg latency s"))

    fh_rows = []
    for mid, d in sorted(faith.items(), key=lambda x: x[1].get("label", "")):
        fh_rows.append(
            (
                html.escape(d["label"]),
                html.escape(arch_from_model_id(mid)),
                f"{d.get('avg_coverage_keyword_pct', 0)}%",
                str(d.get("total_forbidden_hits", 0)),
                str(d.get("hallucination_proxy_lower_is_better", 0)),
            )
        )
    fh_html = _tbl(
        fh_rows,
        ("Model", "Arch", "Keyword coverage %", "Forbidden hits (0 best)", "Hallucination proxy ↓"),
    )

    baseline_mid = next((m for m, r in meta.items() if r == "baseline"), None)
    delta_rows = []
    if baseline_mid:
        b_he = he.get(baseline_mid, {}).get("pass_at_1")
        b_mb = mbpp.get(baseline_mid, {}).get("pass_at_1")
        b_rl = meet.get(baseline_mid, {}).get("rougeL")
        b_tl = tool.get(baseline_mid, {}).get("tool_plus_args_rate_pct")
        b_fh = faith.get(baseline_mid, {}).get("hallucination_proxy_lower_is_better")

        def _label(mid: str) -> str:
            for bucket in (he, mbpp, meet, main, tool, faith):
                if mid in bucket:
                    return str(bucket[mid].get("label", mid))
            return mid

        ft_mids = [m for m, r in meta.items() if r and r != "baseline"]
        for mid in sorted(ft_mids, key=_label):
            dh = (
                f"{he[mid]['pass_at_1'] - b_he:+.1f}"
                if b_he is not None and mid in he
                else "—"
            )
            dm = (
                f"{mbpp[mid]['pass_at_1'] - b_mb:+.1f}"
                if b_mb is not None and mid in mbpp
                else "—"
            )
            dr = (
                f"{meet[mid]['rougeL'] - b_rl:+.2f}"
                if b_rl is not None and mid in meet
                else "—"
            )
            dt = (
                f"{tool[mid]['tool_plus_args_rate_pct'] - b_tl:+.1f}"
                if b_tl is not None and mid in tool
                else "—"
            )
            df = (
                f"{faith[mid]['hallucination_proxy_lower_is_better'] - b_fh:+.1f}"
                if b_fh is not None and mid in faith
                else "—"
            )
            delta_rows.append(
                (
                    html.escape(_label(mid)),
                    html.escape(arch_from_model_id(mid)),
                    dh,
                    dm,
                    dr,
                    dt,
                    df,
                )
            )
    delta_html = (
        _tbl(
            delta_rows,
            (
                "Fine-tuned model",
                "Arch",
                "Δ HumanEval p@1",
                "Δ MBPP p@1",
                "Δ ROUGE-L meet",
                "Δ tool+args %",
                "Δ halluc proxy",
            ),
        )
        if delta_rows
        else "<p><em>Add a baseline row (model_role baseline) to show deltas.</em></p>"
    )

    return {
        "he": he_html,
        "mb": mb_html,
        "mt": mt_html,
        "mn": mn_html,
        "tu": tu_html,
        "fh": fh_html,
        "delta": delta_html,
    }


def showcase_html(showcase_path: Path | None) -> str:
    if not showcase_path or not showcase_path.exists():
        return "<p><em>No showcase JSON found. Re-run suite without --skip-showcase.</em></p>"
    data = load_json(showcase_path)
    if not data:
        return "<p><em>Showcase file unreadable.</em></p>"
    blocks = []
    for m in data.get("models", []):
        title = html.escape(m.get("label", m.get("model_id", "?")))
        body = m.get("response") or m.get("error") or ""
        wc = m.get("response_word_count", len(body.split()))
        err = m.get("error")
        status = f'<span class="ok">{wc} words</span>' if not err else f'<span class="bad">Error: {html.escape(err)}</span>'
        blocks.append(
            f'<details open><summary><strong>{title}</strong> — {status}</summary>'
            f'<pre class="resp">{html.escape(body)}</pre></details>'
        )
    return "\n".join(blocks)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True, help="Path to suite_manifest.json")
    args = ap.parse_args()

    man_path = Path(args.manifest)
    manifest = json.loads(man_path.read_text())
    out_dir = man_path.parent
    artifacts = manifest.get("artifacts", [])

    showcase_path = None
    for a in artifacts:
        if a.get("benchmark") == "showcase_long_meeting":
            showcase_path = Path(a["path"])
            break

    tabs = build_tables(artifacts)
    qual = showcase_html(showcase_path)

    created = html.escape(manifest.get("created_utc", ""))
    cfg = html.escape(manifest.get("config", ""))

    html_doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>WOS — Comprehensive evaluation</title>
<style>
body{{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f172a;color:#e2e8f0;line-height:1.55;max-width:1180px;margin:0 auto;padding:32px 20px 80px;}}
h1{{font-size:1.75rem;margin:0 0 8px;color:#f8fafc;}}
.sub{{color:#94a3b8;font-size:0.95rem;margin-bottom:28px;}}
h2{{font-size:1.2rem;margin:36px 0 12px;color:#38bdf8;border-bottom:1px solid #334155;padding-bottom:6px;}}
h3{{font-size:1rem;margin:22px 0 10px;color:#a5b4fc;}}
p.note{{background:#1e293b;border-left:4px solid #38bdf8;padding:12px 16px;border-radius:0 8px 8px 0;color:#cbd5e1;font-size:0.92rem;}}
table{{width:100%;border-collapse:collapse;font-size:0.88rem;margin:12px 0;background:#1e293b;border-radius:10px;overflow:hidden;}}
th,td{{padding:10px 12px;text-align:left;border-bottom:1px solid #334155;}}
th{{background:#020617;color:#94a3b8;font-weight:600;font-size:0.75rem;text-transform:uppercase;}}
tr:last-child td{{border-bottom:none;}}
pre.resp{{white-space:pre-wrap;background:#020617;padding:16px;border-radius:8px;font-size:0.84rem;color:#e2e8f0;border:1px solid #334155;max-height:520px;overflow:auto;}}
details{{margin:14px 0;background:#1e293b;border-radius:10px;padding:8px 14px 14px;border:1px solid #334155;}}
summary{{cursor:pointer;color:#f8fafc;font-size:0.95rem;padding:6px 0;}}
span.ok{{color:#4ade80;}}
span.bad{{color:#f87171;}}
.grid{{display:grid;gap:18px;}}
@media(min-width:900px){{.grid{{grid-template-columns:1fr 1fr;}}}}
footer{{margin-top:48px;font-size:0.8rem;color:#64748b;text-align:center;}}
</style>
</head>
<body>
<h1>WOS fine-tuned models — comprehensive evaluation</h1>
<p class="sub">Generated {created} · Manifest config: <code>{cfg}</code></p>

<p class="note">
<strong>How to read this report.</strong> The long meeting showcase (below) is the primary signal:
structured briefs, owners, deadlines, and risks are what users judge in production.
ROUGE and pass@1 metrics are complementary checks on automatic benchmarks — useful for regression
tracking, not a full picture of meeting quality.
</p>

<h2>1. Long-form meeting showcase (primary)</h2>
<p>Same realistic multi-stakeholder transcript sent to each meeting-capable endpoint (meeting, main, and baseline rows from your config). Compare depth, structure, and fidelity.</p>
{qual}

<h2>2. Fine-tuned vs baseline (same benchmarks)</h2>
<p class="note">Baseline is configured as <strong>Qwen3 32B</strong> (<code>Qwen/Qwen3-32B</code>) — same scale as your Qwen specialists, with strong tool-calling per Qwen3 docs. Deltas = fine-tuned minus baseline (positive is better for pass@1 / ROUGE / tool match; for hallucination proxy lower is better so negative delta there is good).</p>
{tabs["delta"]}

<h2>3. Automated benchmarks (secondary)</h2>
<p class="note">HumanEval/MBPP limits are set when you run <code>run_wos_evaluation_suite.py</code>. Tool-use tasks use OpenAI-style <code>tools</code> in chat completions. Meeting faithfulness uses keyword coverage + forbidden-phrase checks (proxy, not a human judge).</p>

<h3>HumanEval (code)</h3>
{tabs["he"]}

<h3>MBPP (code)</h3>
{tabs["mb"]}

<h3>DialogSum — meeting ROUGE</h3>
{tabs["mt"]}

<h3>Main / orchestration — ROUGE-L</h3>
{tabs["mn"]}

<h3>Tool calling — success rates</h3>
{tabs["tu"]}

<h3>Meeting faithfulness / hallucination proxies</h3>
{tabs["fh"]}

<h2>4. Suggested talking points</h2>
<ul>
<li>Fine-tuned <strong>meeting</strong> models should show richer action items and explicit owners vs baseline on the same transcript.</li>
<li>Fine-tuned <strong>coding</strong> models should match or beat baseline pass@1 on HumanEval/MBPP at similar parameter scale.</li>
<li><strong>Main</strong> models trade some peak domain scores for balanced behavior across coding, meeting, and general prompts.</li>
</ul>

<footer>WOS training/eval · suite-driven report</footer>
</body>
</html>"""

    out_path = out_dir / "WOS_Comprehensive_Report.html"
    out_path.write_text(html_doc)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
