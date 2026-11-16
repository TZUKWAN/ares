# ARES portable runtime

The shared core calls the real ARES backend. It does not create a second project
format, forward arbitrary commands, supply a model API, or impersonate a DSH
native session. The transport is built from the pinned official MCP TypeScript
SDK; the ARES backend stays outside the bundle so resource and `import.meta.url`
paths retain their meaning.

## Start

Node.js 20 or later is required. Artifact checks also use the existing ARES
Python scripts and their existing format-specific requirements.

```powershell
node scripts/ares-mcp.mjs --host codex --root C:\absolute\project
node scripts/ares-mcp.mjs --host zcode --root C:\absolute\project --home C:\absolute\ares-home
```

The launcher writes protocol messages only to stdout. Diagnostics go to stderr.
It does not install itself into any user's global client configuration.

Default configuration is `~/.ares/codex`, `~/.ares/zcode` or `~/.ares/portable`.
`--home` or `ARES_HOME` explicitly overrides it, including intentional sharing
with an existing DSH home. `DSH_HOME` is never the portable default. Portable
workflow saves do not claim to publish DSH native presets or start DSH agents.

## Project authority

Trusted roots are the union of repeated startup `--root` paths (or the JSON
array in `ARES_ALLOWED_ROOTS`) and the current MCP client's `roots/list` result.
No working directory is implicitly authorized. Only exact canonical existing
directory roots are accepted; children require their own explicit declaration.
Symlink aliases cannot authorize a different target. Client roots are revoked
on a legacy roots-change notification. A failed roots response clears client
authority. On protocol 2026-07-28, each tool call obtains roots in an official
input-required round; responses are tied to a one-use server nonce and exact
tool arguments. There is no root-registration tool.

`core.dispatch(name, args, context)` rejects unknown JSON fields. JSON cannot
select an owner identity. Calls start as the `agent` principal. A host that
declares form-mode elicitation can ask its user to confirm one exact local
owner action: completion/rule approval, team/schedule changes, project flow
apply, formal version freeze or restore. The service uses official
`inputRequired.elicit`; the SDK's default legacy shim sends a real
`elicitation/create` request on older connections. Form responses are strictly
validated and require both `action: accept` and `confirm: true`.

Roots and confirmation share one server-side nonce state machine. The nonce
binds the exact tool/arguments, canonical root, project/revision/definition,
actual input/output/review hashes and target immutable records. After a form,
the service gets current roots again, then rechecks evidence and runs the
original mutation in the same serialized backend-home queue. Confirmed
completion reports pin the approved output hashes and use the original
reviewPath validation branch. Each nonce is consumed once. Changed evidence,
revoked roots, malformed/false/cancelled responses, expiry and replay refuse
the operation without automatically asking again. No capability means the
original `needs-owner` refusal. The local CLI has no form channel and cannot
approve owner operations through JSON or a command-line owner flag.

This trusts the local MCP host to show its actual user the form. It is not user
identity authentication, and an SDK fixture that answers automatically does
not prove that Codex/ZCode displayed or received an actual human confirmation.
Capability availability is reported as `hostConfirmation.protocolAvailable`;
`identityAuthentication` stays false. Concurrent external file editors are
still subject to the original backend's filesystem/revision checks; the queue
does not lock unrelated operating-system processes.

Cloud connect/bind stays outside the portable confirmation whitelist. Public
cloud sharing/publication and permission changes remain unsupported by this
adapter; use the original owner confirmation path. DSH-bound project writes
are rejected because this process cannot attest that their native session is
idle.

## Shared interface

`createPortableAres({home, host, roots})` provides `ready`, `tools()`,
`listTools()`, `dispatch()`, `updateAllowedRoots()` and `dispose()`. The trusted
server-only `prepareOwnerApproval()` and `dispatchConfirmed()` provide the
evidence binding and adjacent final recheck; they are not MCP tools.
Constructor options, root updates and dispatch context belong to trusted server
code, never to a model-supplied JSON object. Calls with distinct homes are
serialized while using the existing backend's process-level `ARES_HOME`, then
restore the previous environment value.

The nine tools are:

| Tool | Scope |
| --- | --- |
| `ares_capabilities` | Honest capabilities and current trusted roots |
| `ares_catalog` | Actual competition/track catalog and skill reference bodies |
| `ares_workflow` | Revision-checked competition flow library and independent project drafts |
| `ares_project` | Project creation/state, compiled fixed step instructions, start/block, actual checks |
| `ares_artifact` | Existing registered artifact read/edit/history, with file-hash conflicts |
| `ares_version` | Working captures, checkpoints, immutable reads and real comparisons |
| `ares_plan` | Current schedule/progress; owner gate on updates |
| `ares_team` | Current members/assignments; owner gate on changes |
| `ares_collaboration` | Existing project-bound Kdocs reads; no automatic cloud writes |

`ares_project` action `step` returns actual fixed skill bodies and output
contracts. The host agent uses its own native file/tools to do the work, then
calls `check` and optionally captures a working version. A successful check or
snapshot is not acceptance. Missing outputs are reported as missing, never
created as placeholders.

`createPortableMcpServer(options)` returns `{server, core, refreshRoots,
uiRegistration}`. It loads `../ui-server.mjs` when present, or accepts
`options.uiRegistrar(server, core, options)`. Custom entry tools must first call
`await options.prepareToolCall(name,args,ctx)` and return a non-null result
unchanged so standard roots discovery is not bypassed. `--require-ui` makes
missing UI resources a startup error; `--no-ui` is available for transport-only
testing. SDK exports are shared through `sdk.mjs`.

## Reproduce build and tests

```powershell
cd platforms/shared
npm ci --ignore-scripts --no-fund --no-audit
npm run build
cd ../..
node --test tests/portable-mcp.test.mjs
node --test tests/portable-owner-approval.test.mjs tests/portable-local.test.mjs
```

Only this private subpackage has dependencies. The root DSH package gains no
runtime dependencies. Release transport files are in `vendor/`; pinned lock,
source entry, build recipe, dependency licenses, source input list and bundle
SHA-256 are included. The protocol tests use the official SDK client from this
subpackage's development dependencies. They launch actual stdio subprocesses,
write only owned temporary projects, and do not invoke an online model, cloud
write or desktop automation.
