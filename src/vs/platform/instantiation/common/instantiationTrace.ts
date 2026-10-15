/**
 * Трасса инстанцирования: кто кого создал на старте и за сколько (аналог `Trace`
 * в `instantiationService.ts` эталона и таблицы контрибуций его «Developer:
 * Startup Performance»). Включается поверх трассы старта флагом
 * `DIODE_STARTUP_TRACE_INSTANTIATIONS=1` (`src/vs/diode/startupTrace.ts`);
 * **без включения `Container.get` её не видит**: одна проверка на промахе кэша,
 * попадание в кэш не трогается вовсе.
 *
 * Запись — одно создание: токен, когда начато (мс от `performance.timeOrigin`),
 * сколько заняло целиком (inclusive) и за вычетом вложенных созданий (self),
 * кто запросил (токен-родитель, фаза контрибуций или функция-вызыватель) и
 * фаза контрибуций, внутри которой это случилось. Таблицу по выгрузке печатает
 * `npm run bench:services`.
 */

export interface IInstantiationTraceEntry {
    /** id токена. */
    readonly id: string;
    /** мс от `performance.timeOrigin`. */
    readonly start: number;
    /** Время создания вместе с вложенными созданиями, мс. */
    readonly inclusive: number;
    /** Время создания без вложенных созданий, мс. */
    readonly self: number;
    /** Глубина в дереве созданий: 0 — запрошен не из конструктора другого сервиса. */
    readonly depth: number;
    /**
     * Кто запросил: id токена-родителя; на верхнем уровне — `contributions:<фаза>`,
     * если создание идёт из реестра контрибуций, иначе первая функция стека за
     * контейнером (`new WorkbenchComponent`, `runEditor`…).
     */
    readonly requester: string;
    /** Фаза контрибуций, внутри которой шло создание; null — вне реестра. */
    readonly phase: string | null;
    /** true — сам токен зарегистрирован контрибуцией и создан её фазой. */
    readonly contribution: boolean;
}

/** Вызыватель верхнего уровня — пока сырой стек: форматирует его V8 лениво, при выгрузке. */
type Requester = string | Error;

interface Frame {
    readonly id: string;
    readonly start: number;
    readonly depth: number;
    readonly requester: Requester;
    readonly phase: string | null;
    readonly contribution: boolean;
    children: number;
}

type RawEntry = Omit<IInstantiationTraceEntry, "requester"> & { readonly requester: Requester };

/** Кадров стека хватает дойти от контейнера до вызывателя; меньше кадров — дешевле захват. */
const CALLER_STACK_LIMIT = 8;

export class InstantiationTracer {
    private readonly entries: RawEntry[] = [];
    private readonly stack: Frame[] = [];
    private readonly phases: string[] = [];
    private pendingContribution = false;

    /** Создаёт значение `factory` под записью `id`; исключение пробрасывает, запись не оставляет. */
    public trace<T>(id: string, factory: () => T): T {
        const parent = this.stack.at(-1);
        const phase = this.phases.at(-1) ?? null;
        const contribution = this.pendingContribution;
        this.pendingContribution = false;
        const requester =
            parent !== undefined
                ? parent.id
                : contribution && phase !== null
                  ? `contributions:${phase}`
                  : captureCaller();
        const frame: Frame = {
            id,
            start: performance.now(),
            depth: this.stack.length,
            requester,
            phase,
            contribution,
            children: 0,
        };
        this.stack.push(frame);
        let ok = false;
        try {
            const value = factory();
            ok = true;
            return value;
        } finally {
            this.stack.pop();
            const inclusive = performance.now() - frame.start;
            if (parent !== undefined) parent.children += inclusive;
            if (ok) {
                this.entries.push({
                    id,
                    start: frame.start,
                    inclusive,
                    self: inclusive - frame.children,
                    depth: frame.depth,
                    requester: frame.requester,
                    phase: frame.phase,
                    contribution: frame.contribution,
                });
            }
        }
    }

    /**
     * Создание контрибуции фазой `phase` (реестр контрибуций): само создание
     * помечено флагом `contribution`, оно и всё вложенное — фазой. Уже созданная
     * контрибуция (кэш контейнера) записи не даёт.
     */
    public contribution<T>(phase: string, run: () => T): T {
        this.phases.push(phase);
        this.pendingContribution = true;
        try {
            return run();
        } finally {
            this.pendingContribution = false;
            this.phases.pop();
        }
    }

    /** Записи в порядке завершения создания; стеки вызывателей форматируются здесь. */
    public getEntries(): IInstantiationTraceEntry[] {
        return this.entries.map((entry) =>
            typeof entry.requester === "string"
                ? (entry as IInstantiationTraceEntry)
                : { ...entry, requester: callerName(entry.requester) },
        );
    }
}

/**
 * Захват стека без форматирования: строку `.stack` V8 собирает при первом
 * чтении, а оно — в {@link callerName} при выгрузке, вне замеряемого окна.
 */
function captureCaller(): Error {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = CALLER_STACK_LIMIT;
    const error = new Error();
    Error.stackTraceLimit = limit;
    return error;
}

/**
 * Первая функция стека за пределами контейнера и трассы. В бандле имена
 * классов и функций esbuild сохраняет, файл и строку отбрасываем: в SEA это
 * строка `main.cjs`, ни о чём не говорящая.
 */
function callerName(error: Error): string {
    const lines = (error.stack ?? "").split("\n").slice(1);
    for (const line of lines) {
        // `at name (file:line:col)`; безымянная функция — `at file:line:col`, её
        // пропускаем, как и кадры самого node (`processTicksAndRejections` после await).
        const match = /^\s*at (?:async )?(.+?) \((.*)\)$/.exec(line);
        if (match === null || match[2].startsWith("node:")) continue;
        const name = match[1];
        if (name === "captureCaller" || /^(?:InstantiationTracer|Container)\./.test(name)) continue;
        return name;
    }
    return "?";
}

let activeTracer: InstantiationTracer | undefined;

/** Включает трассу инстанцирования (идемпотентно) и возвращает её. */
export function enableInstantiationTrace(): InstantiationTracer {
    activeTracer ??= new InstantiationTracer();
    return activeTracer;
}

/** Активная трасса либо undefined — трасса выключена. */
export function getInstantiationTracer(): InstantiationTracer | undefined {
    return activeTracer;
}

/** Выключает трассу и сбрасывает записи — для тестов. */
export function resetInstantiationTrace(): void {
    activeTracer = undefined;
}
