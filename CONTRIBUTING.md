# Contributing to Recme

Thanks for helping. Bug reports, test reports (especially from other machines) and pull requests are all welcome.

## Easiest ways to help

- **Test it** and file a *Test report* issue. On the Record tab, press **Copy diagnostics** and paste the result. See [docs/TESTING.md](docs/TESTING.md).
- **Try it on a Mac.** macOS support is written but has never run on real hardware: [docs/MACOS.md](docs/MACOS.md).
- **Report bugs or ideas** with the issue forms. Security problems go through [SECURITY.md](SECURITY.md), not a public issue.

## Set up

Requirements: Node.js 20+, Windows 10/11 for the full app (the editor, sharing and CLI tests run anywhere), and ffmpeg
(`winget install Gyan.FFmpeg` on Windows, `brew install ffmpeg` on macOS).

```bash
git clone https://github.com/bizcuit47/recme-mcp
cd recme-mcp
npm install
npm start            # run the app
```

To try changes without touching your real settings, start a second copy with its own profile and port:
`npx electron . --user-data-dir=C:\temp\recme-dev` and set `"port": 7790` in that folder's `config.json`.

## Tests

```bash
npm run test:edit    # no app needed: editing, export, file transfer, HTTPS, PIN, trust
npm run test:cli     # no app needed: the recme command
npm run test:mcp     # needs the app running
npm run test:audio   # needs the app running
```

CI runs `test:edit` and `test:cli` on Windows and macOS for every push and pull request. Please run them before
opening a PR, and add a check when you fix a bug or add a feature. For anything that touches capture, also record
a few seconds on a real machine and say what you tried.

## Where things live

| Path | What |
| --- | --- |
| `src/main.js` | The only file tied to Electron windows/tray: wiring, IPC, settings |
| `src/recorder.js`, `src/editor.js`, `src/lan-share.js`, `src/mcp-server.js` | Plain Node, no Electron, so they are testable headless |
| `src/platform/` | Everything OS-specific (capture, devices, windows, ffmpeg lookup). Add OS behaviour **here**, not in the callers |
| `src/cli.js` | The `recme` command |
| `src/renderer/`, `src/editor/`, `src/overlay/` | The UI |
| `docs/HOW-IT-WORKS.md` | Longer explanation (Thai) |

## Guidelines

- **Keep Windows working.** It is the supported platform. Changes to `src/platform/win32*.js` need a real Windows check.
- **Mark what you could not verify.** Code for a platform you cannot run goes in with an "UNTESTED" note, as in `darwin.js`.
- **New MCP tool?** Add it in `src/mcp-server.js` with a clear description, ask for confirmation if it captures, sends or
  deletes, add a CLI command if it makes sense, and update the tool count and list in the README.
- **Security-sensitive changes** (the token, the Host/Origin checks, file receiving) need extra care and a note in the PR on
  what you checked.
- Match the surrounding style: plain CommonJS, small functions, comments only where the reason is not obvious.
  There is no formatter or linter to run.
- Keep PRs focused. One change per PR is easier to review than a bundle.

## Commits and pull requests

- Commit messages follow Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `ci:`, `chore:`.
- Describe what changed and why, and what you tested (and on which OS).
- Do not commit recordings, `vendor/`, `dist/`, tokens or anything from your profile folder.

## License

By contributing you agree that your work is released under the project's [MIT license](LICENSE). The bundled ffmpeg is
a separate GPL build, see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
