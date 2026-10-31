import type * as vscode from "vscode";

import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import { Uri } from "../../../base/common/uri.ts";

import type { SubprocessRpc } from "./extHostProtocol.ts";
import { serializeWorkspaceEdit } from "./extHostTypeConverters.ts";
import { DisposableImpl, EventEmitter, WorkspaceEdit } from "./vscodeTypes.ts";
import type { IWireFileOperationPair, IWireWorkspaceEditOp } from "./wireTypes.ts";

type WillListener<E> = (e: E) => unknown;

/** Upstream `ExtHostFileSystemEventService`, the file operations half. */
export class ExtHostFileOperations {
    private readonly onDidCreateEmitter = new EventEmitter<vscode.FileCreateEvent>();
    private readonly onDidDeleteEmitter = new EventEmitter<vscode.FileDeleteEvent>();
    private readonly onDidRenameEmitter = new EventEmitter<vscode.FileRenameEvent>();

    private readonly willCreate: WillListener<vscode.FileWillCreateEvent>[] = [];
    private readonly willDelete: WillListener<vscode.FileWillDeleteEvent>[] = [];
    private readonly willRename: WillListener<vscode.FileWillRenameEvent>[] = [];
    private willCount = 0;

    public readonly onDidCreateFiles = this.onDidCreateEmitter.event;
    public readonly onDidDeleteFiles = this.onDidDeleteEmitter.event;
    public readonly onDidRenameFiles = this.onDidRenameEmitter.event;
    public readonly onWillCreateFiles = this.willEvent(this.willCreate);
    public readonly onWillDeleteFiles = this.willEvent(this.willDelete);
    public readonly onWillRenameFiles = this.willEvent(this.willRename);

    public constructor(private readonly rpc: SubprocessRpc) {
        rpc.handleNotification("workspace.didRunFileOperation", ({ operation, files }) => {
            if (operation === "move") {
                this.onDidRenameEmitter.fire(Object.freeze({ files: files.map(renamePair) }));
            } else if (operation === "delete") {
                this.onDidDeleteEmitter.fire(Object.freeze({ files: files.map(targetUri) }));
            } else {
                this.onDidCreateEmitter.fire(Object.freeze({ files: files.map(targetUri) }));
            }
        });
        rpc.handleRequest("workspace.willRunFileOperation", ({ operation, files }, token) => {
            if (operation === "move") return fireWill(this.willRename, { files: files.map(renamePair) }, token);
            if (operation === "delete") return fireWill(this.willDelete, { files: files.map(targetUri) }, token);
            return fireWill(this.willCreate, { files: files.map(targetUri) }, token);
        });
    }

    private willEvent<E>(listeners: WillListener<E>[]): vscode.Event<E> {
        return (listener, thisArgs, disposables) => {
            const bound: WillListener<E> = (e) => listener.call(thisArgs, e);
            listeners.push(bound);
            this.changeWillCount(1);
            const disposable = new DisposableImpl(() => {
                const index = listeners.indexOf(bound);
                if (index < 0) return;
                listeners.splice(index, 1);
                this.changeWillCount(-1);
            });
            if (disposables !== undefined) disposables.push(disposable);
            return disposable;
        };
    }

    /** Only the edge is sent. */
    private changeWillCount(delta: 1 | -1): void {
        const was = this.willCount > 0;
        this.willCount += delta;
        const is = this.willCount > 0;
        if (was !== is) this.rpc.notify("workspace.updateFileOperationSubscriptions", { will: is });
    }
}

function targetUri(pair: IWireFileOperationPair): Uri {
    return Uri.parse(pair.target);
}

function renamePair(pair: IWireFileOperationPair): { readonly oldUri: Uri; readonly newUri: Uri } {
    return { oldUri: Uri.parse(pair.source ?? pair.target), newUri: Uri.parse(pair.target) };
}

/**
 * Upstream `AsyncEmitter.fireAsync`: one listener at a time, each waited for, because the next one may look at what
 * the previous did; `waitUntil` only during the dispatch. Cancelled (the host's timeout) — no edits at all.
 */
async function fireWill<E extends IWaitUntil>(
    listeners: readonly WillListener<E>[],
    data: Omit<E, keyof IWaitUntil>,
    token: ICancellationToken,
): Promise<IWireWorkspaceEditOp[]> {
    const edits: WorkspaceEdit[] = [];
    for (const listener of [...listeners]) {
        if (token.isCancellationRequested) return [];
        const thenables: Thenable<unknown>[] = [];
        const event = Object.freeze({
            ...data,
            token,
            waitUntil: (thenable: Thenable<unknown>): void => {
                if (Object.isFrozen(thenables)) throw new Error("waitUntil can NOT be called asynchronous");
                thenables.push(
                    Promise.resolve(thenable).then((result) => {
                        if (result instanceof WorkspaceEdit) edits.push(result);
                    }),
                );
            },
        }) as unknown as E;
        try {
            listener(event);
        } catch {
            // One failing listener doesn't stop the others (as in vscode).
            continue;
        }
        Object.freeze(thenables);
        // A rejected `waitUntil` only loses its own edit.
        await Promise.allSettled(thenables);
    }
    if (token.isCancellationRequested) return [];
    return edits.flatMap((edit) => serializeWorkspaceEdit(edit) ?? []);
}

interface IWaitUntil {
    readonly token: ICancellationToken;
    waitUntil(thenable: Thenable<unknown>): void;
}
