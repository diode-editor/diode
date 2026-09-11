import type { IDisposable } from "@tuidom/core/common/disposable";

import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type {
    IKeybindingEntrySnapshot,
    KeybindingChord,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { IUserKeybindingRule } from "../../../../platform/keybinding/node/keybindingsService.ts";

/**
 * Исход мутации: ошибка записи файла — не исключение, а результат (приём
 * `IExtensionOperationResult`) — вкладка показывает её текстом и остаётся жива.
 */
export type IKeybindingMutationResult = { readonly ok: true } | { readonly ok: false; readonly error: string };

/**
 * Редактирование пользовательских биндингов: единственный владелец применения
 * user-правил к реестру (bootstrap и UI-мутации) и записи keybindings.json.
 *
 * Мутации применяются мгновенно (register/removeBindings) И пишутся в файл —
 * без file-watcher'а: ручные правки файла доезжают после Reload Window, как и
 * раньше. Сессионный «леджер» эффектов user-правил (что добавлено, какие
 * дефолты сняты) позволяет `resetKeybinding` вернуть дефолты без
 * откатываемого слоя в самом реестре; после Reload истина — файл.
 *
 * Контракт в common: browser-вкладка не должна импортировать node-реализацию.
 */
export interface IKeybindingsEditorService extends IDisposable {
    /**
     * Bootstrap: применяет правила keybindings.json к реестру (unbind-правила
     * `-command` снимают дефолты, остальные добавляются источником "user") и
     * заполняет леджер. Вызывается один раз, после регистрации всех дефолтов.
     */
    applyUserKeybindings(rules: readonly IUserKeybindingRule[]): void;

    /**
     * Назначает команде комбинацию. С `previous` — замена конкретной записи:
     * дефолт/расширение снимается unbind-правилом в файле (VS Code-пара
     * «`-command` + новое правило»), user-правило переписывается. Без
     * `previous` — добавление ещё одного биндинга. `when` нового правила
     * копируется из перекрываемой записи — резолвнутый when, включая вклеенный
     * enablement (как пишет VS Code).
     */
    defineKeybinding(
        commandId: string,
        chord: KeybindingChord,
        previous?: IKeybindingEntrySnapshot,
    ): Promise<IKeybindingMutationResult>;

    /** Снимает запись: user-правило удаляется из файла, дефолт/расширение — unbind-правилом. */
    removeKeybinding(entry: IKeybindingEntrySnapshot): Promise<IKeybindingMutationResult>;

    /**
     * Сбрасывает команду к дефолтам: из файла уходят все её правила (и add, и
     * `-command`), из реестра — user-записи, снятые дефолты возвращаются.
     * Порядок возвращённых дефолтов относительно других записей той же
     * комбинации может отличаться от исходного до Reload Window (re-register
     * ставит в конец) — практический эффект виден только у конфликтующих
     * дефолтов, вставку по индексу осознанно не делаем.
     */
    resetKeybinding(commandId: string): Promise<IKeybindingMutationResult>;

    /** Изменился набор действующих биндингов (любая успешная мутация). */
    onDidChange(cb: () => void): IDisposable;
}

export const KeybindingsEditorServiceDIToken = token<IKeybindingsEditorService>("KeybindingsEditorService");
