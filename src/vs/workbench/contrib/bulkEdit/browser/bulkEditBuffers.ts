import { Uri } from "../../../../base/common/uri.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import type { TextFileModelService } from "../../../services/textfile/common/textFileModelService.ts";
import type { BulkEditTarget, IBulkEditBuffers } from "../common/iBulkEditBuffers.ts";

/**
 * {@link IBulkEditBuffers} поверх полосы групп редакторов: по какому ресурсу
 * bulk edit обязан идти через буфер, а не через диск, и в какой бакет истории
 * положить свой единственный шаг.
 *
 * «Открыт» — это не только вкладка: модель файла живёт в реестре
 * (`TextFileModelRegistry`), и её может держать сторона диффа, у которой
 * вкладки в таб-строке нет. Писать мимо такой модели на диск нельзя — буфер и
 * файл разъехались бы, — поэтому она честно отвечает `"read-only"`.
 */
export class BulkEditBuffers implements IBulkEditBuffers {
    private readonly editors: IEditorService;
    private readonly models: TextFileModelService;

    public constructor(editors: IEditorService, models: TextFileModelService) {
        this.editors = editors;
        this.models = models;
    }

    public get(resource: string): BulkEditTarget {
        const pane = this.paneFor(resource);
        if (pane === null) {
            // Вкладки нет — но модель ресурса может жить в реестре (сторона
            // диффа). Правку туда провести нечем, и на диск мимо неё тоже
            // нельзя: отбиваем edit целиком.
            return this.models.get(Uri.parse(resource)) === null ? null : "read-only";
        }
        if (pane.readOnly) return "read-only";
        return {
            text: () => pane.getText(),
            applyEdits: (edits, label) => pane.applyExternalEditsDetached(edits, label),
        };
    }

    public undoContext(touched: readonly string[]): string | null {
        const active = this.editors.getActiveTabEditor();
        // Активная вкладка тронута — её бакет: Ctrl+Z сработает там, где
        // пользователь вызвал действие.
        if (active !== null && touched.includes(active.uri.toString())) return active.undoContext;
        for (const resource of touched) {
            const pane = this.paneFor(resource);
            if (pane !== null) return pane.undoContext;
        }
        // Ни один тронутый ресурс не открыт (правки только по закрытым файлам,
        // файловые операции): якорим шаг на активной вкладке — действие вызвали
        // из неё. Вкладок нет вовсе — шаг уйдёт в бакет workspace-операций.
        return active?.undoContext ?? null;
    }

    /** Вкладка ресурса: активная, если это она (её view-state и есть действующая). */
    private paneFor(resource: string): TextEditorPane | null {
        const active = this.editors.getActiveTabEditor();
        if (active !== null && active.uri.toString() === resource) return active;
        return this.editors.getEditors().find((editor) => editor.uri.toString() === resource) ?? null;
    }
}
