import { Event } from "../vs/base/common/event.ts";
import type { TextEditorPane } from "../vs/workbench/browser/parts/editor/textEditorPane.ts";
import type { IEditorService } from "../vs/workbench/services/editor/common/editorService.ts";

/** Члены роли «активный редактор» — всё, что нужно командам над текущим буфером. */
type ActiveEditorRole = Pick<
    IEditorService,
    | "getActivePane"
    | "getActiveTabPane"
    | "getActiveEditor"
    | "getActiveTabEditor"
    | "getActiveViewState"
    | "focusEditor"
    | "onActiveEditorChanged"
    | "onDidChangeActiveEditorSelection"
>;

/**
 * Типизированный фейк {@link IEditorService} в роли «активный редактор»: один
 * редактор (`createEditorPane` из `TextEditorPaneFactory.ts`) либо его
 * отсутствие. Тестам команд над текущим буфером не нужен целый сервис с
 * полосой групп, моделями и девятью зависимостями.
 *
 * Члены вне роли бросают с именем члена: тест, которому их не хватило, падает
 * громко, а не получает `undefined`. Набор роли проверяется типом — переименование
 * члена интерфейса ломает компиляцию фейка, а не молча его обходит.
 */
export function createTestActiveEditorService(editor: TextEditorPane | null): IEditorService {
    const role = {
        getActivePane: () => editor,
        getActiveTabPane: () => editor,
        getActiveEditor: () => editor,
        getActiveTabEditor: () => editor,
        getActiveViewState: () => editor?.viewState ?? null,
        focusEditor: () => {
            editor?.focusEditor();
        },
        onActiveEditorChanged: Event.None,
        onDidChangeActiveEditorSelection: Event.None,
    } satisfies ActiveEditorRole;
    return new Proxy(role, {
        get(target, member) {
            if (member in target) return target[member as keyof typeof target];
            // Служебные пробы рантайма (thenable-проверка, символы инспекции) — не члены роли.
            if (typeof member === "symbol" || member === "then") return undefined;
            throw new Error(`createTestActiveEditorService: «${member}» вне роли «активный редактор»`);
        },
    }) as unknown as IEditorService;
}
