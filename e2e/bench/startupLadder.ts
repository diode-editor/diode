/**
 * Лестница вех старта — белый ящик бенча открытия файла.
 *
 * Приложение под `DIODE_STARTUP_TRACE=<файл>` выгружает `performance.mark`-вехи
 * (см. `src/vs/diode/startupTrace.ts`); здесь трасса переводится в лестницу
 * «мс от спауна» для каждой вехи, чтобы стоять в отчёте рядом с чёрным ящиком
 * (таймстемпы чанков PTY). Совмещение часов — через epoch: у трассы есть
 * `timeOrigin` процесса, у бенча — epoch-момент спауна.
 */

import type { IStartupTrace } from "../../src/vs/diode/startupTrace.ts";

export type { IStartupTrace };

/** Веха лестницы: ключ отчёта, подпись и как её вывести из трассы. */
export interface Milestone {
    readonly key: string;
    readonly label: string;
}

/** Порядок — порядок строк лестницы в отчёте. */
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
    // В SEA цикл регистрации встроенных расширений идёт на микротасках и
    // успевает до кадра — поэтому он в лестнице раньше «кадра с текстом».
    { key: "extensionsRegistered", label: "встроенные расширения зарегистрированы" },
    { key: "frameWithText", label: "кадр с текстом файла" },
    { key: "frameWithHighlight", label: "кадр с подсветкой" },
    { key: "extHostActivated", label: "extension host поднят" },
    { key: "startupComplete", label: "старт завершён" },
];

/** Лестница одного прогона: веха → мс от спауна (null — вехи в трассе нет). */
export type Ladder = Readonly<Record<string, number | null>>;

interface MarkView {
    readonly name: string;
    readonly t: number;
}

function firstMark(marks: readonly MarkView[], name: string): number | null {
    for (const m of marks) if (m.name === name) return m.t;
    return null;
}

/** Первая веха `frame`, поставленная не раньше `after` (null → любая первая). */
function firstFrameAfter(marks: readonly MarkView[], after: number | null): number | null {
    if (after === null) return null;
    for (const m of marks) if (m.name === "frame" && m.t >= after) return m.t;
    return null;
}

/**
 * Переводит трассу в лестницу «мс от спауна». `spawnEpoch` — epoch-мс момента
 * спауна у бенча (`performance.timeOrigin + performance.now()` перед spawn).
 * Кадр с текстом — первый кадр после `main:files-opened`; кадр с подсветкой —
 * первый кадр после того, как и вкладки открыты, и токенайзер у редактора.
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

/** Разбирает файл трассы; невалидный или неполный JSON → null. */
export function parseTrace(json: string): IStartupTrace | null {
    try {
        const parsed = JSON.parse(json) as Partial<IStartupTrace>;
        if (typeof parsed.timeOrigin !== "number" || !Array.isArray(parsed.marks)) return null;
        return parsed as IStartupTrace;
    } catch {
        return null;
    }
}
