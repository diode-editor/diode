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

import { DEFAULT_REGISTRY_URL } from "../../extensionManagement/node/createRegistrySource.ts";
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
    /**
     * Аргумент `--install-extension`, если указан: путь к `.vsix` (по суффиксу)
     * либо id `publisher.name` из реестра.
     */
    readonly installExtension: string | undefined;
    /**
     * Источник реестра расширений из `--registry` — каталог в публикуемом формате
     * registry-репозитория либо его http(s)-адрес. Влияет на `--install-extension <id>`;
     * не задан — публичный реестр (`DEFAULT_REGISTRY_URL`).
     */
    readonly registry: string | undefined;
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
  --install-extension <path.vsix | id>  Установить расширение и выйти. Аргумент с
                           суффиксом .vsix — путь к файлу, иначе id publisher.name
                           из реестра
  --registry <path|url>    Реестр расширений для установки по id: каталог или
                           http(s)-адрес (default: ${DEFAULT_REGISTRY_URL})
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
    readonly key: "userDataDir" | "profile" | "installExtension" | "uninstallExtension" | "registry";
}

/**
 * Флаги со значением: каждый требует его следующим аргументом или через `=`.
 * Флаги-переключатели (`--help`, `--list-extensions`, …) разбираются выше по
 * телу цикла и в таблицу не попадают.
 */
const FLAG_SPECS: Readonly<Record<string, IFlagSpec | undefined>> = {
    "--user-data-dir": { key: "userDataDir" },
    "--profile": { key: "profile" },
    "--install-extension": { key: "installExtension" },
    "--uninstall-extension": { key: "uninstallExtension" },
    "--registry": { key: "registry" },
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
    // Значения флагов из FLAG_SPECS — по их каноническому ключу; ветвление по
    // ключу не нужно, спек сам говорит, куда класть.
    const flagValues: Partial<Record<IFlagSpec["key"], string>> = {};
    let inspectTui: { host: string; port: number } | undefined;
    let headless: { cols: number; rows: number } | undefined;
    let help = false;
    let version = false;
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
    };
}
