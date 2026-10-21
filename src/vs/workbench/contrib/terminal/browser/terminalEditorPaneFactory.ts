import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IEditorPaneFactory } from "../../../services/editor/browser/editorPaneFactory.ts";

import { TerminalEditorPane } from "./terminalEditorPane.ts";
import { TerminalEditorServiceDIToken } from "./terminalEditorService.ts";

/** Reopening always starts a new shell, so there are no parameters. */
export type ITerminalEditorPaneDescriptor = Readonly<Record<string, never>>;

/** upstream `TerminalEditorInput.ID`. */
export const TERMINAL_EDITOR_PANE_TYPE_ID = "workbench.editors.terminal";

/** Split and copy create a NEW terminal, like upstream `TerminalEditorInput.copy()`. Tabs don't survive a restart. */
export function createTerminalEditorPaneFactory(
    accessor: ServiceAccessor,
): IEditorPaneFactory<ITerminalEditorPaneDescriptor> {
    return {
        typeId: TERMINAL_EDITOR_PANE_TYPE_ID,
        describe: (pane) => (pane instanceof TerminalEditorPane ? {} : undefined),
        serialize: () => undefined,
        deserialize: () => undefined,
        open(_descriptor, { group, focus }) {
            accessor.get(TerminalEditorServiceDIToken).createTerminal({}, { group, preserveFocus: !focus });
            return Promise.resolve();
        },
    };
}
