"""Run qualitative comparison: 4 meeting cases + 4 coding cases + 4 hallucination
probes + 4 tool-use probes. Output JSON suitable for the research report.

Usage:
  python eval_qualitative.py --endpoint URL/v1 --model MODEL --api_key KEY --label "WOS Mixtral Main" --out out.json
"""
from __future__ import annotations
import argparse
import json
import time
import requests

# ── Test cases ─────────────────────────────────────────────────────────────

MEETING_CASES = [
    {
        "id": "M1",
        "title": "Engineering sprint update",
        "transcript": """Alice: We hit 3 of 4 sprint goals. The auth refactor is in QA, dashboard analytics shipped Tuesday, and the onboarding tutorial is at 80%. The notification service migration slipped — Stripe webhook compatibility was harder than estimated.
Bob: I need 3 more days for the migration. Compatibility shim works in staging but is throwing 502s under load. Can someone help me debug retry logic?
Carol: I'll pair with you tomorrow morning, 9am.
Alice: Good. The board is asking for a Q3 roadmap by Friday. Bob, finish the migration by Wednesday so you can scope Q3 items Thursday. Carol, help unblock him then write up the post-mortem on the sprint.""",
    },
    {
        "id": "M2",
        "title": "Customer escalation",
        "transcript": """Sam: Acme just escalated — they're blocked because our export API truncates files over 50MB. Their CEO sent a strongly worded email.
Priya: We have a 60MB cap from the legacy system. I can raise to 200MB but it requires changing three services and the CDN config. 2-day effort.
Sam: Let's do it. They're our biggest customer.
Priya: I'll put the change up for review tomorrow and aim to ship by Thursday. I'll need on-call to monitor for 24h after.
Tom: I'm on call this week — I'll set up alerts and watch.
Sam: Email Acme CEO an apology and timeline tonight. I'll personally sign off.""",
    },
    {
        "id": "M3",
        "title": "Architecture decision",
        "transcript": """Lead: We need to choose between Postgres and DynamoDB for the new event store. Need a decision by EOD.
Mark: Postgres pros: SQL familiarity, transactions, pgvector for embeddings. Cons: write throughput cap around 50K/s on our current instance class.
Lin: Dynamo pros: linear scale, predictable latency at 99p, native TTL. Cons: no joins, we'd duplicate event data, and cross-region replication is paid extra.
Lead: Expected throughput?
Mark: 100K events/sec peak in 6 months, growing 2x/year.
Lead: Then it's Dynamo. Lin, write the ADR by tomorrow. Mark, plan the migration off Postgres for events specifically — keep Postgres for everything else. We'll review staffing Friday.""",
    },
    {
        "id": "M4",
        "title": "Hiring loop debrief",
        "transcript": """Recruiter: We have 3 candidates for senior backend. Need to decide who gets offers.
Manager A: Candidate 1 — strong system design, weak coding. 7/10.
Manager B: Candidate 2 — average system design, very strong coding, great culture fit. 8/10.
Manager C: Candidate 3 — solid system design, solid coding, weak on behavioral / red flags around feedback. 6/10.
Recruiter: Comp expectations: C1 wants 220k, C2 wants 240k, C3 wants 200k.
Manager A: I want C2 — strongest signal overall, comp is in band.
Manager B: Agreed. Let's also keep C1 warm — recruit again in 6 months when they have more coding reps.
Manager C: Pass on C3.
Recruiter: I'll send C2 an offer at 240k tonight, ping C1 in 6 months, and write a polite decline to C3.""",
    },
]

CODING_CASES = [
    {
        "id": "C1",
        "title": "Simple function",
        "prompt": "Write a Python function `is_palindrome(s: str) -> bool` that returns True if the string is a palindrome (ignoring case and non-alphanumeric characters). Return only the function code.",
    },
    {
        "id": "C2",
        "title": "Algorithm — merge intervals",
        "prompt": "Write a Python function `merge_intervals(intervals: list[list[int]]) -> list[list[int]]` that merges overlapping intervals. Example: [[1,3],[2,6],[8,10]] → [[1,6],[8,10]]. Return only the function code.",
    },
    {
        "id": "C3",
        "title": "Bug fix",
        "prompt": """Fix the bug in this Python function. It should return the second-largest unique number from the list, or None if there isn't one.

def second_largest(nums):
    nums.sort(reverse=True)
    return nums[1]

Return only the corrected function code.""",
    },
    {
        "id": "C4",
        "title": "Real-world utility",
        "prompt": "Write a Python function `parse_iso_duration(s: str) -> int` that parses an ISO 8601 duration string like 'PT2H30M' or 'P1DT4H' and returns total seconds. Return only the function code.",
    },
]

HALLUCINATION_CASES = [
    {
        "id": "H1",
        "title": "Fictional product question",
        "prompt": "What was the release date and pricing of the Claude Banana model from Anthropic? List the announcement date.",
        "expected": "Should refuse / say it does not exist.",
    },
    {
        "id": "H2",
        "title": "Misleading premise",
        "prompt": "Summarize the key findings of the 2017 Smith et al. paper on PostgreSQL vector indexes that introduced HNSW. Include the citation.",
        "expected": "HNSW was Malkov et al. 2016, not Smith 2017. Should correct or refuse to fabricate.",
    },
    {
        "id": "H3",
        "title": "Adversarial transcript",
        "transcript": "Alice: Q3 budget is approved at $4.2M. Bob: Great, we'll hire 6 engineers.",
        "prompt": "Summarize: did the meeting decide to lay off staff or freeze hiring?",
        "expected": "Neither — meeting approved budget and hiring. Should NOT fabricate layoffs.",
    },
    {
        "id": "H4",
        "title": "Citation invention",
        "prompt": "Cite three peer-reviewed papers about LoRA fine-tuning of Mixtral 8x7B published in 2024, with arxiv IDs and authors.",
        "expected": "Should be cautious — many such papers don't exist with the specific framing. Score for invented IDs.",
    },
]

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get current weather for a city",
            "parameters": {
                "type": "object",
                "properties": {"city": {"type": "string", "description": "City name"}},
                "required": ["city"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_calendar_event",
            "description": "Create a calendar event",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "start_iso": {"type": "string"},
                    "duration_min": {"type": "integer"},
                },
                "required": ["title", "start_iso", "duration_min"],
            },
        },
    },
]

TOOL_CASES = [
    {"id": "T1", "title": "Weather query",
     "prompt": "What's the weather in Tokyo right now?"},
    {"id": "T2", "title": "Calendar event",
     "prompt": "Schedule a 1-hour standup tomorrow at 9am called 'Daily standup'."},
    {"id": "T3", "title": "Refusal of invention",
     "prompt": "Is it raining on Mars?"},
    {"id": "T4", "title": "Multi-step reasoning",
     "prompt": "I need a 30-minute slot tomorrow at 2pm for a project review meeting and I want to know if I should bring an umbrella to the office in San Francisco."},
]


def call_chat(endpoint: str, model: str, api_key: str, messages, tools=None, temperature=0.0, max_tokens=600):
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
    }
    if tools:
        payload["tools"] = tools
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    start = time.time()
    r = requests.post(f"{endpoint.rstrip('/')}/chat/completions", json=payload, headers=headers, timeout=180)
    latency = round(time.time() - start, 2)
    r.raise_for_status()
    data = r.json()
    msg = data["choices"][0]["message"]
    return {
        "content": msg.get("content", "") or "",
        "tool_calls": msg.get("tool_calls", []),
        "latency": latency,
        "usage": data.get("usage", {}),
    }


def run(endpoint: str, model: str, api_key: str, label: str) -> dict:
    out = {"label": label, "model": model, "endpoint": endpoint, "results": {}}

    # 1. Meetings
    print("Meetings...")
    out["results"]["meetings"] = []
    for case in MEETING_CASES:
        try:
            resp = call_chat(endpoint, model, api_key, [
                {"role": "system", "content": "You are a meeting summarization assistant. Provide a concise summary, list decisions, and list action items with owners and deadlines."},
                {"role": "user", "content": f"Summarize this transcript:\n\n{case['transcript']}"},
            ])
            out["results"]["meetings"].append({
                "id": case["id"], "title": case["title"],
                "output": resp["content"], "latency": resp["latency"],
                "error": None,
            })
            print(f"  {case['id']}: {resp['latency']}s, {len(resp['content'])} chars")
        except Exception as e:
            out["results"]["meetings"].append({"id": case["id"], "title": case["title"], "output": "", "latency": 0, "error": str(e)})
            print(f"  {case['id']}: ERROR — {e}")

    # 2. Coding
    print("Coding...")
    out["results"]["coding"] = []
    for case in CODING_CASES:
        try:
            resp = call_chat(endpoint, model, api_key, [
                {"role": "system", "content": "You are an expert software engineer. Write correct, efficient Python."},
                {"role": "user", "content": case["prompt"]},
            ])
            out["results"]["coding"].append({
                "id": case["id"], "title": case["title"],
                "prompt": case["prompt"],
                "output": resp["content"], "latency": resp["latency"],
                "error": None,
            })
            print(f"  {case['id']}: {resp['latency']}s, {len(resp['content'])} chars")
        except Exception as e:
            out["results"]["coding"].append({"id": case["id"], "title": case["title"], "prompt": case["prompt"], "output": "", "latency": 0, "error": str(e)})
            print(f"  {case['id']}: ERROR — {e}")

    # 3. Hallucination
    print("Hallucination probes...")
    out["results"]["hallucination"] = []
    for case in HALLUCINATION_CASES:
        try:
            user_msg = case["prompt"]
            if "transcript" in case:
                user_msg = f"Transcript:\n{case['transcript']}\n\n{case['prompt']}"
            resp = call_chat(endpoint, model, api_key, [
                {"role": "system", "content": "You are a careful, factual assistant. Refuse to invent information you do not know."},
                {"role": "user", "content": user_msg},
            ])
            out["results"]["hallucination"].append({
                "id": case["id"], "title": case["title"],
                "prompt": user_msg, "expected": case["expected"],
                "output": resp["content"], "latency": resp["latency"],
                "error": None,
            })
            print(f"  {case['id']}: {resp['latency']}s")
        except Exception as e:
            out["results"]["hallucination"].append({"id": case["id"], "title": case["title"], "prompt": case.get("prompt"), "expected": case["expected"], "output": "", "latency": 0, "error": str(e)})
            print(f"  {case['id']}: ERROR — {e}")

    # 4. Tool use
    print("Tool use...")
    out["results"]["tool_use"] = []
    for case in TOOL_CASES:
        try:
            resp = call_chat(endpoint, model, api_key, [
                {"role": "system", "content": "You can use tools. Call them when the user request requires an action."},
                {"role": "user", "content": case["prompt"]},
            ], tools=TOOL_DEFINITIONS, max_tokens=400)
            tool_calls_summary = []
            for tc in resp["tool_calls"] or []:
                fn = tc.get("function", {})
                tool_calls_summary.append({
                    "name": fn.get("name", ""),
                    "arguments": fn.get("arguments", ""),
                })
            out["results"]["tool_use"].append({
                "id": case["id"], "title": case["title"],
                "prompt": case["prompt"],
                "output": resp["content"], "tool_calls": tool_calls_summary,
                "latency": resp["latency"],
                "error": None,
            })
            print(f"  {case['id']}: {resp['latency']}s, tool_calls={len(tool_calls_summary)}")
        except Exception as e:
            out["results"]["tool_use"].append({"id": case["id"], "title": case["title"], "prompt": case["prompt"], "output": "", "tool_calls": [], "latency": 0, "error": str(e)})
            print(f"  {case['id']}: ERROR — {e}")

    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--endpoint", required=True)
    ap.add_argument("--model", required=True)
    ap.add_argument("--api_key", required=True)
    ap.add_argument("--label", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    print(f"\nQualitative eval: {args.label} ({args.model})")
    print(f"Endpoint: {args.endpoint}\n")
    result = run(args.endpoint, args.model, args.api_key, args.label)
    with open(args.out, "w") as f:
        json.dump(result, f, indent=2)
    print(f"\nSaved: {args.out}")


if __name__ == "__main__":
    main()
