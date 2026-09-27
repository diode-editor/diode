/**
 * Парсер аргументов командной строки Diode. Принимает `argv` без первых
 * двух элементов (`node` и путь до скрипта) — то, что обычно получаешь
 * через `process.argv.slice(2)`.
 *
 * Поддерживаемые формы:
 *   --user-data-dir <path>          | --user-data-dir=<path>
 *   --extensions-dir <path>         | --extensions-dir=<path>
 *   --profile <name>                | --profile=<name>
 *   --inspect-tui                   | --inspect-tui=<host:port>
 *   --log <level>                   | --log <channel>:<level>  (повторяемый)
 *   --verbose                       | ≡ --log trace
 *   --goto, -g                      | позиционные читаются как file:line:col
 *   --diff, -d                      | ровно два позиционных — стороны диффа
 *   --disable-extensions            | не грузить пользовательские расширения
 *   --help, -h
 *   --version, -v
 *   --                              | всё после трактуется как позиционные
 *   <позиционные>                   | файлы/папки для открытия; **необязательны** —
 *                                   | без них поднимается пустое окно
 */

import { DEFAULT_REGISTRY_URL } from "../../extensionManagement/node/createRegistrySource.ts";
import { LogLevel, parseLogLevel } from "../../log/common/logLevel.ts";

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
     * registry-репозитория либо его http(s)-адрес. Влияет и на
     * `--install-extension <id>`, и на магазин в UI (вьюлет Extensions);
     * не задан — публичный реестр (`DEFAULT_REGISTRY_URL`).
     */
    readonly registry: string | undefined;
    /** id (`publisher.name`) из `--uninstall-extension`, если указан. */
    readonly uninstallExtension: string | undefined;
    /** Был ли передан `--list-extensions`. */
    readonly listExtensions: boolean;
    /**
     * Каталог внешних расширений из `--extensions-dir`. Не задан — дефолт
     * `<user-data-dir>/extensions`. Отвязывает расширения от `--user-data-dir`,
     * как одноимённый флаг VS Code.
     */
    readonly extensionsDir: string | undefined;
    /**
     * Был ли передан `-g` / `--goto`. Это **режим**, а не значение (как в
     * VS Code): позиционные начинают читаться как `file[:line[:column]]`.
     */
    readonly goto: boolean;
    /**
     * Был ли передан `-d` / `--diff`. Тоже режим: два позиционных — стороны
     * дифф-вкладки (original, modified).
     */
    readonly diff: boolean;
    /**
     * Был ли передан `--disable-extensions`. Гасит **только** пользовательские
     * расширения; встроенные продолжают работать — дословная семантика эталона
     * (`_isDisabledInEnv`: `!extension.isBuiltin`), иначе вместе с расширениями
     * уехали бы грамматики и language-configuration.
     */
    readonly disableExtensions: boolean;
    /**
     * Правила уровней логирования из `--log` (повторяемый) и `--verbose`,
     * в порядке появления. Применяются через `LogService.setLevel`.
     */
    readonly logLevels: readonly ILogLevelRule[];
}

/** Одно правило `--log`: уровень для канала (`channel: "*"` — для всех). */
export interface ILogLevelRule {
    /** Канал или вайлдкард `"*"` — то, что понимает `LogService.setLevel`. */
    readonly channel: string;
    readonly level: LogLevel;
}

/** Адрес инспектора по умолчанию для голого `--inspect-tui`. */
export const DEFAULT_INSPECT_TUI = "127.0.0.1:9223";

/** Размер виртуального терминала по умолчанию для голого `--headless`. */
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
    /** Канонический ключ в `ICliArgs`. */
    readonly key: "userDataDir" | "extensionsDir" | "profile" | "installExtension" | "uninstallExtension" | "registry";
}

/**
 * Флаги со значением: каждый требует его следующим аргументом или через `=`.
 * Флаги-переключатели (`--help`, `--list-extensions`, …) разбираются выше по
 * телу цикла и в таблицу не попадают.
 */
const FLAG_SPECS: Readonly<Record<string, IFlagSpec | undefined>> = {
    "--user-data-dir": { key: "userDataDir" },
    "--extensions-dir": { key: "extensionsDir" },
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

/**
 * Разбирает одну запись `--log`: либо голый уровень (`debug` — для всех
 * каналов), либо `<channel>:<level>` (`extensions.host:debug`). Канал режем по
 * ПОСЛЕДНЕМУ двоеточию: имена каналов у нас точечные (`extensions.host.rpc`),
 * но двоеточие в них не запрещено. Бросает {@link CliArgsError} на неизвестном
 * уровне — молча проглоченный `--log dbug` оставил бы человека без логов.
 */
function parseLogRule(raw: string): ILogLevelRule {
    const idx = raw.lastIndexOf(":");
    const channel = idx === -1 ? "*" : raw.slice(0, idx);
    const levelPart = idx === -1 ? raw : raw.slice(idx + 1);
    const level = parseLogLevel(levelPart);
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
    // Значения флагов из FLAG_SPECS — по их каноническому ключу; ветвление по
    // ключу не нужно, спек сам говорит, куда класть.
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

        // `--verbose` — не отдельный канал настройки, а алиас самого низкого
        // уровня: кладём в тот же список, чтобы порядок с `--log` сохранялся.
        if (arg === "--verbose") {
            logLevels.push({ channel: "*", level: LogLevel.Trace });
            i += 1;
            continue;
        }

        // Повторяемый флаг со значением: в FLAG_SPECS (там одно значение на ключ)
        // он не помещается, поэтому разбирается здесь.
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

    // Режимы позиционных исключают друг друга: у `--diff` они значат «стороны»,
    // у `--goto` — «файл с позицией», и совместить это не во что.
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
