import type * as vscode from "vscode";

import { CancellationTokenNone, type ICancellationToken } from "../../../base/common/cancellation.ts";
import { Emitter } from "../../../base/common/event.ts";

import { callWithVscodeToken } from "./vscodeCancellation.ts";

/**
 * A content provider is NOT a `FileSystemProvider`: ready-made text, read-only,
 * so a scheme here does not clash with the same scheme in the FS registry (upstream also has two registries).
 */
interface IProviderEntry {
    readonly provider: vscode.TextDocumentContentProvider;
    readonly changed: vscode.Disposable | undefined;
}

/**
 * The keys (not the values) of upstream's `Schemas`: `ExtHostDocumentContentProvider` looks the scheme up in
 * `Object.keys(Schemas)`, so `vscodeRemote` is refused and `vscode-remote` is not.
 */
const RESERVED_SCHEMES: ReadonlySet<string> = new Set([
    "inMemory",
    "vscode",
    "internal",
    "walkThrough",
    "walkThroughSnippet",
    "http",
    "https",
    "file",
    "mailto",
    "untitled",
    "data",
    "command",
    "vscodeRemote",
    "vscodeRemoteResource",
    "vscodeManagedRemoteResource",
    "vscodeUserData",
    "vscodeCustomEditor",
    "vscodeNotebookCell",
    "vscodeNotebookCellMetadata",
    "vscodeNotebookCellMetadataDiff",
    "vscodeNotebookCellOutput",
    "vscodeNotebookCellOutputDiff",
    "vscodeNotebookMetadata",
    "vscodeInteractiveInput",
    "vscodeSettings",
    "vscodeWorkspaceTrust",
    "vscodeTerminal",
    "vscodeImageCarousel",
    "vscodeChatCodeBlock",
    "vscodeChatCodeCompareBlock",
    "vscodeChatEditor",
    "vscodeChatInput",
    "vscodeLocalChatSession",
    "webviewPanel",
    "vscodeWebview",
    "vscodeBrowser",
    "extension",
    "vscodeFileResource",
    "tmp",
    "vsls",
    "vscodeSourceControl",
    "commentsInput",
    "codeSetting",
    "outputChannel",
    "accessibleView",
    "chatEditingSnapshotScheme",
    "chatEditingModel",
    "copilotPr",
]);

export class SubprocessTextDocumentContentProviders {
    /** Newest first, as upstream's `registerTextModelContentProvider` (`unshift`). */
    private readonly entries = new Map<string, IProviderEntry[]>();
    private readonly onDidChangeSchemesEmitter = new Emitter<void>();
    private readonly onDidChangeEmitter = new Emitter<vscode.Uri>();

    public register(scheme: string, provider: vscode.TextDocumentContentProvider): { dispose: () => void } {
        if (RESERVED_SCHEMES.has(scheme)) {
            throw new Error(`scheme '${scheme}' already registered`);
        }
        const entry: IProviderEntry = {
            provider,
            changed: provider.onDidChange?.((uri) => {
                if (uri.scheme !== scheme) {
                    console.warn(
                        `Provider for scheme '${scheme}' is firing event for schema '${uri.scheme}' which will be IGNORED`,
                    );
                    return;
                }
                this.onDidChangeEmitter.fire(uri);
            }),
        };
        const known = this.entries.get(scheme);
        if (known === undefined) {
            this.entries.set(scheme, [entry]);
            this.fireSchemesChanged();
        } else {
            known.unshift(entry);
        }
        return {
            dispose: () => {
                const current = this.entries.get(scheme);
                if (!current?.includes(entry)) return;
                current.splice(current.indexOf(entry), 1);
                entry.changed?.dispose();
                if (current.length > 0) return;
                this.entries.delete(scheme);
                this.fireSchemesChanged();
            },
        };
    }

    public schemes(): string[] {
        return [...this.entries.keys()];
    }

    public has(scheme: string): boolean {
        return this.entries.has(scheme);
    }

    /**
     * The first provider that answers with a string wins; anything else (`undefined`, a number) is "not mine".
     * A failing provider does not hide the others (upstream's `evil provider`), but when nobody answered its
     * failure propagates: the core must show the cause rather than silently open nothing.
     */
    public async provide(uri: vscode.Uri, token: ICancellationToken = CancellationTokenNone): Promise<string | null> {
        let failure: { readonly error: unknown } | undefined;
        for (const entry of [...(this.entries.get(uri.scheme) ?? [])]) {
            try {
                const content: unknown = await callWithVscodeToken(token, (vscodeToken) =>
                    entry.provider.provideTextDocumentContent(uri, vscodeToken),
                );
                if (typeof content === "string") return content;
            } catch (error) {
                failure ??= { error };
            }
        }
        if (failure !== undefined) throw failure.error;
        return null;
    }

    public readonly onDidChangeSchemes = this.onDidChangeSchemesEmitter.event;

    public readonly onDidChange = this.onDidChangeEmitter.event;

    private fireSchemesChanged(): void {
        this.onDidChangeSchemesEmitter.fire();
    }
}
