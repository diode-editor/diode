import type * as vscode from "vscode";

import { EventEmitter } from "./vscodeTypes.ts";

/** Токен отмены-заглушка: запрос содержимого короткоживущий, отменять его некому. */
function neverCancelledToken(): vscode.CancellationToken {
    return {
        isCancellationRequested: false,
        onCancellationRequested: new EventEmitter<unknown>().event,
    } as unknown as vscode.CancellationToken;
}

/**
 * Реестр `TextDocumentContentProvider`'ов, зарегистрированных расширениями
 * субпроцесса (`workspace.registerTextDocumentContentProvider`).
 *
 * Именно этой дверью в редактор попадают исходники, которых нет на диске:
 * `jdt:`-ресурсы `redhat.java` (класс из jar, исходник из JDK, результат
 * декомпиляции), `git:`-ревизии, сгенерированные документы. Go to Definition в
 * библиотеку упирается ровно сюда.
 *
 * Живёт отдельно от `workspaceNamespace`, по образцу
 * {@link import("./fileSystemNamespace.ts").SubprocessFileSystemProviders}:
 * сам реестр — чистая логика и тестируется без RPC, а проводка событий на хост
 * остаётся у namespace'а, у которого есть `rpc`.
 *
 * Провайдер содержимого — НЕ то же самое, что `FileSystemProvider`: он отдаёт
 * готовый текст, а не байты, и только на чтение. Поэтому схема, занятая здесь,
 * не мешает той же схеме в реестре ФС — в эталоне это тоже два независимых
 * реестра.
 */
export class SubprocessTextDocumentContentProviders {
    private readonly providers = new Map<string, vscode.TextDocumentContentProvider>();
    private readonly schemeListeners = new Set<() => void>();
    private readonly changeListeners = new Set<(uri: vscode.Uri) => void>();
    private readonly changeSubscriptions = new Map<string, vscode.Disposable>();

    /** Регистрирует провайдера схемы. Занятая схема — ошибка, как в VS Code. */
    public register(scheme: string, provider: vscode.TextDocumentContentProvider): { dispose: () => void } {
        if (this.providers.has(scheme)) {
            throw new Error(`A text document content provider for the scheme '${scheme}' is already registered.`);
        }
        this.providers.set(scheme, provider);
        // `onDidChange` у провайдера опционален (см. vscode.d.ts): им он говорит
        // «содержимое этого ресурса поменялось» — пересылаем наружу, чтобы
        // открытая вкладка перечиталась.
        const changed = provider.onDidChange?.((uri) => {
            for (const cb of [...this.changeListeners]) cb(uri);
        });
        if (changed !== undefined) this.changeSubscriptions.set(scheme, changed);
        this.fireSchemesChanged();
        return {
            dispose: () => {
                // Гейт по идентичности: если схему успели перерегистрировать,
                // снятие старой регистрации не должно убивать нового провайдера.
                if (this.providers.get(scheme) !== provider) return;
                this.providers.delete(scheme);
                this.changeSubscriptions.get(scheme)?.dispose();
                this.changeSubscriptions.delete(scheme);
                this.fireSchemesChanged();
            },
        };
    }

    /** Схемы, которые субпроцесс готов обслуживать (снимок для хоста). */
    public schemes(): string[] {
        return [...this.providers.keys()];
    }

    public has(scheme: string): boolean {
        return this.providers.has(scheme);
    }

    /**
     * Содержимое ресурса от провайдера его схемы. `null` — провайдера нет либо
     * он сам отказался (`ProviderResult` разрешает `undefined`/`null`). Сбой
     * провайдера пробрасывается: ядру нужно показать человеку причину, а не
     * молчаливо ничего не открыть.
     */
    public async provide(uri: vscode.Uri): Promise<string | null> {
        const provider = this.providers.get(uri.scheme);
        if (provider === undefined) return null;
        const content = await provider.provideTextDocumentContent(uri, neverCancelledToken());
        return content ?? null;
    }

    public onDidChangeSchemes(cb: () => void): { dispose: () => void } {
        this.schemeListeners.add(cb);
        return { dispose: () => this.schemeListeners.delete(cb) };
    }

    /** Провайдер объявил, что содержимое ресурса изменилось. */
    public onDidChange(cb: (uri: vscode.Uri) => void): { dispose: () => void } {
        this.changeListeners.add(cb);
        return { dispose: () => this.changeListeners.delete(cb) };
    }

    private fireSchemesChanged(): void {
        for (const cb of [...this.schemeListeners]) cb();
    }
}
