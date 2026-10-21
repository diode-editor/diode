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
    { key: "processStart", label: "process start (timeOrigin)" },
    { key: "nodeBootstrap", label: "node ready (bootstrapComplete)" },
    { key: "mainStart", label: "bundle executed (main:start)" },
    { key: "configLoaded", label: "config loaded" },
    { key: "keybindingsLoaded", label: "keybindings loaded" },
    { key: "stateLoaded", label: "session state loaded" },
    { key: "extensionsScanned", label: "extensions scanned" },
    { key: "themesReady", label: "themes ready" },
    { key: "containerCreated", label: "DI container created" },
    { key: "workbenchMounted", label: "workbench mounted" },
    { key: "firstFrame", label: "first frame" },
    { key: "workbenchActivated", label: "workbench activated" },
    { key: "grammarsPreloaded", label: "grammars preloaded" },
    { key: "fileRead", label: "file read from disk" },
    { key: "fileDecoded", label: "file decoded" },
    { key: "documentBuilt", label: "document built" },
    { key: "tokenizerReady", label: "tokenizer attached to editor" },
    { key: "filesOpened", label: "tabs opened" },
    // In SEA the builtin extension registration loop runs on microtasks and
    // finishes before the frame, so it precedes `frameWithText` in the ladder.
    { key: "extensionsRegistered", label: "built-in extensions registered" },
    { key: "frameWithText", label: "frame with file text" },
    { key: "frameWithHighlight", label: "frame with highlighting" },
    { key: "extHostActivated", label: "extension host up" },
    { key: "startupComplete", label: "startup complete" },
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
