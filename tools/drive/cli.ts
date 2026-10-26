import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";
import type { NodeSnapshot } from "@tuidom/inspector/protocol";

import { findTextCell } from "../../e2e/helpers/frame.ts";
import { $ } from "../../e2e/helpers/query.ts";
import { renderSnapshotToPng } from "../../e2e/helpers/renderScreenshot.ts";
import { waitUntil } from "../../e2e/helpers/waitFor.ts";

import {
    flag,
    flagAll,
    intFlag,
    parseArgs,
    type ParsedArgs,
    parseFileSpec,
    parseNonNegativeInt,
    parseSize,
    UsageError,
} from "./args.ts";
import { DriveClient } from "./driveClient.ts";
import { cellInfo, focusText, formatCell, screenText, selectedTreesText, treeText } from "./format.ts";
import { charToKey, validateKey } from "./keys.ts";
import { DEFAULT_BINARY, gcSessions, repoRoot, startSession, stopSession } from "./launch.ts";
import { isAlive } from "./processes.ts";
import { type SessionRecord, SessionRegistry, validateSessionName } from "./sessionRegistry.ts";

const HELP = `npm run drive -- <command> [args] [-s <session>] [--json]

A session lives across calls (registry: .drive/sessions/ of this checkout).
Default name: default. Exit code: 0 ok, 1 error/timeout, 2 usage, 3 no session.

Session lifecycle
  start [--binary [--binary-path P]] [--size 140x38] [--open P]... [--file rel=text]...
        [--seed DIR] [--settings JSON|@file] [--keybindings JSON|@file] [--install id|vsix]...
        [--arg <diode flag>]... [--keep] [--no-wait-ready] [--no-build] [--timeout MS]
                         launch (from sources by default) in an isolated root
  stop [--all] [--keep]  graceful quit, kill the group and orphans, remove the root
  list                   sessions of this checkout
  gc [--kept]            remove dead sessions, orphans and abandoned roots (--kept: kept ones too)
  dump                   post-mortem: record, frame, focus, tail of stderr and diode.log

Input (each waits for the render to go idle)
  key <K>...             DSL keys: Enter, Ctrl+P, ArrowDown, Alt+F, F1, a (NOT "Down")
  type <text>            types char by char like a user (popups see every char)
  paste <text>           bracketed paste as one block (the suggest popup does NOT open)
  click <x> <y> | --node SEL | --text "…"  [--right] [--double] [--ctrl|--shift|--alt]
  hover <x> <y> | --node SEL | --text "…"   pointer move with no button held (hover)
  wheel up|down|left|right [<x> <y> | --node SEL] [--count N]
  resize <cols>x<rows>

Reading
  screen [--numbered]    frame text (--numbered: with line numbers and a column ruler)
  screenshot <file.png>  frame PNG
  cell <x> <y>           char, code point, fg/bg (#rrggbb|default), style
  cursor                 terminal cursor position and shape (block|underline|bar, if the app set one)
  tree [SEL] [--depth N] [--state]   node tree (or subtrees of SEL matches)
  node <SEL>             first node matching the selector (Type, #id, @role, "A B": descendant)
  focus                  focus path
  output [<channel>] [--list] [--tail N]   OUTPUT panel (channel: id or label)
  logs [--tail N]        process stderr and diode.log (from sources only)
  context <key>          context key value
  when <expr>            when expression over the current keys
  commands [filter]      commands with a title

Actions
  exec <id> [json-arg]... [--no-await] [--timeout MS]   run a command by id
  palette "<title>"      open the command palette, type the title, Enter

Waits (--timeout MS, default 10000; on timeout: frame and focus)
  wait text "…" | node SEL | gone SEL | focus TYPE | idle | ready | reload
                         reload: the new window after workbench.action.reloadWindow is up and ready
`;

const EXIT_ERROR = 1;
const EXIT_USAGE = 2;
const EXIT_NO_SESSION = 3;

class NoSessionError extends Error {}

const registry = new SessionRegistry(join(repoRoot, ".drive", "sessions"));

function out(text: string): void {
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
}

function emit(args: ParsedArgs, json: unknown, text: string): void {
    out(args.booleans.has("json") ? JSON.stringify(json, null, 2) : text);
}

function sessionName(args: ParsedArgs): string {
    return validateSessionName(flag(args, "session") ?? "default");
}

function requireRecord(args: ParsedArgs): SessionRecord {
    const name = sessionName(args);
    const record = registry.read(name);
    if (record === undefined)
        throw new NoSessionError(
            `no session ${name}: npm run drive -- start${name === "default" ? "" : ` -s ${name}`}`,
        );
    return record;
}

async function connect(record: SessionRecord): Promise<DriveClient> {
    try {
        return await DriveClient.connect(record.port, 5000);
    } catch (error) {
        if (!isAlive(record.pid)) {
            throw new NoSessionError(
                `session ${record.name} is dead (pid ${String(record.pid)}): npm run drive -- dump -s ${record.name}; clean up: gc`,
            );
        }
        throw error;
    }
}

async function withClient<T>(
    args: ParsedArgs,
    body: (client: DriveClient, record: SessionRecord) => Promise<T>,
): Promise<T> {
    const record = requireRecord(args);
    const client = await connect(record);
    try {
        return await body(client, record);
    } finally {
        client.close();
    }
}

function timeoutOf(args: ParsedArgs, fallback = 10_000): number {
    return intFlag(args, "timeout") ?? fallback;
}

function readJsonArg(raw: string): unknown {
    const text = raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        throw new UsageError(`expected JSON or @file: ${raw.slice(0, 80)}`);
    }
}

function need(args: ParsedArgs, count: number, usage: string): string[] {
    if (args.positionals.length < count) throw new UsageError(`usage: drive ${usage}`);
    return args.positionals;
}

async function settle(client: DriveClient): Promise<void> {
    await client.waitForIdle({});
}

async function postmortem(client: DriveClient): Promise<string> {
    const parts: string[] = [];
    try {
        parts.push("── frame ──", screenText(await client.captureFrame(), true));
    } catch (error) {
        parts.push(`── frame ── <not captured: ${errorMessage(error)}>`);
    }
    try {
        parts.push(`── focus ── ${focusText(await client.document())}`);
    } catch (error) {
        parts.push(`── focus ── <not captured: ${errorMessage(error)}>`);
    }
    return parts.join("\n");
}

function tailOf(file: string, lines: number): string {
    if (!existsSync(file)) return "<no file>";
    const text = readFileSync(file, "utf8").trimEnd();
    if (text.length === 0) return "<empty>";
    return text.split("\n").slice(-lines).join("\n");
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function cmdStart(args: ParsedArgs): Promise<void> {
    const name = sessionName(args);
    const size = parseSize(flag(args, "size") ?? "140x38");
    const binary =
        args.booleans.has("binary") || flag(args, "binary-path") !== undefined
            ? resolve(flag(args, "binary-path") ?? DEFAULT_BINARY)
            : undefined;
    if (binary !== undefined && args.booleans.has("from-source"))
        throw new UsageError("--binary and --from-source are mutually exclusive");
    const files = Object.fromEntries(flagAll(args, "file").map(parseFileSpec));
    const settingsRaw = flag(args, "settings");
    const keybindingsRaw = flag(args, "keybindings");
    const open = flagAll(args, "open");
    const seed = flag(args, "seed");
    const result = await startSession(registry, {
        name,
        ...(binary !== undefined ? { binary } : {}),
        cols: size.cols,
        rows: size.rows,
        ...(open.length > 0 ? { open } : {}),
        ...(Object.keys(files).length > 0 ? { files } : {}),
        ...(seed !== undefined ? { seed: resolve(seed) } : {}),
        ...(settingsRaw !== undefined ? { settings: readJsonArg(settingsRaw) as Record<string, unknown> } : {}),
        ...(keybindingsRaw !== undefined
            ? { keybindings: readJsonArg(keybindingsRaw) as { key: string; command: string }[] }
            : {}),
        install: flagAll(args, "install"),
        extraArgs: flagAll(args, "arg"),
        keep: args.booleans.has("keep"),
        waitReady: !args.booleans.has("no-wait-ready"),
        readyTimeoutMs: timeoutOf(args, 120_000),
        noBuild: args.booleans.has("no-build"),
    });
    const { record } = result;
    const readyText =
        result.ready === "skipped" ? "readiness not awaited" : result.ready ? "ready" : "NOT ready within the timeout";
    emit(
        args,
        { ...record, ready: result.ready, startMs: result.startMs },
        [
            `session ${record.name}: ${readyText} in ${String(result.startMs)} ms (${record.mode}, pid ${String(record.pid)}, port ${String(record.port)}, ${String(record.cols)}x${String(record.rows)})`,
            `workspace: ${record.workspaceDir}`,
            `root:      ${record.root}`,
        ].join("\n"),
    );
    if (result.ready === false) process.exitCode = EXIT_ERROR;
}

async function cmdStop(args: ParsedArgs): Promise<void> {
    const records = args.booleans.has("all") ? registry.list() : [requireRecord(args)];
    const results = [];
    for (const record of records)
        results.push(await stopSession(registry, record, { keep: args.booleans.has("keep") }));
    emit(
        args,
        results,
        results.length === 0
            ? "no sessions"
            : results
                  .map(
                      (r) =>
                          `${r.name}: stopped ${r.graceful ? "gracefully" : "by signal"}` +
                          (r.killed > 0 ? `, processes killed: ${String(r.killed)}` : "") +
                          (r.rootKept !== undefined ? `; root kept: ${r.rootKept}` : ""),
                  )
                  .join("\n"),
    );
}

function cmdList(args: ParsedArgs): void {
    const rows = registry.list().map((r) => ({ ...r, alive: isAlive(r.pid) }));
    emit(
        args,
        rows,
        rows.length === 0
            ? "no sessions"
            : rows
                  .map(
                      (r) =>
                          `${r.name}\t${r.alive ? "alive" : "DEAD"}\tpid ${String(r.pid)}\tport ${String(r.port)}\t${r.mode}\t${r.startedAt}\t${r.root}`,
                  )
                  .join("\n"),
    );
}

async function cmdGc(args: ParsedArgs): Promise<void> {
    const result = await gcSessions(registry, { kept: args.booleans.has("kept") });
    emit(
        args,
        result,
        [
            `dead sessions removed: ${String(result.deadSessions.length)}${result.deadSessions.length > 0 ? ` (${result.deadSessions.join(", ")})` : ""}`,
            `orphans killed: ${String(result.orphansKilled)}`,
            `abandoned roots removed: ${String(result.rootsRemoved.length)}`,
        ].join("\n"),
    );
}

async function cmdDump(args: ParsedArgs): Promise<void> {
    const record = requireRecord(args);
    const alive = isAlive(record.pid);
    const parts = [`── session ${record.name} ── ${alive ? "alive" : "DEAD"}`, JSON.stringify(record, null, 2)];
    if (alive) {
        try {
            const client = await DriveClient.connect(record.port, 3000);
            try {
                parts.push(await postmortem(client));
            } finally {
                client.close();
            }
        } catch (error) {
            parts.push(`── inspector does not respond: ${errorMessage(error)}`);
        }
    }
    parts.push("── stderr (tail) ──", tailOf(record.stderrFile, 40));
    parts.push("── diode.log (tail) ──", tailOf(join(record.workspaceDir, "diode.log"), 40));
    out(parts.join("\n"));
}

async function cmdKey(args: ParsedArgs): Promise<void> {
    const keys = need(args, 1, "key <key>...").map(validateKey);
    await withClient(args, async (client) => {
        for (const key of keys) {
            await client.sendKey(key);
            await settle(client);
        }
    });
}

async function cmdType(args: ParsedArgs): Promise<void> {
    const text = need(args, 1, "type <text>").join(" ");
    await withClient(args, async (client) => {
        for (const ch of text) await client.sendKey(charToKey(ch));
        await settle(client);
    });
}

async function cmdPaste(args: ParsedArgs): Promise<void> {
    const text = need(args, 1, "paste <text>").join(" ").replace(/\\n/g, "\n");
    await withClient(args, async (client) => {
        await client.sendText(text);
        await settle(client);
    });
}

async function resolvePoint(
    client: DriveClient,
    args: ParsedArgs,
    positionalOffset: number,
): Promise<{ x: number; y: number }> {
    const selector = flag(args, "node");
    const text = flag(args, "text");
    if (selector !== undefined) {
        const node = await client.node(selector);
        if (node === null) throw new Error(`no node matches selector ${selector}`);
        return { x: node.box.x + Math.floor(node.box.width / 2), y: node.box.y + Math.floor(node.box.height / 2) };
    }
    if (text !== undefined) {
        const cell = findTextCell(await client.captureFrame(), text);
        if (cell === null) throw new Error(`text ${JSON.stringify(text)} is not on screen`);
        return { x: cell.x + Math.floor(Array.from(text).length / 2), y: cell.y };
    }
    const rx = args.positionals.at(positionalOffset);
    const ry = args.positionals.at(positionalOffset + 1);
    if (rx === undefined || ry === undefined)
        throw new UsageError("coordinates <x> <y>, --node SEL or --text required");
    return { x: parseNonNegativeInt(rx, "x"), y: parseNonNegativeInt(ry, "y") };
}

async function cmdClick(args: ParsedArgs): Promise<void> {
    await withClient(args, async (client) => {
        const { x, y } = await resolvePoint(client, args, 0);
        const button = args.booleans.has("right") ? "right" : "left";
        const mods = {
            ...(args.booleans.has("ctrl") ? { ctrlKey: true } : {}),
            ...(args.booleans.has("shift") ? { shiftKey: true } : {}),
            ...(args.booleans.has("alt") ? { altKey: true } : {}),
        };
        const times = args.booleans.has("double") ? 2 : 1;
        for (let i = 0; i < times; i++) {
            await client.sendMouse({ action: "press", button, x, y, ...mods });
            await client.sendMouse({ action: "release", button, x, y, ...mods });
        }
        await settle(client);
        emit(args, { x, y }, `click ${String(x)},${String(y)}`);
    });
}

async function cmdHover(args: ParsedArgs): Promise<void> {
    await withClient(args, async (client) => {
        const { x, y } = await resolvePoint(client, args, 0);
        await client.sendMouse({ action: "move", button: "none", x, y });
        await settle(client);
        emit(args, { x, y }, `hover ${String(x)},${String(y)}`);
    });
}

async function cmdWheel(args: ParsedArgs): Promise<void> {
    const [direction] = need(args, 1, "wheel up|down|left|right [<x> <y>|--node SEL]");
    if (!["up", "down", "left", "right"].includes(direction))
        throw new UsageError(`direction: up|down|left|right, not ${direction}`);
    const count = intFlag(args, "count") ?? 1;
    await withClient(args, async (client) => {
        const hasPoint =
            args.positionals.length >= 3 || flag(args, "node") !== undefined || flag(args, "text") !== undefined;
        const frame = hasPoint ? undefined : await client.captureFrame();
        const point =
            frame !== undefined
                ? { x: Math.floor(frame.cols / 2), y: Math.floor(frame.rows / 2) }
                : await resolvePoint(client, args, 1);
        for (let i = 0; i < count; i++) {
            await client.sendMouse({ action: `scroll-${direction}` as "scroll-up", x: point.x, y: point.y });
        }
        await settle(client);
    });
}

async function cmdResize(args: ParsedArgs): Promise<void> {
    const { cols, rows } = parseSize(need(args, 1, "resize <cols>x<rows>")[0]);
    await withClient(args, async (client) => {
        await client.resize(cols, rows);
        await settle(client);
    });
}

async function cmdScreen(args: ParsedArgs): Promise<void> {
    await withClient(args, async (client) => {
        const frame = await client.captureFrame();
        emit(
            args,
            { cols: frame.cols, rows: frame.rows, cursor: frame.cursor, text: screenText(frame, false) },
            screenText(frame, args.booleans.has("numbered")),
        );
    });
}

async function cmdScreenshot(args: ParsedArgs): Promise<void> {
    const file = resolve(need(args, 1, "screenshot <file.png>")[0]);
    await withClient(args, async (client) => {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(file, renderSnapshotToPng(await client.captureFrame()));
        emit(args, { file }, file);
    });
}

async function cmdCell(args: ParsedArgs): Promise<void> {
    const [rx, ry] = need(args, 2, "cell <x> <y>");
    await withClient(args, async (client) => {
        const info = cellInfo(await client.captureFrame(), parseNonNegativeInt(rx, "x"), parseNonNegativeInt(ry, "y"));
        emit(args, info, formatCell(info));
    });
}

async function cmdCursor(args: ParsedArgs): Promise<void> {
    await withClient(args, async (client) => {
        const { cursor, cursorStyle } = await client.captureFrame();
        // The shape only when the app set one (DECSCUSR): without it the terminal keeps its own.
        const shape =
            cursorStyle === null ? "" : ` ${cursorStyle.shape} ${cursorStyle.blinking ? "blinking" : "steady"}`;
        emit(
            args,
            cursor === null ? null : { ...cursor, style: cursorStyle },
            cursor === null ? "cursor hidden" : `${String(cursor.x)},${String(cursor.y)}${shape}`,
        );
    });
}

function stripChildren(node: NodeSnapshot): Omit<NodeSnapshot, "children"> & { childCount: number } {
    const { children, ...rest } = node;
    return { ...rest, childCount: children.length };
}

async function cmdTree(args: ParsedArgs): Promise<void> {
    const selector = args.positionals.at(0);
    const depth = intFlag(args, "depth");
    const options = { ...(depth !== undefined ? { depth } : {}), state: args.booleans.has("state") };
    await withClient(args, async (client) => {
        const root = await client.document();
        if (args.booleans.has("json")) {
            out(JSON.stringify(selector === undefined ? root : $(root, selector), null, 2));
            return;
        }
        out(selector === undefined ? treeText(root, options) : selectedTreesText(root, selector, options));
    });
}

async function cmdNode(args: ParsedArgs): Promise<void> {
    const [selector] = need(args, 1, "node <selector>");
    await withClient(args, async (client) => {
        const node = await client.node(selector);
        if (node === null) {
            emit(args, null, `<no node matches selector ${selector}>`);
            process.exitCode = EXIT_ERROR;
            return;
        }
        out(JSON.stringify(stripChildren(node), null, 2));
    });
}

async function cmdFocus(args: ParsedArgs): Promise<void> {
    await withClient(args, async (client) => {
        const root = await client.document();
        emit(args, { path: focusText(root) }, focusText(root));
    });
}

async function cmdOutput(args: ParsedArgs): Promise<void> {
    await withClient(args, async (client) => {
        const channel = args.positionals.at(0) ?? flag(args, "channel");
        if (args.booleans.has("list") || channel === undefined) {
            const { channels } = await client.listOutputChannels();
            emit(args, channels, channels.map((c) => `${c.id}\t${c.label}`).join("\n"));
            return;
        }
        const result = await client.getOutput(channel);
        const tail = intFlag(args, "tail");
        const text = tail === undefined ? result.text : result.text.trimEnd().split("\n").slice(-tail).join("\n");
        emit(args, { ...result, text }, text.length === 0 ? `<channel ${result.label} is empty>` : text);
    });
}

function cmdLogs(args: ParsedArgs): void {
    const record = requireRecord(args);
    const tail = intFlag(args, "tail") ?? 100;
    const diodeLog = join(record.workspaceDir, "diode.log");
    out(
        [
            `── stderr ── ${record.stderrFile}`,
            tailOf(record.stderrFile, tail),
            `── diode.log ── ${record.mode === "binary" ? "(the binary has no log file; see output)" : diodeLog}`,
            record.mode === "binary" ? "" : tailOf(diodeLog, tail),
        ].join("\n"),
    );
}

async function cmdContext(args: ParsedArgs): Promise<void> {
    const [key] = need(args, 1, "context <key>");
    await withClient(args, async (client) => {
        const { value } = await client.getContextKey(key);
        emit(args, { key, value }, JSON.stringify(value));
    });
}

async function cmdWhen(args: ParsedArgs): Promise<void> {
    const expr = need(args, 1, "when <expr>").join(" ");
    await withClient(args, async (client) => {
        const { value } = await client.evaluateWhen(expr);
        emit(args, { expr, value }, String(value));
    });
}

async function cmdCommands(args: ParsedArgs): Promise<void> {
    const filter = args.positionals.join(" ").toLowerCase();
    await withClient(args, async (client) => {
        const { commands } = await client.listCommands();
        const list = commands
            .filter(
                (c) => filter === "" || c.id.toLowerCase().includes(filter) || c.title.toLowerCase().includes(filter),
            )
            .sort((a, b) => a.id.localeCompare(b.id));
        emit(
            args,
            list,
            list.map((c) => `${c.id}\t${c.category !== undefined ? `${c.category}: ` : ""}${c.title}`).join("\n"),
        );
    });
}

async function cmdExec(args: ParsedArgs): Promise<void> {
    const [id, ...rawArgs] = need(args, 1, "exec <id> [json-arg]...");
    const commandArgs = rawArgs.map((raw) => {
        try {
            return JSON.parse(raw) as unknown;
        } catch {
            return raw;
        }
    });
    await withClient(args, async (client) => {
        const timeoutMs = args.booleans.has("no-await") ? 0 : intFlag(args, "timeout");
        let result: Awaited<ReturnType<DriveClient["executeCommand"]>>;
        try {
            result = await client.executeCommand(id, commandArgs, timeoutMs);
            await settle(client);
        } catch (error) {
            // reloadWindow/quit: the window goes away without replying; that is the command's outcome, not a failure.
            if (!client.closed) throw error;
            emit(args, { windowClosed: true }, "window closed (quit or reload); next: wait reload");
            return;
        }
        emit(
            args,
            result,
            result.settled
                ? `ok${result.result !== null ? ` ${JSON.stringify(result.result)}` : ""}`
                : "started (did not finish within the timeout; waiting for input?)",
        );
    });
}

async function cmdPalette(args: ParsedArgs): Promise<void> {
    const title = need(args, 1, 'palette "<title>"').join(" ");
    await withClient(args, async (client) => {
        await client.executeCommand("workbench.action.showCommands", [], 0);
        await waitUntil(
            () => client.node("#quickInput"),
            (n) => n !== null,
            { timeoutMs: timeoutOf(args), describe: "#quickInput" },
        );
        await client.sendText(title);
        await settle(client);
        const quickInput = await client.node("#quickInput");
        const frame = await client.captureFrame();
        if (
            quickInput === null ||
            !regionText(frame, quickInput.box).some(
                (line, i) => i > 0 && line.toLowerCase().includes(title.toLowerCase()),
            )
        ) {
            await client.sendKey("Escape");
            throw new Error(`no command palette item ${JSON.stringify(title)}\n${await postmortem(client)}`);
        }
        await client.sendKey("Enter");
        await settle(client);
        emit(args, { title }, `palette: ${title}`);
    });
}

/** The old window may still answer on the same port, so wait for a DIFFERENT pid. */
async function waitReload(record: SessionRecord, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const fresh = await probeWindow(record.port);
        if (fresh !== undefined && fresh.pid !== record.windowPid && fresh.ready) {
            registry.write({ ...record, windowPid: fresh.pid });
            return;
        }
        if (!isAlive(record.pid)) throw new NoSessionError(`session ${record.name} died during reload: dump, gc`);
        if (Date.now() > deadline) throw new Error(`new window did not come up within ${String(timeoutMs)} ms`);
        await new Promise((r) => setTimeout(r, 200));
    }
}

/** Uses its own connection: the old one may have closed. */
async function probeWindow(port: number): Promise<{ pid: number; ready: boolean } | undefined> {
    try {
        const client = await DriveClient.connect(port, 1000);
        try {
            return await client.whenReady(1000);
        } finally {
            client.close();
        }
    } catch {
        return undefined;
    }
}

function regionText(frame: GridSnapshot, box: NodeSnapshot["box"]): string[] {
    const lines: string[] = [];
    for (let y = box.y; y < Math.min(frame.rows, box.y + box.height); y++) {
        let line = "";
        for (let x = box.x; x < Math.min(frame.cols, box.x + box.width); x++)
            line += frame.cells[y * frame.cols + x].char;
        lines.push(line);
    }
    return lines;
}

async function cmdWait(args: ParsedArgs): Promise<void> {
    const [kind, ...rest] = need(args, 1, "wait text|node|gone|focus|idle|ready|reload …");
    const timeoutMs = timeoutOf(args, kind === "ready" || kind === "reload" ? 120_000 : 10_000);
    const value = rest.join(" ");
    if (kind === "reload") {
        await waitReload(requireRecord(args), timeoutMs);
        return;
    }
    await withClient(args, async (client) => {
        try {
            switch (kind) {
                case "ready": {
                    const { ready } = await client.whenReady(timeoutMs);
                    if (!ready) throw new Error(`not ready within ${String(timeoutMs)} ms`);
                    break;
                }
                case "idle": {
                    const result = await client.waitForIdle({ timeoutMs });
                    if (!result.idle) throw new Error(`render did not go idle within ${String(timeoutMs)} ms`);
                    break;
                }
                case "text":
                    if (value === "") throw new UsageError('wait text "<text>"');
                    await waitUntil(
                        () => client.captureFrame(),
                        (f) => screenText(f, false).includes(value),
                        { timeoutMs, intervalMs: 150, describe: `text ${JSON.stringify(value)}` },
                    );
                    break;
                case "node":
                case "gone":
                    if (value === "") throw new UsageError(`wait ${kind} <selector>`);
                    await waitUntil(
                        () => client.node(value),
                        (n) => (kind === "node" ? n !== null : n === null),
                        { timeoutMs, describe: `${kind} ${value}` },
                    );
                    break;
                case "focus":
                    if (value === "") throw new UsageError("wait focus <Type>");
                    await waitUntil(
                        () => client.focused(),
                        (n) => n?.type === value,
                        { timeoutMs, describe: `focus on ${value}` },
                    );
                    break;
                default:
                    throw new UsageError(`wait: unknown kind ${kind} (text|node|gone|focus|idle|ready|reload)`);
            }
        } catch (error) {
            if (error instanceof UsageError) throw error;
            throw new Error(`${errorMessage(error)}\n${await postmortem(client)}`, { cause: error });
        }
    });
}

const COMMANDS: Readonly<Record<string, (args: ParsedArgs) => Promise<void> | void>> = {
    start: cmdStart,
    stop: cmdStop,
    list: cmdList,
    gc: cmdGc,
    dump: cmdDump,
    key: cmdKey,
    type: cmdType,
    paste: cmdPaste,
    click: cmdClick,
    hover: cmdHover,
    wheel: cmdWheel,
    resize: cmdResize,
    screen: cmdScreen,
    screenshot: cmdScreenshot,
    cell: cmdCell,
    cursor: cmdCursor,
    tree: cmdTree,
    node: cmdNode,
    focus: cmdFocus,
    output: cmdOutput,
    logs: cmdLogs,
    context: cmdContext,
    when: cmdWhen,
    commands: cmdCommands,
    exec: cmdExec,
    palette: cmdPalette,
    wait: cmdWait,
};

export async function main(argv: readonly string[]): Promise<number> {
    try {
        const args = parseArgs(argv);
        if (args.command === undefined || args.command === "help" || args.booleans.has("help")) {
            out(HELP);
            return 0;
        }
        const command = COMMANDS[args.command] as ((a: ParsedArgs) => Promise<void> | void) | undefined;
        if (command === undefined) throw new UsageError(`unknown command ${args.command}; drive help`);
        await command(args);
        return typeof process.exitCode === "number" ? process.exitCode : 0;
    } catch (error) {
        process.stderr.write(`drive: ${errorMessage(error)}\n`);
        if (error instanceof UsageError) return EXIT_USAGE;
        if (error instanceof NoSessionError) return EXIT_NO_SESSION;
        return EXIT_ERROR;
    }
}

process.exitCode = await main(process.argv.slice(2));
