# Security policy

Recme records your screen and can send files over your network, so security reports are welcome and taken seriously.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

1. Go to the repository's **Security** tab → **Report a vulnerability** (GitHub private reporting).
2. If that button is not available, open a normal issue titled **"Security contact request"** with *no details*
   and we will arrange a private channel.

Helpful to include: what you found, steps to reproduce, the Recme version (Record tab → *Copy diagnostics*),
and what an attacker would gain. This is a small, volunteer project: expect an acknowledgement within about a
week, not hours. Only the latest release is supported.

## What Recme does, security-wise

These are the protections that exist today. If you can get around one of them, that is exactly the kind of
report we want.

**Local MCP server (how Claude and the `recme` command control the app)**
- Listens on `127.0.0.1` only, never on the network.
- Every request needs a bearer token (compared in constant time). The token is generated on first run and can be
  reset from the **Claude** tab.
- Requests with a browser `Origin` header or an unexpected `Host` header are rejected, so a web page you visit
  cannot drive the recorder (DNS-rebinding / cross-site protection).
- Tools that capture the screen, list window titles, send files or delete files can ask for your confirmation
  first (on by default).

**Wi-Fi file sharing (LocalSend v2 protocol)**
- Private-network addresses only, over HTTPS with a self-signed certificate; the sender pins the receiver's
  certificate fingerprint.
- Optional PIN with rate limiting; "trusted devices" are matched by certificate fingerprint and address.
- File names are sanitised and nothing is written until you accept (unless the sender is a trusted device).

**Build and distribution**
- The Electron windows use context isolation, a sandbox and a content security policy; the renderer only
  reaches the main process through a fixed list of IPC calls.
- Releases publish a SHA-256 of each installer.

## Known limitations (not vulnerabilities to report as new)

- The **token is stored in plain text** in Recme's `config.json` in your user profile, like most local developer
  tools. Anyone who can already read your user files can control Recme. Reset the token if you think it leaked.
- The `recme` command and any other local program running **as you** can use that token; the token protects
  against other machines and web pages, not against malware running under your account.
- The Windows installer and the (experimental) macOS builds are **not code-signed**, so SmartScreen / Gatekeeper
  will warn. Verify the SHA-256 from the release notes.
- The bundled ffmpeg is a third-party GPL build; update Recme to receive ffmpeg security fixes.
- macOS support is untested; see [docs/MACOS.md](docs/MACOS.md).

## Out of scope

Reports that need physical access to an unlocked machine, social engineering of the user into accepting a file
or pressing "Allow", or vulnerabilities in Electron, ffmpeg or other dependencies that are not reachable through
Recme (report those upstream).
