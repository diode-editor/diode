import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it, vi } from "vitest";

import { createExtensionTestHarness, extensionFixture } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { QuickInputExtensionAdapter } from "../../../api/browser/quickInputExtensionAdapter.ts";
import { QuickInputComponent } from "../../../browser/parts/quickinput/quickInputComponent.ts";
import { QuickInputService } from "../../../browser/parts/quickinput/quickInputService.ts";

// Стаба-«человека» нет: ответ даёт настоящий виджет на клавишах.

async function setup() {
    const component = new QuickInputComponent();
    const service = new QuickInputService(component);
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    component.attachHost(body);
    const harness = await createExtensionTestHarness({
        initialFile: { name: "main.go", content: "package main\n" },
        extensions: [extensionFixture("test.asksForQuickPick", "asksForQuickPick.cjs")],
        quickInputSink: new QuickInputExtensionAdapter(service),
    });
    const view = (): Record<string, unknown> => component.view.inspectState();
    const type = (text: string): void => {
        for (const ch of text) testApp.sendKey(ch);
    };
    return { harness, component, testApp, view, type };
}

describe("ExtensionHost — window.createQuickPick через настоящий субпроцесс", () => {
    it("ленивый список (форма pickLazyEnum golang.go): предметы после показа, поиск, Enter", async () => {
        const { harness, component, testApp, view, type } = await setup();
        try {
            const result = harness.commandRegistry.execute("test.lazyPick") as Promise<{
                value: string | undefined;
                log: string[];
            }>;
            // Пикер открылся пустым, предметы приехали следующим диффом.
            await vi.waitFor(() => {
                expect(view()).toMatchObject({
                    title: "Lazy enum",
                    items: ["Alpha module", "Beta module", "Gamma"],
                });
            });
            expect(component.view.placeholder).toBe("Type to search modules");
            // detail встаёт на место описания у однострочного ряда.
            expect(component.view.items[0]).toMatchObject({ description: "example.com/alpha" });

            // Запрос «beta»: расширение получает значение и само перезапрашивает
            // предметы; фильтр по label хоста тоже их пропускает.
            type("beta");
            await vi.waitFor(() => {
                expect(component.view.prompt).toBe("results for beta");
            });
            expect(view()).toMatchObject({ query: "beta", items: ["Beta module"] });
            testApp.sendKey("Enter");

            const { value, log } = await result;
            expect(value).toBe("example.com/beta");
            expect(log).toEqual(expect.arrayContaining(["value:beta", "selection:Beta module", "accept"]));
            // Расширение прячет пикер само — по своему hide(), а не по Enter.
            await vi.waitFor(() => {
                expect(component.isOpen()).toBe(false);
            });
        } finally {
            await harness.dispose();
        }
    });

    it("Escape — onDidHide в расширении, команда получает «ничего»", async () => {
        const { harness, component, testApp, view } = await setup();
        try {
            const result = harness.commandRegistry.execute("test.lazyPick") as Promise<{
                value: string | undefined;
                log: string[];
            }>;
            await vi.waitFor(() => {
                expect(view()).toMatchObject({ items: ["Alpha module", "Beta module", "Gamma"] });
            });
            testApp.sendKey("Escape");
            const { value, log } = await result;
            expect(value).toBeUndefined();
            // Два — как в эталоне: Escape даёт onDidHide, а dispose() в его
            // обработчике (так пишет golang.go) — второй (extHostQuickPick.ts).
            expect(log).toEqual(["hide", "hide"]);
            expect(component.isOpen()).toBe(false);
        } finally {
            await harness.dispose();
        }
    });

    it("множественный выбор: предотметка, разделитель не рисуется, шаги в заголовке, свои объекты обратно", async () => {
        const { harness, testApp, view } = await setup();
        try {
            const result = harness.commandRegistry.execute("test.pickManyObject") as Promise<{
                picked: string[];
                same: boolean;
            }>;
            await vi.waitFor(() => {
                expect(view()).toMatchObject({
                    title: "Pick numbers (1/2)",
                    items: ["one", "two", "three"],
                    checked: ["two"],
                });
            });
            testApp.sendKey("ArrowDown");
            testApp.sendKey("ArrowDown");
            testApp.sendKey(" ");
            // Отметка уезжает событием — Enter должен застать её у расширения.
            await vi.waitFor(() => {
                expect(view()).toMatchObject({ checked: ["two", "three"] });
            });
            testApp.sendKey("Enter");
            await expect(result).resolves.toEqual({ picked: ["two", "three"], same: true });
        } finally {
            await harness.dispose();
        }
    });

    it("hide() расширения закрывает оверлей, onDidHide — ровно один раз", async () => {
        const { harness, component } = await setup();
        try {
            await harness.commandRegistry.execute("test.showForHide");
            await vi.waitFor(() => {
                expect(component.isOpen()).toBe(true);
            });
            await expect(harness.commandRegistry.execute("test.hideShown")).resolves.toEqual({ hides: 1 });
            expect(component.isOpen()).toBe(false);
        } finally {
            await harness.dispose();
        }
    });
});
