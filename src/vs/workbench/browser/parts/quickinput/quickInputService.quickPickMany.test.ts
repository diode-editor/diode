import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";

import { QuickInputComponent } from "./quickInputComponent.ts";
import { QuickInputService } from "./quickInputService.ts";

function createService(): { service: QuickInputService; component: QuickInputComponent; testApp: TestApp } {
    const component = new QuickInputComponent();
    const service = new QuickInputService(component);
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    component.attachHost(body);
    return { service, component, testApp };
}

const FRUITS: QuickPickItem[] = [{ label: "alpha" }, { label: "beta" }, { label: "gamma" }];

function labels(items: readonly QuickPickItem[] | undefined): string[] | undefined {
    return items?.map((item) => item.label);
}

describe("QuickInputService.quickPickMany", () => {
    it("Space отмечает строку под курсором, Enter отдаёт отмеченное", async () => {
        const { service, testApp } = createService();
        const result = service.quickPickMany({ items: FRUITS });
        testApp.sendKey(" ");
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        testApp.sendKey(" ");
        testApp.sendKey("Enter");
        expect(labels(await result)).toEqual(["alpha", "gamma"]);
    });

    it("порядок ответа — исходного списка, а не порядка отметки", async () => {
        const { service, testApp } = createService();
        const result = service.quickPickMany({ items: FRUITS });
        // Отмечаем снизу вверх: gamma, потом alpha.
        testApp.sendKey("ArrowDown");
        testApp.sendKey("ArrowDown");
        testApp.sendKey(" ");
        testApp.sendKey("ArrowUp");
        testApp.sendKey("ArrowUp");
        testApp.sendKey(" ");
        testApp.sendKey("Enter");
        expect(labels(await result)).toEqual(["alpha", "gamma"]);
    });

    it("повторный Space снимает отметку", async () => {
        const { service, testApp } = createService();
        const result = service.quickPickMany({ items: FRUITS });
        testApp.sendKey(" ");
        testApp.sendKey(" ");
        testApp.sendKey("Enter");
        expect(labels(await result)).toEqual([]);
    });

    it("пустой набор — это пустой ответ, а не отмена", async () => {
        const { service, testApp } = createService();
        const result = service.quickPickMany({ items: FRUITS });
        testApp.sendKey("Enter");
        const picked = await result;
        expect(picked).not.toBeUndefined();
        expect(labels(picked)).toEqual([]);
    });

    it("Escape — именно отмена (undefined), а не пустой набор", async () => {
        const { service, testApp } = createService();
        const result = service.quickPickMany({ items: FRUITS });
        testApp.sendKey(" ");
        testApp.sendKey("Escape");
        await expect(result).resolves.toBeUndefined();
    });

    it("предотмеченные пункты уезжают в ответ без единого нажатия", async () => {
        const { service, testApp } = createService();
        const result = service.quickPickMany({ items: FRUITS, picked: [FRUITS[1]] });
        testApp.sendKey("Enter");
        expect(labels(await result)).toEqual(["beta"]);
    });

    it("отметка переживает фильтрацию: отмеченное вне текущего фильтра не теряется", async () => {
        const { service, testApp } = createService();
        const result = service.quickPickMany({ items: FRUITS });
        testApp.sendKey(" "); // alpha
        testApp.sendKey("g");
        testApp.sendKey("a"); // фильтр «ga» оставляет только gamma
        testApp.sendKey(" "); // gamma
        testApp.sendKey("Enter");
        expect(labels(await result)).toEqual(["alpha", "gamma"]);
    });

    it("Enter на пустом списке отдаёт пустой набор, а не висит", async () => {
        const { service, testApp } = createService();
        const result = service.quickPickMany({ items: [] });
        testApp.sendKey("Enter");
        expect(labels(await result)).toEqual([]);
    });

    it("отметки предыдущего показа не протекают в следующий", async () => {
        const { service, testApp } = createService();
        const first = service.quickPickMany({ items: FRUITS });
        testApp.sendKey(" ");
        testApp.sendKey("Enter");
        expect(labels(await first)).toEqual(["alpha"]);

        const second = service.quickPickMany({ items: FRUITS });
        testApp.sendKey("Enter");
        expect(labels(await second)).toEqual([]);
    });

    it("одиночный quickPick после множественного не показывает чекбоксов и принимает строку", async () => {
        const { service, component, testApp } = createService();
        const many = service.quickPickMany({ items: FRUITS });
        testApp.sendKey(" ");
        testApp.sendKey("Escape");
        await many;

        const single = service.quickPick({ items: FRUITS });
        expect(component.view.canPickMany).toBe(false);
        expect(component.view.inspectState().checked).toBeUndefined();
        testApp.sendKey("Enter");
        expect((await single)?.label).toBe("alpha");
    });

    it("InputBox после множественного выбора остаётся однострочным вводом", async () => {
        const { service, component, testApp } = createService();
        const many = service.quickPickMany({ items: FRUITS });
        testApp.sendKey(" ");
        testApp.sendKey("Escape");
        await many;

        const value = service.input({});
        expect(component.view.canPickMany).toBe(false);
        // Пробел в поле ввода — обычный символ, а не переключатель отметки.
        testApp.sendKey("a");
        testApp.sendKey(" ");
        testApp.sendKey("b");
        testApp.sendKey("Enter");
        await expect(value).resolves.toBe("a b");
    });

    it("новый показ отменяет предыдущий множественный выбор", async () => {
        const { service } = createService();
        const first = service.quickPickMany({ items: FRUITS });
        void service.quickPick({ items: FRUITS });
        await expect(first).resolves.toBeUndefined();
    });

    it("cancel() доводит висящий показ до undefined", async () => {
        const { service } = createService();
        const pending = service.quickPickMany({ items: FRUITS });
        service.cancel();
        await expect(pending).resolves.toBeUndefined();
    });

    it("cancel() без открытого показа — no-op", () => {
        const { service, component } = createService();
        expect(() => {
            service.cancel();
        }).not.toThrow();
        expect(component.isOpen()).toBe(false);
    });
});
