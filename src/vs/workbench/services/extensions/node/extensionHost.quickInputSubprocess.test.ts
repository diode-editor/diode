import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import type { IQuickInputBoxRequest, IQuickInputSink } from "../../../api/common/iExtensionWindowSinks.ts";
import type { IWireQuickPickRequest, IWireValidationMessage } from "../../../api/common/wireTypes.ts";

// The sink is a stub instead of a human: the overlay is covered by the QuickInputExtensionAdapter tests;
// the subject here is the wire.
function makeSink(answers: {
    input?: (request: IQuickInputBoxRequest) => Promise<string | undefined>;
    pick?: (request: IWireQuickPickRequest) => Promise<readonly number[] | undefined>;
}) {
    const inputRequests: IQuickInputBoxRequest[] = [];
    const pickRequests: IWireQuickPickRequest[] = [];
    const sink: IQuickInputSink = {
        showInputBox: async (request) => {
            inputRequests.push(request);
            return (await answers.input?.(request)) ?? undefined;
        },
        showQuickPick: async (request) => {
            pickRequests.push(request);
            return (await answers.pick?.(request)) ?? undefined;
        },
        cancel: () => undefined,
        updateQuickPick: () => undefined,
        disposeQuickPick: () => undefined,
    };
    return { sink, inputRequests, pickRequests };
}

const FIXTURE = extensionFixture("test.asksForInput", "asksForInput.cjs");

describe("ExtensionHost — quick input through a real subprocess", () => {
    it("showInputBox: options reach the sink, the input goes back to the extension", async () => {
        const { sink, inputRequests } = makeSink({ input: () => Promise.resolve("Ada") });
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [FIXTURE],
            quickInputSink: sink,
        });
        try {
            await expect(harness.commandRegistry.execute("test.askName")).resolves.toBe("got:Ada");
            expect(inputRequests[0]).toMatchObject({
                title: "Your name",
                prompt: "How should we address you",
                placeHolder: "name",
                validates: true,
            });
        } finally {
            await harness.dispose();
        }
    });

    it("extension validation answers across the process boundary", async () => {
        let validation: IWireValidationMessage | null | undefined;
        const { sink } = makeSink({
            input: async (request) => {
                validation = await request.validate?.("bad");
                return "good";
            },
        });
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [FIXTURE],
            quickInputSink: sink,
        });
        try {
            await expect(harness.commandRegistry.execute("test.askName")).resolves.toBe("got:good");
            expect(validation).toEqual({ message: "Not allowed", severity: "error" });
        } finally {
            await harness.dispose();
        }
    });

    it("cancelling the prompt resolves the extension's promise to undefined", async () => {
        const { sink } = makeSink({ input: () => Promise.resolve(undefined) });
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [FIXTURE],
            quickInputSink: sink,
        });
        try {
            await expect(harness.commandRegistry.execute("test.askName")).resolves.toBe("cancelled");
        } finally {
            await harness.dispose();
        }
    });

    it("showQuickPick: strings go out as a list, the picked one returns to the extension", async () => {
        const { sink, pickRequests } = makeSink({ pick: () => Promise.resolve([2]) });
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [FIXTURE],
            quickInputSink: sink,
        });
        try {
            await expect(harness.commandRegistry.execute("test.pickFruit")).resolves.toBe("got:cherry");
            expect(pickRequests[0]).toMatchObject({
                placeHolder: "Pick a fruit",
                canPickMany: false,
                items: [{ label: "apple" }, { label: "banana" }, { label: "cherry" }],
                picked: [],
            });
        } finally {
            await harness.dispose();
        }
    });

    it("canPickMany: preselections go out as indices, the selection returns as an array", async () => {
        const { sink, pickRequests } = makeSink({ pick: () => Promise.resolve([0, 2]) });
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [FIXTURE],
            quickInputSink: sink,
        });
        try {
            await expect(harness.commandRegistry.execute("test.pickMany")).resolves.toBe("got:alpha,gamma");
            expect(pickRequests[0]).toMatchObject({ canPickMany: true, picked: [1] });
        } finally {
            await harness.dispose();
        }
    });

    it("a cancelled pick is undefined, not an empty selection", async () => {
        const { sink } = makeSink({ pick: () => Promise.resolve(undefined) });
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [FIXTURE],
            quickInputSink: sink,
        });
        try {
            await expect(harness.commandRegistry.execute("test.pickMany")).resolves.toBe("cancelled");
        } finally {
            await harness.dispose();
        }
    });
});
