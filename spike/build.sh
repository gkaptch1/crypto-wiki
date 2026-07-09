#!/usr/bin/env bash
# Phase 0 rendering spike: definition fragment + macro set -> real LaTeX -> SVG.
# Proves out the Tier-2 rendering pipeline from PLAN.md (production version will
# run Tectonic in a sandboxed container; the pipeline shape is identical).
#
# Usage: ./build.sh   (outputs SVGs + timings into spike/out/)
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out
export PATH="/Library/TeX/texbin:$PATH"

build() {
  local fragment=$1 macroset=$2 name=$3
  local work
  work=$(mktemp -d)

  cat > "$work/doc.tex" <<EOF
\documentclass[varwidth=12cm, border=8pt]{standalone}
\usepackage{amsmath,amssymb}
\usepackage{cryptocode}
\input{$PWD/macros/$macroset.tex}
\begin{document}
\input{$PWD/fragments/$fragment.tex}
\end{document}
EOF

  local start end
  start=$(python3 -c 'import time; print(time.time())')
  # -no-shell-escape mirrors the sandboxing the production renderer will enforce
  if ! latex -no-shell-escape -interaction=nonstopmode -halt-on-error \
       -output-directory="$work" "$work/doc.tex" > "$work/latex.log" 2>&1; then
    echo "FAIL  $name (latex)"; tail -20 "$work/latex.log"; return 1
  fi
  dvisvgm --no-fonts --exact-bbox -o "out/$name.svg" "$work/doc.dvi" > "$work/dvisvgm.log" 2>&1
  end=$(python3 -c 'import time; print(time.time())')

  printf 'OK    %-24s %5.2fs  %s\n' "$name" "$(echo "$end $start" | awk '{print $1-$2}')" \
    "$(du -h "out/$name.svg" | cut -f1)"
  rm -rf "$work"
}

build prf      standard  prf-standard
build prf      alt       prf-alt
build euf-cma  standard  euf-cma-standard
build euf-cma  alt       euf-cma-alt
