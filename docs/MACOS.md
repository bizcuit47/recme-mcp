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
| Build (`npm run dist:mac`) | Produces an **unsigned** dmg/zip with a static ffmpeg inside (built and checked on an Intel Mac; the bundled ffmpeg runs). Not signed, not notarized. |

## Known limits of the macOS design

- `avfoundation` captures whole screens. A region is cut out with a crop filter, so it is the full screen being
  captured and then cropped.
- "Desktop" means the main display only (the recording shows a warning saying so).
- The first run needs Screen Recording permission (System Settings → Privacy & Security), and the app has to be
  restarted after granting it. Microphone has its own permission prompt.
- The bundled ffmpeg must be a **static** build. Homebrew's ffmpeg links to dylibs, so copying just the binary
  into the app would not run on another Mac. The macOS build therefore bundles a static ffmpeg/ffprobe
  (see "Build the macOS app" below); a packaged app needs no Homebrew. When you run from source (`npm start`)
  the app falls back to `/opt/homebrew/bin`, `/usr/local/bin`, `/opt/local/bin` (`brew install ffmpeg`).
- Shipping outside a developer's own machine needs an Apple Developer account (paid) for signing and notarization.
  Without it Gatekeeper will block the downloaded app.

## Build the macOS app

```bash
npm install
npm run fetch:ffmpeg-mac     # static ffmpeg + ffprobe for THIS Mac's architecture into vendor/ffmpeg
npm run dist:mac             # runs check:ffmpeg-mac first, then builds dist/Recme-<version>-<arch>.dmg and .zip
```

- `fetch:ffmpeg-mac` downloads the `ffmpeg-static` / `ffprobe-static` npm packages into a temp folder (they are
  not added to `package.json`). Set `RECME_MAC_ARCH=x64` or `arm64` to fetch the other architecture.
- `check:ffmpeg-mac` fails the build if ffmpeg/ffprobe are missing, link to anything outside `/usr/lib` and
  `/System/Library`, do not run, or lack `avfoundation`. This is what stops a Homebrew copy from sneaking in.
- A build is for **one architecture**: an Intel build (`x64`) and an Apple Silicon build (`arm64`) each need their
  own ffmpeg. Intel apps run on Apple Silicon through Rosetta, but not the other way round.
- The result is **unsigned and not notarized**. On the Mac that built it you can just open it. On another Mac,
  Gatekeeper blocks a downloaded copy: right-click the app, choose *Open*, or run
  `xattr -cr /Applications/Recme.app`. Removing that step needs an Apple Developer account.
- The bundled ffmpeg is a **GPL** build (see `THIRD-PARTY-NOTICES.md`); follow the GPL if you distribute it.

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
