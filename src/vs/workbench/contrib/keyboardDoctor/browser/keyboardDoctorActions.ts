import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { ClipboardDIToken } from "../../../../platform/clipboard/common/iClipboard.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";

import { KeyboardDoctorComponentDIToken } from "./keyboardDoctorComponent.ts";

export const keyboardDoctorAction: CommandAction = {
    id: "diode.keyboardDoctor",
    title: "Diode: Keyboard Doctor",
    async run(accessor) {
        const report = await accessor.get(KeyboardDoctorComponentDIToken).run();
        const editors = accessor.get(EditorServiceDIToken);
        editors.newUntitled();
        const editor = editors.getActiveEditor();
        editor?.applyExternalEdits(
            [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: report }],
            "Keyboard Doctor",
        );
        // The report is read top-down: environment goes in the first lines.
        editor?.goToPosition(0);
        await accessor.get(ClipboardDIToken).writeText(report);
    },
};

export const KEYBOARD_DOCTOR_ACTIONS: readonly CommandAction[] = [keyboardDoctorAction];
