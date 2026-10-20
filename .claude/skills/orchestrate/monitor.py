"""Watch child-session tmux windows and PRs; exit with a report on the first notable event.

Events: a window vanished; a window's pane unchanged for IDLE_CHECKS checks (idle,
waiting for input or done); a PR merged since START; checks of WATCH_PR finished;
resources free (WAIT_FREE=<load5 threshold>). Every check prints load and memory.

Usage: python3 -I monitor.py START_ISO win1 win2 ...
Env:   WATCH_PR=<number>  WAIT_FREE=<load5>  INTERVAL=<seconds, default 60>
"""
import hashlib
import json
import os
import subprocess
import sys
import time

INTERVAL = int(os.environ.get("INTERVAL", "60"))
IDLE_CHECKS = 4
FREE_MEM_MB = 2500
start = sys.argv[1]
windows = sys.argv[2:]
WATCH_PR = os.environ.get("WATCH_PR")
WAIT_FREE = os.environ.get("WAIT_FREE")


def sh(args):
    return subprocess.run(args, capture_output=True, text=True).stdout


def pane(win):
    out = subprocess.run(["tmux-host-env", "tmux", "capture-pane", "-p", "-t", win], capture_output=True, text=True)
    if out.returncode != 0:
        return None
    return "\n".join(line for line in out.stdout.splitlines() if line.strip())


def merged():
    out = sh(["gh", "pr", "list", "--state", "merged", "--search", f"merged:>={start}", "--json", "number,title", "--limit", "50"])
    try:
        return {p["number"]: p["title"] for p in json.loads(out or "[]")}
    except ValueError:
        return {}


seen_merged = merged()
hashes = {w: [] for w in windows}
while True:
    events = []
    for w in windows:
        text = pane(w)
        if text is None:
            events.append(f"window gone: {w}")
            continue
        h = hashlib.sha1(text.encode()).hexdigest()
        hashes[w] = (hashes[w] + [h])[-IDLE_CHECKS:]
        if len(hashes[w]) == IDLE_CHECKS and len(set(hashes[w])) == 1:
            tail = "\n".join(text.splitlines()[-25:])
            events.append(f"idle: {w}\n{tail}")
    for n, t in merged().items():
        if n not in seen_merged:
            events.append(f"merged: #{n} {t}")
    if WATCH_PR:
        out = sh(["gh", "pr", "checks", WATCH_PR, "--json", "state", "--jq", '[.[].state] | unique | join(",")']).strip()
        if out and not any(s in out for s in ("PENDING", "IN_PROGRESS", "QUEUED")):
            events.append(f"checks of #{WATCH_PR} finished: {out}")
    load = open("/proc/loadavg").read().split()[:3]
    mem_mb = int([l for l in open("/proc/meminfo") if l.startswith("MemAvailable")][0].split()[1]) // 1024
    print(time.strftime("%H:%M:%S"), "load", " ".join(load), "memAvailMB", mem_mb, flush=True)
    if WAIT_FREE and float(load[1]) < float(WAIT_FREE) and mem_mb > FREE_MEM_MB:
        events.append(f"resources free: load5 {load[1]}, memAvailMB {mem_mb}")
    if events:
        print("\n\n".join(events), flush=True)
        sys.exit(0)
    time.sleep(INTERVAL)
