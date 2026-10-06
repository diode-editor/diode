import type { ICommandSnapshot } from "../platform/commands/common/commandRegistry.ts";
import type { IOutputChannelDescriptor } from "../workbench/services/output/common/output.ts";

/**
 * Методы инспектора уровня редактора — `Diode.*` поверх протокола `TUIDom.*`
 * (`@tuidom/inspector`). Движок знает только дерево, ввод и кадр; всё, что
 * агенту нужно знать о РЕДАКТОРЕ (готов ли он, что в OUTPUT, чему равен
 * контекст-ключ), — здесь, и регистрируется в ядро инспектора через его
 * публичный `register`, без правки движка. Поднимаются только по
 * `--inspect-tui` (как и сам инспектор). Клиент — `npm run drive`
 * (`tools/drive/`), рецепты — `.claude/skills/drive/SKILL.md`.
 *
 * Модуль не знает DI: сервисы приходят портами (узкие срезы настоящих
 * классов), проводка — в `main.ts`. Так методы тестируются без контейнера.
 */
export const DiodeInspectorMethod = {
    /**
     * `{timeoutMs?}` → `{ready, pid}`: старт дошёл до конца (extension host
     * активирован, фаза eventually). `pid` окна отличает новое окно после
     * `reloadWindow` (тот же порт) от старого, ещё не успевшего уйти.
     */
    whenReady: "Diode.whenReady",
    /** `{id, args?, timeoutMs?}` → `{settled, result?}`: выполнить команду по id. */
    executeCommand: "Diode.executeCommand",
    /** `{}` → `{commands}`: команды с заголовком (то, что видно в палитре). */
    listCommands: "Diode.listCommands",
    /** `{}` → `{channels}`: каналы панели Output. */
    listOutputChannels: "Diode.listOutputChannels",
    /** `{channel}` (id или подпись) → `{id, label, text}`: содержимое канала Output. */
    getOutput: "Diode.getOutput",
    /** `{key}` → `{value}`: значение контекст-ключа (`undefined` — не задан). */
    getContextKey: "Diode.getContextKey",
    /** `{expr}` → `{value}`: when-выражение над текущими контекст-ключами. */
    evaluateWhen: "Diode.evaluateWhen",
} as const;

export interface IDiodeInspectorPorts {
    readonly commands: {
        has(id: string): boolean;
        execute(id: string, ...args: unknown[]): unknown;
        listCommands(): ICommandSnapshot[];
    };
    readonly output: {
        getChannels(): readonly IOutputChannelDescriptor[];
        renderChannel(id: string): string;
    };
    readonly contextKeys: {
        getRaw(key: string): unknown;
        evaluate(when: string): boolean;
    };
    /** Резолвится, когда старт дошёл до конца; не отклоняется. */
    readonly ready: Promise<void>;
    /** Pid процесса окна. */
    readonly pid: number;
}

/** Регистрирующая функция ядра инспектора (`InspectorCore.register`). */
export type RegisterInspectorMethod = (method: string, handler: (params: unknown) => unknown) => void;

/** Сколько ждать завершения команды, вернувшей промис (команды бывают «до закрытия диалога»). */
export const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
/** Сколько ждать готовности по умолчанию. */
export const DEFAULT_READY_TIMEOUT_MS = 60_000;

export function registerDiodeInspectorMethods(register: RegisterInspectorMethod, ports: IDiodeInspectorPorts): void {
    register(DiodeInspectorMethod.whenReady, async (params) => {
        const timeoutMs = optionalNumber(params, "timeoutMs") ?? DEFAULT_READY_TIMEOUT_MS;
        const ready = await settleWithin(ports.ready, timeoutMs);
        return { ready: ready.settled, pid: ports.pid };
    });

    register(DiodeInspectorMethod.executeCommand, async (params) => {
        const id = requiredString(params, "id");
        const args = optionalArray(params, "args") ?? [];
        const timeoutMs = optionalNumber(params, "timeoutMs") ?? DEFAULT_COMMAND_TIMEOUT_MS;
        if (!ports.commands.has(id)) throw new Error(`unknown command: ${id}`);
        // Промис команды не ждём дольше таймаута: quick pick и диалоги
        // резолвятся только по ответу пользователя, а ответить он может лишь
        // следующим вызовом — то есть после нашего ответа.
        const outcome = await settleWithin(Promise.resolve(ports.commands.execute(id, ...args)), timeoutMs);
        return outcome.settled ? { settled: true, result: toWire(outcome.value) } : { settled: false };
    });

    register(DiodeInspectorMethod.listCommands, () => ({ commands: ports.commands.listCommands() }));

    register(DiodeInspectorMethod.listOutputChannels, () => ({
        channels: ports.output.getChannels().map(({ id, label }) => ({ id, label })),
    }));

    register(DiodeInspectorMethod.getOutput, (params) => {
        const wanted = requiredString(params, "channel");
        const channels = ports.output.getChannels();
        const lower = wanted.toLowerCase();
        const channel = channels.find((c) => c.id === wanted) ?? channels.find((c) => c.label.toLowerCase() === lower);
        if (channel === undefined) {
            const known = channels.map((c) => `${c.id} (${c.label})`).join(", ");
            throw new Error(`unknown output channel: ${wanted}; known: ${known}`);
        }
        return { id: channel.id, label: channel.label, text: ports.output.renderChannel(channel.id) };
    });

    register(DiodeInspectorMethod.getContextKey, (params) => ({
        value: toWire(ports.contextKeys.getRaw(requiredString(params, "key"))),
    }));

    register(DiodeInspectorMethod.evaluateWhen, (params) => ({
        value: ports.contextKeys.evaluate(requiredString(params, "expr")),
    }));
}

type Settled<T> = { settled: true; value: T } | { settled: false };

/**
 * Исход промиса, если он уложился в `timeoutMs`. Отказ пробрасывается — это
 * ответ-ошибка протокола, а не «не успел».
 */
async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<Settled<T>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<Settled<T>>((resolve) => {
        timer = setTimeout(() => {
            resolve({ settled: false });
        }, timeoutMs);
    });
    try {
        return await Promise.race([promise.then((value): Settled<T> => ({ settled: true, value })), timeout]);
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Значение, пригодное для JSON-ответа. Сервер инспектора сериализует ответ
 * `JSON.stringify` — объект с циклом (модель, редактор) уронил бы отправку, а
 * `undefined` молча пропал бы из ответа. Несериализуемое отдаём строкой.
 */
export function toWire(value: unknown): unknown {
    if (value === undefined) return null;
    try {
        return JSON.parse(JSON.stringify(value)) as unknown;
    } catch {
        // Цикл (объект модели) или BigInt: JSON их не выражает.
        return typeof value === "bigint" ? value.toString() : `<несериализуемо: ${typeof value}>`;
    }
}

function field(params: unknown, name: string): unknown {
    if (typeof params !== "object" || params === null) return undefined;
    return (params as Record<string, unknown>)[name];
}

function requiredString(params: unknown, name: string): string {
    const value = field(params, name);
    if (typeof value !== "string" || value.length === 0) throw new Error(`'${name}' must be a non-empty string`);
    return value;
}

function optionalNumber(params: unknown, name: string): number | undefined {
    const value = field(params, name);
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new Error(`'${name}' must be a non-negative number`);
    }
    return value;
}

function optionalArray(params: unknown, name: string): unknown[] | undefined {
    const value = field(params, name);
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw new Error(`'${name}' must be an array`);
    return value as unknown[];
}
