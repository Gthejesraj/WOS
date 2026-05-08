#!/usr/bin/env python3
"""
Tool-use evaluation (OpenAI-compatible chat.completions with `tools`).

Scores per task:
  - tool_success: correct function name emitted in tool_calls (or parseable XML/JSON fallback)
  - args_plausible: required substrings appear in serialized arguments

Designed for Qwen3-class models (native tool calling). Fine-tuned specialists may
score lower if not trained on tools — that is a useful signal.

Usage:
  python eval_tool_use.py --endpoint https://.../v1 --model Qwen/Qwen3-32B --api_key KEY --out tools_baseline.json
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from typing import Any

import requests

SYSTEM = (
    "You are a precise assistant. When the user needs external data or side effects, "
    "you MUST call the appropriate tool using the API. Do not invent tool results."
)

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "get_current_weather",
            "description": "Get current weather for a city.",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {"type": "string", "description": "City name"},
                    "unit": {
                        "type": "string",
                        "enum": ["celsius", "fahrenheit"],
                        "description": "Temperature unit",
                    },
                },
                "required": ["location"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_calendar",
            "description": "Search calendar events in a date range.",
            "parameters": {
                "type": "object",
                "properties": {
                    "start_date": {"type": "string"},
                    "end_date": {"type": "string"},
                },
                "required": ["start_date", "end_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_ticket",
            "description": "Create a support ticket.",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "priority": {"type": "string", "enum": ["low", "medium", "high"]},
                },
                "required": ["title", "priority"],
            },
        },
    },
]

TASKS = [
    {
        "id": "weather_boston",
        "user": "Use tools only: what is the weather in Boston in fahrenheit?",
        "expect_tool": "get_current_weather",
        "args_contain": ["Boston", "fahrenheit"],
    },
    {
        "id": "calendar_range",
        "user": "Search my calendar from 2026-05-01 to 2026-05-07 for conflicts.",
        "expect_tool": "search_calendar",
        "args_contain": ["2026-05-01", "2026-05-07"],
    },
    {
        "id": "ticket_high",
        "user": "Open a support ticket titled 'Checkout timeout on mobile' with high priority.",
        "expect_tool": "create_ticket",
        "args_contain": ["Checkout", "high"],
    },
    {
        "id": "weather_refuse_invent",
        "user": "Use a tool call to fetch weather for 'Zzyzx CA' — do not answer from memory.",
        "expect_tool": "get_current_weather",
        "args_contain": ["Zzyzx"],
    },
]


def extract_tool_calls(payload: dict) -> list[dict]:
    msg = payload.get("choices", [{}])[0].get("message", {})
    raw = msg.get("tool_calls")
    if raw:
        out = []
        for tc in raw:
            if isinstance(tc, dict) and tc.get("type") == "function":
                fn = tc.get("function") or {}
            else:
                fn = tc if isinstance(tc, dict) else {}
            out.append(
                {
                    "name": fn.get("name", ""),
                    "arguments": fn.get("arguments", "") or "",
                }
            )
        return out
    # Fallback: Qwen XML-style in content
    content = msg.get("content") or ""
    blocks = re.findall(
        r'<tool_call>\s*(\{.*?\})\s*</tool_call>', content, re.DOTALL | re.IGNORECASE
    )
    out = []
    for b in blocks:
        try:
            obj = json.loads(b)
            out.append(
                {"name": obj.get("name", ""), "arguments": json.dumps(obj.get("arguments", {}))}
            )
        except json.JSONDecodeError:
            continue
    return out


def score_task(resp_json: dict, expect_tool: str, args_contain: list[str]) -> dict:
    calls = extract_tool_calls(resp_json)
    names = [c["name"] for c in calls]
    args_blob = " ".join(c.get("arguments", "") for c in calls).lower()
    tool_ok = expect_tool in names
    args_ok = all(s.lower() in args_blob for s in args_contain) if tool_ok else False
    return {
        "tool_success": tool_ok,
        "args_match": args_ok,
        "tools_called": names,
        "raw_tool_calls": len(calls),
    }


def call_api(endpoint: str, model: str, api_key: str, user: str) -> dict:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": user},
        ],
        "tools": TOOLS,
        "tool_choice": "auto",
        "temperature": 0.0,
        "max_tokens": 512,
    }
    r = requests.post(
        f"{endpoint.rstrip('/')}/chat/completions",
        json=body,
        headers=headers,
        timeout=120,
    )
    r.raise_for_status()
    return r.json()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--endpoint", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--api_key", default="EMPTY")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    slug = args.model.replace("/", "_").replace(".", "-")
    out_path = args.out or f"tool_use_{slug}.json"

    rows = []
    latencies = []
    for t in TASKS:
        t0 = time.time()
        try:
            payload = call_api(args.endpoint, args.model, args.api_key, t["user"])
            sc = score_task(payload, t["expect_tool"], t["args_contain"])
            err = None
        except Exception as e:
            payload = {}
            sc = {
                "tool_success": False,
                "args_match": False,
                "tools_called": [],
                "raw_tool_calls": 0,
            }
            err = str(e)
        lat = time.time() - t0
        latencies.append(lat)
        rows.append(
            {
                "id": t["id"],
                "latency_sec": round(lat, 2),
                "error": err,
                **sc,
            }
        )
        st = "OK" if sc["tool_success"] and sc["args_match"] else ("PART" if sc["tool_success"] else "FAIL")
        print(f"  {t['id']}: {st}  tools={sc['tools_called']} ({lat:.1f}s)")

    tool_rate = sum(1 for r in rows if r["tool_success"]) / len(rows) * 100
    full_rate = sum(1 for r in rows if r["tool_success"] and r["args_match"]) / len(rows) * 100

    result = {
        "model": args.model,
        "benchmark": "tool_use",
        "tasks": len(TASKS),
        "tool_call_rate_pct": round(tool_rate, 1),
        "tool_plus_args_rate_pct": round(full_rate, 1),
        "avg_latency_sec": round(sum(latencies) / len(latencies), 2),
        "details": rows,
    }

    print(f"\nTool call success rate:   {result['tool_call_rate_pct']}%")
    print(f"Tool + args match rate:   {result['tool_plus_args_rate_pct']}%")

    Path(out_path).write_text(json.dumps(result, indent=2))
    print(f"Saved {out_path}")


if __name__ == "__main__":
    main()
