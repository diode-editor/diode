import { describe, expect, it } from "vitest";

import type { IConfigurationService } from "../../../platform/configuration/common/iConfigurationService.ts";
import { NotificationService } from "../../services/notification/browser/notificationService.ts";

import { NotificationExtensionAdapter } from "./notificationExtensionAdapter.ts";

/** Конфиг без автоскрытия: тост не должен исчезать из-под теста. */
const NO_AUTO_HIDE = {
    get: () => 0,
    getValue: () => undefined,
    inspect: () => ({ key: "", value: undefined }),
    onDidChangeConfiguration: () => ({ dispose: () => undefined }),
} as unknown as IConfigurationService;

function make() {
    const service = new NotificationService(NO_AUTO_HIDE);
    return { service, adapter: new NotificationExtensionAdapter(service) };
}

describe("NotificationExtensionAdapter", () => {
    it("строгость с провода переводится в строгость модели (warn → warning)", async () => {
        const { service, adapter } = make();
        void adapter.show({ severity: "error", message: "boom", items: [] });
        void adapter.show({ severity: "warn", message: "careful", items: [] });
        void adapter.show({ severity: "info", message: "fyi", items: [] });
        expect(service.notifications().map((n) => n.severity)).toEqual(["error", "warning", "info"]);
        service.clearAll();
        await Promise.resolve();
    });

    it("подписи кнопок доезжают до сообщения, а ответ приходит индексом", async () => {
        const { service, adapter } = make();
        const answer = adapter.show({ severity: "info", message: "выбери", items: ["Activate", "Free"] });
        const shown = service.notifications().at(0);
        expect(shown?.items).toEqual(["Activate", "Free"]);
        service.accept(shown!.id, 1);
        await expect(answer).resolves.toBe(1);
    });

    it("закрытие без выбора доезжает как undefined", async () => {
        const { service, adapter } = make();
        const answer = adapter.show({ severity: "info", message: "выбери", items: ["Activate"] });
        service.dismiss(service.notifications().at(0)!.id);
        await expect(answer).resolves.toBeUndefined();
    });

    it("clear (субпроцесс умер) снимает живые сообщения и дорешивает их обещания", async () => {
        const { service, adapter } = make();
        const answer = adapter.show({ severity: "error", message: "boom", items: ["Retry"] });
        adapter.clear();
        await expect(answer).resolves.toBeUndefined();
        expect(service.notifications()).toEqual([]);
    });
});
