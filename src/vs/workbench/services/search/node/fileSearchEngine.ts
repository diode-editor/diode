import { spawn } from "node:child_process";
import * as path from "node:path";

import { Emitter } from "../../../../base/common/event.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { GuardedChildProcess, splitLines } from "../../../../base/node/childProcessGuard.ts";
import { FileIndex } from "../common/fileIndex.ts";
import type {
    IFileIndexRequest,
    IFileIndexResult,
    IFileQueryRequest,
    IFileQueryResult,
    IFileSearchProvider,
} from "../common/fileSearch.ts";
import { MAX_INDEXED_FILES } from "../common/fileSearch.ts";
import { buildRgFilesArgs } from "../common/ripgrepArgs.ts";

import { loadRipgrepPath } from "./loadRipgrep.ts";

const NOTIFY_DEBOUNCE_MS = 50;

interface IIndexState {
    readonly index: FileIndex;
    readonly done: Promise<IFileIndexResult>;
    complete: boolean;
    limitHit: boolean;
    walker: GuardedChildProcess | null;
    notifyTimer: ReturnType<typeof setTimeout> | undefined;
}

export interface IFileSearchEngineOptions {
    /** Defaults to the bundled rg (or `DIODE_RIPGREP_PATH`), resolved on the first walk. */
    readonly ripgrepPath?: string;
    readonly capacity?: number;
}

/**
 * Upstream's `SearchService` of the extension host (`rawSearchService.ts`): `rg --files` per cache
 * key, the result cached until `clearCache`. Runs where it is constructed — in production in the
 * extension host subprocess, so a huge folder costs that process, not the editor's (#1179).
 */
export class FileSearchEngine extends Disposable implements IFileSearchProvider {
    private readonly states = new Map<string, IIndexState>();
    private readonly onDidChangeIndexEmitter = this.register(new Emitter<string>());
    public readonly onDidChangeIndex = this.onDidChangeIndexEmitter.event;
    private resolvedRgPath: string | undefined;
    private readonly capacity: number;

    public constructor(options: IFileSearchEngineOptions = {}) {
        super();
        this.resolvedRgPath = options.ripgrepPath;
        this.capacity = options.capacity ?? MAX_INDEXED_FILES;
    }

    public index(request: IFileIndexRequest): Promise<IFileIndexResult> {
        const existing = this.states.get(request.cacheKey);
        if (existing !== undefined) return existing.done;
        let finish!: (result: IFileIndexResult) => void;
        const state: IIndexState = {
            index: new FileIndex(this.capacity),
            done: new Promise((resolve) => (finish = resolve)),
            complete: false,
            limitHit: false,
            walker: null,
            notifyTimer: undefined,
        };
        this.states.set(request.cacheKey, state);
        this.walk(request, state, () => {
            if (this.states.get(request.cacheKey) !== state) {
                // Cleared mid-walk: whoever awaits gets what was there, nobody else hears of it.
                finish({ limitHit: state.limitHit });
                return;
            }
            state.complete = true;
            this.flushNotify(request.cacheKey, state);
            finish({ limitHit: state.limitHit });
        });
        return state.done;
    }

    public query(request: IFileQueryRequest): Promise<IFileQueryResult> {
        const state = this.states.get(request.cacheKey);
        if (state === undefined) return Promise.resolve({ matches: [], complete: false, limitHit: false });
        return Promise.resolve({
            matches: state.index.search(request.query, request.maxResults),
            complete: state.complete,
            limitHit: state.limitHit,
        });
    }

    public clearCache(cacheKey: string): void {
        const state = this.states.get(cacheKey);
        if (state === undefined) return;
        this.states.delete(cacheKey);
        this.stop(state);
    }

    public override dispose(): void {
        for (const state of this.states.values()) this.stop(state);
        this.states.clear();
        // Stryker disable next-line CallExpression: the emitter has nothing left to fire — every state is gone, and a walk ending later finds none
        super.dispose();
    }

    private stop(state: IIndexState): void {
        // `kill`, not the guard's `dispose`: dispose also silences `onDidEnd`, and `done` would never settle.
        state.walker?.child.kill();
        clearTimeout(state.notifyTimer);
        state.notifyTimer = undefined;
    }

    /**
     * `rg --files`, like upstream: rg honors ignore files and prunes excluded subtrees before
     * descending into them. Output is parsed as it arrives, so the index grows live.
     */
    private walk(request: IFileIndexRequest, state: IIndexState, onEnd: () => void): void {
        let child;
        try {
            child = spawn(this.rgPath(), buildRgFilesArgs(request.excludes, request.useIgnoreFiles), {
                cwd: request.folder,
            });
        } catch {
            // rg failed to load (broken build asset): the index stays empty, the host keeps running.
            onEnd();
            return;
        }
        // End on `close`: stdout may still hold lines after `exit`.
        // Stryker disable next-line StringLiteral: the label only names the process in a guard warning
        const guard = new GuardedChildProcess(child, { label: "rg", waitForStdio: true });
        state.walker = guard;

        splitLines(child.stdout, (line) => {
            if (line === "" || state.limitHit) return;
            if (!state.index.add(line.replaceAll(path.sep, "/"))) {
                // Like upstream's `isLimitHit`: the rest of the walk is waste.
                state.limitHit = true;
                child.kill();
                return;
            }
            this.scheduleNotify(request.cacheKey, state);
        });

        // The exit code is ignored: 1 means "no files", 2 means rg hit an unreadable directory but
        // listed the rest; a missing folder (spawn `error`) yields an empty index, not a failure.
        guard.onDidEnd(() => {
            onEnd();
        });
    }

    private rgPath(): string {
        this.resolvedRgPath ??= loadRipgrepPath();
        return this.resolvedRgPath;
    }

    private scheduleNotify(cacheKey: string, state: IIndexState): void {
        if (state.notifyTimer !== undefined) return;
        state.notifyTimer = setTimeout(() => {
            state.notifyTimer = undefined;
            this.onDidChangeIndexEmitter.fire(cacheKey);
        }, NOTIFY_DEBOUNCE_MS);
    }

    private flushNotify(cacheKey: string, state: IIndexState): void {
        clearTimeout(state.notifyTimer);
        state.notifyTimer = undefined;
        this.onDidChangeIndexEmitter.fire(cacheKey);
    }
}
