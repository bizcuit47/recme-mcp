# macOS status

**Short version: Recme does not work on macOS yet.** Windows is the only supported platform today.

Phase 1 of the port is in the repository: all Windows-specific code now sits behind a platform adapter
(`src/platform/`), and an *untested* macOS adapter exists next to it. Nobody has run Recme on a Mac, so
everything below marked **UNVERIFIED** is a best guess from documentation, not something we have seen work.

## What is where

| Part | State |
| --- | --- |
| Editor, export, contact sheet, Wi-Fi sharing, MCP server | Platform independent. Checked by `npm run test:edit` on Windows, and by the macOS CI job (see below). |
| Screen capture on macOS (`src/platform/darwin.js`) | Written, **UNVERIFIED**. Uses ffmpeg `avfoundation`. |
| Microphone on macOS | Written, **UNVERIFIED**. |
| System audio on macOS | Reuses the Electron loopback path. Needs macOS 13+ (and `NSAudioCaptureUsageDescription` on 14.2+). **UNVERIFIED**. |
| Window list / window capture | Window list through JXA (`CGWindowListCopyWindowInfo`) is written, **UNVERIFIED**. `window` capture is rejected on macOS; `window_area` (record the window's rectangle) is the intended route. |
| Hardware encoder | `h264_videotoolbox` mapping written, quality mapping **UNVERIFIED**. |
| Launch at login, hotkey labels (Cmd) | Written, **UNVERIFIED**. |
| Build (`npm run dist:mac`) | Config is in `package.json`; produces an **unsigned** dmg/zip. Not signed, not notarized. |

## Known limits of the macOS design

- `avfoundation` captures whole screens. A region is cut out with a crop filter, so it is the full screen being
  captured and then cropped.
- "Desktop" means the main display only (the recording shows a warning saying so).
- The first run needs Screen Recording permission (System Settings → Privacy & Security), and the app has to be
  restarted after granting it. Microphone has its own permission prompt.
- The bundled ffmpeg must be a **static** build. Homebrew's ffmpeg links to dylibs, so copying just the binary
  into the app would not run on another Mac. Until that is solved the app looks for `ffmpeg` in
  `/opt/homebrew/bin`, `/usr/local/bin`, `/opt/local/bin` (`brew install ffmpeg`).
- Shipping outside a developer's own machine needs an Apple Developer account (paid) for signing and notarization.
  Without it Gatekeeper will block the downloaded app.

## CI

`.github/workflows/ci.yml` runs on every push:

- **Windows** – `npm run test:edit`.
- **macOS** – the same headless suite on a real macOS runner (experimental, failures do not block).
- **macOS build** – an unsigned `.dmg`/`.zip` as a downloadable workflow artifact (experimental).

A green macOS job only proves the platform-independent parts. It cannot test screen capture, because CI
machines have no display or permissions.

## Want to help test on a Mac?

1. `brew install ffmpeg`
2. `git clone https://github.com/bizcuit47/recme-mcp && cd recme-mcp && npm install`
3. `npm run test:edit` – tell us the result.
4. `npm start`, grant Screen Recording when asked, restart, then try a short recording.
5. In the app, on the **Record** tab, scroll to the app settings and press **Copy diagnostics**, then open a
   *Test report* issue and paste it.

What we most want to learn: does `avfoundation` pick the right screen, are Retina sizes correct, does the
region crop land in the right place, and does system audio work.
