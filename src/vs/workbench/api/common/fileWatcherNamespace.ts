import type * as vscode from "vscode";

import { Uri } from "../../../base/common/uri.ts";

import { EventEmitter, RelativePattern } from "./vscodeTypes.ts";
import type { IWireWatcherCreate, IWireWatcherEvents } from "./wireTypes.ts";

export interface IWatcherTransport {
    create(request: IWireWatcherCreate): void;
    dispose(id: number): void;
}

export interface IResolvedGlobPattern {
    readonly base: string;
    readonly pattern: string;
}

/**
 * Строковый шаблон — «во всех папках воркспейса», а папка у нас одна. Нет
 * воркспейса — `null`: watcher валиден, но нем, как в пустом окне VS Code.
 */
export function resolveGlobPattern(
    // `unknown`, а не `vscode.GlobPattern`: сюда штатно приезжает чужой объект из
    // другого рантайма расширения — проверки ниже не декоративные.
    globPattern: unknown,
    workspaceRoot: string | undefined,
): IResolvedGlobPattern | null {
    if (typeof globPattern === "string") {
        return workspaceRoot === undefined ? null : { base: workspaceRoot, pattern: globPattern };
    }
    if (typeof globPattern !== "object" || globPattern === null) return null;
    const raw = globPattern as { baseUri?: unknown; base?: unknown; pattern?: unknown };
    if (typeof raw.pattern !== "string") return null;
    const base = baseFsPath(globPattern instanceof RelativePattern ? globPattern.baseUri : raw.baseUri, raw.base);
    return base === null ? null : { base, pattern: raw.pattern };
}

/** Строковое `base` — устаревшая форма `RelativePattern`. */
function baseFsPath(baseUri: unknown, base: unknown): string | null {
    if (baseUri instanceof Uri) return baseUri.fsPath;
    if (typeof baseUri === "object" && baseUri !== null) {
        const fsPath = (baseUri as { fsPath?: unknown }).fsPath;
        if (typeof fsPath === "string" && fsPath !== "") return fsPath;
    }
    return typeof base === "string" && base !== "" ? base : null;
}

/** Слежение ведёт ядро: субпроцессу нельзя раздавать бюджет inotify и знание про `files.watcherExclude`. */
export class SubprocessFileSystemWatchers {
    private readonly emitters = new Map<
        number,
        {
            readonly onDidCreate: EventEmitter<vscode.Uri>;
            readonly onDidChange: EventEmitter<vscode.Uri>;
            readonly onDidDelete: EventEmitter<vscode.Uri>;
        }
    >();
    private nextId = 1;

    public constructor(private readonly transport: IWatcherTransport) {}

    /** Флаги `ignore*Events` едут на хост: ненужное событие не должно пересекать границу процесса. */
    public create(
        resolved: IResolvedGlobPattern,
        ignoreCreateEvents: boolean,
        ignoreChangeEvents: boolean,
        ignoreDeleteEvents: boolean,
    ): vscode.FileSystemWatcher {
        const id = this.nextId++;
        const emitters = {
            onDidCreate: new EventEmitter<vscode.Uri>(),
            onDidChange: new EventEmitter<vscode.Uri>(),
            onDidDelete: new EventEmitter<vscode.Uri>(),
        };
        this.emitters.set(id, emitters);
        this.transport.create({
            id,
            base: resolved.base,
            pattern: resolved.pattern,
            ignoreCreateEvents,
            ignoreChangeEvents,
            ignoreDeleteEvents,
        });

        const watcher = {
            ignoreCreateEvents,
            ignoreChangeEvents,
            ignoreDeleteEvents,
            onDidCreate: emitters.onDidCreate.event,
            onDidChange: emitters.onDidChange.event,
            onDidDelete: emitters.onDidDelete.event,
            dispose: () => {
                if (!this.emitters.delete(id)) return; // повторный dispose — no-op
                emitters.onDidCreate.dispose();
                emitters.onDidChange.dispose();
                emitters.onDidDelete.dispose();
                this.transport.dispose(id);
            },
        };
        return watcher;
    }

    public createInert(
        ignoreCreateEvents: boolean,
        ignoreChangeEvents: boolean,
        ignoreDeleteEvents: boolean,
    ): vscode.FileSystemWatcher {
        const emitter = new EventEmitter<vscode.Uri>();
        return {
            ignoreCreateEvents,
            ignoreChangeEvents,
            ignoreDeleteEvents,
            onDidCreate: emitter.event,
            onDidChange: emitter.event,
            onDidDelete: emitter.event,
            dispose: () => {
                emitter.dispose();
            },
        };
    }

    public dispatch(events: IWireWatcherEvents): void {
        const emitters = this.emitters.get(events.id);
        // Гонка на закрытии: хост успел отправить пачку до `workspace.watcher.dispose`.
        if (emitters === undefined) return;
        for (const event of events.events) {
            const uri = Uri.parse(event.uri);
            if (event.type === "created") emitters.onDidCreate.fire(uri);
            else if (event.type === "changed") emitters.onDidChange.fire(uri);
            else emitters.onDidDelete.fire(uri);
        }
    }
}
