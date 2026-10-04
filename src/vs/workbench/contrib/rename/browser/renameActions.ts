import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";

import { RenameServiceDIToken } from "./renameService.ts";

/**
 * Rename Symbol — переименование символа под кареткой по всем затронутым
 * файлам (`editor.action.rename`, F2 как в VS Code). Правки приходят от
 * rename-провайдеров расширений и ложатся одним шагом отмены, включая
 * закрытые файлы.
 *
 * F2 досягаема на любом терминале (голая функциональная клавиша), поэтому
 * второго, аккордного пути команде не нужно.
 */
export const renameSymbolAction: CommandAction = {
    id: "editor.action.rename",
    title: "Rename Symbol",
    keybinding: parseKeybinding("f2"),
    when: "textInputFocus && !editorReadonly",
    // Группа и порядок — дословно upstream (`rename.ts`): пункт виден только
    // там, где есть rename-провайдер, иначе меню обещало бы нерабочее.
    menus: [{ menuId: MenuId.EditorContext, group: "1_modification", order: 1.1, when: "editorHasRenameProvider" }],
    run(accessor) {
        return accessor.get(RenameServiceDIToken).rename();
    },
};

/** Экшены переименования. Фича отдаёт их одним массивом; регистрирует агрегатор (`builtinActions`). */
export const RENAME_ACTIONS: readonly CommandAction[] = [renameSymbolAction];
