import { describe, expect, it, vi } from "vitest";

import type { IConfigurationService } from "../../../platform/configuration/common/iConfigurationService.ts";
import { Container } from "../../../platform/instantiation/common/diContainer.ts";
import type { KeybindingChord } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { formatKeybinding } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    NotificationService,
    NotificationServiceDIToken,
} from "../../services/notification/browser/notificationService.ts";
import type { NotificationsToastsComponent } from "../parts/notifications/notificationsToastsComponent.ts";
import { NotificationsToastsComponentDIToken } from "../parts/notifications/notificationsToastsComponent.ts";

import { clearNotificationsAction, focusNotificationToastsAction } from "./notificationActions.ts";

const NO_AUTO_HIDE = {
    get: () => 0,
    getValue: () => undefined,
    inspect: () => ({ key: "", value: undefined }),
    onDidChangeConfiguration: () => ({ dispose: () => undefined }),
} as unknown as IConfigurationService;

function makeAccessor() {
    const notificationService = new NotificationService(NO_AUTO_HIDE);
    const focusToasts = vi.fn();
    const container = new Container();
    container.bind(NotificationServiceDIToken, () => notificationService);
    container.bind(
        NotificationsToastsComponentDIToken,
        () => ({ focusToasts }) as unknown as NotificationsToastsComponent,
    );
    return { accessor: container, notificationService, focusToasts };
}

describe("notificationActions", () => {
    it("focusToasts гейтится видимостью стека и висит на аккорде Ctrl+K Ctrl+N", () => {
        expect(focusNotificationToastsAction.when).toBe("notificationToastsVisible");
        expect(formatKeybinding(focusNotificationToastsAction.keybinding as KeybindingChord)).toBe("Ctrl+K Ctrl+N");
    });

    it("focusToasts уводит фокус в стек", () => {
        const { accessor, focusToasts } = makeAccessor();
        focusNotificationToastsAction.run(accessor);
        expect(focusToasts).toHaveBeenCalledTimes(1);
    });

    it("clearAll закрывает все сообщения и дорешивает их обещания", async () => {
        const { accessor, notificationService } = makeAccessor();
        const answer = notificationService.notify({ severity: "error", message: "boom", items: ["Retry"] });
        clearNotificationsAction.run(accessor);
        await expect(answer).resolves.toBeUndefined();
        expect(notificationService.notifications()).toEqual([]);
    });

    it("у clearAll аккорда нет — как и в VS Code (Escape по стеку делает то же)", () => {
        expect(clearNotificationsAction.keybinding).toBeUndefined();
    });
});
