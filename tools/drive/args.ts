/**
 * Разбор командной строки `npm run drive -- <команда> [аргументы] [флаги]`.
 * Флаги в любом месте: `--name value`, `--name=value`, булевы `--name`;
 * `-s NAME` — короткая форма `--session`. Всё после `--` — позиционное как
 * есть (текст, начинающийся с `-`). Какие флаги булевы, а какие берут
 * значение, знает таблица ниже: неизвестный флаг — ошибка, а не тихий
 * позиционный аргумент.
 */

/** Флаги со значением; повторяемые копятся массивом. */
const VALUE_FLAGS = new Set([
    "session",
    "timeout",
    "size",
    "open",
    "file",
    "seed",
    "settings",
    "keybindings",
    "install",
    "arg",
    "node",
    "text",
    "depth",
    "tail",
    "count",
    "channel",
    "button",
    "binary-path",
]);

const BOOLEAN_FLAGS = new Set([
    "json",
    "all",
    "keep",
    "kept",
    "binary",
    "from-source",
    "no-wait-ready",
    "no-build",
    "numbered",
    "state",
    "list",
    "no-await",
    "ctrl",
    "shift",
    "alt",
    "right",
    "double",
    "help",
]);

export interface ParsedArgs {
    readonly command: string | undefined;
    readonly positionals: string[];
    readonly flags: ReadonlyMap<string, string[]>;
    readonly booleans: ReadonlySet<string>;
}

export class UsageError extends Error {}

export function parseArgs(argv: readonly string[]): ParsedArgs {
    const positionals: string[] = [];
    const flags = new Map<string, string[]>();
    const booleans = new Set<string>();
    let rest = false;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (rest || !arg.startsWith("-") || arg === "-") {
            positionals.push(arg);
            continue;
        }
        if (arg === "--") {
            rest = true;
            continue;
        }
        let name: string;
        let inline: string | undefined;
        if (arg === "-s") {
            name = "session";
        } else if (arg.startsWith("--")) {
            const eq = arg.indexOf("=");
            name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
            inline = eq === -1 ? undefined : arg.slice(eq + 1);
        } else {
            throw new UsageError(`неизвестный флаг ${arg}`);
        }
        if (BOOLEAN_FLAGS.has(name)) {
            if (inline !== undefined) throw new UsageError(`флаг --${name} не принимает значения`);
            booleans.add(name);
            continue;
        }
        if (!VALUE_FLAGS.has(name)) throw new UsageError(`неизвестный флаг --${name}`);
        let value = inline;
        if (value === undefined) {
            i++;
            if (i >= argv.length) throw new UsageError(`флагу --${name} нужно значение`);
            value = argv[i];
        }
        const list = flags.get(name) ?? [];
        list.push(value);
        flags.set(name, list);
    }
    const [command, ...others] = positionals;
    return { command, positionals: others, flags, booleans };
}

/** Последнее значение флага (повтор переопределяет). */
export function flag(args: ParsedArgs, name: string): string | undefined {
    return args.flags.get(name)?.at(-1);
}

export function flagAll(args: ParsedArgs, name: string): string[] {
    return [...(args.flags.get(name) ?? [])];
}

export function intFlag(args: ParsedArgs, name: string): number | undefined {
    const raw = flag(args, name);
    if (raw === undefined) return undefined;
    return parseNonNegativeInt(raw, `--${name}`);
}

export function parseNonNegativeInt(raw: string, what: string): number {
    if (!/^\d+$/.test(raw))
        throw new UsageError(`${what}: ожидалось неотрицательное целое, получено ${JSON.stringify(raw)}`);
    return Number(raw);
}

/** `140x38` → размер. */
export function parseSize(raw: string): { cols: number; rows: number } {
    const match = /^(\d+)x(\d+)$/.exec(raw);
    if (match === null) throw new UsageError(`размер ожидается как <cols>x<rows>, получено ${JSON.stringify(raw)}`);
    const cols = Number(match[1]);
    const rows = Number(match[2]);
    if (cols === 0 || rows === 0) throw new UsageError(`размер должен быть положительным: ${raw}`);
    return { cols, rows };
}

/** `--file rel/path=содержимое` → пара; `\n` в содержимом — перевод строки. */
export function parseFileSpec(raw: string): [string, string] {
    const eq = raw.indexOf("=");
    if (eq <= 0) throw new UsageError(`--file ожидается как <путь>=<содержимое>, получено ${JSON.stringify(raw)}`);
    return [raw.slice(0, eq), raw.slice(eq + 1).replace(/\\n/g, "\n")];
}
