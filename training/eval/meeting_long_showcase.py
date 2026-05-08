#!/usr/bin/env python3
"""
Long-form meeting qualitative showcase — primary metric is usefulness of the
summary (structure, decisions, actions, risks), not ROUGE.

Reads models from models_config.json (or --config). By default calls every entry
whose type is meeting, main, or baseline (skip placeholders with YOUR_ in URL).

Usage:
  export RUNPOD_API_KEY=...   # optional default if config has EMPTY
  python meeting_long_showcase.py --config models_config.json --out showcase_long.json
"""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

import requests

SYSTEM = (
    "You are WOS Meeting, an expert meeting intelligence assistant. "
    "Produce a structured brief: (1) Executive summary, (2) Key decisions, "
    "(3) Action items with owner and deadline if stated, (4) Open risks or blockers, "
    "(5) Timeline / next milestones. Use clear headings. Be faithful to the transcript."
)

# Realistic multi-party product review — intentionally not trivial.
LONG_TRANSCRIPT = """
Product sync — Phoenix Analytics rollout
Date: 2026-05-06 | Attendees: Maya Chen (PM), Jordan Lee (Eng Lead), Sam Okonkwo (SRE),
Priya Desai (Legal), Alex Ruiz (Customer Success)

Maya: We're two weeks from GA for the new in-app analytics module. I want alignment on scope,
risks, and who owns what through launch weekend.

Jordan: Engineering status — feature flag `analytics_phoenix_v1` is in staging. We fixed the
duplicate-event bug yesterday. Remaining work is performance on cold start: p95 load is 2.1s,
target is under 1.2s. I need one more engineer-day for lazy init of the chart SDK.

Sam: From SRE side, autoscaling rules are drafted. Peak test showed we need 30% more headroom
in us-east; I'll bump max pods from 40 to 52 before cutover. Incident comms: we'll run a dry
run of the rollback playbook Thursday 4pm ET.

Priya: Legal reviewed the data processing addendum. Two items: we must surface the retention
toggle in onboarding (already in designs), and we cannot enable session replay for EU tenants
until DPIA sign-off — that blocks EU GA, not US GA.

Alex: Top customer Northwind is piloting week of May 12. They asked for CSV export of funnels;
that's not in MVP. I told them post-GA unless we pull something in. They also want Slack alerts
for anomaly spikes — we scoped that to phase 2.

Maya: Decision time — do we slip GA one week to pick up CSV export for Northwind?

Jordan: I advise no — CSV export touches the warehouse ACL layer; that's at least five days with
review. Lazy-init fix is higher ROI for everyone.

Maya: Agreed — GA stays May 20 US-only. EU GA targets June 3 pending Priya's DPIA. Alex, communicate
Northwind timeline and offer a concierge export run weekly until CSV ships.

Priya: I'll circulate the DPIA checklist by Friday; need engineering estimates for data flows
in sections 4 and 7 of the form.

Sam: Freeze window starts May 17 end of day; only SEV fixes after that. Jordan and I will be
primary on-call launch weekend; secondary is the platform rotation.

Maya: Action recap — Jordan: lazy-init by EOD May 9; Sam: scaling + dry run May 9–10; Priya: DPIA
inputs May 10; Alex: Northwind comms by May 8 COB. Risks: EU delay if DPIA slips; performance if
lazy-init misses target. Next checkpoint: go/no-go May 13 standup.
""".strip()

USER_PROMPT = (
    "Analyze the transcript below. Follow your system instructions.\n\n"
    f"--- TRANSCRIPT ---\n{LONG_TRANSCRIPT}\n--- END ---"
)


def call_model(endpoint: str, model_id: str, api_key: str, max_tokens: int = 1200) -> tuple[str, float, str | None]:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {
        "model": model_id,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": USER_PROMPT},
        ],
        "max_tokens": max_tokens,
        "temperature": 0.2,
    }
    t0 = time.time()
    try:
        r = requests.post(
            f"{endpoint.rstrip('/')}/chat/completions",
            json=payload,
            headers=headers,
            timeout=300,
        )
        r.raise_for_status()
        text = r.json()["choices"][0]["message"]["content"]
        return text, time.time() - t0, None
    except Exception as e:
        return "", time.time() - t0, str(e)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="models_config.json")
    ap.add_argument("--out", default="showcase_meeting_long.json")
    ap.add_argument(
        "--types",
        default="meeting,main,baseline",
        help="Comma-separated types from config to include",
    )
    ap.add_argument("--max-tokens", type=int, default=1200)
    args = ap.parse_args()

    cfg_path = Path(args.config)
    if not cfg_path.exists():
        raise SystemExit(f"Config not found: {cfg_path}")

    cfg = json.loads(cfg_path.read_text())
    want_types = {t.strip() for t in args.types.split(",") if t.strip()}
    default_key = os.environ.get("RUNPOD_API_KEY") or os.environ.get("RUNPOD_KEY") or ""

    rows = []
    for m in cfg.get("models", []):
        ep = m.get("endpoint", "")
        if "YOUR_" in ep:
            continue
        if m.get("type") not in want_types:
            continue
        key = m.get("api_key") or default_key or "EMPTY"
        print(f"Showcase: {m.get('label')} ...", flush=True)
        text, latency, err = call_model(ep, m["model_id"], key, args.max_tokens)
        rows.append(
            {
                "label": m.get("label"),
                "type": m.get("type"),
                "model_id": m["model_id"],
                "endpoint": ep,
                "latency_sec": round(latency, 2),
                "error": err,
                "response": text,
                "response_word_count": len(text.split()) if text else 0,
            }
        )
        if err:
            print(f"  ERROR: {err}")
        else:
            print(f"  OK ({latency:.1f}s, {rows[-1]['response_word_count']} words)")

    out = {
        "transcript_chars": len(LONG_TRANSCRIPT),
        "system_prompt": SYSTEM,
        "user_prompt_preview": USER_PROMPT[:400] + "...",
        "models": rows,
    }
    Path(args.out).write_text(json.dumps(out, indent=2))
    print(f"\nWrote {args.out}")


if __name__ == "__main__":
    main()
