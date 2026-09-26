import { Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { KeybindingRegistry, parseChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { NotificationService } from "../../../services/notification/browser/notificationService.ts";

import { FOCUS_NOTIFICATION_TOASTS_COMMAND_ID } from "./notificationCommandIds.ts";
import { NotificationsToastsComponent } from "./notificationsToastsComponent.ts";

/** Конфиг без автоскрытия: экран в тестах должен быть детерминированным. */
const NO_AUTO_HIDE = {
    get: () => 0,
    getValue: () => undefined,
    inspect: () => ({ key: "", value: undefined }),
    onDidChangeConfiguration: () => ({ dispose: () => undefined }),
} as unknown as IConfigurationService;

function makeComponent(options: { bindFocusCommand?: boolean } = {}) {
    const notificationService = new NotificationService(NO_AUTO_HIDE);
    const keybindings = new KeybindingRegistry();
    if (options.bindFocusCommand !== false) {
        keybindings.register(parseChord("ctrl+k ctrl+n"), FOCUS_NOTIFICATION_TOASTS_COMMAND_ID);
    }
    const component = new NotificationsToastsComponent(notificationService, keybindings);
    return { component, notificationService, keybindings };
}

function withHost(options: { bindFocusCommand?: boolean } = {}) {
    const made = makeComponent(options);
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    made.component.attachHost(body);
    testApp.render();
    return { ...made, body, testApp };
}

describe("NotificationsToastsComponent — без прикреплённого хоста", () => {
    it("сообщение до attachHost не открывает сессию и не падает", () => {
        const { component, notificationService } = makeComponent();
        expect(component.isOpen()).toBe(false);
        expect(component.view.id).toBe("notificationToasts");
        void notificationService.notify({ severity: "info", message: "fyi" });
        expect(component.isOpen()).toBe(false);
        component.dispose();
    });

    it("attachHost показывает то, что успело накопиться до первого кадра", () => {
        const { component, notificationService } = makeComponent();
        void notificationService.notify({ severity: "error", message: "рано" });
        const body = new BodyElement();
        TestApp.create(body, new Size(80, 24));
        component.attachHost(body);
        expect(component.isOpen()).toBe(true);
        component.dispose();
    });

    it("focusToasts на закрытом стеке — no-op", () => {
        const { component } = makeComponent();
        expect(() => {
            component.focusToasts();
        }).not.toThrow();
        component.dispose();
    });
});

describe("NotificationsToastsComponent — overlay-сессия", () => {
    it("показ открывает сессию, закрытие последнего сообщения — закрывает", () => {
        const { component, notificationService } = withHost();
        void notificationService.notify({ severity: "info", message: "fyi" });
        expect(component.isOpen()).toBe(true);

        notificationService.clearAll();
        expect(component.isOpen()).toBe(false);
        component.dispose();
    });

    it("повторное закрытие уже закрытой сессии не роняет компонент", () => {
        const { component, notificationService } = withHost();
        notificationService.clearAll();
        expect(component.isOpen()).toBe(false);
        component.dispose();
    });

    it("стек прижат к правому нижнему углу", () => {
        const { component, notificationService, body, testApp } = withHost();
        void notificationService.notify({ severity: "info", message: "fyi" });
        testApp.render();
        const item = body.overlayLayer.getItems().find((candidate) => candidate.element === component.view);
        // 80 − ширина − отступ 1 по горизонтали; 24 − высота − отступ 1 по вертикали.
        expect(item?.position.x).toBe(80 - component.view.preferredWidth - 1);
        expect(item?.position.y).toBe(24 - component.view.totalHeight - 1);
        component.dispose();
    });

    it("в узком терминале ширина тоста сжимается до доступной", () => {
        const { component, notificationService } = (() => {
            const made = makeComponent();
            const body = new BodyElement();
            TestApp.create(body, new Size(20, 10));
            made.component.attachHost(body);
            return made;
        })();
        void notificationService.notify({ severity: "info", message: "fyi" });
        expect(component.view.preferredWidth).toBe(24);
        component.dispose();
    });

    it("нажатие кнопки в тосте резолвит обещание сообщения", async () => {
        const { component, notificationService, testApp } = withHost();
        const answer = notificationService.notify({ severity: "info", message: "fyi", items: ["Activate", "Free"] });
        testApp.render();
        component.focusToasts();
        // Кнопку жмём её собственным колбэком: клавиатуру стека закрывает
        // notificationsToastsElement.test.ts, здесь важен путь до сервиса.
        const buttons = component.view.querySelectorAll("ButtonElement") as unknown as { onActivate?: () => void }[];
        buttons[1]?.onActivate?.();
        await expect(answer).resolves.toBe(1);
        expect(component.isOpen()).toBe(false);
        component.dispose();
    });

    it("Escape по стеку закрывает все сообщения", async () => {
        const { component, notificationService } = withHost();
        const answer = notificationService.notify({ severity: "error", message: "boom", items: ["Retry"] });
        component.view.onHideAll?.();
        await expect(answer).resolves.toBeUndefined();
        expect(component.isOpen()).toBe(false);
        component.dispose();
    });

    it("подсказка в тосте показывает реальный аккорд команды фокусировки", () => {
        const { component, notificationService, testApp } = withHost();
        void notificationService.notify({ severity: "info", message: "fyi", items: ["OK"] });
        testApp.render();
        expect(testApp.backend.screenToString()).toContain("Ctrl+K Ctrl+N to answer");
        component.dispose();
    });

    it("без биндинга подсказки нет: текст без клавиши врал бы", () => {
        const { component, notificationService, testApp } = withHost({ bindFocusCommand: false });
        void notificationService.notify({ severity: "info", message: "fyi", items: ["OK"] });
        testApp.render();
        expect(testApp.backend.screenToString()).not.toContain("to answer");
        component.dispose();
    });

    it("dispose снимает сессию со слоя — оверлей не переживает компонент", () => {
        const { component, notificationService, body } = withHost();
        void notificationService.notify({ severity: "info", message: "fyi" });
        expect(body.overlayLayer.getItems().some((item) => item.element === component.view)).toBe(true);
        component.dispose();
        expect(body.overlayLayer.getItems().some((item) => item.element === component.view)).toBe(false);
    });
});
