import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IEditorPaneFactory } from "../../../services/editor/browser/editorPaneFactory.ts";

import { KeybindingsEditorPane } from "./keybindingsEditorPane.ts";
import { openKeybindingsEditor } from "./preferencesActions.ts";

/** Рецепт вкладки Keyboard Shortcuts: она одна и без параметров. */
export type IKeybindingsEditorPaneDescriptor = Readonly<Record<string, never>>;

/** upstream `KeybindingsEditorInput.ID`. */
export const KEYBINDINGS_EDITOR_PANE_TYPE_ID = "workbench.input.keybindings";

/**
 * Фабрика вкладки Keyboard Shortcuts: переживает рестарт (upstream
 * `KeybindingsEditorInputSerializer` пишет пустую строку и пересоздаёт
 * вкладку), но одна на окно — сплит и копия в группу её не повторяют.
 */
export function createKeybindingsEditorPaneFactory(
    accessor: ServiceAccessor,
): IEditorPaneFactory<IKeybindingsEditorPaneDescriptor> {
    return {
        typeId: KEYBINDINGS_EDITOR_PANE_TYPE_ID,
        singleton: true,
        describe: (pane) => (pane instanceof KeybindingsEditorPane ? {} : undefined),
        serialize: () => "",
        deserialize: () => ({}),
        open(_descriptor, { group, focus }) {
            openKeybindingsEditor(accessor, { group, focus });
            return Promise.resolve();
        },
    };
}
