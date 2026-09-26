import { describe, expect, it } from "vitest";

import { InMemoryClipboard } from "../../../../platform/clipboard/common/inMemoryClipboard.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { ClipboardDIToken } from "../../../common/coreTokens.ts";
import { type EditorService, EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

import { keyboardDoctorAction } from "./keyboardDoctorActions.ts";
import { type KeyboardDoctorComponent, KeyboardDoctorComponentDIToken } from "./keyboardDoctorComponent.ts";

function accessorWith(editor: { applied: string[] } | null) {
    const clipboard = new InMemoryClipboard();
    const container = new Container();
    let untitled = 0;
    container.bind(
        KeyboardDoctorComponentDIToken,
        () => ({ run: () => Promise.resolve("REPORT\n") }) as unknown as KeyboardDoctorComponent,
    );
    container.bind(ClipboardDIToken, () => clipboard);
    container.bind(
        EditorServiceDIToken,
        () =>
            ({
                newUntitled: () => {
                    untitled++;
                },
                getActiveEditor: () =>
                    editor === null
                        ? null
                        : {
                              applyExternalEdits: (edits: readonly { text: string }[], label: string) => {
                                  editor.applied.push(`${label}: ${edits.map((e) => e.text).join("")}`);
                              },
                              goToPosition: (line: number) => {
                                  editor.applied.push(`goTo ${String(line)}`);
                              },
                          },
            }) as unknown as EditorService,
    );
    return { container, clipboard, untitled: () => untitled };
}

describe("keyboardDoctorAction", () => {
    it("отчёт — в новый безымянный документ и в буфер обмена", async () => {
        const editor = { applied: [] as string[] };
        const { container, clipboard, untitled } = accessorWith(editor);
        expect(keyboardDoctorAction.title).toBe("Diode: Keyboard Doctor");

        await keyboardDoctorAction.run(container);

        expect(untitled()).toBe(1);
        expect(editor.applied).toEqual(["Keyboard Doctor: REPORT\n", "goTo 0"]);
        await expect(clipboard.readText()).resolves.toBe("REPORT\n");
    });

    it("без открывшегося редактора отчёт всё равно попадает в буфер", async () => {
        const { container, clipboard } = accessorWith(null);
        await keyboardDoctorAction.run(container);
        await expect(clipboard.readText()).resolves.toBe("REPORT\n");
    });
});
