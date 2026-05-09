#!/usr/bin/env bash
# Always compile from this directory so figures/ resolves correctly.
set -euo pipefail
cd "$(dirname "$0")"
export MPLCONFIGDIR="${MPLCONFIGDIR:-$(pwd)/.mplconfig}"
mkdir -p "$MPLCONFIGDIR"
if [[ ! -f figures/wos_system_architecture.png ]]; then
  echo "Generating figures..."
  python3 gen_figures.py
fi
pdflatex -interaction=nonstopmode full_report.tex
bibtex full_report || true
pdflatex -interaction=nonstopmode full_report.tex
pdflatex -interaction=nonstopmode full_report.tex
echo "Output: $(pwd)/full_report.pdf"
