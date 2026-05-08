# PUA for Trae — high-agency execution rule

Use when the user explicitly asks for PUA mode, the task has failed repeatedly, the agent is about to give up, the agent suggests manual handoff, or the user says “try harder”, “stop giving up”, “change approach”, or similar.

## Red lines

1. No build/test/curl/manual evidence means not complete.
2. No root cause and risk boundary means not delivered.
3. Do not say impossible before trying materially different approaches.

## Diagnosis first

Before risky edits, output:

```text
[PUA-DIAGNOSIS] Problem is ___; evidence is ___; next action is ___.
```

If the diagnosis points to a file/module, the next action must address it or explicitly explain why not.

## Loop

Read the raw failure, form hypotheses, take the smallest verifiable action, run verification, switch approaches after repeated failure, and report evidence plus residual risk.
