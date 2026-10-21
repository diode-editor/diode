import { DiffEditorPane2 } from "../../../browser/parts/editor/diffEditorPane2.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { isTextEditorPane, type TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { BaseTextEditorModel } from "../../../common/editor/textEditorModel.ts";
import type { DialogService } from "../../dialogs/browser/dialogService.ts";

import type { EditorGroup } from "./editorGroupModel.ts";

/** Все редактирующие поверхности всех групп: текстовые вкладки и стороны диффов. */
export interface IEditorCloseSurfaces {
    surfaces(): readonly TextEditorPane[];
}

/**
 * Аналог upstream `EditorGroupView.handleCloseConfirmation`. Save закрывает вкладку, только если
 * сохранились все её поверхности (untitled без пути оставляет вкладку — текст не теряется);
 * Cancel — вето, обрывающее серию.
 */
export class EditorCloseHandler {
    /** Повторный запрос на ту же вкладку присоединяется к открытому диалогу (upstream `mapEditorToPendingConfirmation`). */
    private readonly pending = new Map<IEditorPane, Promise<boolean>>();

    public constructor(
        private readonly dialogs: DialogService,
        private readonly surfaces: IEditorCloseSurfaces,
    ) {}

    /**
     * Целями держим панели, а не номера: между диалогами вкладки сдвигаются, позиция ищется заново.
     * Чистые вкладки закрываются синхронно, до первого диалога.
     */
    public async confirmAndClose(group: EditorGroup, panes: readonly IEditorPane[]): Promise<boolean> {
        for (const pane of panes) {
            if (this.needsCloseConfirm(pane) && !(await this.confirm(group, pane))) return false;
            // Цель могла уже закрыться (пока шёл диалог или параллельным запросом): позицию -1 группа пропускает.
            group.closeTab(group.getPanes().indexOf(pane));
        }
        return true;
    }

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
        // Перед вопросом вкладка становится видимой (upstream `doOpenEditor`).
        group.activateTab(group.getPanes().indexOf(pane));
        const targets = this.saveTargetsOf(pane);
        const choice = await this.dialogs.confirmSave(targets.map((target) => target.label).join(", "));
        if (choice === "cancel") return false;
        if (choice === "save") {
            // Явный Save перезаписывает файл даже при внешних изменениях — выбор человека не должен
            // пропасть. Не сохранилось (untitled без пути, ошибка записи) — вето.
            for (const target of targets) {
                if ((await target.save({ overwrite: true })) !== "saved") return false;
            }
        }
        return true;
    }

    /**
     * Текстовая вкладка: изменена и последняя у документа. Дифф: есть грязная сторона, которую больше
     * нигде не видно. Прочие панели: по `isModified`.
     */
    public needsCloseConfirm(pane: IEditorPane): boolean {
        if (pane instanceof DiffEditorPane2) return this.dirtyExclusiveDiffSides(pane).length > 0;
        // Без ветки чужая панель (Keyboard Shortcuts) упала бы в текстовую формулу с `model === undefined`
        // и дала тот же `isModified`, поэтому мутант эквивалентен. Ветка держит смысл, а не результат.
        // Stryker disable next-line ConditionalExpression: эквивалентен — см. выше
        if (!isTextEditorPane(pane)) return pane.isModified;
        return pane.isModified && this.isLastPaneForDocument(pane);
    }

    public dirtyExclusiveDiffSides(pane: DiffEditorPane2): TextEditorPane[] {
        return pane.sidePanes().filter((side) => side.isModified && this.holdersOf(side.model) <= 1);
    }

    /** Пока документ виден где-то ещё, вкладка закрывается молча: правки живут в общей модели (как в VS Code). */
    public isLastPaneForDocument(editor: TextEditorPane): boolean {
        return this.holdersOf(editor.model) <= 1;
    }

    private saveTargetsOf(pane: IEditorPane): TextEditorPane[] {
        if (pane instanceof DiffEditorPane2) return this.dirtyExclusiveDiffSides(pane);
        /* v8 ignore start -- needsCloseConfirm для не-диффа истинен только у текстовой панели: панели других видов (Keyboard Shortcuts, страница расширения) не бывают изменёнными */
        // Stryker disable next-line ConditionalExpression,ArrayDeclaration: ветка недостижима — см. v8 ignore выше
        if (!isTextEditorPane(pane)) return [];
        /* v8 ignore stop */
        return [pane];
    }

    private holdersOf(model: BaseTextEditorModel): number {
        return this.surfaces.surfaces().filter((pane) => pane.model === model).length;
    }
}
