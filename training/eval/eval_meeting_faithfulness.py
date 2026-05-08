#!/usr/bin/env python3
"""
Meeting faithfulness / hallucination *proxies* (no external LLM judge).

1) **Coverage** — important tokens from transcript (capitalized words, numbers, product names)
   should appear in the model summary (case-insensitive). Higher = more grounded in source.

2) **Forbidden hallucination** — response must NOT assert contradictory facts on adversarial
   snippets (e.g. transcript says budget approved; summary must not say rejected).

3) **Invented-name heuristic** — capitalized tokens in summary that never appear in transcript
   (excluding sentence starts) → `possible_invented_names` count (lower is better).

Usage:
  python eval_meeting_faithfulness.py --endpoint URL/v1 --model thejesraj/wos-meeting-gemma --api_key KEY
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path

import requests

SYSTEM = (
    "You are WOS Meeting. Summarize faithfully from the transcript only. "
    "Do not invent attendees, budgets, or dates not stated."
)


def call_model(endpoint: str, model: str, user: str, api_key: str) -> str:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    r = requests.post(
        f"{endpoint.rstrip('/')}/chat/completions",
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": user},
            ],
            "max_tokens": 600,
            "temperature": 0.0,
        },
        headers=headers,
        timeout=120,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


def important_tokens(text: str) -> set[str]:
    words = re.findall(r"[A-Za-z][\w-]{2,}|\d{4}-\d{2}-\d{2}|\bQ[1-4]\b", text)
    stop = {
        "The",
        "This",
        "That",
        "There",
        "They",
        "What",
        "When",
        "With",
        "From",
        "Have",
        "Been",
        "Will",
        "Your",
        "Team",
        "Meeting",
        "Summary",
        "Transcript",
    }
    out = set()
    for w in words:
        if w in stop:
            continue
        if w.isdigit() and len(w) < 4:
            continue
        out.add(w)
    return out


def coverage_score(transcript: str, summary: str) -> float:
    S = summary.lower()
    toks = important_tokens(transcript)
    if not toks:
        return 100.0
    hit = sum(1 for w in toks if w.lower() in S)
    return round(hit / len(toks) * 100, 1)


def invented_capital_hits(transcript: str, summary: str) -> int:
    """Heuristic: TitleCase tokens in summary absent from transcript."""
    Tlow = transcript.lower()
    caps = re.findall(r"\b[A-Z][a-z]{2,}[A-Za-z]*\b", summary)
    bad = 0
    for w in caps:
        if w.lower() not in Tlow and w not in {"May", "Monday", "Friday", "Thursday"}:
            # allow common day names if transcript had dates
            if len(w) >= 4:
                bad += 1
    return bad


SCENARIOS = [
    {
        "id": "adv_budget",
        "transcript": (
            "Finance sync — only facts stated.\n"
            "CFO: The board approved the FY27 budget increase of 12%.\n"
            "Controller: We will not cut headcount; hiring freeze is lifted for engineering only.\n"
            "CFO: There is no acquisition on the table this quarter."
        ),
        "prompt": "Summarize decisions. Do not contradict the transcript.",
        "forbidden_substrings": [
            "budget rejected",
            "hiring freeze remains",
            "acquisition announced",
            "layoff",
        ],
    },
    {
        "id": "adv_timeline",
        "transcript": (
            "Launch review.\n"
            "PM: GA date is fixed at June 10; no slip is authorized.\n"
            "QA: We are green for release criteria as of today."
        ),
        "prompt": "What is the GA date and status?",
        "forbidden_substrings": ["july", "august", "slipped", "delayed to", "postponed indefinitely"],
    },
    {
        "id": "coverage_rich",
        "transcript": (
            "Standup — Acme Corp / Phoenix module.\n"
            "Ravi: Dependency on Redis cluster us-east-1b is resolved; cutover Saturday 02:00 UTC.\n"
            "Lena: Customer Northwind reported timeout above 8s; we added cache warming in PR 4412.\n"
            "Ravi: SLO target p95 under 800ms remains; current p95 is 640ms after warming."
        ),
        "prompt": "Summarize for leadership: dependencies, customer, metrics, timing.",
        "forbidden_substrings": [],
    },
]


def run_one(endpoint: str, model: str, api_key: str, sc: dict) -> dict:
    user = f"{sc['prompt']}\n\n--- TRANSCRIPT ---\n{sc['transcript']}\n--- END ---"
    t0 = time.time()
    try:
        summary = call_model(endpoint, model, user, api_key)
        err = None
    except Exception as e:
        summary = ""
        err = str(e)
    lat = time.time() - t0

    forb = sc.get("forbidden_substrings", [])
    violations = [f for f in forb if f.lower() in summary.lower()]
    cov = coverage_score(sc["transcript"], summary) if summary else 0.0
    inv = invented_capital_hits(sc["transcript"], summary) if summary else 0

    return {
        "id": sc["id"],
        "latency_sec": round(lat, 2),
        "error": err,
        "coverage_keyword_pct": cov,
        "forbidden_hits": len(violations),
        "forbidden_detail": violations,
        "possible_invented_names": inv,
        "summary_preview": summary[:400],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--endpoint", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--api_key", default="EMPTY")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    slug = args.model.replace("/", "_").replace(".", "-")
    out_path = args.out or f"meeting_faith_{slug}.json"

    details = []
    for sc in SCENARIOS:
        row = run_one(args.endpoint, args.model, args.api_key, sc)
        details.append(row)
        print(
            f"  {row['id']}: cov={row['coverage_keyword_pct']}% "
            f"forbid={row['forbidden_hits']} inv={row['possible_invented_names']} ({row['latency_sec']}s)"
        )

    avg_cov = sum(d["coverage_keyword_pct"] for d in details) / len(details)
    total_forbid = sum(d["forbidden_hits"] for d in details)
    total_inv = sum(d["possible_invented_names"] for d in details)

    result = {
        "model": args.model,
        "benchmark": "meeting_faithfulness",
        "avg_coverage_keyword_pct": round(avg_cov, 1),
        "total_forbidden_hits": total_forbid,
        "total_possible_invented_names": total_inv,
        "hallucination_proxy_lower_is_better": round(total_forbid * 10 + total_inv + (100 - avg_cov), 1),
        "details": details,
    }

    print(f"\nAvg keyword coverage: {result['avg_coverage_keyword_pct']}%")
    print(f"Forbidden phrase hits (should be 0): {total_forbid}")
    print(f"Composite proxy (lower better): {result['hallucination_proxy_lower_is_better']}")

    Path(out_path).write_text(json.dumps(result, indent=2))
    print(f"Saved {out_path}")


if __name__ == "__main__":
    main()
