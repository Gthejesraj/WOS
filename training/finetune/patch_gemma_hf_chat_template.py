#!/usr/bin/env python3
"""
Fast fix: copy Gemma 2 Instruct chat_template into your merged HF repo (no weight remerge).

Fixes vLLM / OpenAI ChatTemplateResolutionError on transformers>=4.44 when the base model
was google/gemma-2-27b (no chat template).

Usage:
  export HF_TOKEN=hf_...   # optional if you ran: huggingface-cli login
  python3 patch_gemma_hf_chat_template.py --repo thejesraj/wos-coding-gemma

Repeat for wos-meeting-gemma / wos-main-gemma if needed.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

from huggingface_hub import hf_hub_download, upload_file


def _resolve_token() -> str | None:
    t = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if t:
        return t.strip()
    try:
        from huggingface_hub import get_token as _gt

        return (_gt() or "").strip() or None
    except Exception:
        return None


SOURCE = "google/gemma-2-27b-it"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True, help="Your model repo id, e.g. thejesraj/wos-coding-gemma")
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Print lengths only; do not upload",
    )
    args = ap.parse_args()

    token = _resolve_token()
    if not token:
        print(
            "ERROR: No Hugging Face token.\n"
            "  Either:  export HF_TOKEN=hf_...\n"
            "  Or run once:  huggingface-cli login",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"Downloading tokenizer_config.json from {SOURCE}...")
    src_path = hf_hub_download(
        repo_id=SOURCE,
        filename="tokenizer_config.json",
        token=token,
    )
    with open(src_path, encoding="utf-8") as f:
        src = json.load(f)
    chat_template = src.get("chat_template")
    if not chat_template or not str(chat_template).strip():
        print("ERROR: source repo has no chat_template", file=sys.stderr)
        sys.exit(1)

    print(f"Downloading tokenizer_config.json from {args.repo}...")
    dst_path = hf_hub_download(
        repo_id=args.repo,
        filename="tokenizer_config.json",
        token=token,
    )
    with open(dst_path, encoding="utf-8") as f:
        dst = json.load(f)

    before = bool((dst.get("chat_template") or "").strip())
    dst["chat_template"] = chat_template

    out_json = json.dumps(dst, indent=2, ensure_ascii=False)
    jinja_body = chat_template if isinstance(chat_template, str) else str(chat_template)

    if args.dry_run:
        print(f"Would set chat_template ({len(jinja_body)} chars); had template before: {before}")
        print("Dry run OK — remove --dry-run to upload.")
        return

    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "tokenizer_config.json"
        p.write_text(out_json, encoding="utf-8")
        print(f"Uploading tokenizer_config.json to {args.repo}...")
        upload_file(
            path_or_fileobj=str(p),
            path_in_repo="tokenizer_config.json",
            repo_id=args.repo,
            repo_type="model",
            token=token,
            commit_message="Add Gemma 2 Instruct chat_template for vLLM /chat/completions",
        )

        jpath = Path(td) / "chat_template.jinja"
        jpath.write_text(jinja_body, encoding="utf-8")
        print(f"Uploading chat_template.jinja to {args.repo}...")
        upload_file(
            path_or_fileobj=str(jpath),
            path_in_repo="chat_template.jinja",
            repo_id=args.repo,
            repo_type="model",
            token=token,
            commit_message="Add chat_template.jinja for optional vLLM --chat-template",
        )

    print("\nDone. Redeploy / restart Runpod workers so they pull the new revision.")
    print("Optional vLLM flag if Hub cache is sticky:\n  --chat-template /path/to/chat_template.jinja")


if __name__ == "__main__":
    main()
