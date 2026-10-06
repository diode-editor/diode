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

/** Инструмент живого прогона: водит headless-diode через инспектор. Справка — `drive help`. */

const HELP = `npm run drive -- <команда> [аргументы] [-s <сессия>] [--json]

Сессия живёт между вызовами (реестр — .drive/sessions/ этого checkout'а).
Имя по умолчанию — default. Код выхода: 0 ок, 1 ошибка/таймаут, 2 usage, 3 нет сессии.

Жизнь сессии
  start [--binary [--binary-path P]] [--size 140x38] [--open P]... [--file rel=текст]...
        [--seed DIR] [--settings JSON|@file] [--keybindings JSON|@file] [--install id|vsix]...
        [--arg <флаг diode>]... [--keep] [--no-wait-ready] [--no-build] [--timeout MS]
                         запуск (по умолчанию из исходников) в изолированном корне
  stop [--all] [--keep]  вежливый выход, добивание группы и сирот, уборка корня
  list                   сессии этого checkout'а
  gc [--kept]            убрать мёртвые сессии, сирот и брошенные корни (--kept — и сохранённые)
  dump                   пост-мортем: запись, кадр, фокус, хвост stderr и diode.log

Ввод (после каждого — ожидание покоя рендера)
  key <K>...             клавиши DSL: Enter, Ctrl+P, ArrowDown, Alt+F, F1, a (НЕ "Down")
  type <текст>           посимвольный набор, как пользователь (попапы видят каждый символ)
  paste <текст>          bracketed paste одним блоком (попап автодополнения НЕ откроется)
  click <x> <y> | --node SEL | --text "…"  [--right] [--double] [--ctrl|--shift|--alt]
  wheel up|down|left|right [<x> <y> | --node SEL] [--count N]
  resize <cols>x<rows>

Чтение
  screen [--numbered]    текст кадра (--numbered — с номерами строк и линейкой колонок)
  screenshot <file.png>  PNG кадра
  cell <x> <y>           символ, код-пойнт, fg/bg (#rrggbb|default), стиль
  cursor                 позиция курсора терминала
  tree [SEL] [--depth N] [--state]   дерево узлов (или поддеревья совпадений SEL)
  node <SEL>             первый узел по селектору (Type, #id, @role, «A B» — потомок)
  focus                  путь фокуса
  output [<канал>] [--list] [--tail N]   панель OUTPUT (канал — id или подпись)
  logs [--tail N]        stderr процесса и diode.log (только из исходников)
  context <ключ>         значение контекст-ключа
  when <выражение>       when-выражение над текущими ключами
  commands [фильтр]      команды с заголовком

Действия
  exec <id> [json-арг]... [--no-await] [--timeout MS]   выполнить команду по id
  palette "<заголовок>"  открыть палитру, ввести заголовок, Enter

Ожидания (--timeout MS, по умолчанию 10000; при таймауте — кадр и фокус)
  wait text "…" | node SEL | gone SEL | focus TYPE | idle | ready | reload
                         reload — новое окно после workbench.action.reloadWindow поднялось и готово
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
            `сессии ${name} нет: npm run drive -- start${name === "default" ? "" : ` -s ${name}`}`,
        );
    return record;
}

async function connect(record: SessionRecord): Promise<DriveClient> {
    try {
        return await DriveClient.connect(record.port, 5000);
    } catch (error) {
        if (!isAlive(record.pid)) {
            throw new NoSessionError(
                `сессия ${record.name} мертва (pid ${String(record.pid)}): npm run drive -- dump -s ${record.name}; уборка — gc`,
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
        throw new UsageError(`ожидался JSON или @файл: ${raw.slice(0, 80)}`);
    }
}

function need(args: ParsedArgs, count: number, usage: string): string[] {
    if (args.positionals.length < count) throw new UsageError(`usage: drive ${usage}`);
    return args.positionals;
}

async function settle(client: DriveClient): Promise<void> {
    await client.waitForIdle({});
}

/** Кадр и фокус — то, что печатается при таймауте ожидания и в `dump`. */
async function postmortem(client: DriveClient): Promise<string> {
    const parts: string[] = [];
    try {
        parts.push("── кадр ──", screenText(await client.captureFrame(), true));
    } catch (error) {
        parts.push(`── кадр ── <не снят: ${errorMessage(error)}>`);
    }
    try {
        parts.push(`── фокус ── ${focusText(await client.document())}`);
    } catch (error) {
        parts.push(`── фокус ── <не снят: ${errorMessage(error)}>`);
    }
    return parts.join("\n");
}

function tailOf(file: string, lines: number): string {
    if (!existsSync(file)) return "<нет файла>";
    const text = readFileSync(file, "utf8").trimEnd();
    if (text.length === 0) return "<пусто>";
    return text.split("\n").slice(-lines).join("\n");
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// ── Команды ──────────────────────────────────────────────────────────────────

async function cmdStart(args: ParsedArgs): Promise<void> {
    const name = sessionName(args);
    const size = parseSize(flag(args, "size") ?? "140x38");
    const binary =
        args.booleans.has("binary") || flag(args, "binary-path") !== undefined
            ? resolve(flag(args, "binary-path") ?? DEFAULT_BINARY)
            : undefined;
    if (binary !== undefined && args.booleans.has("from-source"))
        throw new UsageError("--binary и --from-source вместе не бывают");
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
        result.ready === "skipped" ? "готовность не ждали" : result.ready ? "готов" : "НЕ готов за таймаут";
    emit(
        args,
        { ...record, ready: result.ready, startMs: result.startMs },
        [
            `сессия ${record.name}: ${readyText} за ${String(result.startMs)} мс (${record.mode}, pid ${String(record.pid)}, порт ${String(record.port)}, ${String(record.cols)}x${String(record.rows)})`,
            `воркспейс: ${record.workspaceDir}`,
            `корень:    ${record.root}`,
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
            ? "сессий нет"
            : results
                  .map(
                      (r) =>
                          `${r.name}: остановлена ${r.graceful ? "вежливо" : "сигналом"}` +
                          (r.killed > 0 ? `, добито процессов: ${String(r.killed)}` : "") +
                          (r.rootKept !== undefined ? `; корень сохранён: ${r.rootKept}` : ""),
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
            ? "сессий нет"
            : rows
                  .map(
                      (r) =>
                          `${r.name}\t${r.alive ? "жива" : "МЕРТВА"}\tpid ${String(r.pid)}\tпорт ${String(r.port)}\t${r.mode}\t${r.startedAt}\t${r.root}`,
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
            `мёртвых сессий убрано: ${String(result.deadSessions.length)}${result.deadSessions.length > 0 ? ` (${result.deadSessions.join(", ")})` : ""}`,
            `сирот добито: ${String(result.orphansKilled)}`,
            `брошенных корней удалено: ${String(result.rootsRemoved.length)}`,
        ].join("\n"),
    );
}

async function cmdDump(args: ParsedArgs): Promise<void> {
    const record = requireRecord(args);
    const alive = isAlive(record.pid);
    const parts = [`── сессия ${record.name} ── ${alive ? "жива" : "МЕРТВА"}`, JSON.stringify(record, null, 2)];
    if (alive) {
        try {
            const client = await DriveClient.connect(record.port, 3000);
            try {
                parts.push(await postmortem(client));
            } finally {
                client.close();
            }
        } catch (error) {
            parts.push(`── инспектор не отвечает: ${errorMessage(error)}`);
        }
    }
    parts.push("── stderr (хвост) ──", tailOf(record.stderrFile, 40));
    parts.push("── diode.log (хвост) ──", tailOf(join(record.workspaceDir, "diode.log"), 40));
    out(parts.join("\n"));
}

async function cmdKey(args: ParsedArgs): Promise<void> {
    const keys = need(args, 1, "key <клавиша>...").map(validateKey);
    await withClient(args, async (client) => {
        for (const key of keys) {
            await client.sendKey(key);
            await settle(client);
        }
    });
}

async function cmdType(args: ParsedArgs): Promise<void> {
    const text = need(args, 1, "type <текст>").join(" ");
    await withClient(args, async (client) => {
        for (const ch of text) await client.sendKey(charToKey(ch));
        await settle(client);
    });
}

async function cmdPaste(args: ParsedArgs): Promise<void> {
    const text = need(args, 1, "paste <текст>").join(" ").replace(/\\n/g, "\n");
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
        if (node === null) throw new Error(`нет узла по селектору ${selector}`);
        return { x: node.box.x + Math.floor(node.box.width / 2), y: node.box.y + Math.floor(node.box.height / 2) };
    }
    if (text !== undefined) {
        const cell = findTextCell(await client.captureFrame(), text);
        if (cell === null) throw new Error(`на экране нет текста ${JSON.stringify(text)}`);
        return { x: cell.x + Math.floor(Array.from(text).length / 2), y: cell.y };
    }
    const rx = args.positionals.at(positionalOffset);
    const ry = args.positionals.at(positionalOffset + 1);
    if (rx === undefined || ry === undefined) throw new UsageError("нужны координаты <x> <y>, --node SEL или --text");
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
        emit(args, { x, y }, `клик ${String(x)},${String(y)}`);
    });
}

async function cmdWheel(args: ParsedArgs): Promise<void> {
    const [direction] = need(args, 1, "wheel up|down|left|right [<x> <y>|--node SEL]");
    if (!["up", "down", "left", "right"].includes(direction))
        throw new UsageError(`направление: up|down|left|right, не ${direction}`);
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
        const { cursor } = await client.captureFrame();
        emit(args, cursor, cursor === null ? "курсор скрыт" : `${String(cursor.x)},${String(cursor.y)}`);
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
    const [selector] = need(args, 1, "node <селектор>");
    await withClient(args, async (client) => {
        const node = await client.node(selector);
        if (node === null) {
            emit(args, null, `<нет узла по селектору ${selector}>`);
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
        emit(args, { ...result, text }, text.length === 0 ? `<канал ${result.label} пуст>` : text);
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
            `── diode.log ── ${record.mode === "binary" ? "(у бинаря файлового лога нет — смотри output)" : diodeLog}`,
            record.mode === "binary" ? "" : tailOf(diodeLog, tail),
        ].join("\n"),
    );
}

async function cmdContext(args: ParsedArgs): Promise<void> {
    const [key] = need(args, 1, "context <ключ>");
    await withClient(args, async (client) => {
        const { value } = await client.getContextKey(key);
        emit(args, { key, value }, JSON.stringify(value));
    });
}

async function cmdWhen(args: ParsedArgs): Promise<void> {
    const expr = need(args, 1, "when <выражение>").join(" ");
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
    const [id, ...rawArgs] = need(args, 1, "exec <id> [json-арг]...");
    const commandArgs = rawArgs.map((raw) => {
        try {
            return JSON.parse(raw) as unknown;
        } catch {
            return raw; // не JSON — строка как есть
        }
    });
    await withClient(args, async (client) => {
        const timeoutMs = args.booleans.has("no-await") ? 0 : intFlag(args, "timeout");
        let result: Awaited<ReturnType<DriveClient["executeCommand"]>>;
        try {
            result = await client.executeCommand(id, commandArgs, timeoutMs);
            await settle(client);
        } catch (error) {
            // reloadWindow/quit: окно уходит, не ответив, — это исход команды, а не сбой.
            if (!client.closed) throw error;
            emit(args, { windowClosed: true }, "окно закрылось (выход или перезагрузка) — дальше: wait reload");
            return;
        }
        emit(
            args,
            result,
            result.settled
                ? `ok${result.result !== null ? ` ${JSON.stringify(result.result)}` : ""}`
                : "запущена (не завершилась за таймаут — ждёт ввода?)",
        );
    });
}

async function cmdPalette(args: ParsedArgs): Promise<void> {
    const title = need(args, 1, 'palette "<заголовок>"').join(" ");
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
            throw new Error(`в палитре нет пункта ${JSON.stringify(title)}\n${await postmortem(client)}`);
        }
        await client.sendKey("Enter");
        await settle(client);
        emit(args, { title }, `palette: ${title}`);
    });
}

/**
 * Окно после `reloadWindow` — новый процесс на том же порту; старое ещё может
 * отвечать, поэтому ждём ДРУГОЙ pid и его готовность. Своё подключение с
 * ретраями: в момент перезапуска порт никто не слушает.
 */
async function waitReload(record: SessionRecord, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const fresh = await probeWindow(record.port);
        if (fresh !== undefined && fresh.pid !== record.windowPid && fresh.ready) {
            registry.write({ ...record, windowPid: fresh.pid });
            return;
        }
        if (!isAlive(record.pid)) throw new NoSessionError(`сессия ${record.name} умерла при перезагрузке: dump, gc`);
        if (Date.now() > deadline) throw new Error(`новое окно не поднялось за ${String(timeoutMs)} мс`);
        await new Promise((r) => setTimeout(r, 200));
    }
}

/** Pid и готовность окна на порту — отдельным подключением (старое могло закрыться). */
async function probeWindow(port: number): Promise<{ pid: number; ready: boolean } | undefined> {
    try {
        const client = await DriveClient.connect(port, 1000);
        try {
            return await client.whenReady(1000);
        } finally {
            client.close();
        }
    } catch {
        return undefined; // окно в перезапуске — порт ещё не слушают
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
                    if (!ready) throw new Error(`не готов за ${String(timeoutMs)} мс`);
                    break;
                }
                case "idle": {
                    const result = await client.waitForIdle({ timeoutMs });
                    if (!result.idle) throw new Error(`рендер не успокоился за ${String(timeoutMs)} мс`);
                    break;
                }
                case "text":
                    if (value === "") throw new UsageError('wait text "<текст>"');
                    await waitUntil(
                        () => client.captureFrame(),
                        (f) => screenText(f, false).includes(value),
                        { timeoutMs, intervalMs: 150, describe: `текст ${JSON.stringify(value)}` },
                    );
                    break;
                case "node":
                case "gone":
                    if (value === "") throw new UsageError(`wait ${kind} <селектор>`);
                    await waitUntil(
                        () => client.node(value),
                        (n) => (kind === "node" ? n !== null : n === null),
                        { timeoutMs, describe: `${kind} ${value}` },
                    );
                    break;
                case "focus":
                    if (value === "") throw new UsageError("wait focus <Тип>");
                    await waitUntil(
                        () => client.focused(),
                        (n) => n?.type === value,
                        { timeoutMs, describe: `фокус на ${value}` },
                    );
                    break;
                default:
                    throw new UsageError(`wait: неизвестный вид ${kind} (text|node|gone|focus|idle|ready|reload)`);
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
        if (command === undefined) throw new UsageError(`неизвестная команда ${args.command}; drive help`);
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
