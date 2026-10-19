import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IEditorPaneFactory } from "../../../services/editor/browser/editorPaneFactory.ts";

import { TerminalEditorPane } from "./terminalEditorPane.ts";
import { TerminalEditorServiceDIToken } from "./terminalEditorService.ts";

/** Рецепт вкладки-терминала: повтор — всегда новый шелл, параметров нет. */
export type ITerminalEditorPaneDescriptor = Readonly<Record<string, never>>;

/** upstream `TerminalEditorInput.ID`. */
export const TERMINAL_EDITOR_PANE_TYPE_ID = "workbench.editors.terminal";

/**
 * Фабрика вкладок-терминалов: сплит и копия в группу заводят в целевой группе
 * НОВЫЙ терминал (upstream `TerminalEditorInput.copy()` создаёт новый
 * инстанс, процесс не делится). Рестарт вкладка не переживает: процессы
 * терминалов не сохраняются (у эталона без persistent sessions — так же).
 */
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
