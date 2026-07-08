# Invariant check for the live form save+replay output.
#
# The output contract lives in two co-located halves: cases/form-live.task
# pins what the agent must return, this file verifies it. Edit them together.
#
# Unlike hn-live, the fixture is fully deterministic — only the LLM side
# varies (how it phrases the extraction, whether it clicks or presses Enter) —
# so the values themselves are pinned: a GET submission whose query string
# carries the typed h3 value and the form's hidden h1 field, and never the
# disabled h2 field.
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
