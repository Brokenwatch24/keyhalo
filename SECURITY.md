# Security policy

KeyHalo talks to USB hardware, hooks global input for remapping and statistics, runs
community-made lighting effects and can sign in to GitHub. This page explains how each of
those is kept safe, and how to report a problem.

## Supported versions

Only the **latest release** on the [Releases page](https://github.com/Brokenwatch24/keyhalo/releases/latest)
receives security fixes. Please update before reporting.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report them privately through
[GitHub Security Advisories](https://github.com/Brokenwatch24/keyhalo/security/advisories/new).
Include the KeyHalo version, Windows version, steps to reproduce and the impact you expect.
You will get a first answer within **7 days**. Once a fix is released we credit reporters in the
advisory unless you prefer to stay anonymous.

## How KeyHalo protects you

### Hardware: no firmware flashing, ever

- KeyHalo **never flashes or updates firmware**. It only sends documented runtime commands
  (lighting frames, effects, brightness, DPI, polling rate, battery queries) and, when you
  explicitly choose "Save to device", the vendor's onboard-memory (varstore) commands.
  Protocol notes live in [`docs/protocols`](docs/protocols).
- Before the first write to a device, KeyHalo captures a **snapshot** of its current state.
  **Restore original** puts the device back the way it was.
- **Safe mode** (Settings) disables every hardware write and keeps KeyHalo read-only, which is
  useful for diagnostics and for testing new device definitions.

### Community effects run sandboxed

Community lighting effects (`community/effects/*.js`) run in an isolated **Web Worker** that
receives only frame data and returns colours. They have no access to the DOM, storage,
the backend or the network.

- CI rejects effect files that reference `fetch`, `XMLHttpRequest`, `WebSocket`,
  `importScripts`, `eval` or `Function(`, and validates their `meta` export without running
  the effect itself (in a `node:vm` context with no globals and a timeout).
- At runtime the worker removes network, storage and code-loading APIs (`fetch`, `XMLHttpRequest`,
  `WebSocket`, `EventSource`, `importScripts`, nested workers…) before evaluating the effect, rejects
  `import`/`require`, and disables effects that throw, stall or exceed their frame budget.

### Risky keymap actions need your review

Keymap packs and profiles can contain actions that do more than remap a key:
`launch` (start a program), `macro` steps that type text, `text`, and `http` requests
(automations). These are flagged as **risky**:

- **In CI**, pull requests that add risky actions get a warning in the validation comment so
  reviewers look at them closely.
- **In the app**, installing content with risky actions shows exactly what it does and needs
  your explicit confirmation before it is enabled.

### Local API

The local REST/WebSocket API (used by the CLI, Stream Deck-style tools and scripts):

- listens on **127.0.0.1 only**, never on your network;
- supports an optional **bearer token** (Settings → API);
- can be **disabled** entirely in Settings.

### GitHub sign-in and tokens

Publishing to the community gallery and sharing via Gist need a GitHub token:

- obtained through the **OAuth device flow** (scopes `public_repo gist`), or a
  **fine-grained Personal Access Token** that you paste yourself;
- stored in **plain JSON** in `settings.json` inside the KeyHalo app data folder
  (on Windows `%APPDATA%\<app identifier>\`). Anyone with access to your Windows user
  account can read it, as with most desktop apps;
- only ever sent to `api.github.com` / `github.com`;
- removed when you **Sign out**. You can also revoke it at any time at
  <https://github.com/settings/applications> (OAuth) or
  <https://github.com/settings/personal-access-tokens> (PATs).

### Input privacy

The global input hook is used for remapping, live WPM, reactive lighting and **counts only**
(keys pressed, clicks, mouse distance). Typed text is never stored, except inside the typing
trainer's own sessions, which stay on your computer.

### Anti-cheat

KeyHalo does not inject into games or install kernel drivers. Remapping and macros pause
automatically while competitive games from the configurable pause list are focused.
