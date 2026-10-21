import { DEFAULT_REGISTRY_URL } from "../../extensionManagement/node/createRegistrySource.ts";
import { LogLevel, parseLogLevel } from "../../log/common/logLevel.ts";

export interface ICliArgs {
    readonly positional: readonly string[];
    readonly userDataDir: string | undefined;
    /** The workspace gets bound to it; an unknown name creates an empty profile (`resolveActiveProfile`). */
    readonly profile: string | undefined;
    readonly inspectTui: { host: string; port: number } | undefined;
    /** Requires `--inspect-tui`: otherwise the session cannot be driven and no frame can be captured. */
    readonly headless: { cols: number; rows: number } | undefined;
    readonly help: boolean;
    readonly version: boolean;
    /** A `.vsix` path (by suffix) or a `publisher.name` id from the registry. */
    readonly installExtension: string | undefined;
    /** A directory or an http(s) URL; affects both `--install-extension <id>` and the Extensions viewlet. */
    readonly registry: string | undefined;
    readonly uninstallExtension: string | undefined;
    readonly listExtensions: boolean;
    readonly extensionsDir: string | undefined;
    /** A **mode**, not a value (as in VS Code): positionals are read as `file[:line[:column]]`. */
    readonly goto: boolean;
    /** Also a mode: two positionals, original and modified. */
    readonly diff: boolean;
    /**
     * Disables **only** user extensions, like upstream (`_isDisabledInEnv`):
     * otherwise grammars and language-configuration would go away along with built-ins.
     */
    readonly disableExtensions: boolean;
    /** `--log` and `--verbose` in order of appearance. */
    readonly logLevels: readonly ILogLevelRule[];
}

export interface ILogLevelRule {
    /** `"*"` means all channels. */
    readonly channel: string;
    readonly level: LogLevel;
}

export const DEFAULT_INSPECT_TUI = "127.0.0.1:9223";

export const DEFAULT_HEADLESS_SIZE = { cols: 120, rows: 32 } as const;

export const USAGE = `Usage: diode [options] [<file-or-dir> ...]

Без аргументов поднимается пустое окно: папка не открывается, текущий каталог
не сканируется, вкладки прошлой сессии не восстанавливаются. Папку можно
открыть из редактора командой Open Folder.

Options:
  -g, --goto               Читать позиционные как file:line[:column] и ставить
                           каретку в указанную позицию
  -d, --diff <a> <b>       Открыть дифф-вкладку для двух файлов
  --user-data-dir <path>   Альтернативный каталог user data (default: ~/.diode)
  --extensions-dir <path>  Каталог внешних расширений
                           (default: <user-data-dir>/extensions)
  --profile <name>         Имя профиля (default: "default")
  --disable-extensions     Не грузить пользовательские расширения (встроенные
                           остаются — с ними грамматики и настройки языков)
  --log <level>            Уровень логирования: off|trace|debug|info|warn|error.
  --log <channel>:<level>  Тот же флаг для одного канала (например
                           extensions.host:debug). Повторяемый
  --verbose                То же, что --log trace
  --inspect-tui[=host:port] Поднять TUIDom-инспектор (default: ${DEFAULT_INSPECT_TUI})
  --headless[=<cols>x<rows>] Запуск без терминала: рендер в память, управление
                           через инспектор (требует --inspect-tui; default: ${DEFAULT_HEADLESS_SIZE.cols}x${DEFAULT_HEADLESS_SIZE.rows})
  --install-extension <path.vsix | id>  Установить расширение и выйти. Аргумент с
                           суффиксом .vsix — путь к файлу, иначе id publisher.name
                           из реестра
  --registry <path|url>    Реестр расширений для установки по id и для вьюлета
                           Extensions: каталог или http(s)-адрес
                           (default: ${DEFAULT_REGISTRY_URL})
  --uninstall-extension <publisher.name>  Удалить расширение (все версии) и выйти
  --list-extensions        Показать установленные расширения и выйти
  -h, --help               Показать эту справку
  -v, --version            Показать версию

Флаги управления расширениями выполняются до запуска TUI; при нескольких
одновременно применяется первый по приоритету install → uninstall → list.
`;

export class CliArgsError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = "CliArgsError";
    }
}

interface IFlagSpec {
    readonly key: "userDataDir" | "extensionsDir" | "profile" | "installExtension" | "uninstallExtension" | "registry";
}

const FLAG_SPECS: Readonly<Record<string, IFlagSpec | undefined>> = {
    "--user-data-dir": { key: "userDataDir" },
    "--extensions-dir": { key: "extensionsDir" },
    "--profile": { key: "profile" },
    "--install-extension": { key: "installExtension" },
    "--uninstall-extension": { key: "uninstallExtension" },
    "--registry": { key: "registry" },
};

/** Port 0 is ephemeral. */
function parseInspectTui(raw: string): { host: string; port: number } {
    const idx = raw.lastIndexOf(":");
    if (idx === -1) {
        throw new CliArgsError(`--inspect-tui expects host:port, got: ${raw}`);
    }
    const host = raw.slice(0, idx);
    const portStr = raw.slice(idx + 1);
    if (host.length === 0) {
        throw new CliArgsError(`--inspect-tui requires a non-empty host: ${raw}`);
    }
    const port = Number(portStr);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new CliArgsError(`--inspect-tui requires a port in 0..65535: ${raw}`);
    }
    return { host, port };
}

function parseHeadlessSize(raw: string): { cols: number; rows: number } {
    const match = /^(\d+)x(\d+)$/iu.exec(raw);
    if (match === null) {
        throw new CliArgsError(`--headless expects <cols>x<rows>, got: ${raw}`);
    }
    const cols = Number(match[1]);
    const rows = Number(match[2]);
    if (cols <= 0 || rows <= 0) {
        throw new CliArgsError(`--headless requires positive dimensions: ${raw}`);
    }
    return { cols, rows };
}

/**
 * The channel is split at the LAST colon: a channel name may contain one. An unknown
 * level is an error: a silently swallowed `--log dbug` would leave the user without logs.
 */
function parseLogRule(raw: string): ILogLevelRule {
    const idx = raw.lastIndexOf(":");
    const channel = idx === -1 ? "*" : raw.slice(0, idx);
    // Without a colon `slice(0)` returns the whole string by itself; a separate branch would be an equivalent mutant.
    const level = parseLogLevel(raw.slice(idx + 1));
    if (level === undefined) {
        throw new CliArgsError(
            `--log expects [<channel>:]<level> with level off|trace|debug|info|warn|error, got: ${raw}`,
        );
    }
    if (channel.length === 0) {
        throw new CliArgsError(`--log requires a non-empty channel: ${raw}`);
    }
    return { channel, level };
}

export function parseCliArgs(argv: readonly string[]): ICliArgs {
    const positional: string[] = [];
    const flagValues: Partial<Record<IFlagSpec["key"], string>> = {};
    let inspectTui: { host: string; port: number } | undefined;
    let headless: { cols: number; rows: number } | undefined;
    let help = false;
    let version = false;
    let listExtensions = false;
    let gotoMode = false;
    let diffMode = false;
    let disableExtensions = false;
    const logLevels: ILogLevelRule[] = [];

    let i = 0;
    while (i < argv.length) {
        const arg = argv[i];

        if (arg === "--") {
            for (let j = i + 1; j < argv.length; j++) positional.push(argv[j]);
            break;
        }

        if (arg === "-h" || arg === "--help") {
            help = true;
            i += 1;
            continue;
        }

        if (arg === "-v" || arg === "--version") {
            version = true;
            i += 1;
            continue;
        }

        if (arg === "--list-extensions") {
            listExtensions = true;
            i += 1;
            continue;
        }

        if (arg === "-g" || arg === "--goto") {
            gotoMode = true;
            i += 1;
            continue;
        }

        if (arg === "-d" || arg === "--diff") {
            diffMode = true;
            i += 1;
            continue;
        }

        if (arg === "--disable-extensions") {
            disableExtensions = true;
            i += 1;
            continue;
        }

        // Same list as `--log`: their relative order matters.
        if (arg === "--verbose") {
            logLevels.push({ channel: "*", level: LogLevel.Trace });
            i += 1;
            continue;
        }

        // Repeatable, so it does not fit FLAG_SPECS (one value per key).
        if (arg === "--log" || arg.startsWith("--log=")) {
            const eqIndex = arg.indexOf("=");
            let raw: string;
            if (eqIndex === -1) {
                if (i + 1 >= argv.length) {
                    throw new CliArgsError("Option --log requires a value");
                }
                raw = argv[i + 1];
                i += 2;
            } else {
                raw = arg.slice(eqIndex + 1);
                i += 1;
            }
            logLevels.push(parseLogRule(raw));
            continue;
        }

        if (arg === "--inspect-tui" || arg.startsWith("--inspect-tui=")) {
            const eqIndex = arg.indexOf("=");
            const raw = eqIndex === -1 ? DEFAULT_INSPECT_TUI : arg.slice(eqIndex + 1);
            inspectTui = parseInspectTui(raw);
            i += 1;
            continue;
        }

        if (arg === "--headless" || arg.startsWith("--headless=")) {
            const eqIndex = arg.indexOf("=");
            headless = eqIndex === -1 ? { ...DEFAULT_HEADLESS_SIZE } : parseHeadlessSize(arg.slice(eqIndex + 1));
            i += 1;
            continue;
        }

        if (arg.startsWith("--")) {
            const eqIndex = arg.indexOf("=");
            const name = eqIndex === -1 ? arg : arg.slice(0, eqIndex);
            const inlineValue = eqIndex === -1 ? undefined : arg.slice(eqIndex + 1);

            const spec = FLAG_SPECS[name];
            if (spec === undefined) {
                throw new CliArgsError(`Unknown option: ${name}`);
            }

            let value: string;
            if (inlineValue !== undefined) {
                value = inlineValue;
                i += 1;
            } else {
                if (i + 1 >= argv.length) {
                    throw new CliArgsError(`Option ${name} requires a value`);
                }
                value = argv[i + 1];
                i += 2;
            }

            if (value.length === 0) {
                throw new CliArgsError(`Option ${name} requires a non-empty value`);
            }

            flagValues[spec.key] = value;
            continue;
        }

        if (arg.startsWith("-") && arg.length > 1) {
            throw new CliArgsError(`Unknown option: ${arg}`);
        }

        positional.push(arg);
        i += 1;
    }

    if (headless !== undefined && inspectTui === undefined) {
        throw new CliArgsError("--headless requires --inspect-tui to drive the session");
    }

    if (diffMode && gotoMode) {
        throw new CliArgsError("--diff cannot be combined with --goto");
    }
    if (diffMode && positional.length !== 2) {
        throw new CliArgsError(`--diff expects exactly two files, got ${String(positional.length)}`);
    }

    return {
        positional,
        userDataDir: flagValues.userDataDir,
        profile: flagValues.profile,
        inspectTui,
        headless,
        help,
        version,
        installExtension: flagValues.installExtension,
        uninstallExtension: flagValues.uninstallExtension,
        registry: flagValues.registry,
        listExtensions,
        extensionsDir: flagValues.extensionsDir,
        goto: gotoMode,
        diff: diffMode,
        disableExtensions,
        logLevels,
    };
}

export interface IRelaunchOverrides {
    readonly profile: string;
    /** Replaces this window's positionals along with `--goto`/`--diff`: they described the previous workspace. */
    readonly workspace?: string | undefined;
}

/**
 * The current workspace, if the window changed it after startup: Open Folder into the same
 * profile needs no reload, and without this Reload Window would bring up
 * the startup folder from argv, and an explicit `--profile` would bind that folder to the profile.
 */
export function relaunchWorkspace(
    requested: string | undefined,
    startup: string | undefined,
    current: string | undefined,
): string | undefined {
    if (requested !== undefined) return requested;
    return current !== startup ? current : undefined;
}

const VALUE_FLAGS: ReadonlySet<string> = new Set([...Object.keys(FLAG_SPECS), "--log"]);

/**
 * The previous `--profile` is dropped: otherwise it would override the just-written
 * workspace binding. Positionals go after `--` so a path starting with `-` does not become a flag.
 */
export function relaunchArgs(args: readonly string[], overrides: IRelaunchOverrides): string[] {
    const flags: string[] = [];
    const positional: string[] = [];
    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg === "--") {
            positional.push(...args.slice(i + 1));
            break;
        }
        if (arg === "--profile") {
            i += 2;
            continue;
        }
        if (arg.startsWith("--profile=")) {
            i += 1;
            continue;
        }
        if (
            overrides.workspace !== undefined &&
            (arg === "-g" || arg === "--goto" || arg === "-d" || arg === "--diff")
        ) {
            i += 1;
            continue;
        }
        if (VALUE_FLAGS.has(arg)) {
            const value = args.at(i + 1);
            if (value !== undefined) flags.push(arg, value);
            i += 2;
            continue;
        }
        if (arg.startsWith("-") && arg.length > 1) {
            flags.push(arg);
            i += 1;
            continue;
        }
        positional.push(arg);
        i += 1;
    }
    const targets = overrides.workspace === undefined ? positional : [overrides.workspace];
    return [...flags, "--profile", overrides.profile, ...(targets.length > 0 ? ["--", ...targets] : [])];
}
