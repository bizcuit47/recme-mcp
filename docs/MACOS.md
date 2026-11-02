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

- `fetch:ffmpeg-mac` downloads `ffmpeg-static` and `@ffprobe-installer/darwin-<arch>` from npm into a temp folder
  (they are not added to `package.json`) and checks both files are the right architecture. (`ffprobe-static` is
  not used: its `darwin/arm64` folder holds an Intel binary.)
- `check:ffmpeg-mac` fails the build if ffmpeg/ffprobe are missing, are the wrong architecture, link to anything
  outside `/usr/lib` and `/System/Library`, do not run, or lack `avfoundation`. This is what stops a Homebrew copy
  from sneaking in. When the target architecture is not the machine's own, the binaries cannot be run, so they are
  only inspected.
- A build is for **one architecture**, and you can build either one on either kind of Mac:

  ```bash
  RECME_MAC_ARCH=arm64 npm run fetch:ffmpeg-mac && RECME_MAC_ARCH=arm64 npm run dist:mac -- --arm64   # Apple Silicon
  RECME_MAC_ARCH=x64   npm run fetch:ffmpeg-mac && RECME_MAC_ARCH=x64   npm run dist:mac -- --x64     # Intel
  ```

  Intel apps run on Apple Silicon through Rosetta (if installed), but not the other way round. Do the two builds
  one after the other: both use `vendor/ffmpeg`.
- The app is **ad-hoc signed** (`mac.identity` is `-` in `package.json`; no Apple account needed). Apple Silicon
  refuses to run an app whose signature is broken, and electron-builder otherwise leaves Electron's old signature
  in place, so this is required for the arm64 build. It is **not notarized**: on another Mac, Gatekeeper blocks a
  downloaded copy. Right-click the app, choose *Open*, or run `xattr -cr /Applications/Recme.app`. Removing that
  step needs a paid Apple Developer account (set `mac.identity` to your certificate, then notarize).
- **The arm64 build has only been built, never run on an Apple Silicon Mac.**
- The bundled ffmpeg is a **GPL** build (see `THIRD-PARTY-NOTICES.md`); follow the GPL if you distribute it.

## CI

`.github/workflows/ci.yml` runs on every push:

- **Windows** – `npm run test:edit`.
- **macOS** – the same headless suite on a real macOS runner (experimental, failures do not block).
- **macOS build** – an ad-hoc signed, not notarized arm64 `.dmg`/`.zip` as a downloadable workflow artifact
  (experimental).

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
