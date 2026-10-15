import { writeFileSync } from "node:fs";
import { performance as nodePerformance } from "node:perf_hooks";

import type { Point } from "@tuidom/core/common/geometryPromitives";
import type { Grid } from "@tuidom/core/rendering/grid";
import { NodeTerminalBackend } from "@tuidom/terminal-backend/nodeTerminalBackend";

import { enablePerformanceMarks, getMarks, type IPerformanceMark, mark } from "../base/common/performance.ts";
import {
    enableInstantiationTrace,
    getInstantiationTracer,
    type IInstantiationTraceEntry,
} from "../platform/instantiation/common/instantiationTrace.ts";

/**
 * Трасса старта: белый ящик для бенча открытия файла (`e2e/bench/benchOpen.ts`,
 * план — docs/TODO/OpenPerformance.md, этап «Линейка»).
 *
 * Включается только env `DIODE_STARTUP_TRACE=<файл>`: тогда `main.ts` включает
 * метки (`base/common/performance.ts`), терминальный бэкенд ставит веху `frame`
 * после каждого кадра, ушедшего в терминал, а по завершении старта (extension
 * host поднят, фаза Eventually отработала) метки выгружаются в `<файл>` одним
 * JSON. Без env ничего из этого не происходит.
 *
 * С `DIODE_STARTUP_TRACE_INSTANTIATIONS=1` поверх трассы DI-контейнер пишет ещё
 * и созданные сервисы и контрибуции (`instantiationTrace.ts`, таблица — `npm run
 * bench:services`). Отдельным флагом, потому что запись не бесплатна (≈2 мс
 * на CI в окне DI): бенч и перф-гейт всегда идут под трассой, и их цифры она
 * сдвигала бы.
 *
 * Время в трассе — мс от `performance.timeOrigin` (старт процесса); сам
 * `timeOrigin` в epoch-мс тоже в файле, чтобы бенч совместил лестницу с
 * таймстемпами чёрного ящика (спаун ↔ timeOrigin — цена fork/exec).
 */

export const STARTUP_TRACE_ENV = "DIODE_STARTUP_TRACE";
export const STARTUP_TRACE_INSTANTIATIONS_ENV = "DIODE_STARTUP_TRACE_INSTANTIATIONS";

/** Путь файла трассы из env, либо null — трасса выключена. */
export function startupTracePath(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
    const value = env[STARTUP_TRACE_ENV];
    return value !== undefined && value.length > 0 ? value : null;
}

/**
 * Включает метки, если env просит трассу (и трассу созданий DI, если просит и
 * её); возвращает путь выгрузки либо null.
 */
export function setupStartupTrace(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
    const path = startupTracePath(env);
    if (path !== null) {
        enablePerformanceMarks();
        if (env[STARTUP_TRACE_INSTANTIATIONS_ENV] === "1") enableInstantiationTrace();
    }
    return path;
}

/**
 * Терминальный бэкенд, который после каждого кадра ставит веху `frame`
 * (detail — порядковый номер кадра). Метка идёт ПОСЛЕ записи в stdout: для TTY
 * на Linux запись синхронная, так что это момент, когда байты кадра отданы
 * ядру, — та же точка, что видит бенч на своей стороне PTY (минус доставка).
 * Кадр, не изменивший ни ячейки, бэкенд не пишет, но веха ставится всё равно —
 * бенч сопоставляет кадры по вехам вокруг них, а не по номерам.
 */
export class TracingNodeTerminalBackend extends NodeTerminalBackend {
    private frames = 0;

    public override renderFrame(grid: Grid, cursorPosition: Point | null): void {
        super.renderFrame(grid, cursorPosition);
        this.frames++;
        mark("frame", { frame: this.frames });
    }
}

export interface IStartupTrace {
    readonly pid: number;
    /** `performance.timeOrigin`, epoch-мс: старт процесса по часам стены. */
    readonly timeOrigin: number;
    /** `performance.nodeTiming` — вехи самого node (bootstrapComplete и др.), мс от timeOrigin. */
    readonly nodeTiming: Readonly<Record<string, number>>;
    readonly marks: readonly IPerformanceMark[];
    /**
     * Созданные DI-контейнером сервисы и контрибуции (пусто без
     * `DIODE_STARTUP_TRACE_INSTANTIATIONS=1`) — таблицу печатает `npm run bench:services`.
     */
    readonly instantiations: readonly IInstantiationTraceEntry[];
    /** true — старт дошёл до конца (extension host поднят); false — промежуточная выгрузка. */
    readonly complete: boolean;
}

/** Снимок трассы на текущий момент. */
export function buildStartupTrace(complete: boolean): IStartupTrace {
    const nodeTiming: Record<string, number> = {};
    for (const [key, value] of Object.entries(nodePerformance.nodeTiming.toJSON() as Record<string, unknown>)) {
        if (typeof value === "number") nodeTiming[key] = value;
    }
    return {
        pid: process.pid,
        timeOrigin: performance.timeOrigin,
        nodeTiming,
        marks: getMarks(),
        instantiations: getInstantiationTracer()?.getEntries() ?? [],
        complete,
    };
}

/** Пишет трассу в файл целиком (перезапись). Сбой записи — не повод ронять редактор. */
export function writeStartupTrace(path: string, complete: boolean): void {
    try {
        writeFileSync(path, JSON.stringify(buildStartupTrace(complete)) + "\n");
    } catch {
        // трасса — диагностика; редактор от неё не зависит
    }
}
