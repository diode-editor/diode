import { Event } from "../vs/base/common/event.ts";
import type { TextEditorPane } from "../vs/workbench/browser/parts/editor/textEditorPane.ts";
import type { IEditorService } from "../vs/workbench/services/editor/common/editorService.ts";

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

/** Члены вне роли бросают с именем члена: тест падает громко, а не получает `undefined`. */
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
