import type * as vscode from "vscode";

import { CancellationTokenNone, type ICancellationToken } from "../../../base/common/cancellation.ts";
import { Emitter } from "../../../base/common/event.ts";

import { callWithVscodeToken } from "./vscodeCancellation.ts";

/**
 * Провайдер содержимого — НЕ `FileSystemProvider`: готовый текст и только чтение,
 * поэтому схема здесь не мешает той же схеме в реестре ФС (в эталоне тоже два реестра).
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
                // Гейт по идентичности: если схему успели перерегистрировать,
                // снятие старой регистрации не должно убивать нового провайдера.
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

    /** Сбой провайдера пробрасывается: ядру нужно показать причину, а не молча ничего не открыть. */
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
