import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { Uri } from "../../../../base/common/uri.ts";

import type { TextFileModel } from "./textFileModel.ts";

/** Последняя ссылка диспозит модель. Повторный `dispose` ссылки — no-op. */
export interface ITextFileModelReference extends IDisposable {
    readonly model: TextFileModel;
}

interface IModelEntry {
    model: TextFileModel;
    refs: number;
    /** Текущий ключ в {@link TextFileModelRegistry.byUri}; `null` — вытеснен коллизией saveAs. */
    key: string | null;
}

/**
 * Аналог reference-counting `ITextModelService`: одна модель на ресурс, сколько бы
 * вкладок его ни показывало. Безымянные и синтетические буферы сюда не попадают.
 */
export class TextFileModelRegistry {
    private readonly entries = new Set<IModelEntry>();
    private readonly byUri = new Map<string, IModelEntry>();

    public constructor(private readonly factory: (uri: Uri) => TextFileModel) {}

    /** Своя фабрика вызова — для ресурса, чьи байты уже прочитаны. Владелец обязан освободить ссылку. */
    public acquire(uri: Uri, factory: (uri: Uri) => TextFileModel = this.factory): ITextFileModelReference {
        const key = uri.toString();
        let entry = this.byUri.get(key);
        if (entry === undefined) {
            const model = factory(uri);
            entry = { model, refs: 0, key };
            this.entries.add(entry);
            this.byUri.set(key, entry);
        }
        entry.refs++;

        let released = false;
        return {
            model: entry.model,
            dispose: () => {
                if (released) return;
                released = true;
                this.release(entry);
            },
        };
    }

    public get(uri: Uri): TextFileModel | null {
        return this.byUri.get(uri.toString())?.model ?? null;
    }

    public refCount(uri: Uri): number {
        return this.byUri.get(uri.toString())?.refs ?? 0;
    }

    public models(): readonly TextFileModel[] {
        return [...this.entries].map((entry) => entry.model);
    }

    /**
     * Если целевой ключ занят другой моделью, перемещённая остаётся без ключа: следующий
     * `acquire` создаст свежую модель, а живые ссылки освобождаются корректно.
     */
    public handleUriChanged(model: TextFileModel): void {
        const entry = [...this.entries].find((candidate) => candidate.model === model);
        if (entry === undefined) return;
        const newKey = model.uri.toString();
        if (entry.key === newKey) return;
        if (entry.key !== null) this.byUri.delete(entry.key);
        if (this.byUri.has(newKey)) {
            entry.key = null;
            return;
        }
        entry.key = newKey;
        this.byUri.set(newKey, entry);
    }

    private release(entry: IModelEntry): void {
        entry.refs--;
        if (entry.refs > 0) return;
        this.entries.delete(entry);
        if (entry.key !== null) this.byUri.delete(entry.key);
        entry.model.dispose();
    }
}
