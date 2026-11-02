# Third-party notices

Recme is MIT licensed (see `LICENSE`). It uses and, in the installer, ships the following software.

## FFmpeg (bundled in the installer)

The installer contains `ffmpeg.exe` and `ffprobe.exe` (in `resources/ffmpeg/`), taken from the
"full build" of FFmpeg 7.1 by gyan.dev.

- Project: <https://ffmpeg.org/>
- Build: <https://www.gyan.dev/ffmpeg/builds/>
- **License of this build: GNU General Public License v3 or later** (it is configured with `--enable-gpl --enable-version3`, includes x264 and other GPL components). The full license text is shipped next to the binaries (`resources/ffmpeg/LICENSE`).
- Source code: FFmpeg's source is available at <https://ffmpeg.org/download.html>; the exact sources used for the gyan.dev build are linked from <https://www.gyan.dev/ffmpeg/builds/>.
- Recme runs FFmpeg as a separate program (it does not link to it). If you redistribute the installer, you must follow the GPL for the bundled FFmpeg (keep the license text, and make the corresponding source available), or replace it with an LGPL build of FFmpeg.

### macOS build

The macOS `.dmg`/`.zip` contains static `ffmpeg` and `ffprobe` (in `Recme.app/Contents/Resources/ffmpeg/`), fetched
by `npm run fetch:ffmpeg-mac` from the npm packages [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static)
and [`@ffprobe-installer`](https://github.com/SavageCore/node-ffprobe-installer) (`darwin-x64` / `darwin-arm64`).
The `ffmpeg` builds are configured with `--enable-gpl` (GPL, includes x264).
The same rules as above apply when you redistribute it. Note that the `LICENSE` file copied next to the macOS
binaries is the general FFmpeg licence overview shipped by `ffmpeg-static`; if you distribute the macOS build,
also include the full GPL v3 text and a source offer, or use an LGPL build of FFmpeg instead.

## Runtime dependencies (npm)

| Package | License | Use |
|---|---|---|
| [Electron](https://www.electronjs.org/) | MIT | application shell (Chromium + Node.js) |
| [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) | MIT | MCP server |
| [zod](https://github.com/colinhacks/zod) | MIT | tool input validation |
| [selfsigned](https://github.com/jfromaniello/selfsigned) | MIT | TLS certificate for encrypted file receiving |
| [electron-builder](https://www.electron.build/) | MIT | packaging (build time only) |

Each package's own license file is included in `node_modules/` and in the installer's `app.asar`.

## LocalSend

Recme's "Share on Wi-Fi" speaks the public LocalSend protocol (v2) so it can find and exchange files with
devices running [LocalSend](https://localsend.org/) (Apache-2.0). Recme is an independent project, not
affiliated with or endorsed by LocalSend. The protocol is implemented from its public description; no
LocalSend code is included.

## Names

"Windows", "Claude", "Unity", "OBS Studio", "LocalSend" and other product names mentioned in the
documentation belong to their respective owners.
