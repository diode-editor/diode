import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { KeybindingRegistry, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { NotificationService } from "../../../services/notification/browser/notificationService.ts";

import { clampRow, FOCUS_MESSAGE_COMMAND_ID, NotificationsComponent } from "./notificationsComponent.ts";

// Полный маршрут «сервис → overlay-сессия → кадр» закрывает
// workbench.notifications.test.ts; здесь — жизнь компонента ДО attachHost и
// после dispose (сообщения в headless-порядке не должны ни падать, ни оставлять
// открытых оверлеев) и подпись бинда в подсказке.

function makeComponent(binding?: string) {
    const notifications = new NotificationService();
    const keybindings = new KeybindingRegistry();
    const contextKeys = new ContextKeyService();
    if (binding !== undefined) keybindings.register(parseKeybinding(binding), FOCUS_MESSAGE_COMMAND_ID);
    const component = new NotificationsComponent(notifications, keybindings, contextKeys);
    return { notifications, component };
}

function mountHost(component: NotificationsComponent) {
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    component.attachHost(body);
    return { body, testApp };
}

function screen(testApp: TestApp): string {
    testApp.render();
    return testApp.backend.screenToString();
}

describe("clampRow", () => {
    it("обычный ряд проходит как есть", () => {
        expect(clampRow(10, 24)).toBe(10);
    });

    it("на низком экране высокий тост не уезжает выше строки меню", () => {
        // Строка меню занимает ряд 0 — тост начинается не выше первого.
        expect(clampRow(-5, 24)).toBe(1);
        expect(clampRow(0, 24)).toBe(1);
    });

    it("и не уезжает за нижний край кадра", () => {
        // Последний допустимый ряд — предпоследний: ниже статус-бар.
        expect(clampRow(100, 24)).toBe(23);
    });

    it("на экране в один ряд остаётся первый ряд", () => {
        expect(clampRow(0, 1)).toBe(1);
    });
});

describe("NotificationsComponent — без прикреплённого хоста", () => {
    it("сообщение до attachHost не падает и оверлеев не открывает", () => {
        const { notifications, component } = makeComponent();

        expect(() => {
            notifications.show({ severity: "error", message: "boom", modal: false, items: [] });
            notifications.show({ severity: "info", message: "ask?", modal: false, items: ["One"] });
        }).not.toThrow();
        expect(component.getOpenAsk()).toBeNull();
        expect(component.focusAsk()).toBe(false);
    });

    it("attachHost показывает то, что уже накопилось", () => {
        const { notifications, component } = makeComponent();
        notifications.show({ severity: "error", message: "раньше хоста", modal: false, items: [] });

        const { testApp } = mountHost(component);

        expect(screen(testApp)).toContain("раньше хоста");
    });

    it("пустой сервис не рисует ни рамки, ни пустого окна", () => {
        const { component } = makeComponent();
        const { testApp } = mountHost(component);

        expect(screen(testApp)).not.toContain("╭");
    });
});

describe("NotificationsComponent — dispose", () => {
    it("снимает вопрос с экрана и перестаёт слушать сервис", () => {
        const { notifications, component } = makeComponent();
        const { testApp } = mountHost(component);
        notifications.show({ severity: "info", message: "ask?", modal: false, items: ["One"] });
        expect(component.getOpenAsk()).not.toBeNull();

        component.dispose();

        expect(component.getOpenAsk()).toBeNull();
        expect(screen(testApp)).not.toContain("ask?");

        // Сервис ещё жив, но компонент на него больше не реагирует.
        expect(() => {
            notifications.show({ severity: "error", message: "после dispose", modal: false, items: [] });
        }).not.toThrow();
        expect(screen(testApp)).not.toContain("после dispose");
    });

    it("снимает пассивный стек: освобождённые тосты не остаются в дереве", () => {
        const { notifications, component } = makeComponent();
        const { testApp } = mountHost(component);
        notifications.show({ severity: "error", message: "sticky", modal: false, items: [] });
        expect(screen(testApp)).toContain("sticky");

        component.dispose();

        expect(screen(testApp)).not.toContain("sticky");
    });
});

describe("NotificationsComponent — подпись бинда в подсказке", () => {
    it("берёт комбинацию действующего бинда команды фокуса", () => {
        const { notifications, component } = makeComponent("alt+m");
        const { testApp } = mountHost(component);

        notifications.show({ severity: "info", message: "ask?", modal: false, items: ["One"] });

        expect(screen(testApp)).toContain("Alt+M — ответить");
    });

    it("без бинда называет команду — её найдут в палитре", () => {
        const { notifications, component } = makeComponent();
        const { testApp } = mountHost(component);

        notifications.show({ severity: "info", message: "ask?", modal: false, items: ["One"] });

        expect(screen(testApp)).toContain("Notifications: Focus Message");
    });
});
