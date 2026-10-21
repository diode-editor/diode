import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getBinaryPath } from "./buildOnce.ts";
import { HeadlessSession, type HeadlessSessionOptions } from "./headlessSession.ts";
import { reapSession } from "./processGroup.ts";
import { DiodeSession } from "./runDiode.ts";

// The single implementation of an isolated binary launch for e2e: without it suites started against
// the real `~/.diode` (someone else's session and extensions, the developer's trash and `diode.log`).
//
//     <root>/
//       user-data-dir/   → --user-data-dir (settings, keybindings, globalState, extensions)
//       home/            → HOME/USERPROFILE + XDG_{DATA,CACHE,CONFIG}_HOME (trash, caches)
//       workspace/       → process cwd (diode.log, ext-host folders) + seeded workspace

/** Seed files for the isolated workspace: relative path → text (utf-8) or raw bytes (a file in another encoding). */
export type SeedFiles = Readonly<Record<string, string | Uint8Array>>;

export interface AppEnvOptions {
    /** Relative paths; parent directories are created. */
    files?: SeedFiles;
    settings?: Readonly<Record<string, unknown>> | string;
    keybindings?: readonly { key: string; command: string; when?: string; args?: unknown }[];
    /** A `.vsix` path or a public marketplace id (told apart by suffix, as in the CLI); an id hits the network. */
    installVsix?: readonly string[];
    /** Copied into the isolated `--user-data-dir` so the session does not write into a committed fixture. */
    seedUserData?: string;
    /**
     * Paths are relative to the isolated workspace. Omitted — the workspace itself (workspaceFolder);
     * an empty array — EXPLICITLY bare `diode`, an empty window.
     */
    open?: readonly string[];
    /** Excluding headless/inspect-tui — the transport sets those. */
    extraArgs?: readonly string[];
    env?: Readonly<Record<string, string>>;
    /** Root of a previous session — for restart tests. */
    root?: string;
    keepRoot?: boolean;
    /** Isolated by default; `false` for a test that needs the real HOME. */
    isolateHome?: boolean;
    /** Defaults to the isolated workspace (where `diode.log` goes too); scenarios start from repoRoot. */
    cwd?: string;
    cols?: number;
    rows?: number;
}

export interface AppEnv {
    readonly root: string;
    readonly userDataDir: string;
    readonly home: string;
    /** Process cwd and (by default) workspaceFolder. */
    readonly workspaceDir: string;
    readonly args: string[];
    readonly env: Record<string, string>;
    dispose(): void;
}

/** Mirrors the `resolveUserDataPaths` layout. */
function userProfileDir(userDataDir: string): string {
    return join(userDataDir, "user-data", "User");
}

/**
 * On Windows the built-in TS server fails to start ("Server initialization failed …"), and its
 * error toasts break scenarios unrelated to LSP — so the client is turned off there. A test with its own
 * settings gets NOTHING appended: such tests compare the file verbatim (`extensionTheme.test.ts`).
 */
function platformSettingDefaults(explicit: AppEnvOptions["settings"]): Record<string, unknown> {
    if (explicit !== undefined || process.platform !== "win32") return {};
    return { "diode.lsp.typescript.enabled": false };
}

/** Only prepares the FS and returns args/env for the transport — launches nothing. */
export async function prepareAppEnv(options: AppEnvOptions = {}): Promise<AppEnv> {
    const isolateHome = options.isolateHome !== false;
    const root = options.root ?? mkdtempSync(join(tmpdir(), "diode-e2e-"));
    const userDataDir = join(root, "user-data-dir");
    const home = isolateHome ? join(root, "home") : "";
    const workspaceDir = join(root, "workspace");

    mkdirSync(workspaceDir, { recursive: true });
    if (isolateHome) mkdirSync(home, { recursive: true });

    if (options.seedUserData !== undefined) {
        cpSync(options.seedUserData, userDataDir, { recursive: true });
    }

    for (const [rel, content] of Object.entries(options.files ?? {})) {
        const file = join(workspaceDir, rel);
        mkdirSync(join(file, ".."), { recursive: true });
        writeFileSync(file, content);
    }

    const settings = options.settings ?? platformSettingDefaults(options.settings);
    const hasSettings = typeof settings === "string" || Object.keys(settings).length > 0;
    if (hasSettings || options.keybindings !== undefined) {
        const profileDir = userProfileDir(userDataDir);
        mkdirSync(profileDir, { recursive: true });
        if (hasSettings) {
            const body = typeof settings === "string" ? settings : JSON.stringify(settings, null, 2);
            writeFileSync(join(profileDir, "settings.json"), body);
        }
        if (options.keybindings !== undefined) {
            writeFileSync(join(profileDir, "keybindings.json"), JSON.stringify(options.keybindings, null, 2));
        }
    }

    // Install extensions via the same CLI path a user takes.
    for (const vsix of options.installVsix ?? []) {
        await installExtension(userDataDir, vsix);
    }

    const opens =
        options.open !== undefined
            ? options.open.map((p) => (isAbsoluteLike(p) ? p : join(workspaceDir, p)))
            : [workspaceDir];

    const args = [`--user-data-dir=${userDataDir}`, ...(options.extraArgs ?? []), ...opens];
    const env = buildEnv(home, isolateHome, options.env);

    return {
        root,
        userDataDir,
        home,
        workspaceDir,
        args,
        env,
        dispose: () => {
            if (options.keepRoot !== true) removeTempDir(root);
        },
    };
}

/** Absolute path? (POSIX `/…` or Windows `C:\…`). */
function isAbsoluteLike(p: string): boolean {
    return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
}

/**
 * HOME/XDG go inside the root. Terminal identity is pinned by the session spawn itself
 * ({@link import("./hermeticEnv.ts").hermeticSpawnEnv}), as the last merge step.
 */
function buildEnv(home: string, isolateHome: boolean, extra?: Readonly<Record<string, string>>): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    if (isolateHome) Object.assign(env, homeIsolationEnv(home));
    Object.assign(env, extra ?? {});
    return env;
}

/** Catch paths that bypass `--user-data-dir`: trash (`trashService`), self-extract cache, shell configs. */
export function homeIsolationEnv(home: string): Record<string, string> {
    return {
        HOME: home,
        USERPROFILE: home,
        XDG_DATA_HOME: join(home, ".local", "share"),
        XDG_CACHE_HOME: join(home, ".cache"),
        XDG_CONFIG_HOME: join(home, ".config"),
    };
}

/**
 * Rejects on a non-zero exit code: a broken fixture must fail the session rather than silently
 * yield a session without the extension.
 */
async function installExtension(userDataDir: string, vsix: string): Promise<void> {
    const binary = await getBinaryPath();
    await new Promise<void>((resolveInstall, reject) => {
        const child = spawn(binary, [`--user-data-dir=${userDataDir}`, "--install-extension", vsix], {
            stdio: ["ignore", "ignore", "pipe"],
        });
        let stderr = "";
        child.stderr?.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) resolveInstall();
            else reject(new Error(`--install-extension ${vsix} exited ${String(code)}: ${stderr}`));
        });
    });
}

/**
 * Windows releases handles with a delay — `rmSync` fails with `EPERM`, hence `maxRetries`. If it still
 * fails, don't throw: the directory is inside the run root, and teardown removes it (`src/TestUtils/tmpRoot.ts`).
 */
export function removeTempDir(dir: string): void {
    try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
        // best-effort: a temp directory is not worth a failed test
    }
}


export interface HeadlessApp {
    readonly session: HeadlessSession;
    readonly env: AppEnv;
    dispose(): Promise<void>;
}

export async function startHeadlessApp(options: AppEnvOptions & { binary?: string } = {}): Promise<HeadlessApp> {
    const env = await prepareAppEnv(options);
    const sessionOpts: HeadlessSessionOptions = {
        args: env.args,
        cwd: options.cwd ?? env.workspaceDir,
        env: env.env,
        ...(options.cols !== undefined ? { cols: options.cols } : {}),
        ...(options.rows !== undefined ? { rows: options.rows } : {}),
        ...(options.binary !== undefined ? { binary: options.binary } : {}),
    };
    const session = await HeadlessSession.start(sessionOpts);
    return {
        session,
        env,
        dispose: async () => {
            await session.dispose();
            // Language servers live in another process group: the group signal from
            // `dispose` does not reach them. Kill everything with the session tag.
            await reapSession(session.sessionTag);
            env.dispose();
        },
    };
}


export interface PtyApp {
    readonly session: DiodeSession;
    readonly env: AppEnv;
    dispose(): Promise<void>;
}

export interface PtyAppOptions extends AppEnvOptions {
    /** Start the inspector alongside the PTY (tree assertions without ANSI parsing). */
    inspect?: boolean;
    binary?: string;
}

export async function startPtyApp(options: PtyAppOptions = {}): Promise<PtyApp> {
    const env = await prepareAppEnv(options);
    const session = await DiodeSession.start({
        args: env.args,
        cwd: options.cwd ?? env.workspaceDir,
        env: env.env,
        ...(options.cols !== undefined ? { cols: options.cols } : {}),
        ...(options.rows !== undefined ? { rows: options.rows } : {}),
        ...(options.inspect !== undefined ? { inspect: options.inspect } : {}),
        ...(options.binary !== undefined ? { binary: options.binary } : {}),
    });
    return {
        session,
        env,
        dispose: async () => {
            await session.dispose();
            // Language servers live in another process group: the group signal from
            // `dispose` does not reach them. Kill everything with the session tag.
            await reapSession(session.sessionTag);
            env.dispose();
        },
    };
}
