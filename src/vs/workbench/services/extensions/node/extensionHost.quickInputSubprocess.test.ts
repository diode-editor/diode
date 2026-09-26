import { describe, expect, it } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import type { IWireQuickPickRequest, IWireValidationMessage } from "../../../api/common/wireTypes.ts";

import type { IQuickInputBoxRequest, IQuickInputSink } from "./extensionHost.ts";

// Полный круг quick input'а через НАСТОЯЩИЙ субпроцесс: команда расширения →
// window.showInputBox/showQuickPick → RPC → сток хоста → ответ → обратно в
// расширение. Сток здесь — стаб, который отвечает вместо человека: сам оверлей
// закрыт тестами QuickInputExtensionAdapter, а предмет этого теста — провод.

/** Сток-«человек»: отвечает заранее заданным и записывает, о чём спросили. */
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
    };
    return { sink, inputRequests, pickRequests };
}

const FIXTURE = extensionFixture("test.asksForInput", "asksForInput.cjs");

describe("ExtensionHost — quick input через настоящий субпроцесс", () => {
    it("showInputBox: опции доезжают до стока, введённое — обратно в расширение", async () => {
        const { sink, inputRequests } = makeSink({ input: () => Promise.resolve("Ада") });
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [FIXTURE],
            quickInputSink: sink,
        });
        try {
            await expect(harness.commandRegistry.execute("test.askName")).resolves.toBe("got:Ада");
            expect(inputRequests[0]).toMatchObject({
                title: "Your name",
                prompt: "Как к вам обращаться",
                placeHolder: "имя",
                validates: true,
            });
        } finally {
            await harness.dispose();
        }
    });

    it("валидация расширения отвечает через границу процессов", async () => {
        let validation: IWireValidationMessage | null | undefined;
        const { sink } = makeSink({
            input: async (request) => {
                validation = await request.validate?.("плохо");
                return "хорошо";
            },
        });
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [FIXTURE],
            quickInputSink: sink,
        });
        try {
            await expect(harness.commandRegistry.execute("test.askName")).resolves.toBe("got:хорошо");
            expect(validation).toEqual({ message: "Так нельзя", severity: "error" });
        } finally {
            await harness.dispose();
        }
    });

    it("отмена показа доводит обещание расширения до undefined", async () => {
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

    it("showQuickPick: строки уезжают списком, выбранная возвращается расширению", async () => {
        const { sink, pickRequests } = makeSink({ pick: () => Promise.resolve([2]) });
        const harness = await createExtensionTestHarness({
            initialFile: { name: "main.ts", content: "x\n" },
            extensions: [FIXTURE],
            quickInputSink: sink,
        });
        try {
            await expect(harness.commandRegistry.execute("test.pickFruit")).resolves.toBe("got:cherry");
            expect(pickRequests[0]).toMatchObject({
                placeHolder: "Выберите фрукт",
                canPickMany: false,
                items: [{ label: "apple" }, { label: "banana" }, { label: "cherry" }],
                picked: [],
            });
        } finally {
            await harness.dispose();
        }
    });

    it("canPickMany: предотметки уезжают индексами, набор возвращается массивом", async () => {
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

    it("отменённый список — undefined, а не пустой набор", async () => {
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
