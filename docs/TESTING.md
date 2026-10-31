# Testing Recme

Thank you for helping to test! This page tells you what to try and how to report it.
**ภาษาไทยอยู่ท้ายหน้า** (Thai summary at the bottom).

Recme is a **beta**. It was developed and tested on one Windows 11 PC, so reports from *other* computers are the most valuable thing you can give.

## Before you start

- Windows 10 or 11, 64-bit. (There is no macOS or Linux version.)
- Download **`Recme-Setup-<version>.exe`** from the [newest release](https://github.com/bizcuit47/recme-mcp/releases) (top of the list, under *Assets*) and run it.
- Windows **SmartScreen** may say it does not know the publisher (the installer is not code-signed yet). Choose **More info → Run anyway**.
- Windows **Firewall** may ask about network access. Allow **Private networks** (needed only for sending files over Wi-Fi).
- You do not need to install ffmpeg or Node.js to use the app itself.

## 5-minute smoke test

1. Start Recme. Open the **Record** tab and press **Start recording**, play a video or music for ~10 seconds, press **Stop**.
2. Go to **Library**, press **Play** on the new file. Is the picture sharp and is the sound there?
3. Press **Edit**. Click on the timeline (the playhead should move), press **S** to split, drag a blue piece to another place, press **Export video**.
4. Press **Save audio only**. Do you get a sound file?
5. Close the window. Recme should keep running in the system tray (the red ring icon). Press `Ctrl+Shift+R` to start a recording, press it again to stop.

If all five worked, please still send a short report (see "How to report").

## Things I could not test myself (please try these!)

| What | How |
|---|---|
| **Clean install** | Install on a PC that has never had Recme/ffmpeg/Node. Does it start? Does uninstalling remove it? |
| **Two devices** | Install Recme on two PCs on the same Wi-Fi, or use [LocalSend](https://localsend.org/) on a phone. In **Share** press **Find devices**, send a file **both ways**. Try with and without a PIN. |
| **Real LocalSend app** | Send a file from Recme to the LocalSend app and from LocalSend to Recme. |
| **Several monitors** | Record each display and "All screens". Try Custom area on the second screen. |
| **Display scaling** | Try 100 %, 125 %, 150 % (Settings → System → Display). Is the recorded area exactly what you selected? |
| **Different graphics cards** | NVIDIA, Intel, AMD, or none. The report's *Hardware encoders* line shows what Recme found. Is the video smooth? |
| **Sound** | Record with speakers, with headphones, with Bluetooth audio. Is the sound there and in sync with the picture? Also try the *Microphone* option. |
| **Long recording** | Record 30 minutes or more. Is the file complete and playable? What happens when the disk is nearly full? |
| **Hotkey** | Does `Ctrl+Shift+R` clash with another program? Try changing it in **Record → App**. |
| **Windows start-up** | Tick *Start Recme when Windows starts* (and *start hidden*), restart the PC. |
| **Claude Code** | Copy the command from the **Claude** tab into a terminal, then ask Claude: *"Record my screen for 10 seconds and show me an overview of the clip."* |
| **Claude Desktop** | Needs Node.js installed (it uses `npx mcp-remote`). Paste the JSON from the **Claude** tab into `claude_desktop_config.json`. |
| **Games / other apps** | Record a game or a video player. Is the picture black or frozen anywhere? |

## How to report

Open an issue: <https://github.com/bizcuit47/recme-mcp/issues/new/choose>

- **Something broke** → *Bug report*
- **Everything was fine / mixed results** → *Test report* (tick what you tried)
- Use **Record → App → Copy diagnostics** and paste the result. It contains versions, GPU, screens, settings and the last log lines. It does **not** contain your token, PIN, file names, folder paths (your user name is masked) or device names.
- A screenshot or short screen recording helps a lot.
- The log file itself: **Record → App → Show log file** (`recme.log`). Please look through it before attaching, it is plain text.

## What Recme does on your PC (so you know)

- Everything stays on your computer. Nothing is uploaded.
- It listens on `127.0.0.1:7777` (this PC only) for Claude, protected by a token, and on a local-network port (53317 and up) to receive files, only if you leave *Allow receiving* on. Every incoming file asks for your confirmation unless you trusted that device.
- Recordings are saved in `Videos\Recme` (or the folder you choose). Settings are in `%APPDATA%\Recme`.
- To remove everything: uninstall Recme, then delete `%APPDATA%\Recme`.

## Known limits (no need to report)

Windows only · about 28–29 fps when recording a 2880×1800 screen · system sound is merged into the video when you stop · the editor is basic (no text, transitions or multi-track) · the installer is unsigned.

---

## สรุปภาษาไทย

Recme ยังเป็นรุ่นทดลอง (beta) ผมทดสอบบนเครื่องเดียว การทดสอบบน**เครื่องอื่น**จึงมีค่ามากที่สุด

1. โหลด `Recme-Setup-<เวอร์ชัน>.exe` จาก [หน้า Releases](https://github.com/bizcuit47/recme-mcp/releases) (รุ่นบนสุด ในหัวข้อ Assets) แล้วรัน (Windows 10/11 แบบ 64-bit เท่านั้น)
2. ถ้า Windows เตือน SmartScreen ให้กด **More info → Run anyway** ถ้า Firewall ถามให้อนุญาตเฉพาะเครือข่าย **Private**
3. ลองตามหัวข้อ "5-minute smoke test": อัด 10 วินาที, เปิดดู, ตัดต่อ, แยกเสียง, ปิดหน้าต่างแล้วกด `Ctrl+Shift+R`
4. ถ้าสะดวก ลองหัวข้อ "Things I could not test myself" โดยเฉพาะ: ส่งไฟล์ระหว่างสองเครื่อง (หรือกับ LocalSend บนมือถือ), หลายจอ, สเกลจอต่างกัน, การ์ดจอต่างยี่ห้อ, อัดนาน 30 นาที
5. รายงานที่ https://github.com/bizcuit47/recme-mcp/issues/new/choose : เจอปัญหา → *Bug report*, ใช้ได้ดี/ปนกัน → *Test report* และกด **Record → App → Copy diagnostics** แล้ววางข้อมูลลงไปด้วย (ไม่มี token, PIN, ชื่อไฟล์ หรือชื่ออุปกรณ์ ชื่อผู้ใช้ Windows ถูกปิดไว้)

ข้อมูลทุกอย่างอยู่ในเครื่องคุณ ไม่มีอะไรถูกอัปโหลดไปไหน ถอนการติดตั้งได้ตามปกติ และลบโฟลเดอร์ `%APPDATA%\Recme` เพื่อล้างการตั้งค่า
