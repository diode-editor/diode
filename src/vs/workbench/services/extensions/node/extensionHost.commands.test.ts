import { describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    registerAndActivate,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { currentCursorChangeSource } from "../../../../editor/common/core/cursorChangeSource.ts";

describe("ExtensionHost — commands bridge (subprocess)", () => {
    it("host → subprocess: core executes an extension proxy command over real RPC", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [extensionFixture("test.registersCommand", "registersCommand.cjs")],
        });
        try {
            expect(harness.commandRegistry.has("test.applyTab")).toBe(true);

            const result = await harness.commandRegistry.execute("test.applyTab", 5);
            expect(result).toBe("applied:5");

            await settle();
            expect(harness.group.getActiveEditor()?.viewState.tabSize).toBe(5);
        } finally {
            await harness.dispose();
        }
    });

    it("commandTitles from contributes.commands make the proxy visible in the command palette", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [
                {
                    ...extensionFixture("test.registersCommand", "registersCommand.cjs"),
                    commandTitles: { "test.applyTab": "Apply Tab" },
                },
            ],
        });
        try {
            expect(harness.commandRegistry.has("test.applyTab")).toBe(true);
            const listed = harness.commandRegistry.listCommands();
            expect(listed).toContainEqual({ id: "test.applyTab", title: "Apply Tab" });
        } finally {
            await harness.dispose();
        }
    });

    it("host → subprocess: extension dispose removes the proxy from the host registry", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
        });
        try {
            const disposable = await registerAndActivate(
                harness.host,
                extensionFixture("test.registersCommand", "registersCommand.cjs"),
            );
            await settle();
            expect(harness.commandRegistry.has("test.applyTab")).toBe(true);

            disposable.dispose();
            await settle();
            expect(harness.commandRegistry.has("test.applyTab")).toBe(false);
        } finally {
            await harness.dispose();
        }
    });

    it("subprocess → host: fall-through executeCommand runs a core command", async () => {
        // A host command runs before extension activation, so the harness has NO extensions.
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
        });
        try {
            let captured: number | null = null;
            harness.commandRegistry.register("test.hostApply", (n) => {
                captured = n as number;
                harness.group.getActiveEditor()?.setIndentOptions({ tabSize: n as number });
                return "host-ran";
            });

            await registerAndActivate(harness.host, extensionFixture("test.callsHost", "callsHostCommand.cjs"));
            await settle();

            expect(captured).toBe(7);
            expect(harness.group.getActiveEditor()?.viewState.tabSize).toBe(7);
        } finally {
            await harness.dispose();
        }
    });

    // Producer of `TextEditorSelectionChangeKind.Command` for a cursor moved by an extension command.
    it("subprocess → host: an extension command runs inside the command scope", { timeout: 60_000 }, async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
        });
        try {
            const seen: (string | undefined)[] = [];
            harness.commandRegistry.register("test.hostApply", () => {
                seen.push(currentCursorChangeSource());
                return null;
            });

            await registerAndActivate(harness.host, extensionFixture("test.callsHost", "callsHostCommand.cjs"));
            await settle();

            expect(seen).toEqual(["command"]);
            expect(currentCursorChangeSource()).toBeUndefined();
        } finally {
            await harness.dispose();
        }
    });

    it("local-first: executeCommand of its own command runs in the subprocess", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [extensionFixture("test.localFirst", "localFirstCommand.cjs")],
        });
        try {
            await settle();
            expect(harness.group.getActiveEditor()?.viewState.tabSize).toBe(9);
        } finally {
            await harness.dispose();
        }
    });

    it("executeCommand of a missing command rejects (tabSize=3 marker)", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [extensionFixture("test.callsMissing", "callsMissingCommand.cjs")],
        });
        try {
            await settle();
            // The fixture sets tabSize=3 only in the reject branch.
            expect(harness.group.getActiveEditor()?.viewState.tabSize).toBe(3);
        } finally {
            await harness.dispose();
        }
    });
});
