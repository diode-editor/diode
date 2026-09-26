import { describe, expect, it } from "vitest";

import { CONFIGURATION_CONTRIBUTIONS } from "./configurationContributions.ts";
import { notificationsConfiguration } from "./notificationsConfiguration.ts";

// Узел настроек — это ДАННЫЕ, которые читают двое: рантайм (defaults-слой
// `ConfigurationRegistry`) и генератор каталога автодополнения settings.json
// (`scripts/generate-settings-schema.mjs`). Поэтому проверяем именно форму:
// ключ, тип, дефолт и то, что узел вообще подключён к приложению.

describe("notificationsConfiguration", () => {
    it("подключён к приложению — иначе дефолт не попадёт ни в рантайм, ни в автодополнение", () => {
        expect(CONFIGURATION_CONTRIBUTIONS).toContain(notificationsConfiguration);
    });

    it("id и заголовок узла", () => {
        expect(notificationsConfiguration.id).toBe("notifications");
        expect(notificationsConfiguration.title).toBe("Notifications");
    });

    it("единственный ключ — notifications.autoHideTimeout: число, дефолт 15 секунд (как в VS Code)", () => {
        expect(Object.keys(notificationsConfiguration.properties)).toEqual(["notifications.autoHideTimeout"]);
        const schema = notificationsConfiguration.properties["notifications.autoHideTimeout"];
        expect(schema.type).toBe("number");
        expect(schema.default).toBe(15000);
    });

    it("описание называет и единицу, и смысл нуля, и кого автоскрытие НЕ касается", () => {
        const { description } = notificationsConfiguration.properties["notifications.autoHideTimeout"];
        expect(description).toContain("milliseconds");
        expect(description).toContain("0 keeps it until dismissed");
        expect(description).toContain("Warnings, errors and notifications with buttons");
    });
});
