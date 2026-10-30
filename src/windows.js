'use strict';

// Lists the visible top-level windows with their position on screen (physical pixels),
// so a recording can be pointed at e.g. the Unity window without guessing coordinates.
const { spawnSync } = require('child_process');

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public class RecmeWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);
  public static List<string[]> All() {
    var list = new List<string[]>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h) || IsIconic(h)) return true;
      int cloaked; DwmGetWindowAttribute(h, 14, out cloaked, 4);
      if (cloaked != 0) return true;
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
      if (sb.Length == 0) return true;
      RECT r;
      if (DwmGetWindowAttribute(h, 9, out r, 16) != 0) GetWindowRect(h, out r);
      uint pid; GetWindowThreadProcessId(h, out pid);
      list.Add(new string[] { sb.ToString(), r.Left.ToString(), r.Top.ToString(), (r.Right - r.Left).ToString(), (r.Bottom - r.Top).ToString(), pid.ToString() });
      return true;
    }, IntPtr.Zero);
    return list;
  }
}
"@
[RecmeWin]::SetProcessDPIAware() | Out-Null
$out = foreach ($w in [RecmeWin]::All()) {
  $p = try { (Get-Process -Id ([int]$w[5]) -ErrorAction Stop).ProcessName } catch { '' }
  [pscustomobject]@{ title = $w[0]; x = [int]$w[1]; y = [int]$w[2]; width = [int]$w[3]; height = [int]$w[4]; pid = [int]$w[5]; process = $p }
}
if (-not $out) { '[]' } else { ConvertTo-Json -InputObject @($out) -Compress }
`;

/** Visible windows, front-most first: [{ title, process, pid, x, y, width, height }] */
function listWindows() {
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    encoding: 'utf8', windowsHide: true, timeout: 20000,
  });
  if (r.status !== 0) throw new Error(`Could not list windows: ${(r.stderr || '').trim().split(/\r?\n/)[0] || 'PowerShell failed'}`);
  const list = JSON.parse(r.stdout.trim() || '[]');
  return list.filter((w) => w.width >= 40 && w.height >= 40);
}

/** First window whose title contains `title` (case-insensitive). */
function findWindow(title) {
  const q = String(title || '').toLowerCase();
  return listWindows().find((w) => w.title.toLowerCase().includes(q)) || null;
}

module.exports = { listWindows, findWindow };
