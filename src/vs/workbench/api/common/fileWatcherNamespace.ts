import type * as vscode from "vscode";

import { Uri } from "../../../base/common/uri.ts";

import { EventEmitter, RelativePattern } from "./vscodeTypes.ts";
import type { IWireWatcherCreate, IWireWatcherEvents } from "./wireTypes.ts";

/**
 * Транспорт запросов watcher'а на хост. Отдельным интерфейсом — чтобы реестр
 * тестировался без RPC (та же причина, что у `SubprocessFileSystemProviders`).
 */
export interface IWatcherTransport {
    create(request: IWireWatcherCreate): void;
    dispose(id: number): void;
}

/** Разобранный `GlobPattern`: база (абсолютный путь каталога) + шаблон относительно неё. */
export interface IResolvedGlobPattern {
    readonly base: string;
    readonly pattern: string;
}

/**
 * Приводит `GlobPattern` к паре база+шаблон.
 *
 * Строковый шаблон в VS Code означает «во всех папках воркспейса»; папка у нас
 * одна, поэтому базой становится она. Если воркспейса нет вовсе — `null`:
 * следить не за чем, и watcher останется валидным, но немым (так же ведёт себя
 * VS Code в пустом окне).
 *
 * `RelativePattern` принимается и «чужой» — расширение могло собрать объект
 * руками или прийти из своего рантайма; нам достаточно `baseUri`/`base`+`pattern`.
 */
export function resolveGlobPattern(
    globPattern: vscode.GlobPattern,
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

/** `baseUri` (наш Uri или чужой uri-подобный) либо устаревшее строковое `base` → путь. */
function baseFsPath(baseUri: unknown, base: unknown): string | null {
    if (baseUri instanceof Uri) return baseUri.fsPath;
    if (typeof baseUri === "object" && baseUri !== null) {
        const fsPath = (baseUri as { fsPath?: unknown }).fsPath;
        if (typeof fsPath === "string" && fsPath !== "") return fsPath;
    }
    return typeof base === "string" && base !== "" ? base : null;
}

/**
 * Реестр `vscode.FileSystemWatcher`'ов субпроцесса.
 *
 * Каждый watcher — это id, живущий по обе стороны RPC: субпроцесс просит хост
 * следить за базой, хост присылает уже отфильтрованные шаблоном события
 * (`workspace.watcher.events`), реестр разводит их по эмиттерам. Само слежение
 * ведёт ядро — субпроцессу нельзя раздавать бюджет inotify и знание про
 * `files.watcherExclude`.
 */
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

    /**
     * Заводит watcher по уже разобранному шаблону. Флаги `ignore*Events` едут на
     * хост, а не фильтруются здесь: событие, которое расширению не нужно, не
     * должно даже пересекать границу процесса.
     */
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
        return watcher as unknown as vscode.FileSystemWatcher;
    }

    /** Валидный watcher, который никогда не стреляет: следить не за чем (нет воркспейса). */
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
            dispose: () => emitter.dispose(),
        } as unknown as vscode.FileSystemWatcher;
    }

    /** Разводит пачку событий хоста по эмиттерам своего watcher'а. */
    public dispatch(events: IWireWatcherEvents): void {
        const emitters = this.emitters.get(events.id);
        // Гонка на закрытии: хост успел отправить пачку до `workspace.watcher.dispose`.
        if (emitters === undefined) return;
        for (const event of events.events) {
            const uri = Uri.parse(event.uri) as unknown as vscode.Uri;
            if (event.type === "created") emitters.onDidCreate.fire(uri);
            else if (event.type === "changed") emitters.onDidChange.fire(uri);
            else emitters.onDidDelete.fire(uri);
        }
    }
}
