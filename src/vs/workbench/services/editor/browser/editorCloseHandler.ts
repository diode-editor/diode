import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { DialogService } from "../../dialogs/browser/dialogService.ts";
import type { TextFileModel } from "../../textfile/common/textFileModel.ts";

import type { EditorGroup } from "./editorGroupModel.ts";

/**
 * Узкий срез {@link EditorService}, через который обработчик видит полосу:
 * все редактирующие поверхности — текстовые вкладки и стороны диффов всех
 * групп. По нему считается «показан ли документ где-то ещё».
 */
export interface IEditorCloseSurfaces {
    surfaces(): readonly TextEditorPane[];
}

/**
 * Закрытие вкладок с подтверждением — единственное место, где решается и «надо
 * ли спросить», и «что делать с ответом» (аналог upstream
 * `EditorGroupView.handleCloseConfirmation`). Не DI-сервис: его держит
 * `EditorService`, который один видит все группы и стороны диффов.
 *
 * Развязка диалога одна на все пути закрытия: Save закрывает вкладку, только
 * если сохранились все её несохранённые поверхности (untitled без пути —
 * `"no-file"` — оставляет вкладку открытой, текст не теряется), Don't Save
 * закрывает, Cancel — вето, обрывающее серию.
 */
export class EditorCloseHandler {
    /**
     * Идущие подтверждения по панели: повторный запрос на ту же вкладку, пока
     * её диалог открыт, присоединяется к нему, а не открывает второй (upstream
     * `mapEditorToPendingConfirmation`).
     */
    private readonly pending = new Map<IEditorPane, Promise<boolean>>();

    public constructor(
        private readonly dialogs: DialogService,
        private readonly surfaces: IEditorCloseSurfaces,
    ) {}

    /**
     * Последовательно закрывает `panes` группы в заданном порядке — он же
     * порядок диалогов, и им управляет вызывающий. Целями держим панели, а не
     * номера: между диалогами список вкладок сдвигается, поэтому позиция ищется
     * заново прямо перед закрытием. Первое вето обрывает серию; `true` — закрыты
     * все цели.
     *
     * Чистые вкладки закрываются синхронно, до первого диалога: вызывающему без
     * диалогов не нужно ждать промис, чтобы увидеть результат.
     */
    public async confirmAndClose(group: EditorGroup, panes: readonly IEditorPane[]): Promise<boolean> {
        for (const pane of panes) {
            if (this.needsCloseConfirm(pane) && !(await this.confirm(group, pane))) return false;
            // Цель могла уже закрыться (пока шёл диалог, или её закрыл
            // параллельный запрос, присоединившийся к тому же диалогу): позиция
            // -1 группа сама пропускает — закрывать нечего.
            group.closeTab(group.getPanes().indexOf(pane));
        }
        return true;
    }

    /** Диалог по одной вкладке; `true` — её можно закрывать. */
    private confirm(group: EditorGroup, pane: IEditorPane): Promise<boolean> {
        const pending = this.pending.get(pane);
        if (pending !== undefined) return pending;
        const result = this.doConfirm(group, pane).finally(() => {
            this.pending.delete(pane);
        });
        this.pending.set(pane, result);
        return result;
    }

    private async doConfirm(group: EditorGroup, pane: IEditorPane): Promise<boolean> {
        // Перед вопросом вкладка становится видимой (upstream `doOpenEditor`):
        // человек должен видеть, про что его спрашивают.
        group.activateTab(group.getPanes().indexOf(pane));
        const targets = this.saveTargetsOf(pane);
        const choice = await this.dialogs.confirmSave(targets.map((target) => target.label).join(", "));
        if (choice === "cancel") return false;
        if (choice === "save") {
            // Явный Save при закрытии перезаписывает файл даже при внешних
            // изменениях — выбор пользователя не должен пропасть. Не сохранилось
            // (untitled без пути, ошибка записи) — вето: вкладка остаётся.
            for (const target of targets) {
                if ((await target.save({ overwrite: true })) !== "saved") return false;
            }
        }
        return true;
    }

    /**
     * Нужен ли confirm-диалог перед закрытием вкладки. Текстовая вкладка:
     * изменена и последняя у документа. Дифф v2: есть сторона с несохранёнными
     * правками, которую больше нигде не видно. Прочие панели: по `isModified`.
     */
    public needsCloseConfirm(pane: IEditorPane): boolean {
        if (pane instanceof DiffEditorPane2) return this.dirtyExclusiveDiffSides(pane).length > 0;
        // Без ветки панель чужого вида (Keyboard Shortcuts, страница расширения)
        // упала бы в текстовую формулу с `model === undefined`: holders = 0,
        // «последняя поверхность» — и ответ тот же `isModified`, поэтому мутант
        // условия эквивалентен. Ветка держит смысл, а не результат.
        // Stryker disable next-line ConditionalExpression: эквивалентен — см. выше
        if (!(pane instanceof TextEditorPane)) return pane.isModified;
        return pane.isModified && this.isLastPaneForDocument(pane);
    }

    /**
     * Стороны диффа с несохранёнными правками, которые не показаны больше нигде:
     * закрытие вкладки потеряло бы их.
     */
    public dirtyExclusiveDiffSides(pane: DiffEditorPane2): TextEditorPane[] {
        return pane.sidePanes().filter((side) => side.isModified && this.holdersOf(side.model) <= 1);
    }

    /**
     * Правда, если `editor` — последняя поверхность, показывающая свой документ:
     * закрытие потеряет несохранённые правки. Пока документ виден где-то ещё — в
     * другой группе или стороной диффа, — вкладка закрывается молча: правки
     * живут в общей модели (семантика VS Code).
     */
    public isLastPaneForDocument(editor: TextEditorPane): boolean {
        return this.holdersOf(editor.model) <= 1;
    }

    /**
     * Что предлагает сохранить диалог закрытия вкладки: сама текстовая панель
     * либо dirty-стороны диффа v2, не видимые больше нигде (untitled-пара, файл
     * без вкладки). Зовётся только для вкладок, прошедших {@link needsCloseConfirm}.
     */
    private saveTargetsOf(pane: IEditorPane): TextEditorPane[] {
        if (pane instanceof DiffEditorPane2) return this.dirtyExclusiveDiffSides(pane);
        /* v8 ignore start -- needsCloseConfirm для не-диффа истинен только у текстовой панели: панели других видов (Keyboard Shortcuts, страница расширения) не бывают изменёнными */
        // Stryker disable next-line ConditionalExpression,ArrayDeclaration: ветка недостижима — см. v8 ignore выше
        if (!(pane instanceof TextEditorPane)) return [];
        /* v8 ignore stop */
        return [pane];
    }

    /** Сколько поверхностей (вкладок и дифф-сторон) показывают модель. */
    private holdersOf(model: TextFileModel): number {
        return this.surfaces.surfaces().filter((pane) => pane.model === model).length;
    }
}
