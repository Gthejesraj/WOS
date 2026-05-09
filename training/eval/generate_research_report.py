"""Generate a comprehensive research-grade HTML benchmark report for WOS.

Reads from a suite output directory (suite_manifest.json + result JSONs + roc_pr_results.json).
Outputs a single self-contained WOS_Research_Report.html.

Usage:
  cd training/eval
  python generate_research_report.py --suite-dir ./suite_20250508_120000
  python generate_research_report.py --suite-dir ./suite_20250508_120000 --out WOS_Research_Report.html
"""

from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

# ---------------------------------------------------------------------------
# Data loading helpers
# ---------------------------------------------------------------------------

def _safe(v, fmt=".1f", fallback="N/A"):
    if v is None:
        return fallback
    try:
        return format(float(v), fmt)
    except Exception:
        return str(v)


def load_suite(suite_dir: Path) -> dict:
    """Load and organize all eval results from a suite output directory."""
    data: dict = {
        "coding": {},    # label -> {humaneval: {...}, mbpp: {...}}
        "meeting": {},   # label -> {...}
        "main": {},      # label -> {...}
        "tool_use": {},  # label -> {...}
        "faithfulness": {},  # label -> {...}
        "action_items": {},  # label -> {...}
        "roc_pr": None,
        "manifest": {},
    }

    manifest_path = suite_dir / "suite_manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        data["manifest"] = manifest
        for art in manifest.get("artifacts", []):
            path = Path(art["path"])
            if not path.exists():
                continue
            try:
                d = json.loads(path.read_text())
            except Exception:
                continue
            label = art.get("label", d.get("model", path.stem))
            bench = art.get("benchmark", "")
            role = art.get("model_role", "unknown")
            d["_label"] = label
            d["_role"] = role

            if bench == "humaneval":
                data["coding"].setdefault(label, {})["humaneval"] = d
            elif bench == "mbpp":
                data["coding"].setdefault(label, {})["mbpp"] = d
            elif bench == "meeting_dialogsum":
                data["meeting"][label] = d
            elif bench == "main_orchestration":
                data["main"][label] = d
            elif bench == "tool_use":
                data["tool_use"][label] = d
            elif bench == "meeting_faithfulness":
                data["faithfulness"][label] = d
            elif bench == "action_items":
                data["action_items"][label] = d
    else:
        # Fallback: scan files
        for f in suite_dir.glob("*.json"):
            if f.name in ("suite_manifest.json", "roc_pr_results.json"):
                continue
            try:
                d = json.loads(f.read_text())
            except Exception:
                continue
            bench = d.get("benchmark", "")
            label = d.get("model", f.stem)
            d["_label"] = label
            d["_role"] = "unknown"
            if bench == "humaneval":
                data["coding"].setdefault(label, {})["humaneval"] = d
            elif bench == "mbpp":
                data["coding"].setdefault(label, {})["mbpp"] = d
            elif "rouge" in bench or "rougeL" in d:
                data["meeting"][label] = d
            elif bench == "action_items":
                data["action_items"][label] = d

    # Load action items from separate files
    for f in suite_dir.glob("action_items_*.json"):
        try:
            d = json.loads(f.read_text())
            label = d.get("model", f.stem)
            d["_label"] = label
            if label not in data["action_items"]:
                data["action_items"][label] = d
        except Exception:
            pass

    # ROC/PR results
    roc_path = suite_dir / "roc_pr_results.json"
    if roc_path.exists():
        data["roc_pr"] = json.loads(roc_path.read_text())

    return data


def _role(label: str) -> str:
    l = label.lower()
    if "baseline" in l:
        return "baseline"
    if "coding" in l:
        return "coding"
    if "meeting" in l:
        return "meeting"
    if "main" in l or "orch" in l:
        return "main"
    return "other"


def _arch(label: str) -> str:
    l = label.lower()
    if "mixtral" in l:
        return "Mixtral 8x7B"
    if "gemma" in l:
        return "Gemma 2-27B"
    if "qwen" in l or "32b" in l:
        return "Qwen 2.5-32B"
    return "Unknown"


def _color(label: str) -> str:
    arch = _arch(label)
    if "Mixtral" in arch:
        return "#7c3aed"
    if "Gemma" in arch:
        return "#0891b2"
    if "Qwen" in arch:
        if "baseline" in label.lower():
            return "#6b7280"
        return "#059669"
    return "#374151"


def _delta_class(val, baseline_val, higher_is_better=True):
    if val is None or baseline_val is None:
        return ""
    try:
        delta = float(val) - float(baseline_val)
        if higher_is_better and delta > 0:
            return "better"
        if not higher_is_better and delta < 0:
            return "better"
    except Exception:
        pass
    return ""


# ---------------------------------------------------------------------------
# HTML sections
# ---------------------------------------------------------------------------

def _summary_table(data: dict, baseline_label: str) -> str:
    all_labels = sorted(
        set(list(data["coding"].keys()) + list(data["meeting"].keys()) +
            list(data["main"].keys()) + list(data["action_items"].keys())),
        key=lambda x: (0 if "baseline" in x.lower() else 1, x)
    )
    if not all_labels:
        return "<p class='na'>No results available yet.</p>"

    b_code = data["coding"].get(baseline_label, {})
    b_meet = data["meeting"].get(baseline_label, {})
    b_ai = data["action_items"].get(baseline_label, {})
    b_tool = data["tool_use"].get(baseline_label, {})

    b_pass1 = b_code.get("humaneval", {}).get("pass_at_1")
    b_rougeL = b_meet.get("rougeL_f1", b_meet.get("rougeL"))
    b_item_f1 = b_ai.get("avg_item_f1")
    b_tool_rate = b_tool.get("tool_success_rate")

    rows = []
    for lbl in all_labels:
        role = _role(lbl)
        arch = _arch(lbl)
        color = _color(lbl)
        is_baseline = "baseline" in lbl.lower()

        c = data["coding"].get(lbl, {})
        he = c.get("humaneval", {})
        mb = c.get("mbpp", {})
        mt = data["meeting"].get(lbl, {})
        ai = data["action_items"].get(lbl, {})
        tu = data["tool_use"].get(lbl, {})
        fa = data["faithfulness"].get(lbl, {})

        pass1 = he.get("pass_at_1")
        mbpp_p1 = mb.get("pass_at_1")
        r1_f1 = mt.get("rouge1_f1", mt.get("rouge1"))
        rL_f1 = mt.get("rougeL_f1", mt.get("rougeL"))
        rL_p = mt.get("rougeL_precision")
        rL_r = mt.get("rougeL_recall")
        item_f1 = ai.get("avg_item_f1")
        tool_rate = tu.get("tool_success_rate")
        hall = fa.get("avg_hallucination_proxy")

        def _cell(val, b_val, fmt=".1f", suffix="", higher_is_better=True, invert=False):
            if val is None:
                return "<td class='na'>—</td>"
            dc = _delta_class(val, b_val, higher_is_better and not invert)
            badge = ""
            if not is_baseline and b_val is not None:
                try:
                    delta = float(val) - float(b_val)
                    sign = "+" if delta > 0 else ""
                    badge = f"<span class='delta {dc}'>{sign}{delta:{fmt}}</span>"
                except Exception:
                    pass
            cls = "baseline-cell" if is_baseline else dc
            return f"<td class='{cls}'>{format(float(val), fmt)}{suffix} {badge}</td>"

        row = f"""
        <tr>
          <td><span class='model-dot' style='background:{color}'></span>
              <strong>{'[Baseline] ' if is_baseline else ''}{lbl}</strong>
              <br><small style='color:#6b7280'>{arch}</small></td>
          <td class='role-{role}'>{role}</td>
          {_cell(pass1, b_pass1, '.1f', '%')}
          {_cell(mbpp_p1, None, '.1f', '%')}
          {_cell(rL_f1, b_rougeL, '.2f')}
          {_cell(rL_p, None, '.2f')}
          {_cell(rL_r, None, '.2f')}
          {_cell(item_f1, b_item_f1, '.4f')}
          {_cell(tool_rate, b_tool_rate, '.1f', '%')}
          {_cell(hall, None, '.1f', '', higher_is_better=False)}
        </tr>"""
        rows.append(row)

    return f"""
    <table class='data-table'>
      <thead>
        <tr>
          <th>Model</th><th>Role</th>
          <th>HumanEval<br>pass@1</th><th>MBPP<br>pass@1</th>
          <th>ROUGE-L<br>F1</th><th>ROUGE-L<br>Prec</th><th>ROUGE-L<br>Rec</th>
          <th>Action Item<br>F1</th>
          <th>Tool Use<br>Success%</th>
          <th>Hallucination<br>Score ↓</th>
        </tr>
      </thead>
      <tbody>{''.join(rows)}</tbody>
    </table>"""


def _coding_section(data: dict, baseline_label: str) -> str:
    all_coding = sorted(data["coding"].keys(),
                        key=lambda x: (0 if "baseline" in x.lower() else 1, x))
    if not all_coding:
        return "<p class='na'>No coding results found.</p>"

    # Chart data
    he_labels = json.dumps([l for l in all_coding])
    he_pass1 = json.dumps([data["coding"][l].get("humaneval", {}).get("pass_at_1", 0) for l in all_coding])
    mb_pass1 = json.dumps([data["coding"][l].get("mbpp", {}).get("pass_at_1", 0) for l in all_coding])
    he_prec = json.dumps([data["coding"][l].get("humaneval", {}).get("precision") or 0 for l in all_coding])
    he_rec = json.dumps([data["coding"][l].get("humaneval", {}).get("recall") or 0 for l in all_coding])
    colors = json.dumps([_color(l) for l in all_coding])

    # Token P/R/F1 table
    rows = []
    b = data["coding"].get(baseline_label, {})
    b_he = b.get("humaneval", {})
    for lbl in all_coding:
        c = data["coding"][lbl]
        he = c.get("humaneval", {})
        mb = c.get("mbpp", {})
        is_bl = "baseline" in lbl.lower()
        p = he.get("precision")
        r = he.get("recall")
        f = he.get("avg_code_token_f1_vs_canonical")
        b_pass = b_he.get("pass_at_1")

        def _dc(val, bval):
            if val is None or bval is None or is_bl:
                return ""
            try:
                return "better" if float(val) > float(bval) else "worse"
            except Exception:
                return ""

        rows.append(f"""<tr>
          <td><span class='model-dot' style='background:{_color(lbl)}'></span>{lbl}</td>
          <td class='{_dc(he.get("pass_at_1"), b_pass)}'>{_safe(he.get("pass_at_1"))}%</td>
          <td>{_safe(mb.get("pass_at_1"))}%</td>
          <td>{_safe(p, '.4f')}</td>
          <td>{_safe(r, '.4f')}</td>
          <td>{_safe(f, '.4f')}</td>
          <td>{_safe(he.get("avg_latency"))}s</td>
        </tr>""")

    table = f"""
    <table class='data-table'>
      <thead><tr>
        <th>Model</th><th>HumanEval pass@1</th><th>MBPP pass@1</th>
        <th>Token Precision</th><th>Token Recall</th><th>Token F1</th><th>Avg Latency</th>
      </tr></thead>
      <tbody>{''.join(rows)}</tbody>
    </table>"""

    return f"""
    <div class='chart-grid'>
      <div class='chart-box'>
        <h4>HumanEval & MBPP pass@1 (%)</h4>
        <canvas id='codingPassChart'></canvas>
      </div>
      <div class='chart-box'>
        <h4>Code Token Precision & Recall</h4>
        <canvas id='codingPRChart'></canvas>
      </div>
    </div>
    <h4>Coding Benchmark Details</h4>
    {table}
    <script>
    new Chart(document.getElementById('codingPassChart'), {{
      type: 'bar',
      data: {{
        labels: {he_labels},
        datasets: [
          {{label: 'HumanEval pass@1', data: {he_pass1}, backgroundColor: {colors}, borderRadius: 4}},
          {{label: 'MBPP pass@1', data: {mb_pass1}, backgroundColor: {colors}.map(c => c + '99'), borderRadius: 4}},
        ]
      }},
      options: {{responsive: true, plugins: {{legend: {{position: 'top'}}}},
        scales: {{y: {{min: 0, max: 100, title: {{display: true, text: 'pass@1 (%)'}}}}}}}}
    }});
    new Chart(document.getElementById('codingPRChart'), {{
      type: 'bar',
      data: {{
        labels: {he_labels},
        datasets: [
          {{label: 'Token Precision', data: {he_prec}, backgroundColor: {colors}, borderRadius: 4}},
          {{label: 'Token Recall', data: {he_rec}, backgroundColor: {colors}.map(c => c + '88'), borderRadius: 4}},
        ]
      }},
      options: {{responsive: true, plugins: {{legend: {{position: 'top'}}}},
        scales: {{y: {{min: 0, max: 1, title: {{display: true, text: 'Score (0-1)'}}}}}}}}
    }});
    </script>"""


def _meeting_section(data: dict, baseline_label: str) -> str:
    all_meet = sorted(data["meeting"].keys(),
                      key=lambda x: (0 if "baseline" in x.lower() else 1, x))
    if not all_meet:
        return "<p class='na'>No meeting results found.</p>"

    labels_js = json.dumps(all_meet)
    r1_f1 = json.dumps([data["meeting"][l].get("rouge1_f1", data["meeting"][l].get("rouge1", 0)) for l in all_meet])
    r2_f1 = json.dumps([data["meeting"][l].get("rouge2_f1", data["meeting"][l].get("rouge2", 0)) for l in all_meet])
    rL_f1 = json.dumps([data["meeting"][l].get("rougeL_f1", data["meeting"][l].get("rougeL", 0)) for l in all_meet])
    colors = json.dumps([_color(l) for l in all_meet])

    rows = []
    b = data["meeting"].get(baseline_label, {})
    b_rL = b.get("rougeL_f1", b.get("rougeL"))
    for lbl in all_meet:
        m = data["meeting"][lbl]
        is_bl = "baseline" in lbl.lower()
        r1p = m.get("rouge1_precision")
        r1r = m.get("rouge1_recall")
        r1f = m.get("rouge1_f1", m.get("rouge1"))
        rLp = m.get("rougeL_precision")
        rLr = m.get("rougeL_recall")
        rLf = m.get("rougeL_f1", m.get("rougeL"))

        def _dc(val, bval):
            if val is None or bval is None or is_bl:
                return ""
            try:
                return "better" if float(val) > float(bval) else "worse"
            except Exception:
                return ""

        rows.append(f"""<tr>
          <td><span class='model-dot' style='background:{_color(lbl)}'></span>{lbl}</td>
          <td>{_safe(r1p, '.2f')}</td><td>{_safe(r1r, '.2f')}</td><td>{_safe(r1f, '.2f')}</td>
          <td>{_safe(rLp, '.2f')}</td><td>{_safe(rLr, '.2f')}</td>
          <td class='{_dc(rLf, b_rL)}'>{_safe(rLf, '.2f')}</td>
          <td>{_safe(m.get("num_samples"), 'd')}</td>
        </tr>""")

    table = f"""
    <table class='data-table'>
      <thead><tr>
        <th>Model</th>
        <th>ROUGE-1 P</th><th>ROUGE-1 R</th><th>ROUGE-1 F1</th>
        <th>ROUGE-L P</th><th>ROUGE-L R</th><th>ROUGE-L F1</th>
        <th>Samples</th>
      </tr></thead>
      <tbody>{''.join(rows)}</tbody>
    </table>"""

    # Faithfulness table
    faith_rows = []
    for lbl in all_meet:
        fa = data["faithfulness"].get(lbl, {})
        if not fa:
            continue
        faith_rows.append(f"""<tr>
          <td>{lbl}</td>
          <td>{_safe(fa.get('avg_coverage_pct'), '.1f')}%</td>
          <td>{_safe(fa.get('avg_forbidden_hits'), '.2f')}</td>
          <td>{_safe(fa.get('avg_invented_names'), '.2f')}</td>
          <td>{_safe(fa.get('avg_hallucination_proxy'), '.1f')} ↓</td>
        </tr>""")
    faith_section = ""
    if faith_rows:
        faith_section = f"""
        <h4>Hallucination / Faithfulness Scores</h4>
        <table class='data-table'>
          <thead><tr>
            <th>Model</th><th>Coverage %</th><th>Forbidden Hits</th>
            <th>Invented Names</th><th>Hallucination Proxy ↓</th>
          </tr></thead>
          <tbody>{''.join(faith_rows)}</tbody>
        </table>
        <p class='caption'>Hallucination proxy = (forbidden hits × 10) + invented names + (100 − coverage). Lower is better.</p>"""

    return f"""
    <div class='chart-box wide'>
      <h4>ROUGE-1 / ROUGE-2 / ROUGE-L F1 by Model</h4>
      <canvas id='meetingRougeChart'></canvas>
    </div>
    <h4>Meeting Summarization — Full P/R/F1</h4>
    {table}
    {faith_section}
    <script>
    new Chart(document.getElementById('meetingRougeChart'), {{
      type: 'bar',
      data: {{
        labels: {labels_js},
        datasets: [
          {{label: 'ROUGE-1 F1', data: {r1_f1}, backgroundColor: {colors}, borderRadius: 4}},
          {{label: 'ROUGE-2 F1', data: {r2_f1}, backgroundColor: {colors}.map(c => c + 'bb'), borderRadius: 4}},
          {{label: 'ROUGE-L F1', data: {rL_f1}, backgroundColor: {colors}.map(c => c + '77'), borderRadius: 4}},
        ]
      }},
      options: {{responsive: true, plugins: {{legend: {{position: 'top'}}}},
        scales: {{y: {{title: {{display: true, text: 'ROUGE F1'}}}}}}}}
    }});
    </script>"""


def _action_items_section(data: dict, baseline_label: str) -> str:
    all_ai = sorted(data["action_items"].keys(),
                    key=lambda x: (0 if "baseline" in x.lower() else 1, x))
    if not all_ai:
        return "<p class='na'>No action item results found. Run eval_action_items.py to generate them.</p>"

    labels_js = json.dumps(all_ai)
    item_f1 = json.dumps([data["action_items"][l].get("avg_item_f1", 0) for l in all_ai])
    owner_cov = json.dumps([data["action_items"][l].get("avg_owner_coverage", 0) for l in all_ai])
    deadline_cov = json.dumps([data["action_items"][l].get("avg_deadline_coverage", 0) for l in all_ai])
    colors = json.dumps([_color(l) for l in all_ai])

    b = data["action_items"].get(baseline_label, {})
    b_item_f1 = b.get("avg_item_f1")

    rows = []
    for lbl in all_ai:
        ai = data["action_items"][lbl]
        is_bl = "baseline" in lbl.lower()
        f1 = ai.get("avg_item_f1")
        p = ai.get("avg_item_precision")
        r = ai.get("avg_item_recall")
        oc = ai.get("avg_owner_coverage")
        dc = ai.get("avg_deadline_coverage")
        r1 = ai.get("avg_rouge1_f1")

        def _dc(val, bval):
            if val is None or bval is None or is_bl:
                return ""
            try:
                return "better" if float(val) > float(bval) else "worse"
            except Exception:
                return ""

        rows.append(f"""<tr>
          <td><span class='model-dot' style='background:{_color(lbl)}'></span>{lbl}</td>
          <td class='{_dc(f1, b_item_f1)}'>{_safe(f1, '.4f')}</td>
          <td>{_safe(p, '.4f')}</td><td>{_safe(r, '.4f')}</td>
          <td>{_safe(oc, '.4f')}</td><td>{_safe(dc, '.4f')}</td>
          <td>{_safe(r1, '.2f')}</td>
        </tr>""")

    table = f"""
    <table class='data-table'>
      <thead><tr>
        <th>Model</th><th>Item F1</th><th>Item Prec</th><th>Item Recall</th>
        <th>Owner Coverage</th><th>Deadline Coverage</th><th>ROUGE-1 F1</th>
      </tr></thead>
      <tbody>{''.join(rows)}</tbody>
    </table>"""

    return f"""
    <div class='chart-grid'>
      <div class='chart-box'>
        <h4>Action Item Extraction F1</h4>
        <canvas id='aiF1Chart'></canvas>
      </div>
      <div class='chart-box'>
        <h4>Owner & Deadline Coverage</h4>
        <canvas id='aiCoverageChart'></canvas>
      </div>
    </div>
    {table}
    <p class='caption'>Item F1: fuzzy item-level match (ROUGE-L ≥ 0.5 threshold). 20 multi-speaker transcripts spanning sprint planning, budget reviews, security incidents, and product launches.</p>
    <script>
    new Chart(document.getElementById('aiF1Chart'), {{
      type: 'bar',
      data: {{labels: {labels_js}, datasets: [
        {{label: 'Item F1', data: {item_f1}, backgroundColor: {colors}, borderRadius: 4}}
      ]}},
      options: {{responsive: true, scales: {{y: {{min:0, max:1, title: {{display:true, text:'F1'}}}}}}}}
    }});
    new Chart(document.getElementById('aiCoverageChart'), {{
      type: 'bar',
      data: {{labels: {labels_js}, datasets: [
        {{label: 'Owner Coverage', data: {owner_cov}, backgroundColor: {colors}, borderRadius: 4}},
        {{label: 'Deadline Coverage', data: {deadline_cov}, backgroundColor: {colors}.map(c=>c+'88'), borderRadius: 4}},
      ]}},
      options: {{responsive: true, plugins: {{legend: {{position: 'top'}}}},
        scales: {{y: {{min:0, max:1, title: {{display:true, text:'Coverage (0-1)'}}}}}}}}
    }});
    </script>"""


def _orch_section(data: dict, baseline_label: str) -> str:
    all_main = sorted(
        set(list(data["main"].keys()) + [k for k in data["tool_use"].keys()]),
        key=lambda x: (0 if "baseline" in x.lower() else 1, x)
    )
    if not all_main:
        return "<p class='na'>No orchestrator/main model results found.</p>"

    b_main = data["main"].get(baseline_label, {})
    b_rL = b_main.get("overall_rougeL") or b_main.get("rougeL_f1")
    b_tool = data["tool_use"].get(baseline_label, {})
    b_tool_rate = b_tool.get("tool_success_rate")

    rows = []
    for lbl in all_main:
        m = data["main"].get(lbl, {})
        tu = data["tool_use"].get(lbl, {})
        is_bl = "baseline" in lbl.lower()

        rL = m.get("overall_rougeL") or m.get("rougeL_f1")
        coding_rL = m.get("coding_rougeL")
        meet_rL = m.get("meeting_rougeL")
        gen_rL = m.get("general_rougeL")
        tool_rate = tu.get("tool_success_rate")
        args_rate = tu.get("args_plausibility_rate")

        def _dc(val, bval):
            if val is None or bval is None or is_bl:
                return ""
            try:
                return "better" if float(val) > float(bval) else ""
            except Exception:
                return ""

        rows.append(f"""<tr>
          <td><span class='model-dot' style='background:{_color(lbl)}'></span>{lbl}</td>
          <td class='{_dc(rL, b_rL)}'>{_safe(rL, '.2f')}</td>
          <td>{_safe(coding_rL, '.2f')}</td>
          <td>{_safe(meet_rL, '.2f')}</td>
          <td>{_safe(gen_rL, '.2f')}</td>
          <td class='{_dc(tool_rate, b_tool_rate)}'>{_safe(tool_rate, '.1f')}%</td>
          <td>{_safe(args_rate, '.1f')}%</td>
        </tr>""")

    table = f"""
    <table class='data-table'>
      <thead><tr>
        <th>Model</th>
        <th>Overall ROUGE-L</th><th>Coding ROUGE-L</th>
        <th>Meeting ROUGE-L</th><th>General ROUGE-L</th>
        <th>Tool Success%</th><th>Args Plausibility%</th>
      </tr></thead>
      <tbody>{''.join(rows)}</tbody>
    </table>"""

    # Tool use chart
    tool_labels = [l for l in all_main if data["tool_use"].get(l)]
    if tool_labels:
        tl_js = json.dumps(tool_labels)
        tr_js = json.dumps([data["tool_use"][l].get("tool_success_rate", 0) for l in tool_labels])
        ar_js = json.dumps([data["tool_use"][l].get("args_plausibility_rate", 0) for l in tool_labels])
        tc_js = json.dumps([_color(l) for l in tool_labels])
        tool_chart = f"""
        <div class='chart-box wide'>
          <h4>Tool Use Success Rate vs Args Plausibility</h4>
          <canvas id='toolChart'></canvas>
        </div>
        <script>
        new Chart(document.getElementById('toolChart'), {{
          type: 'bar',
          data: {{labels: {tl_js}, datasets: [
            {{label: 'Tool Success %', data: {tr_js}, backgroundColor: {tc_js}, borderRadius: 4}},
            {{label: 'Args Plausibility %', data: {ar_js}, backgroundColor: {tc_js}.map(c=>c+'88'), borderRadius: 4}},
          ]}},
          options: {{responsive: true, plugins: {{legend: {{position: 'top'}}}},
            scales: {{y: {{min:0, max:100, title: {{display:true, text:'Rate (%)'}}}}}}}}
        }});
        </script>"""
    else:
        tool_chart = ""

    return f"""
    <h4>Orchestrator Model — Multi-Domain ROUGE-L & Tool Use</h4>
    {table}
    {tool_chart}
    <p class='caption'>Orchestrator (WOS Main) tested on 16 prompts spanning coding, meeting, general, and advanced tasks. Tool use evaluation covers weather, calendar, ticket creation, and refusal-of-invention tasks.</p>"""


def _roc_pr_section(roc_pr: dict | None) -> str:
    if not roc_pr:
        return "<p class='na'>ROC/PR results not found. Run <code>eval_roc_pr.py --suite-dir &lt;dir&gt;</code> to generate.</p>"

    # Meeting P-R curves
    pr_curves = roc_pr.get("meeting_pr_curves", [])
    if pr_curves:
        datasets = []
        for entry in pr_curves:
            curve = entry.get("pr_curve", {})
            recalls = curve.get("recalls", [])
            precisions = curve.get("precisions", [])
            if not recalls:
                continue
            pts = [{"x": r, "y": p} for r, p in zip(recalls, precisions)]
            color = _color(entry["label"])
            datasets.append(
                f'{{"label": "{entry["label"]} (AUPRC={_safe(entry.get("auprc"), ".4f")})", '
                f'"data": {json.dumps(pts)}, "borderColor": "{color}", '
                f'"backgroundColor": "{color}22", "fill": false, "tension": 0.2, "pointRadius": 0}}'
            )
        datasets_js = "[" + ",\n".join(datasets) + "]"
        pr_chart = f"""
        <div class='chart-box wide'>
          <h4>Meeting Summarization — Precision-Recall Curves</h4>
          <p class='caption'>P-R curve generated by sweeping ROUGE-L quality threshold. Higher curve = better discrimination of summary quality.</p>
          <canvas id='prCurveChart'></canvas>
        </div>
        <script>
        new Chart(document.getElementById('prCurveChart'), {{
          type: 'scatter',
          data: {{datasets: {datasets_js}}},
          options: {{
            responsive: true,
            plugins: {{legend: {{position: 'right'}}}},
            scales: {{
              x: {{min: 0, max: 1, title: {{display: true, text: 'Recall'}}}},
              y: {{min: 0, max: 1, title: {{display: true, text: 'Precision'}}}}
            }}
          }}
        }});
        </script>"""
    else:
        pr_chart = "<p class='na'>No P-R curve data.</p>"

    # Pass@k table
    pak = roc_pr.get("coding_pass_at_k", [])
    pak_rows = ""
    if pak:
        rows = []
        for r in sorted(pak, key=lambda x: (0 if "baseline" in x["label"].lower() else 1, x["label"])):
            rows.append(f"""<tr>
              <td><span class='model-dot' style='background:{_color(r["label"])}'></span>{r["label"]}</td>
              <td>{r['benchmark']}</td>
              <td>{_safe(r.get('pass_at_1'))}%</td>
              <td>{_safe(r.get('pass_at_5')) if r.get('pass_at_5') is not None else '—'}%</td>
              <td>{_safe(r.get('pass_at_10')) if r.get('pass_at_10') is not None else '—'}%</td>
              <td>{_safe(r.get('token_f1'), '.4f')}</td>
            </tr>""")
        pak_rows = f"""
        <h4>Coding — pass@k (Unbiased Estimator)</h4>
        <table class='data-table'>
          <thead><tr>
            <th>Model</th><th>Benchmark</th>
            <th>pass@1</th><th>pass@5</th><th>pass@10</th><th>Token F1</th>
          </tr></thead>
          <tbody>{''.join(rows)}</tbody>
        </table>
        <p class='caption'>pass@k computed via Chen et al. 2021 unbiased estimator. pass@5 and pass@10 require --pass-k-samples 10 flag in eval_coding.py.</p>"""

    # AUPRC table
    auprc_rows = ""
    if pr_curves:
        rows = []
        for r in sorted(pr_curves, key=lambda x: (0 if "baseline" in x["label"].lower() else 1, x["label"])):
            rows.append(f"""<tr>
              <td><span class='model-dot' style='background:{_color(r["label"])}'></span>{r["label"]}</td>
              <td>{_safe(r.get('rougeL_f1'), '.2f')}</td>
              <td>{_safe(r.get('rouge1_precision'), '.2f')}</td>
              <td>{_safe(r.get('rouge1_recall'), '.2f')}</td>
              <td><strong>{_safe(r.get('auprc'), '.4f')}</strong></td>
            </tr>""")
        auprc_rows = f"""
        <h4>Meeting — AUPRC Summary</h4>
        <table class='data-table'>
          <thead><tr>
            <th>Model</th><th>ROUGE-L F1</th>
            <th>ROUGE-1 Prec</th><th>ROUGE-1 Rec</th><th>AUPRC ↑</th>
          </tr></thead>
          <tbody>{''.join(rows)}</tbody>
        </table>"""

    return f"{pr_chart}{pak_rows}{auprc_rows}"


def _model_overview_table(data: dict) -> str:
    MODEL_META = {
        "thejesraj/wos-coding-32b":    {"arch": "Qwen 2.5-32B", "params": "32B", "task": "Coding", "steps": 532, "loss": 0.740, "lora": 16},
        "thejesraj/wos-meeting-32b":   {"arch": "Qwen 2.5-32B", "params": "32B", "task": "Meeting", "steps": 532, "loss": 1.210, "lora": 16},
        "thejesraj/wos-main-32b":      {"arch": "Qwen 2.5-32B", "params": "32B", "task": "General/Orch", "steps": 532, "loss": 0.713, "lora": 16},
        "thejesraj/wos-coding-mixtral":{"arch": "Mixtral 8x7B", "params": "~47B MoE", "task": "Coding", "steps": 177, "loss": 0.502, "lora": 16},
        "thejesraj/wos-meeting-mixtral":{"arch": "Mixtral 8x7B","params": "~47B MoE", "task": "Meeting", "steps": 200, "loss": 1.777, "lora": 16},
        "thejesraj/wos-main-mixtral":  {"arch": "Mixtral 8x7B", "params": "~47B MoE", "task": "General/Orch", "steps": 587, "loss": 0.705, "lora": 16},
        "thejesraj/wos-coding-gemma":  {"arch": "Gemma 2-27B", "params": "27B", "task": "Coding", "steps": 521, "loss": 0.830, "lora": 16},
        "thejesraj/wos-meeting-gemma": {"arch": "Gemma 2-27B", "params": "27B", "task": "Meeting", "steps": 521, "loss": 1.430, "lora": 16},
        "thejesraj/wos-main-gemma":    {"arch": "Gemma 2-27B", "params": "27B", "task": "General/Orch", "steps": 521, "loss": 0.857, "lora": 16},
        "Qwen/Qwen2.5-32B-Instruct":   {"arch": "Qwen 2.5-32B", "params": "32B", "task": "Baseline (untuned)", "steps": "—", "loss": "—", "lora": "—"},
    }
    rows = []
    for model_id, meta in MODEL_META.items():
        color = "#6b7280" if "Baseline" in meta["task"] else _color(meta["arch"])
        is_bl = "Baseline" in meta["task"]
        rows.append(f"""<tr>
          <td><span class='model-dot' style='background:{color}'></span>
              {'<strong>[Baseline]</strong> ' if is_bl else ''}{model_id}</td>
          <td>{meta['arch']}</td><td>{meta['params']}</td><td>{meta['task']}</td>
          <td>{meta['steps']}</td><td>{meta['loss']}</td><td>{meta['lora']}</td>
        </tr>""")
    return f"""
    <table class='data-table'>
      <thead><tr>
        <th>Model ID</th><th>Base Architecture</th><th>Parameters</th><th>Task</th>
        <th>Training Steps</th><th>Final Loss</th><th>LoRA Rank</th>
      </tr></thead>
      <tbody>{''.join(rows)}</tbody>
    </table>
    <p class='caption'>All fine-tuned models use QLoRA: 4-bit NF4 quantization + LoRA adapters (rank 16) on q/k/v/o/gate/up/down projections. ~50M trainable params out of 27–32B total.</p>"""


# ---------------------------------------------------------------------------
# Full HTML assembly
# ---------------------------------------------------------------------------

CSS = """
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
       background: #f8fafc; color: #1e293b; line-height: 1.5; }
.header { background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
          color: white; padding: 40px 60px; }
.header h1 { font-size: 2rem; font-weight: 700; }
.header .subtitle { color: #94a3b8; margin-top: 8px; font-size: 1rem; }
.nav { background: #1e293b; padding: 0 60px; display: flex; gap: 4px; }
.nav a { color: #94a3b8; text-decoration: none; padding: 12px 16px;
          font-size: 0.85rem; border-bottom: 3px solid transparent; transition: all 0.2s; }
.nav a:hover, .nav a.active { color: white; border-bottom-color: #3b82f6; }
.content { max-width: 1400px; margin: 0 auto; padding: 40px 60px; }
.section { background: white; border-radius: 12px; padding: 32px;
           margin-bottom: 32px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.section h2 { font-size: 1.4rem; font-weight: 700; color: #0f172a;
              margin-bottom: 20px; padding-bottom: 12px;
              border-bottom: 2px solid #e2e8f0; }
.section h4 { font-size: 1rem; font-weight: 600; color: #334155; margin: 20px 0 10px; }
.chart-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-bottom: 24px; }
.chart-box { background: #f8fafc; border-radius: 8px; padding: 20px; }
.chart-box.wide { grid-column: 1/-1; }
canvas { max-height: 320px; }
.data-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; margin: 16px 0; }
.data-table th { background: #f1f5f9; font-weight: 600; padding: 10px 12px;
                  text-align: left; color: #475569; border-bottom: 2px solid #e2e8f0; }
.data-table td { padding: 9px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
.data-table tr:hover td { background: #f8fafc; }
.data-table td.better { color: #059669; font-weight: 600; }
.data-table td.worse { color: #dc2626; }
.data-table td.baseline-cell { color: #6b7280; }
.data-table td.na { color: #94a3b8; }
.delta { font-size: 0.78rem; margin-left: 6px; padding: 1px 5px; border-radius: 4px; }
.delta.better { background: #dcfce7; color: #15803d; }
.delta.worse { background: #fee2e2; color: #dc2626; }
.model-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; }
.role-baseline { color: #6b7280; font-style: italic; }
.role-coding { color: #7c3aed; }
.role-meeting { color: #0891b2; }
.role-main { color: #ea580c; }
.badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px;
         background: #f1f5f9; border-radius: 20px; font-size: 0.8rem; margin: 4px; }
.caption { font-size: 0.82rem; color: #64748b; margin-top: 8px; line-height: 1.4; }
.na { color: #94a3b8; font-style: italic; padding: 16px 0; }
.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px,1fr)); gap: 16px; margin-bottom: 24px; }
.stat-card { background: #f8fafc; border-radius: 8px; padding: 16px; text-align: center; }
.stat-card .value { font-size: 1.8rem; font-weight: 700; }
.stat-card .label { font-size: 0.8rem; color: #64748b; margin-top: 4px; }
"""

def _stats_cards(data: dict) -> str:
    n_ft = sum(1 for k in list(data["coding"].keys()) + list(data["meeting"].keys()) + list(data["main"].keys())
               if "baseline" not in k.lower())
    n_baselines = sum(1 for k in list(data["coding"].keys()) + list(data["meeting"].keys())
                      if "baseline" in k.lower())
    n_ai = len(data["action_items"])
    return f"""
    <div class='stat-grid'>
      <div class='stat-card'><div class='value' style='color:#059669'>{len(data["coding"])}</div><div class='label'>Coding Evals</div></div>
      <div class='stat-card'><div class='value' style='color:#0891b2'>{len(data["meeting"])}</div><div class='label'>Meeting Evals</div></div>
      <div class='stat-card'><div class='value' style='color:#ea580c'>{len(data["main"])}</div><div class='label'>Orch Evals</div></div>
      <div class='stat-card'><div class='value' style='color:#7c3aed'>{n_ai}</div><div class='label'>Action Item Evals</div></div>
      <div class='stat-card'><div class='value' style='color:#374151'>{len(data["tool_use"])}</div><div class='label'>Tool Use Evals</div></div>
    </div>"""


def build_html(data: dict, baseline_label: str, suite_dir: str) -> str:
    roc_pr = data.get("roc_pr")
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WOS Research Benchmark Report</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>{CSS}</style>
</head>
<body>

<div class="header">
  <h1>WOS Research Benchmark Report</h1>
  <div class="subtitle">
    Fine-tuned specialist models vs. <strong>Qwen2.5-32B-Instruct baseline</strong> &nbsp;|&nbsp;
    Suite: <code>{suite_dir}</code>
  </div>
  <div style="margin-top:16px">
    <span class='badge'><span class='model-dot' style='background:#6b7280'></span>Baseline: Qwen2.5-32B-Instruct</span>
    <span class='badge'><span class='model-dot' style='background:#059669'></span>WOS Qwen 32B Fine-tuned</span>
    <span class='badge'><span class='model-dot' style='background:#7c3aed'></span>WOS Mixtral 8x7B Fine-tuned</span>
    <span class='badge'><span class='model-dot' style='background:#0891b2'></span>WOS Gemma 2-27B Fine-tuned</span>
  </div>
</div>

<nav class="nav">
  <a href="#summary" class="active">Summary</a>
  <a href="#coding">Coding</a>
  <a href="#meeting">Meeting</a>
  <a href="#action-items">Action Items</a>
  <a href="#orchestrator">Orchestrator</a>
  <a href="#roc-pr">ROC / PR Curves</a>
  <a href="#models">Model Overview</a>
</nav>

<div class="content">

  <div class="section" id="summary">
    <h2>Executive Summary</h2>
    {_stats_cards(data)}
    <p style="margin-bottom:16px;color:#475569">
      Green cells indicate fine-tuned model outperforms the baseline. Deltas shown relative to <strong>{baseline_label}</strong>.
    </p>
    {_summary_table(data, baseline_label)}
  </div>

  <div class="section" id="coding">
    <h2>Coding Benchmark</h2>
    <p style="margin-bottom:16px;color:#475569">HumanEval (164 problems) and MBPP evaluated via pass@1. Code token precision/recall measures lexical overlap with reference implementations.</p>
    {_coding_section(data, baseline_label)}
  </div>

  <div class="section" id="meeting">
    <h2>Meeting Summarization Benchmark</h2>
    <p style="margin-bottom:16px;color:#475569">DialogSum test set. ROUGE-1/2/L precision, recall, and F1 (macro-averaged). Faithfulness scores measure hallucination risk.</p>
    {_meeting_section(data, baseline_label)}
  </div>

  <div class="section" id="action-items">
    <h2>Action Item Extraction</h2>
    <p style="margin-bottom:16px;color:#475569">20 realistic multi-speaker meeting transcripts. Item-level F1 uses fuzzy matching (ROUGE-L ≥ 0.5). Owner and deadline coverage measure structural accuracy.</p>
    {_action_items_section(data, baseline_label)}
  </div>

  <div class="section" id="orchestrator">
    <h2>Orchestrator (Main) Model</h2>
    <p style="margin-bottom:16px;color:#475569">WOS Main fine-tuned models tested on multi-domain ROUGE-L and tool calling. Baseline run on the same prompts for direct comparison.</p>
    {_orch_section(data, baseline_label)}
  </div>

  <div class="section" id="roc-pr">
    <h2>ROC / Precision-Recall Curves & AUC</h2>
    <p style="margin-bottom:16px;color:#475569">
      Meeting: P-R curves via ROUGE-L quality threshold sweep (AUPRC = area under curve).<br>
      Coding: pass@k curves using unbiased estimator (Chen et al. 2021).
    </p>
    {_roc_pr_section(roc_pr)}
  </div>

  <div class="section" id="models">
    <h2>Model Overview</h2>
    {_model_overview_table(data)}
  </div>

</div>
</body>
</html>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--suite-dir", required=True, help="Suite output directory")
    ap.add_argument("--out", default=None, help="Output HTML path (default: <suite-dir>/WOS_Research_Report.html)")
    ap.add_argument("--baseline", default=None, help="Baseline model label (auto-detected if omitted)")
    args = ap.parse_args()

    suite_dir = Path(args.suite_dir)
    out_path = Path(args.out) if args.out else suite_dir / "WOS_Research_Report.html"

    print(f"Loading results from: {suite_dir}")
    data = load_suite(suite_dir)

    # Auto-detect baseline label
    all_labels = (
        list(data["coding"].keys()) + list(data["meeting"].keys()) +
        list(data["main"].keys())
    )
    if args.baseline:
        baseline_label = args.baseline
    else:
        baseline_label = next(
            (l for l in all_labels if "baseline" in l.lower()),
            all_labels[0] if all_labels else "Baseline"
        )
    print(f"Baseline: {baseline_label}")

    html = build_html(data, baseline_label, str(suite_dir))
    out_path.write_text(html, encoding="utf-8")
    print(f"\nReport saved: {out_path}")
    print(f"  Coding evals:    {len(data['coding'])}")
    print(f"  Meeting evals:   {len(data['meeting'])}")
    print(f"  Orch evals:      {len(data['main'])}")
    print(f"  Action item:     {len(data['action_items'])}")
    print(f"  Tool use:        {len(data['tool_use'])}")
    print(f"  ROC/PR data:     {'yes' if data['roc_pr'] else 'no (run eval_roc_pr.py)'}")


if __name__ == "__main__":
    main()
