import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getBinaryPath } from "./buildOnce.ts";
import { HeadlessSession, type HeadlessSessionOptions } from "./headlessSession.ts";
import { VexxSession } from "./runVexx.ts";

// ── Hermetic app session ─────────────────────────────────────────────────────
// Единственная реализация изолированного запуска настоящего бинаря для e2e.
// Раньше изоляция («временный --user-data-dir + keybindings.json») жила внутри
// `runScenario`, наружу не торчала, и половина сьютов стартовала против реального
// `~/.vexx`: восстанавливали чужую сессию, видели чужие расширения, писали в
// корзину и `vexx.log` разработчика. Здесь один временный корень изолирует всё:
//
//     <root>/
//       user-data-dir/   → --user-data-dir (settings, keybindings, globalState, extensions)
//       home/            → HOME/USERPROFILE + XDG_{DATA,CACHE,CONFIG}_HOME (корзина, кеши)
//       workspace/       → cwd процесса (vexx.log, ext-host folders) + сид-воркспейс
//
// Два транспорта поверх одного окружения: `startHeadlessApp` (инспектор, основной
// путь) и `startPtyApp` (ANSI-уровень, для sea-*). Изоляция — в одном месте.

/** Сид-файл в изолированный воркспейс: относительный путь → содержимое. */
export type SeedFiles = Readonly<Record<string, string>>;

export interface AppEnvOptions {
    /** Сид-файлы воркспейса (относительные пути; родители создаются). */
    files?: SeedFiles;
    /** settings.json активного профиля — объект (сериализуется) или готовая строка. */
    settings?: Readonly<Record<string, unknown>> | string;
    /** keybindings.json активного профиля. */
    keybindings?: readonly { key: string; command: string }[];
    /** `.vsix`, устанавливаемые до запуска (тот же путь, что `--install-extension`). */
    installVsix?: readonly string[];
    /**
     * Каталог-фикстура user-data-dir, чьё содержимое копируется в изолированный
     * `--user-data-dir` перед запуском (например `extensions/<id>` с уже
     * распакованным расширением). Копия, а не сам каталог, — чтобы состояние
     * сессии не писалось обратно в закоммиченную фикстуру.
     */
    seedUserData?: string;
    /**
     * Что открыть. Относительные пути резолвятся от изолированного воркспейса,
     * абсолютные — как есть (можно открыть repo-фикстуру, сохранив изоляцию
     * user-data/home). По умолчанию — каталог воркспейса (workspaceFolder).
     */
    open?: readonly string[];
    /** Дополнительные CLI-флаги (кроме headless/inspect-tui — их ставит транспорт). */
    extraArgs?: readonly string[];
    /** Доп. переменные окружения поверх изолированных. */
    env?: Readonly<Record<string, string>>;
    /**
     * Переиспользовать существующий корень (тесты на рестарт: второй запуск видит
     * состояние первого). Обычно — значение `root` от прошлой сессии.
     */
    root?: string;
    /** Не удалять корень при `dispose` — для рестарта и пост-мортема. */
    keepRoot?: boolean;
    /**
     * Не изолировать HOME/XDG (оставить реальные). По умолчанию `true` —
     * изолируем. Опт-аут для редкого теста, которому нужен настоящий HOME.
     */
    isolateHome?: boolean;
    /**
     * cwd процесса. По умолчанию — изолированный воркспейс (`vexx.log` и
     * ext-host folders изолируются). Переопределяется, когда тест/сценарий
     * должен стартовать из конкретного каталога (сценарии — из repoRoot).
     */
    cwd?: string;
    cols?: number;
    rows?: number;
}

/** Разложенное изолированное окружение: пути, аргументы, env, уборка. */
export interface AppEnv {
    /** Временный корень сессии. */
    readonly root: string;
    /** Значение `--user-data-dir`. */
    readonly userDataDir: string;
    /** Изолированный HOME (или реальный, если `isolateHome: false`). */
    readonly home: string;
    /** Каталог воркспейса — cwd процесса и (по умолчанию) workspaceFolder. */
    readonly workspaceDir: string;
    /** Позиционные аргументы (что открыть). */
    readonly args: string[];
    /** Env для спавна. */
    readonly env: Record<string, string>;
    /** Удаляет корень (если не `keepRoot`). */
    dispose(): void;
}

/** Раскладка User-каталога внутри `--user-data-dir` (см. resolveUserDataPaths). */
function userProfileDir(userDataDir: string): string {
    return join(userDataDir, "user-data", "User");
}

/**
 * Собирает изолированное окружение: корень, подкаталоги, сид-файлы, settings и
 * keybindings, устанавливает `.vsix`. Ничего не запускает — только готовит FS и
 * возвращает аргументы/env для транспорта.
 */
export async function prepareAppEnv(options: AppEnvOptions = {}): Promise<AppEnv> {
    const isolateHome = options.isolateHome !== false;
    const root = options.root ?? mkdtempSync(join(tmpdir(), "vexx-e2e-"));
    const userDataDir = join(root, "user-data-dir");
    const home = isolateHome ? join(root, "home") : "";
    const workspaceDir = join(root, "workspace");

    mkdirSync(workspaceDir, { recursive: true });
    if (isolateHome) mkdirSync(home, { recursive: true });

    // Копия фикстуры user-data-dir (расширения/настройки) в изолированный корень.
    if (options.seedUserData !== undefined) {
        cpSync(options.seedUserData, userDataDir, { recursive: true });
    }

    // Сид-файлы воркспейса.
    for (const [rel, content] of Object.entries(options.files ?? {})) {
        const file = join(workspaceDir, rel);
        mkdirSync(join(file, ".."), { recursive: true });
        writeFileSync(file, content);
    }

    // settings.json / keybindings.json активного профиля.
    if (options.settings !== undefined || options.keybindings !== undefined) {
        const profileDir = userProfileDir(userDataDir);
        mkdirSync(profileDir, { recursive: true });
        if (options.settings !== undefined) {
            const body = typeof options.settings === "string" ? options.settings : JSON.stringify(options.settings, null, 2);
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

    // Что открыть: относительное — от воркспейса, абсолютное — как есть; иначе сам
    // каталог воркспейса (становится workspaceFolder).
    const opens =
        options.open !== undefined && options.open.length > 0
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
 * Изолированное env: HOME/XDG внутрь корня. Терминальную идентичность
 * ($TERM, маркеры kitty/tmux/ssh) здесь не трогаем — её пинует к
 * детерминированному baseline сам спаун сессии
 * ({@link import("./hermeticEnv.ts").hermeticSpawnEnv}), последним шагом мержа.
 */
function buildEnv(home: string, isolateHome: boolean, extra?: Readonly<Record<string, string>>): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    if (isolateHome) Object.assign(env, homeIsolationEnv(home));
    Object.assign(env, extra ?? {});
    return env;
}

/**
 * Переменные, перенаправляющие HOME/XDG внутрь `home`. Ловят пути мимо
 * `--user-data-dir`: корзину (`trashService`), кеш self-extract, шелл-конфиги.
 * Экспортируется для сьютов со своей проводкой запуска (editorconfig-stock).
 */
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
 * Устанавливает `.vsix` в user-data-dir через реальный CLI (`--install-extension`).
 * Реджектит на ненулевом коде, чтобы битая фикстура роняла сессию, а не давала
 * молча незаряженное расширение.
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
 * Удаляет временный каталог, переживая Windows.
 *
 * `dispose()` завершает процесс редактора, но Windows отдаёт хендлы не мгновенно
 * — и `rmSync` падает с `EPERM`. `maxRetries`/`retryDelay` — штатный ответ Node
 * ровно на этот класс ошибок. Если и после ретраев не вышло — не падаем: это
 * `tmpdir()`, его подчистит система.
 */
export function removeTempDir(dir: string): void {
    try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
        // best-effort: временный каталог не стоит упавшего теста
    }
}

// ── Headless transport (inspector) ───────────────────────────────────────────

/** Изолированная headless-сессия: инспектор + разложенное окружение + уборка. */
export interface HeadlessApp {
    readonly session: HeadlessSession;
    readonly env: AppEnv;
    dispose(): Promise<void>;
}

/**
 * Запускает бинарь headless в изолированном окружении и отдаёт инспектор-сессию.
 * `dispose()` гасит процесс и убирает корень (если не `keepRoot`).
 */
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
            env.dispose();
        },
    };
}

// ── PTY transport (ANSI screen) ──────────────────────────────────────────────

/** Изолированная PTY-сессия: настоящий терминал + окружение + уборка. */
export interface PtyApp {
    readonly session: VexxSession;
    readonly env: AppEnv;
    dispose(): Promise<void>;
}

export interface PtyAppOptions extends AppEnvOptions {
    /** Поднять инспектор рядом с PTY (ассерты по дереву без ANSI-парсинга). */
    inspect?: boolean;
    /** Нестандартный бинарь (self-extract-сборка). */
    binary?: string;
}

/**
 * Запускает бинарь через настоящий PTY (`node-pty`) в изолированном окружении.
 * Для сьютов, которые проверяют ANSI-вывод; инспектор — опционально (`inspect`).
 */
export async function startPtyApp(options: PtyAppOptions = {}): Promise<PtyApp> {
    const env = await prepareAppEnv(options);
    const session = await VexxSession.start({
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
            env.dispose();
        },
    };
}
