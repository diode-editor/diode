import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getBinaryPath } from "./buildOnce.ts";
import { HeadlessSession, type HeadlessSessionOptions } from "./headlessSession.ts";
import { reapSession } from "./processGroup.ts";
import { DiodeSession } from "./runDiode.ts";

// Единственная реализация изолированного запуска бинаря для e2e: без неё сьюты стартовали против
// реального `~/.diode` (чужая сессия, чужие расширения, корзина и `diode.log` разработчика).
//
//     <root>/
//       user-data-dir/   → --user-data-dir (settings, keybindings, globalState, extensions)
//       home/            → HOME/USERPROFILE + XDG_{DATA,CACHE,CONFIG}_HOME (корзина, кеши)
//       workspace/       → cwd процесса (diode.log, ext-host folders) + сид-воркспейс

/** Сид-файл в изолированный воркспейс: относительный путь → текст (utf-8) или байты как есть (файл в чужой кодировке). */
export type SeedFiles = Readonly<Record<string, string | Uint8Array>>;

export interface AppEnvOptions {
    /** Относительные пути; родители создаются. */
    files?: SeedFiles;
    settings?: Readonly<Record<string, unknown>> | string;
    keybindings?: readonly { key: string; command: string; when?: string; args?: unknown }[];
    /** Путь к `.vsix` или id из публичного магазина (различение по суффиксу, как у CLI); id ходит в сеть. */
    installVsix?: readonly string[];
    /** Копируется в изолированный `--user-data-dir` — чтобы сессия не писала в закоммиченную фикстуру. */
    seedUserData?: string;
    /**
     * Относительные пути — от изолированного воркспейса. Опущено — сам воркспейс (workspaceFolder);
     * пустой массив — ЯВНО голый `diode`, пустое окно.
     */
    open?: readonly string[];
    /** Кроме headless/inspect-tui — их ставит транспорт. */
    extraArgs?: readonly string[];
    env?: Readonly<Record<string, string>>;
    /** Корень прошлой сессии — тесты на рестарт. */
    root?: string;
    keepRoot?: boolean;
    /** По умолчанию изолируем; `false` — для теста, которому нужен настоящий HOME. */
    isolateHome?: boolean;
    /** По умолчанию — изолированный воркспейс (туда же `diode.log`); сценарии стартуют из repoRoot. */
    cwd?: string;
    cols?: number;
    rows?: number;
}

export interface AppEnv {
    readonly root: string;
    readonly userDataDir: string;
    readonly home: string;
    /** cwd процесса и (по умолчанию) workspaceFolder. */
    readonly workspaceDir: string;
    readonly args: string[];
    readonly env: Record<string, string>;
    dispose(): void;
}

/** Зеркало раскладки `resolveUserDataPaths`. */
function userProfileDir(userDataDir: string): string {
    return join(userDataDir, "user-data", "User");
}

/**
 * На Windows встроенный TS-сервер не поднимается («Server initialization failed …»), а его
 * error-тосты роняют сценарии, к LSP отношения не имеющие, — там клиент гасим. Тесту со своими
 * настройками не дописываем НИЧЕГО: такие сверяют файл дословно (`extensionTheme.test.ts`).
 */
function platformSettingDefaults(explicit: AppEnvOptions["settings"]): Record<string, unknown> {
    if (explicit !== undefined || process.platform !== "win32") return {};
    return { "diode.lsp.typescript.enabled": false };
}

/** Только готовит FS и возвращает аргументы/env для транспорта — ничего не запускает. */
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

    // Установка расширений — тем же CLI-путём, что у пользователя.
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

/** Абсолютный путь? (POSIX `/…` или Windows `C:\…`). */
function isAbsoluteLike(p: string): boolean {
    return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
}

/**
 * HOME/XDG — внутрь корня. Терминальную идентичность пинует сам спаун сессии
 * ({@link import("./hermeticEnv.ts").hermeticSpawnEnv}), последним шагом мержа.
 */
function buildEnv(home: string, isolateHome: boolean, extra?: Readonly<Record<string, string>>): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    if (isolateHome) Object.assign(env, homeIsolationEnv(home));
    Object.assign(env, extra ?? {});
    return env;
}

/** Ловят пути мимо `--user-data-dir`: корзину (`trashService`), кеш self-extract, шелл-конфиги. */
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
 * Реджектит на ненулевом коде: битая фикстура должна ронять сессию, а не давать молча
 * незаряженное расширение.
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
 * Windows отдаёт хендлы не мгновенно — `rmSync` падает с `EPERM`, отсюда `maxRetries`. Не вышло —
 * не падаем: каталог внутри корня прогона, его снесёт teardown (`src/TestUtils/tmpRoot.ts`).
 */
export function removeTempDir(dir: string): void {
    try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
        // best-effort: временный каталог не стоит упавшего теста
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
            // Языковые серверы живут в чужой группе процессов: групповой сигнал
            // `dispose` до них не доходит. Добиваем всё с меткой сессии.
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
    /** Поднять инспектор рядом с PTY (ассерты по дереву без ANSI-парсинга). */
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
            // Языковые серверы живут в чужой группе процессов: групповой сигнал
            // `dispose` до них не доходит. Добиваем всё с меткой сессии.
            await reapSession(session.sessionTag);
            env.dispose();
        },
    };
}
