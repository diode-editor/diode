import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
    closeSync,
    cpSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readdirSync,
    readFileSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type AppEnvOptions, prepareAppEnv, removeTempDir } from "../../e2e/helpers/appSession.ts";
import { hermeticSpawnEnv } from "../../e2e/helpers/hermeticEnv.ts";
import { freePort } from "../../e2e/helpers/inspectorClient.ts";

import { DriveClient } from "./driveClient.ts";
import { findMarkedProcesses, isAlive, killSessionProcesses } from "./processes.ts";
import { ROOT_PREFIX, SESSION_MARKER_ENV, type SessionRecord, type SessionRegistry } from "./sessionRegistry.ts";

export const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const MAIN_TS = join(repoRoot, "src", "vs", "diode", "main.ts");
export const DEFAULT_BINARY = join(repoRoot, "dist", process.platform === "win32" ? "diode.exe" : "diode");

/** Холодный tsx — секунды. */
const CONNECT_TIMEOUT_MS = 60_000;

export interface StartOptions {
    readonly name: string;
    /** Не задан — запуск из исходников. */
    readonly binary?: string;
    readonly cols: number;
    readonly rows: number;
    readonly open?: readonly string[];
    readonly files?: Readonly<Record<string, string>>;
    readonly seed?: string;
    readonly settings?: AppEnvOptions["settings"];
    readonly keybindings?: AppEnvOptions["keybindings"];
    /** id из магазина или путь к `.vsix`. */
    readonly install: readonly string[];
    readonly extraArgs: readonly string[];
    readonly keep: boolean;
    readonly waitReady: boolean;
    readonly readyTimeoutMs: number;
    readonly noBuild: boolean;
}

export interface StartResult {
    readonly record: SessionRecord;
    readonly ready: boolean | "skipped";
    readonly startMs: number;
}

function launcher(binary: string | undefined): { command: string; prefix: string[]; entry: string } {
    if (binary !== undefined) return { command: binary, prefix: [], entry: binary };
    // `--import <url tsx>`, а не CLI `tsx`: один процесс (pid в реестре — сам редактор), и
    // абсолютный URL резолвится из изолированного воркспейса, где `node_modules` нет.
    return { command: process.execPath, prefix: ["--import", import.meta.resolve("tsx"), MAIN_TS], entry: MAIN_TS };
}

function buildExtensions(): void {
    const result = spawnSync(process.execPath, [join(repoRoot, "scripts", "build-extensions.mjs")], {
        cwd: repoRoot,
        stdio: ["ignore", "ignore", "pipe"],
        encoding: "utf8",
    });
    if (result.status !== 0) throw new Error(`build:extensions упал:\n${result.stderr}`);
}

function installExtension(
    run: ReturnType<typeof launcher>,
    userDataDir: string,
    id: string,
    env: Record<string, string>,
    cwd: string,
): void {
    const result = spawnSync(
        run.command,
        [...run.prefix, `--user-data-dir=${userDataDir}`, "--install-extension", id],
        {
            cwd,
            env,
            stdio: ["ignore", "pipe", "pipe"],
            encoding: "utf8",
            timeout: 300_000,
        },
    );
    if (result.status !== 0) {
        throw new Error(`--install-extension ${id}: код ${String(result.status)}\n${result.stdout}${result.stderr}`);
    }
}

export async function startSession(registry: SessionRegistry, options: StartOptions): Promise<StartResult> {
    const existing = registry.read(options.name);
    if (existing !== undefined) {
        if (isAlive(existing.pid)) {
            throw new Error(
                `сессия ${options.name} уже запущена (pid ${String(existing.pid)}): drive stop -s ${options.name}`,
            );
        }
        await disposeSession(registry, existing, { keep: false });
    }
    const t0 = Date.now();
    const run = launcher(options.binary);
    if (options.binary !== undefined && !existsSync(options.binary)) {
        throw new Error(`бинаря нет: ${options.binary} (сборка — под лизой: claude-lease run -- npm run build:sea)`);
    }
    if (options.binary === undefined && !options.noBuild) buildExtensions();

    const root = mkdtempSync(join(tmpdir(), `${ROOT_PREFIX}${options.name}-`));
    const marker = `${options.name}:${root}`;
    // Пока процесса нет, «лидер» корня — мы сами: `gc` соседнего worktree корень не снесёт.
    mkdirSync(join(root, "drive"), { recursive: true });
    writeFileSync(rootRecordFile(root), JSON.stringify({ pid: process.pid, keep: options.keep }));
    let child: ChildProcess | undefined;
    try {
        // До prepareAppEnv: withWorkspaceFolder должен видеть засеянные каталоги.
        const workspaceDir = join(root, "workspace");
        mkdirSync(workspaceDir, { recursive: true });
        if (options.seed !== undefined) cpSync(options.seed, workspaceDir, { recursive: true });
        for (const [rel, content] of Object.entries(options.files ?? {})) {
            const file = join(workspaceDir, rel);
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, content);
        }
        const appEnv = await prepareAppEnv({
            root,
            keepRoot: true,
            ...(options.settings !== undefined ? { settings: options.settings } : {}),
            ...(options.keybindings !== undefined ? { keybindings: options.keybindings } : {}),
            // Без папки нет ни дерева файлов, ни SCM, ни workspaceFolders у расширений.
            ...(options.open !== undefined ? { open: withWorkspaceFolder(root, options.open) } : {}),
            extraArgs: options.extraArgs,
        });
        const env = hermeticSpawnEnv({ ...appEnv.env, [SESSION_MARKER_ENV]: marker });
        for (const id of options.install) installExtension(run, appEnv.userDataDir, id, env, appEnv.workspaceDir);

        const port = await freePort();
        const logDir = join(root, "drive");
        const stdoutFile = join(logDir, "stdout.log");
        const stderrFile = join(logDir, "stderr.log");
        const out = openSync(stdoutFile, "a");
        const err = openSync(stderrFile, "a");
        child = spawn(
            run.command,
            [
                ...run.prefix,
                ...appEnv.args,
                `--headless=${String(options.cols)}x${String(options.rows)}`,
                `--inspect-tui=127.0.0.1:${String(port)}`,
            ],
            { cwd: appEnv.workspaceDir, env, detached: true, stdio: ["ignore", out, err] },
        );
        closeSync(out);
        closeSync(err);
        const pid = child.pid;
        if (pid === undefined) throw new Error(`не запустился: ${run.command}`);
        child.unref();

        const record: SessionRecord = {
            name: options.name,
            pid,
            windowPid: pid,
            port,
            root,
            workspaceDir: appEnv.workspaceDir,
            userDataDir: appEnv.userDataDir,
            mode: options.binary === undefined ? "source" : "binary",
            entry: run.entry,
            cols: options.cols,
            rows: options.rows,
            startedAt: new Date().toISOString(),
            stdoutFile,
            stderrFile,
            keep: options.keep,
            marker,
        };
        registry.write(record);
        writeFileSync(rootRecordFile(root), `${JSON.stringify(record, null, 2)}\n`);

        const client = await connectRacingExit(child, port, stderrFile);
        try {
            let ready: boolean | "skipped" = "skipped";
            if (options.waitReady) ready = (await client.whenReady(options.readyTimeoutMs)).ready;
            return { record, ready, startMs: Date.now() - t0 };
        } finally {
            client.close();
        }
    } catch (error) {
        await killSessionProcesses(child?.pid, marker, 1000);
        registry.remove(options.name);
        if (!options.keep) removeTempDir(root);
        throw error;
    }
}

function withWorkspaceFolder(root: string, open: readonly string[]): string[] {
    const workspaceDir = join(root, "workspace");
    const isDir = (p: string): boolean => {
        try {
            return statSync(p.startsWith("/") ? p : join(workspaceDir, p)).isDirectory();
        } catch {
            return false;
        }
    };
    const opensWorkspace = (p: string): boolean => isDir(p) || p.endsWith(".code-workspace");
    return open.some(opensWorkspace) ? [...open] : [workspaceDir, ...open];
}

async function connectRacingExit(child: ChildProcess, port: number, stderrFile: string): Promise<DriveClient> {
    const abort = new AbortController();
    const died = new Promise<never>((_, reject) => {
        child.once("error", (e) => {
            reject(new Error(`редактор не запустился: ${e.message}`));
        });
        child.once("exit", (code, sig) => {
            const how = sig === null ? `кодом ${String(code)}` : `сигналом ${sig}`;
            reject(new Error(`редактор вышел ${how} до подключения инспектора; stderr: ${stderrFile}`));
        });
    });
    try {
        return await Promise.race([DriveClient.connect(port, CONNECT_TIMEOUT_MS, abort.signal), died]);
    } finally {
        abort.abort();
    }
}

export interface StopResult {
    readonly name: string;
    readonly graceful: boolean;
    readonly killed: number;
    readonly rootKept: string | undefined;
}

export async function stopSession(
    registry: SessionRegistry,
    record: SessionRecord,
    opts: { keep: boolean },
): Promise<StopResult> {
    let graceful = false;
    if (isAlive(record.pid)) {
        try {
            const client = await DriveClient.connect(record.port, 2000);
            try {
                await Promise.race([client.shutdown(), sleep(3000)]);
            } catch {
                // сокет закрывается вместе с процессом — это и есть успех
            } finally {
                client.close();
            }
            const deadline = Date.now() + 5000;
            while (isAlive(record.pid) && Date.now() < deadline) await sleep(100);
            graceful = !isAlive(record.pid);
        } catch {
            // инспектор не отвечает — сразу к сигналам
        }
    }
    return disposeSession(registry, record, { keep: opts.keep, graceful });
}

async function disposeSession(
    registry: SessionRegistry,
    record: SessionRecord,
    opts: { keep: boolean; graceful?: boolean },
): Promise<StopResult> {
    const killed = await killSessionProcesses(record.pid, record.marker);
    const keep = opts.keep || record.keep;
    if (keep) {
        writeFileSync(rootRecordFile(record.root), `${JSON.stringify({ ...record, keep: true }, null, 2)}\n`);
    } else {
        removeTempDir(record.root);
    }
    registry.remove(record.name);
    return { name: record.name, graceful: opts.graceful ?? false, killed, rootKept: keep ? record.root : undefined };
}

export interface GcResult {
    readonly deadSessions: string[];
    readonly orphansKilled: number;
    readonly rootsRemoved: string[];
}

/**
 * Источник правды — копия записи в корне сессии, а не реестр: реестр соседнего
 * worktree не виден, а корень виден, и живую чужую сессию трогать нельзя.
 */
export async function gcSessions(registry: SessionRegistry, opts: { kept: boolean }): Promise<GcResult> {
    const deadSessions: string[] = [];
    for (const record of registry.list()) {
        if (isAlive(record.pid)) continue;
        await disposeSession(registry, { ...record, keep: record.keep && !opts.kept }, { keep: false });
        deadSessions.push(record.name);
    }

    let orphansKilled = 0;
    const orphanMarkers = new Set(
        findMarkedProcesses()
            .filter((p) => !rootLeaderAlive(markerRoot(p.marker)))
            .map((p) => p.marker),
    );
    for (const marker of orphanMarkers) {
        orphansKilled += findMarkedProcesses().filter((p) => p.marker === marker).length;
        await killSessionProcesses(undefined, marker, 1500);
    }

    const liveRoots = new Set(findMarkedProcesses().map((p) => markerRoot(p.marker)));
    const rootsRemoved: string[] = [];
    for (const entry of safeReaddir(tmpdir())) {
        if (!entry.startsWith(ROOT_PREFIX)) continue;
        const root = join(tmpdir(), entry);
        if (liveRoots.has(root) || rootLeaderAlive(root)) continue;
        if (!opts.kept && readRootRecord(root)?.keep === true) continue;
        removeTempDir(root);
        rootsRemoved.push(root);
    }
    return { deadSessions, orphansKilled, rootsRemoved };
}

export function rootRecordFile(root: string): string {
    return join(root, "drive", "session.json");
}

function readRootRecord(root: string): Partial<SessionRecord> | undefined {
    try {
        return JSON.parse(readFileSync(rootRecordFile(root), "utf8")) as Partial<SessionRecord>;
    } catch {
        return undefined;
    }
}

function rootLeaderAlive(root: string): boolean {
    const pid = readRootRecord(root)?.pid;
    return typeof pid === "number" && isAlive(pid);
}

function markerRoot(marker: string): string {
    return marker.slice(marker.indexOf(":") + 1);
}

function safeReaddir(dir: string): string[] {
    try {
        return readdirSync(dir);
    } catch {
        return [];
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}
