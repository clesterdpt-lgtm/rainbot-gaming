#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

failures=0

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  failures=1
}

excluded_pathspecs=(
  ':!assets/vendor/**'
  ':!output/**'
  ':!tmp/**'
  ':!test-artifacts/**'
  ':!.playwright-cli/**'
  ':!.playwright-mcp/**'
)
site_scan_pathspecs=(
  "${excluded_pathspecs[@]}"
  ':!scripts/security-prepublish-check.sh'
)

artifact_pattern='^(\.playwright-cli|\.playwright-mcp|output|tmp|test-artifacts)/'
tracked_artifacts="$(git ls-files | grep -E "$artifact_pattern" || true)"
if [[ -n "$tracked_artifacts" ]]; then
  fail "Generated/dev-only artifacts are tracked and would be publicly served."
  printf '%s\n' "$tracked_artifacts" | sed -n '1,40p' >&2
  artifact_count="$(printf '%s\n' "$tracked_artifacts" | wc -l | tr -d ' ')"
  if [[ "$artifact_count" -gt 40 ]]; then
    printf '...and %s more\n' "$((artifact_count - 40))" >&2
  fi
fi

secret_pattern='(-----BEGIN ([A-Z]+ )?PRIVATE KEY-----|ghp_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{22,}|sk-[A-Za-z0-9_-]{20,}|AIza[0-9A-Za-z_-]{35}|AKIA[0-9A-Z]{16}|xox[baprs]-[0-9A-Za-z-]+)'
if command -v rg >/dev/null 2>&1; then
  secret_hits="$(
    git ls-files -z -- "${excluded_pathspecs[@]}" |
      xargs -0 rg -n --pcre2 "$secret_pattern" 2>/dev/null || true
  )"
else
  secret_hits="$(git grep -nIE "$secret_pattern" -- . "${excluded_pathspecs[@]}" || true)"
fi
if [[ -n "$secret_hits" ]]; then
  fail "Potential high-confidence secret material found."
  printf '%s\n' "$secret_hits" | sed -n '1,40p' >&2
fi

approved_hosts_file="scripts/approved-external-hosts.txt"
if [[ ! -f "$approved_hosts_file" ]]; then
  fail "Missing $approved_hosts_file."
else
  tmp_hosts="$(mktemp)"
  tmp_approved="$(mktemp)"
  trap 'rm -f "$tmp_hosts" "$tmp_approved"' EXIT

  git grep -hIEo "https://[^\"' <>)]+" -- . "${site_scan_pathspecs[@]}" 2>/dev/null |
    sed -E 's#https://([^/?#]+).*#\1#' |
    sed '/^$/d' |
    sort -u > "$tmp_hosts" || true

  grep -Ev '^[[:space:]]*(#|$)' "$approved_hosts_file" | sort -u > "$tmp_approved"
  unknown_hosts="$(comm -23 "$tmp_hosts" "$tmp_approved")"
  if [[ -n "$unknown_hosts" ]]; then
    fail "Unapproved external host(s) found. Review and add only if intentional."
    printf '%s\n' "$unknown_hosts" >&2
  fi
fi

dangerous_js_hits="$(git grep -nIE '(eval[[:space:]]*\(|new Function[[:space:]]*\(|document\.write[[:space:]]*\(|javascript:)' -- '*.html' 'assets/js/**' 'games/**' "${excluded_pathspecs[@]}" || true)"
if [[ -n "$dangerous_js_hits" ]]; then
  fail "High-risk JavaScript pattern(s) found."
  printf '%s\n' "$dangerous_js_hits" | sed -n '1,40p' >&2
fi

inner_html_count="$(git grep -nE 'innerHTML[[:space:]]*=' -- assets/js games 2>/dev/null | wc -l | tr -d ' ')"
printf 'Security prepublish check complete. innerHTML assignment count: %s; keep user-controlled data out of those sinks.\n' "$inner_html_count"

if [[ "$failures" -ne 0 ]]; then
  exit 1
fi
