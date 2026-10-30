# Recme

Screen recorder for Windows with a **built-in MCP server**, so Claude can start/stop recordings, take screenshots and review the videos.

## Run

```bash
npm install
node node_modules/electron/install.js   # only if npm skipped Electron's download script
npm start
```

Requires `ffmpeg` on the machine (`winget install Gyan.FFmpeg`). Recme finds it on PATH or in the WinGet folder, or use `FFMPEG_PATH`.

Videos are saved to `C:\Users\<you>\Videos\Recme` (changeable in the app).

## Build the installer (.exe)

```bash
npm install
npm run dist
```

Creates `dist/Recme-Setup-1.0.0.exe` (Windows installer, per-user, ~180 MB). It bundles ffmpeg and ffprobe (copied from your own install by `npm run prepare:ffmpeg`), so the installed app needs nothing else. `dist/win-unpacked/Recme.exe` is the same app without installing.

- The installer is **not code-signed**, so Windows SmartScreen may warn ("More info" → "Run anyway").
- The bundled ffmpeg is a GPL build (x264). Fine for your own use; if you hand the installer to others, you must follow the GPL (include the licence and offer the ffmpeg source), or swap in an LGPL ffmpeg build.
- The installed app shares settings with the dev version (`%APPDATA%\Recme`).

## Sharp output

- Captures at the screen's **native resolution** (e.g. 2880×1800) – never downscaled, only cropped to even dimensions.
- H.264, BT.709 colour tags, cursor included.
- Presets: Standard (CRF 23, 30 fps), **High (CRF 18, 30 fps – default)**, Ultra (CRF 14, 60 fps).
- **Custom area**: choose *Custom area…* as the source, click *Select area on screen…* and drag a box (move it, resize it with the handles, Enter to confirm), or type X/Y/W/H or pick a size preset. A red frame is shown just outside the area while recording, and is not part of the video.
- **System sound** (what you hear) is recorded by default and merged into the MP4 when you stop. Microphone is optional.
- **Editor** (*Edit* button on a recording): player with a video lane and an audio lane (with waveform). The timeline shows the pieces one after another (*View: gaps closed*, like the exported video); the *View* button switches to the original positions. **Drag a blue piece sideways to rearrange the pieces** (a green marker shows where it lands; the *Move* buttons or Alt+arrows do the same). Click or drag anywhere on the timeline, or use the slider under the video, to move. *Save audio only* and *Detach audio from video* (sound file + muted copy) sit right under the timeline. Split at the playhead (S), drag piece edges or trim to playhead ([ and ]), remove pieces (Del), undo (Ctrl+Z). The preview skips removed parts. Export a new MP4 (precise re-encode, or fast keyframe cut), mute it, or **save the audio only** as M4A / MP3 / WAV / FLAC. The original is never changed.
- **Menu**: Record · Library (files, edit, send, delete) · Share · Claude (MCP connection, tools, activity).
- **Share on Wi-Fi** (Share tab, or *Send* on a recording; add any file from the computer with *Browse* or drag & drop, several at once): finds devices on the same network and sends files to them using the LocalSend v2 protocol. The receiver must accept each transfer; received files go to `Received` inside the recordings folder.
- Hardware encoder (NVENC / QSV / AMF) is detected and used automatically when available, otherwise libx264.
- Output is fragmented MP4, so a recording stays playable even if the app crashes.

## Connect Claude

The app listens on `http://127.0.0.1:7777/mcp` (localhost only) and requires a bearer token. The **Claude connection** panel in the app shows ready-to-copy settings with your token.

**Claude Code**

```bash
claude mcp add --transport http recme http://127.0.0.1:7777/mcp --header "Authorization: Bearer <TOKEN>"
```

**Claude Desktop** – copy the JSON from the app into `claude_desktop_config.json` (uses `mcp-remote` to bridge to the HTTP server).

Keep Recme running while Claude uses it.

## MCP tools

| Tool | What it does |
| --- | --- |
| `start_recording` | Start recording (quality, fps, source: desktop/display/window/region, `system_audio`, microphone `audio_device`, encoder, `max_seconds`) |
| `stop_recording` | Finish the file, returns path/duration/size |
| `get_status` | Current state, elapsed time, file size |
| `take_screenshot` | Capture now; returns an image and saves the full-res PNG |
| `list_displays` / `list_audio_devices` | Capture sources |
| `list_recordings` / `get_recording_info` | Browse files, codec/resolution/bitrate |
| `get_recording_frame` | View a frame of a recording at a given time |
| `trim_recording` | Cut/join pieces of a recording into a new MP4 (`segments`, `audio`, `mode`) |
| `extract_audio` | Save the audio (optionally only some pieces) as m4a/mp3/wav/flac |
| `list_nearby_devices` | Devices on the same network that can receive files |
| `send_recording` | Send a file to a nearby device (they must accept) |
| `delete_recording` | Delete a file |

Try: *"Record my screen for 10 seconds at ultra quality, then show me a frame from the middle."*

## Network sharing notes

- Recme listens on TCP 53317 (or the next free port if LocalSend is already running) and UDP 53317 multicast. Allow it in the Windows firewall for *Private* networks when asked.
- Discovery uses multicast; on Wi-Fi that blocks it (some guest/office networks) press **Find devices** to scan the local subnet.
- Receiving is encrypted (HTTPS, self-signed certificate; the device fingerprint is the certificate's SHA-256, as in LocalSend) and senders verify it. Turn it off in Share → Receiving only if an old device cannot connect.
- Optional **PIN** (rate limited) and **trusted devices** (accepted without asking). Trust is based on the device's announced fingerprint and address, so only trust your own devices.
- Compatibility with the LocalSend app follows its published v2 protocol. Recme talks to a real LocalSend's HTTPS info endpoint and verifies its certificate; a full file transfer to/from the real app is untested.
- **System tray**: closing the window keeps Recme running (Claude connection, sharing) in the tray; quit from the tray icon. Options (and start with Windows) are in Record → App.
- Only private-network addresses are accepted, filenames are sanitised, and nothing is written before you press Accept.

## Security

The server binds to 127.0.0.1 only, requires the token, and rejects requests with an `Origin` header or foreign `Host`, so web pages cannot control it. The token lives in `%APPDATA%\Recme\config.json`.

## Test

`npm run test:edit` (no app needed: cutting, audio extraction and file transfer between two nodes).

With the app running: `npm run test:mcp` (tools) and `npm run test:audio` (records an area while a sound plays and checks the audio is in the file)
