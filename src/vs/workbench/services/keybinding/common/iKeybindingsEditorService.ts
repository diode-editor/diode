import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type {
    IKeybindingEntrySnapshot,
    KeybindingChord,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { IUserKeybindingRule } from "../../../../platform/keybinding/common/userKeybindings.ts";

/** Ошибка записи файла — результат, а не исключение: вкладка показывает её текстом и остаётся жива. */
export type IKeybindingMutationResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * Единственный владелец применения user-правил к реестру и записи keybindings.json.
 * Мутации применяются мгновенно; file-watcher'а нет — ручные правки файла доезжают после Reload Window.
 */
export interface IKeybindingsEditorService extends IDisposable {
    /** Один раз, после регистрации всех дефолтов. */
    applyUserKeybindings(rules: readonly IUserKeybindingRule[]): void;

    /**
     * С `previous` — замена записи: дефолт/расширение снимается unbind-правилом (пара
     * «`-command` + новое правило» VS Code), user-правило переписывается; без — ещё один
     * биндинг. `when` копируется резолвнутым, с вклеенным enablement, как пишет VS Code.
     */
    defineKeybinding(
        commandId: string,
        chord: KeybindingChord,
        previous?: IKeybindingEntrySnapshot,
    ): Promise<IKeybindingMutationResult>;

    /** User-правило удаляется из файла, дефолт/расширение — unbind-правилом. */
    removeKeybinding(entry: IKeybindingEntrySnapshot): Promise<IKeybindingMutationResult>;

    resetKeybinding(commandId: string): Promise<IKeybindingMutationResult>;

    /** Гейт пункта «Reset Keybinding». */
    hasUserModifications(commandId: string): boolean;

    onDidChange(cb: () => void): IDisposable;
}

export const KeybindingsEditorServiceDIToken = token<IKeybindingsEditorService>("KeybindingsEditorService");
