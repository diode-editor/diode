import type { IDisposable } from "../../../../../../tuidom/common/disposable.ts";
import type { Uri } from "../../../../base/common/uri.ts";

import type { TextFileModel } from "./textFileModel.ts";

/**
 * Ссылка на модель из реестра. Освобождение последней ссылки диспозит модель
 * (watcher, undo-бакет — всё её штатное `dispose`). Повторный `dispose` ссылки —
 * no-op.
 */
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
 * Реестр моделей открытых файлов: один {@link TextFileModel} на ресурс, сколько
 * бы вкладок (в т.ч. в разных группах) его ни показывало — аналог
 * `ITextModelService`/reference-counting у VS Code. Владелец — `EditorService`;
 * он же поставляет фабрику (создание + обвязка + `openFile`). Безымянные и
 * синтетические буферы в реестр не попадают — они уникальны по построению.
 */
export class TextFileModelRegistry {
    private readonly entries = new Set<IModelEntry>();
    private readonly byUri = new Map<string, IModelEntry>();

    public constructor(private readonly factory: (uri: Uri) => TextFileModel) {}

    /**
     * Возвращает ссылку на модель ресурса, создавая модель фабрикой при первом
     * обращении. Каждую полученную ссылку владелец обязан освободить.
     */
    public acquire(uri: Uri): ITextFileModelReference {
        const key = uri.toString();
        let entry = this.byUri.get(key);
        if (entry === undefined) {
            const model = this.factory(uri);
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

    /** Модель ресурса, если открыта; без создания и без изменения ref-count. */
    public get(uri: Uri): TextFileModel | null {
        return this.byUri.get(uri.toString())?.model ?? null;
    }

    /** Число живых ссылок на модель ресурса (0 — не открыта). */
    public refCount(uri: Uri): number {
        return this.byUri.get(uri.toString())?.refs ?? 0;
    }

    /** Все живые модели реестра (для обхода «каждому документу по разу»). */
    public models(): readonly TextFileModel[] {
        return [...this.entries].map((entry) => entry.model);
    }

    /**
     * Перепривязывает ключ модели к её текущему uri (после `saveAs`). Если
     * целевой ключ занят другой моделью, перемещённая остаётся без ключа:
     * следующий `acquire` того же пути создаст свежую модель, а живые ссылки
     * продолжают работать и корректно освобождаются — как «оторванная» вкладка.
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
