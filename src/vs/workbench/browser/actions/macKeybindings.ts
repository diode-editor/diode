import {
    combineWhen,
    type CommandAction,
    type KeybindingEntry,
} from "../../../platform/actions/common/commandAction.ts";
import {
    type KeybindingChord,
    parseChord,
    serializeChord,
} from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { macKeysAtLeast, type MacKeysRung, notMacKeys } from "../../../platform/keybinding/common/macKeys.ts";

/**
 * Мак-дельты дефолтных биндов — ручная половина мак-раскладки, одной таблицей.
 *
 * Эталон — дефолтные бинды VS Code 1.138 для Linux и macOS. Механическая половина
 * (Ctrl на Linux ↔ Cmd на маке) живёт при командах токеном `mod` (аналог
 * `KeyMod.CtrlCmd`). Сюда — всё, где 1:1 нет: pc-бинды, которых на маке у VS Code
 * нет (`pcOnly`), и мак-бинды без pc-пары (`mac`: явный `mac:`, Option-слова,
 * WinCtrl-подслой ⌃N/⌃P/⌃B/⌃F…). Таблица сверяется с эталоном целиком; слой
 * регистрации ({@link withMacKeybindings}) разворачивает её в обычные
 * per-binding записи с условием по мак-рунгу — механизм биндингов один.
 *
 * Правила (закрыты тестами `macKeybindings.test.ts`):
 *  - `from` — самый низкий рунг, где комбинация физически доезжает; выше она
 *    действует сама (наследование вверх). Ctrl-аккорд, который ниже cmd занят
 *    фоллбэком `mod` другой команды (⌃N — New File, ⌃P — Quick Open…), действует
 *    с рунга cmd, где `mod` — уже Cmd;
 *  - не `alt+<буква>`: на немецкой/французской раскладке Option+буква даёт
 *    `@ [ ] { }`, бинд съел бы ввод символа;
 *  - не `ctrl+←/→`: их забирает Mission Control;
 *  - Cmd+C/V/X не биндим: копипаст остаётся эмулятору (решение человека);
 *  - в пределах семейства условия взаимоисключающие — `pcOnly` снимает на маке
 *    pc-бинд, чья комбинация там значит другое.
 *
 * Отклонения от эталона — в docs/TODO/MacKeybindings.md: Ctrl+Y у redo остаётся
 * на маке (на mac-legacy ⇧⌘Z не доезжает), rename в проводнике — F2, а не Enter
 * (нет команды «открыть» на ⌘↓), ⌃A/⌃E — с mac-legacy, поэтому «выделить всё»
 * на маке — только ⌘A.
 */
export interface MacKeybindingDelta {
    readonly command: string;
    /** Комбинации pc-биндов команды (как объявлены при команде), которые на маке не действуют. */
    readonly pcOnly?: readonly string[];
    /** Мак-бинды: с какого рунга действуют. */
    readonly mac?: readonly { readonly keys: string; readonly from: MacKeysRung }[];
}

export const MAC_KEYBINDING_DELTAS: readonly MacKeybindingDelta[] = [
    { command: "cursorBottom", pcOnly: ["ctrl+end"], mac: [{ keys: "meta+down", from: "cmd" }] },
    { command: "cursorBottomSelect", pcOnly: ["ctrl+shift+end"], mac: [{ keys: "shift+meta+down", from: "cmd" }] },
    { command: "cursorDown", mac: [{ keys: "ctrl+n", from: "cmd" }] },
    { command: "cursorEnd", mac: [{ keys: "meta+right", from: "cmd" }] },
    { command: "cursorEndSelect", mac: [{ keys: "shift+meta+right", from: "cmd" }] },
    { command: "cursorHome", mac: [{ keys: "meta+left", from: "cmd" }] },
    { command: "cursorHomeSelect", mac: [{ keys: "shift+meta+left", from: "cmd" }] },
    { command: "cursorLeft", mac: [{ keys: "ctrl+b", from: "cmd" }] },
    { command: "cursorLineEnd", mac: [{ keys: "ctrl+e", from: "legacy" }] },
    { command: "cursorLineStart", mac: [{ keys: "ctrl+a", from: "legacy" }] },
    { command: "cursorRight", mac: [{ keys: "ctrl+f", from: "cmd" }] },
    { command: "cursorTop", pcOnly: ["ctrl+home"], mac: [{ keys: "meta+up", from: "cmd" }] },
    { command: "cursorTopSelect", pcOnly: ["ctrl+shift+home"], mac: [{ keys: "shift+meta+up", from: "cmd" }] },
    { command: "cursorUp", mac: [{ keys: "ctrl+p", from: "cmd" }] },
    { command: "cursorWordLeft", pcOnly: ["ctrl+left"], mac: [{ keys: "alt+left", from: "legacy" }] },
    { command: "cursorWordLeftSelect", pcOnly: ["ctrl+shift+left"], mac: [{ keys: "shift+alt+left", from: "legacy" }] },
    { command: "cursorWordRight", pcOnly: ["ctrl+right"], mac: [{ keys: "alt+right", from: "legacy" }] },
    {
        command: "cursorWordRightSelect",
        pcOnly: ["ctrl+shift+right"],
        mac: [{ keys: "shift+alt+right", from: "legacy" }],
    },
    { command: "deleteAllLeft", mac: [{ keys: "meta+backspace", from: "cmd" }] },
    {
        command: "deleteLeft",
        mac: [
            { keys: "ctrl+backspace", from: "extended" },
            { keys: "ctrl+h", from: "legacy" },
        ],
    },
    {
        command: "deleteRight",
        mac: [
            { keys: "ctrl+delete", from: "legacy" },
            { keys: "ctrl+d", from: "cmd" },
        ],
    },
    { command: "deleteWordLeft", pcOnly: ["ctrl+backspace"], mac: [{ keys: "alt+backspace", from: "legacy" }] },
    { command: "deleteWordRight", pcOnly: ["ctrl+delete"], mac: [{ keys: "alt+delete", from: "legacy" }] },
    {
        command: "editor.action.copyLinesDownAction",
        pcOnly: ["ctrl+shift+alt+down"],
        mac: [{ keys: "shift+alt+down", from: "legacy" }],
    },
    {
        command: "editor.action.copyLinesUpAction",
        pcOnly: ["ctrl+shift+alt+up"],
        mac: [{ keys: "shift+alt+up", from: "legacy" }],
    },
    {
        command: "editor.action.insertCursorAbove",
        pcOnly: ["shift+alt+up"],
        mac: [{ keys: "alt+meta+up", from: "cmd" }],
    },
    {
        command: "editor.action.insertCursorBelow",
        pcOnly: ["shift+alt+down"],
        mac: [{ keys: "alt+meta+down", from: "cmd" }],
    },
    { command: "editor.action.nextMatchFindAction", mac: [{ keys: "meta+g", from: "cmd" }] },
    { command: "editor.action.previousMatchFindAction", mac: [{ keys: "shift+meta+g", from: "cmd" }] },
    { command: "editor.action.selectAll", pcOnly: ["mod+a"], mac: [{ keys: "meta+a", from: "cmd" }] },
    { command: "editor.action.triggerSuggest", mac: [{ keys: "alt+escape", from: "extended" }] },
    { command: "editor.fold", pcOnly: ["ctrl+shift+["], mac: [{ keys: "alt+meta+[", from: "cmd" }] },
    { command: "editor.unfold", pcOnly: ["ctrl+shift+]"], mac: [{ keys: "alt+meta+]", from: "cmd" }] },
    { command: "fileOperations.deleteFile", mac: [{ keys: "meta+backspace", from: "cmd" }] },
    { command: "input.cursorEnd", mac: [{ keys: "meta+right", from: "cmd" }] },
    { command: "input.cursorHome", mac: [{ keys: "meta+left", from: "cmd" }] },
    { command: "input.cursorLeft", mac: [{ keys: "ctrl+b", from: "cmd" }] },
    { command: "input.cursorRight", mac: [{ keys: "ctrl+f", from: "cmd" }] },
    { command: "input.cursorWordLeft", pcOnly: ["ctrl+left"], mac: [{ keys: "alt+left", from: "legacy" }] },
    { command: "input.cursorWordRight", pcOnly: ["ctrl+right"], mac: [{ keys: "alt+right", from: "legacy" }] },
    {
        command: "input.deleteLeft",
        mac: [
            { keys: "ctrl+backspace", from: "extended" },
            { keys: "ctrl+h", from: "legacy" },
        ],
    },
    {
        command: "input.deleteRight",
        mac: [
            { keys: "ctrl+delete", from: "legacy" },
            { keys: "ctrl+d", from: "cmd" },
        ],
    },
    { command: "input.deleteWordLeft", pcOnly: ["ctrl+backspace"], mac: [{ keys: "alt+backspace", from: "legacy" }] },
    { command: "input.deleteWordRight", pcOnly: ["ctrl+delete"], mac: [{ keys: "alt+delete", from: "legacy" }] },
    { command: "input.selectToEnd", mac: [{ keys: "shift+meta+right", from: "cmd" }] },
    { command: "input.selectToHome", mac: [{ keys: "shift+meta+left", from: "cmd" }] },
    { command: "input.selectWordLeft", pcOnly: ["ctrl+shift+left"], mac: [{ keys: "shift+alt+left", from: "legacy" }] },
    {
        command: "input.selectWordRight",
        pcOnly: ["ctrl+shift+right"],
        mac: [{ keys: "shift+alt+right", from: "legacy" }],
    },
    { command: "scrollLineDown", pcOnly: ["ctrl+down"], mac: [{ keys: "ctrl+pagedown", from: "legacy" }] },
    { command: "scrollLineUp", pcOnly: ["ctrl+up"], mac: [{ keys: "ctrl+pageup", from: "legacy" }] },
    { command: "selectNextSuggestion", mac: [{ keys: "ctrl+n", from: "cmd" }] },
    { command: "selectPrevSuggestion", mac: [{ keys: "ctrl+p", from: "cmd" }] },
    { command: "showNextParameterHint", mac: [{ keys: "ctrl+n", from: "cmd" }] },
    { command: "showPrevParameterHint", mac: [{ keys: "ctrl+p", from: "cmd" }] },
    { command: "workbench.action.closeOtherEditors", mac: [{ keys: "alt+meta+t", from: "cmd" }] },
    { command: "workbench.action.files.openFolder", pcOnly: ["ctrl+k ctrl+o"] },
    {
        command: "workbench.action.moveEditorToNextGroup",
        pcOnly: ["ctrl+alt+right"],
        mac: [{ keys: "ctrl+meta+right", from: "cmd" }],
    },
    {
        command: "workbench.action.moveEditorToPreviousGroup",
        pcOnly: ["ctrl+alt+left"],
        mac: [{ keys: "ctrl+meta+left", from: "cmd" }],
    },
    { command: "workbench.action.navigateBack", pcOnly: ["ctrl+alt+-"], mac: [{ keys: "ctrl+-", from: "legacy" }] },
    {
        command: "workbench.action.nextEditor",
        pcOnly: ["ctrl+pagedown"],
        mac: [
            { keys: "shift+meta+]", from: "cmd" },
            { keys: "alt+meta+right", from: "cmd" },
        ],
    },
    { command: "workbench.action.nextEditorInGroup", mac: [{ keys: "meta+k alt+meta+right", from: "cmd" }] },
    {
        command: "workbench.action.output.toggleOutput",
        pcOnly: ["ctrl+k ctrl+h"],
        mac: [{ keys: "shift+meta+u", from: "cmd" }],
    },
    {
        command: "workbench.action.previousEditor",
        pcOnly: ["ctrl+pageup"],
        mac: [
            { keys: "shift+meta+[", from: "cmd" },
            { keys: "alt+meta+left", from: "cmd" },
        ],
    },
    { command: "workbench.action.previousEditorInGroup", mac: [{ keys: "meta+k alt+meta+left", from: "cmd" }] },
    {
        command: "workbench.action.showAllEditors",
        pcOnly: ["ctrl+k ctrl+p"],
        mac: [{ keys: "alt+meta+tab", from: "cmd" }],
    },
    {
        command: "workbench.action.toggleEditorGroupLayout",
        pcOnly: ["shift+alt+0"],
        mac: [{ keys: "alt+meta+0", from: "cmd" }],
    },
];

const DELTAS_BY_COMMAND: ReadonlyMap<string, MacKeybindingDelta> = new Map(
    MAC_KEYBINDING_DELTAS.map((delta) => [delta.command, delta]),
);

function toConditional(entry: KeybindingEntry): { keys: KeybindingChord; when: string | undefined } {
    if (!Array.isArray(entry) && "keys" in entry) {
        return { keys: Array.isArray(entry.keys) ? entry.keys : [entry.keys], when: entry.when };
    }
    return { keys: Array.isArray(entry) ? entry : [entry], when: undefined };
}

/**
 * Накладывает мак-дельту команды на её бинды: pc-бинды из `pcOnly` получают
 * условие «не мак», мак-бинды добавляются с условием «рунг ≥ from». Команда без
 * дельты возвращается как есть. `pcOnly`, не найденный среди биндов команды, —
 * ошибка таблицы, а не тихий no-op.
 */
export function withMacKeybindings(
    action: CommandAction,
    deltas: ReadonlyMap<string, MacKeybindingDelta> = DELTAS_BY_COMMAND,
): CommandAction {
    const delta = deltas.get(action.id);
    if (delta === undefined) return action;

    const declared = [action.keybinding, ...(action.keybindings ?? [])]
        .filter((entry) => entry !== undefined)
        .map(toConditional);
    const pcOnly = new Set(delta.pcOnly);
    const bindings: KeybindingEntry[] = declared.map(({ keys, when }) => {
        const spec = serializeChord(keys);
        if (!pcOnly.has(spec)) return { keys, when };
        pcOnly.delete(spec);
        return { keys, when: combineWhen(when, notMacKeys()) };
    });
    if (pcOnly.size > 0) {
        throw new Error(`${action.id}: pcOnly ${[...pcOnly].join(", ")} не найден среди биндов команды`);
    }
    for (const { keys, from } of delta.mac ?? []) {
        bindings.push({ keys: parseChord(keys), when: macKeysAtLeast(from) });
    }
    const { keybinding: _primary, ...rest } = action;
    return { ...rest, keybindings: bindings };
}
