"""Shared metrics: ROUGE precision/recall/F1 (macro over pairs), code token F1."""

from __future__ import annotations

import re
from collections import Counter

from rouge_score import rouge_scorer


def rouge_macro_prf(
    predictions: list[str],
    references: list[str],
    use_stemmer: bool = True,
) -> dict[str, float]:
    """Macro-average ROUGE-1/2/L precision, recall, and F1 (as 0–100), stemmed."""
    scorer = rouge_scorer.RougeScorer(["rouge1", "rouge2", "rougeL"], use_stemmer=use_stemmer)
    keys = ("rouge1", "rouge2", "rougeL")
    sums = {f"{k}_precision": 0.0 for k in keys}
    sums.update({f"{k}_recall": 0.0 for k in keys})
    sums.update({f"{k}_f1": 0.0 for k in keys})
    n = len(predictions)
    if n == 0:
        return {k: 0.0 for k in sums}
    for pred, ref in zip(predictions, references):
        s = scorer.score(ref, pred)
        for k in keys:
            sums[f"{k}_precision"] += s[k].precision * 100
            sums[f"{k}_recall"] += s[k].recall * 100
            sums[f"{k}_f1"] += s[k].fmeasure * 100
    return {k: round(sums[k] / n, 3) for k in sums}


def code_token_f1(reference: str, hypothesis: str) -> float:
    """Multiset token F1 over alphanumeric tokens (case-insensitive)."""
    return code_token_prf(reference, hypothesis)["f1"]


def code_token_prf(reference: str, hypothesis: str) -> dict[str, float]:
    """Multiset token precision, recall, F1 over alphanumeric tokens (case-insensitive)."""

    def toks(s: str) -> list[str]:
        return re.findall(r"[A-Za-z_]\w*", s.lower())

    rt, ht = toks(reference), toks(hypothesis)
    if not rt and not ht:
        return {"precision": 1.0, "recall": 1.0, "f1": 1.0}
    if not rt or not ht:
        return {"precision": 0.0, "recall": 0.0, "f1": 0.0}
    rc, hc = Counter(rt), Counter(ht)
    inter = sum((rc & hc).values())
    prec = round(inter / max(1, sum(hc.values())), 4)
    rec = round(inter / max(1, sum(rc.values())), 4)
    f1 = round(2.0 * prec * rec / (prec + rec), 4) if prec + rec > 1e-9 else 0.0
    return {"precision": prec, "recall": rec, "f1": f1}


def rouge_single_prf(prediction: str, reference: str, use_stemmer: bool = True) -> dict[str, float]:
    scorer = rouge_scorer.RougeScorer(["rouge1", "rouge2", "rougeL"], use_stemmer=use_stemmer)
    s = scorer.score(reference, prediction)
    out = {}
    for k in ("rouge1", "rouge2", "rougeL"):
        out[f"{k}_precision"] = round(s[k].precision * 100, 3)
        out[f"{k}_recall"] = round(s[k].recall * 100, 3)
        out[f"{k}_f1"] = round(s[k].fmeasure * 100, 3)
    return out
