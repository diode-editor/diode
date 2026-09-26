import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { ClipboardDIToken } from "../../../common/coreTokens.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

import { KeyboardDoctorComponentDIToken } from "./keyboardDoctorComponent.ts";

/**
 * Keyboard Doctor: проводит по проверкам клавиатуры (протокол фидбека в
 * docs/TODO/MacKeybindings.md) и отдаёт отчёт одним куском — безымянным
 * документом (его можно сохранить или выделить) и сразу в буфер обмена.
 */
export const keyboardDoctorAction: CommandAction = {
    id: "diode.keyboardDoctor",
    title: "Diode: Keyboard Doctor",
    async run(accessor) {
        const report = await accessor.get(KeyboardDoctorComponentDIToken).run();
        const editors = accessor.get(EditorServiceDIToken);
        editors.newUntitled();
        editors
            .getActiveEditor()
            ?.applyExternalEdits(
                [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: report }],
                "Keyboard Doctor",
            );
        await accessor.get(ClipboardDIToken).writeText(report);
    },
};
