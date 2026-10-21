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

export class SubprocessTextDocumentContentProviders {
    private readonly entries = new Map<string, IProviderEntry>();
    private readonly onDidChangeSchemesEmitter = new Emitter<void>();
    private readonly onDidChangeEmitter = new Emitter<vscode.Uri>();

    public register(scheme: string, provider: vscode.TextDocumentContentProvider): { dispose: () => void } {
        if (this.entries.has(scheme)) {
            throw new Error(`A text document content provider for the scheme '${scheme}' is already registered.`);
        }
        const entry: IProviderEntry = {
            provider,
            changed: provider.onDidChange?.((uri) => {
                this.onDidChangeEmitter.fire(uri);
            }),
        };
        this.entries.set(scheme, entry);
        this.fireSchemesChanged();
        return {
            dispose: () => {
                // Identity gate: if the scheme has been re-registered meanwhile,
                // disposing the old registration must not kill the new provider.
                if (this.entries.get(scheme) !== entry) return;
                this.entries.delete(scheme);
                entry.changed?.dispose();
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

    /** Provider failures propagate: the core must show the cause rather than silently open nothing. */
    public async provide(uri: vscode.Uri, token: ICancellationToken = CancellationTokenNone): Promise<string | null> {
        const entry = this.entries.get(uri.scheme);
        if (entry === undefined) return null;
        const content = await callWithVscodeToken(token, (vscodeToken) =>
            entry.provider.provideTextDocumentContent(uri, vscodeToken),
        );
        return content ?? null;
    }

    public readonly onDidChangeSchemes = this.onDidChangeSchemesEmitter.event;

    public readonly onDidChange = this.onDidChangeEmitter.event;

    private fireSchemesChanged(): void {
        this.onDidChangeSchemesEmitter.fire();
    }
}
