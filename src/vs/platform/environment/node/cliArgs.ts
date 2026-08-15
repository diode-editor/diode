/**
 * Парсер аргументов командной строки Diode. Принимает `argv` без первых
 * двух элементов (`node` и путь до скрипта) — то, что обычно получаешь
 * через `process.argv.slice(2)`.
 *
 * Поддерживаемые формы:
 *   --user-data-dir <path>          | --user-data-dir=<path>
 *   --profile <name>                | --profile=<name>
 *   --inspect-tui                   | --inspect-tui=<host:port>
 *   --help, -h
 *   --version, -v
 *   --                              | всё после трактуется как позиционные
 *   <позиционные>                   | файлы/папки для открытия
 */
export interface ICliArgs {
    /** Файлы и/или директории для открытия. */
    readonly positional: readonly string[];
    /** Значение `--user-data-dir`, если указано. */
    readonly userDataDir: string | undefined;
    /** Имя профиля из `--profile`, если указано. */
    readonly profile: string | undefined;
    /**
     * Адрес TUIDom-инспектора, если передан `--inspect-tui`. Голый флаг даёт
     * дефолт {@link DEFAULT_INSPECT_TUI}; `--inspect-tui=host:port` — заданный адрес.
     */
    readonly inspectTui: { host: string; port: number } | undefined;
    /**
     * Размер виртуального терминала для headless-режима, если передан `--headless`.
     * Голый флаг даёт {@link DEFAULT_HEADLESS_SIZE}; `--headless=<cols>x<rows>` —
     * заданный размер. Требует одновременно `--inspect-tui` (иначе сессией не
     * порулить и кадр не снять).
     */
    readonly headless: { cols: number; rows: number } | undefined;
    /** Был ли передан `--help` / `-h`. */
    readonly help: boolean;
    /** Был ли передан `--version` / `-v`. */
    readonly version: boolean;
    /** Путь к `.vsix` из `--install-extension`, если указан. */
    readonly installExtension: string | undefined;
    /** id (`publisher.name`) из `--uninstall-extension`, если указан. */
    readonly uninstallExtension: string | undefined;
    /** Был ли передан `--list-extensions`. */
    readonly listExtensions: boolean;
}

/** Адрес инспектора по умолчанию для голого `--inspect-tui`. */
export const DEFAULT_INSPECT_TUI = "127.0.0.1:9223";

/** Размер виртуального терминала по умолчанию для голого `--headless`. */
export const DEFAULT_HEADLESS_SIZE = { cols: 120, rows: 32 } as const;

export const USAGE = `Usage: diode [options] <file-or-dir> [<file-or-dir> ...]

Options:
  --user-data-dir <path>   Альтернативный каталог user data (default: ~/.diode)
  --profile <name>         Имя профиля (default: "default")
  --inspect-tui[=host:port] Поднять TUIDom-инспектор (default: ${DEFAULT_INSPECT_TUI})
  --headless[=<cols>x<rows>] Запуск без терминала: рендер в память, управление
                           через инспектор (требует --inspect-tui; default: ${DEFAULT_HEADLESS_SIZE.cols}x${DEFAULT_HEADLESS_SIZE.rows})
  --install-extension <path.vsix>   Установить расширение из .vsix и выйти
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
    /** Канонический ключ в `ICliArgs`. */
    readonly key: "userDataDir" | "profile" | "installExtension" | "uninstallExtension";
    /** Требует значение следующим аргументом или через `=`. */
    readonly value: true;
}

const FLAG_SPECS: Readonly<Record<string, IFlagSpec | undefined>> = {
    "--user-data-dir": { key: "userDataDir", value: true },
    "--profile": { key: "profile", value: true },
    "--install-extension": { key: "installExtension", value: true },
    "--uninstall-extension": { key: "uninstallExtension", value: true },
};

/**
 * Разбирает `host:port` для `--inspect-tui`. Хост обязателен и непуст; порт —
 * целое 0..65535 (0 = эфемерный). Бросает {@link CliArgsError} при неверном формате.
 */
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

/**
 * Разбирает `<cols>x<rows>` для `--headless`. Оба измерения — положительные целые.
 * Бросает {@link CliArgsError} при неверном формате.
 */
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

export function parseCliArgs(argv: readonly string[]): ICliArgs {
    const positional: string[] = [];
    let userDataDir: string | undefined;
    let profile: string | undefined;
    let inspectTui: { host: string; port: number } | undefined;
    let headless: { cols: number; rows: number } | undefined;
    let help = false;
    let version = false;
    let installExtension: string | undefined;
    let uninstallExtension: string | undefined;
    let listExtensions = false;

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

        // Опциональное значение: голый `--inspect-tui` → дефолт, иначе `=host:port`.
        if (arg === "--inspect-tui" || arg.startsWith("--inspect-tui=")) {
            const eqIndex = arg.indexOf("=");
            const raw = eqIndex === -1 ? DEFAULT_INSPECT_TUI : arg.slice(eqIndex + 1);
            inspectTui = parseInspectTui(raw);
            i += 1;
            continue;
        }

        // Опциональное значение: голый `--headless` → дефолт, иначе `=<cols>x<rows>`.
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

            if (spec.key === "userDataDir") userDataDir = value;
            else if (spec.key === "profile") profile = value;
            else if (spec.key === "installExtension") installExtension = value;
            else uninstallExtension = value;
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

    return {
        positional,
        userDataDir,
        profile,
        inspectTui,
        headless,
        help,
        version,
        installExtension,
        uninstallExtension,
        listExtensions,
    };
}
