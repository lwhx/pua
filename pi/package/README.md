# @tanweai/pi-pua

PUA high-agency governance package for the [Pi coding agent](https://pi.dev/):

- extension: `/pua-on`, `/pua-off`, `/pua-status`, `/pua-reset`, shared `~/.pua/config.json`, failure counter, before-agent diligence context;
- skill: `pua` SKILL.md governance contract with diagnosis-first, four-power separation, and verification gates.

## Install

After publishing to npm:

```bash
pi install npm:@tanweai/pi-pua
```

From this repository checkout:

```bash
pi install ./pi/package
```

Temporary trial:

```bash
pi -e ./pi/package/extensions/pua/index.ts --skill ./pi/package/skills/pua
```

## Commands

| Command | Effect |
|---|---|
| `/pua-on` | Enable persistent PUA diligence context |
| `/pua-off` | Disable persistent mode and feedback prompts |
| `/pua-status` | Show config, offline flag, failure count, pressure level |
| `/pua-reset` | Reset shared failure counter |

## Governance boundary

This package does not replace Pi sandboxing, permission systems, or human approval. It deliberately separates action, self-review, scoring, and environment mutation so the agent cannot confuse “looks done” with “verified done”.
