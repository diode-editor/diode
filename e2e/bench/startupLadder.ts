/**
 * `DIODE_STARTUP_TRACE` trace → "ms since spawn" per mark. Clocks are aligned via epoch:
 * the process `timeOrigin` in the trace and the bench's epoch time of the spawn.
 */

import type { IStartupTrace } from "../../src/vs/diode/startupTrace.ts";

export type { IStartupTrace };

export interface Milestone {
    readonly key: string;
    readonly label: string;
}

/** The order is the order of ladder rows in the report. */
export const MILESTONES: readonly Milestone[] = [
    { key: "processStart", label: "старт процесса (timeOrigin)" },
    { key: "nodeBootstrap", label: "node готов (bootstrapComplete)" },
    { key: "mainStart", label: "бандл выполнен (main:start)" },
    { key: "configLoaded", label: "конфиг загружен" },
    { key: "keybindingsLoaded", label: "кейбинды загружены" },
    { key: "stateLoaded", label: "состояние сессии загружено" },
    { key: "extensionsScanned", label: "расширения просканированы" },
    { key: "themesReady", label: "темы готовы" },
    { key: "containerCreated", label: "DI-контейнер собран" },
    { key: "workbenchMounted", label: "workbench смонтирован" },
    { key: "firstFrame", label: "первый кадр" },
    { key: "workbenchActivated", label: "workbench активирован" },
    { key: "grammarsPreloaded", label: "грамматики прогреты" },
    { key: "fileRead", label: "файл прочитан с диска" },
    { key: "fileDecoded", label: "файл декодирован" },
    { key: "documentBuilt", label: "документ построен" },
    { key: "tokenizerReady", label: "токенайзер у редактора" },
    { key: "filesOpened", label: "вкладки открыты" },
    // In SEA the builtin extension registration loop runs on microtasks and
    // finishes before the frame, so it precedes `frameWithText` in the ladder.
    { key: "extensionsRegistered", label: "встроенные расширения зарегистрированы" },
    { key: "frameWithText", label: "кадр с текстом файла" },
    { key: "frameWithHighlight", label: "кадр с подсветкой" },
    { key: "extHostActivated", label: "extension host поднят" },
    { key: "startupComplete", label: "старт завершён" },
];

/** The ladder of one run: mark → ms since spawn (null if the trace lacks the mark). */
export type Ladder = Readonly<Record<string, number | null>>;

interface MarkView {
    readonly name: string;
    readonly t: number;
}

function firstMark(marks: readonly MarkView[], name: string): number | null {
    for (const m of marks) if (m.name === name) return m.t;
    return null;
}

/** The first `frame` mark set no earlier than `after` (null `after` → null). */
function firstFrameAfter(marks: readonly MarkView[], after: number | null): number | null {
    if (after === null) return null;
    for (const m of marks) if (m.name === "frame" && m.t >= after) return m.t;
    return null;
}

/**
 * `spawnEpoch` is `performance.timeOrigin + performance.now()` before spawn. The highlighted frame is
 * the first frame after both the tabs are open and the editor has its tokenizer.
 */
export function ladderFromTrace(trace: IStartupTrace, spawnEpoch: number): Ladder {
    const offset = trace.timeOrigin - spawnEpoch;
    const marks: MarkView[] = trace.marks.map((m) => ({ name: m.name, t: m.startTime + offset }));
    const shift = (value: number | null | undefined): number | null =>
        typeof value === "number" ? value + offset : null;

    const filesOpened = firstMark(marks, "main:files-opened");
    const tokenizerReady = firstMark(marks, "editor:tokenizer-ready");
    const highlightAfter =
        filesOpened === null || tokenizerReady === null ? null : Math.max(filesOpened, tokenizerReady);

    return {
        processStart: offset,
        nodeBootstrap: shift(trace.nodeTiming.bootstrapComplete),
        mainStart: firstMark(marks, "main:start"),
        configLoaded: firstMark(marks, "main:config-loaded"),
        keybindingsLoaded: firstMark(marks, "main:keybindings-loaded"),
        stateLoaded: firstMark(marks, "main:state-loaded"),
        extensionsScanned: firstMark(marks, "main:extensions-scanned"),
        themesReady: firstMark(marks, "main:themes-ready"),
        containerCreated: firstMark(marks, "main:container-created"),
        workbenchMounted: firstMark(marks, "workbench:mounted"),
        firstFrame: firstFrameAfter(marks, 0),
        workbenchActivated: firstMark(marks, "workbench:activated"),
        grammarsPreloaded: firstMark(marks, "main:grammars-preloaded"),
        fileRead: firstMark(marks, "textfile:read"),
        fileDecoded: firstMark(marks, "textfile:decoded"),
        documentBuilt: firstMark(marks, "textfile:document-built"),
        tokenizerReady,
        filesOpened,
        frameWithText: firstFrameAfter(marks, filesOpened),
        frameWithHighlight: firstFrameAfter(marks, highlightAfter),
        extensionsRegistered: firstMark(marks, "main:extensions-registered"),
        extHostActivated: firstMark(marks, "exthost:activated"),
        startupComplete: firstMark(marks, "main:startup-complete"),
    };
}

export function parseTrace(json: string): IStartupTrace | null {
    try {
        const parsed = JSON.parse(json) as Partial<IStartupTrace>;
        if (typeof parsed.timeOrigin !== "number" || !Array.isArray(parsed.marks)) return null;
        return parsed as IStartupTrace;
    } catch {
        return null;
    }
}
