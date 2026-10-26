# Invariant check for the live prompt-command save+replay output.
#
# cases/prompt-live.repl submits the same form fixture as form-live, but
# through REPL prompt commands (`/fill the … input value=…`), so the same
# values are pinned. The typed value reaches the query only if the pinned
# `value=` survived into the saved script.
#
# Evaluates to true iff every invariant holds. Use with `jq -e -f` so the
# process exit code reflects the result.
(type == "object")
and (.method | type == "string" and ascii_upcase == "GET")
and (.query | type == "string"
  and contains("h3=lightpanda42")
  and contains("h1=v1")
  and (contains("h2=") | not)
)
