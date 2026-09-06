import { describe, expect, it, vi } from "vitest";

import { WindowReloadHandlerDIToken } from "../../workbench/services/lifecycle/common/windowReload.ts";

import { lifecycleModule } from "./lifecycleModule.ts";
import { createTestContainer } from "./testProfile.ts";

/**
 * Проводка перезагрузки окна в DI: продовый модуль поверх тестового контейнера.
 * Проверяем не «биндинг объявлен», а что через него доезжает именно то
 * замыкание, которое отдал владелец приложения: перепутанный аргумент даёт
 * рабочий контейнер и окно, которое не перезагружается.
 */
describe("lifecycleModule", () => {
    it("шов перезагрузки зовёт замыкание владельца приложения", () => {
        const { container } = createTestContainer();
        const reloadWindow = vi.fn();
        // Токен заранее «отравлен»: если модуль перестанет его перебивать, резолв
        // упадёт — иначе тест зелёный на дефолтном биндинге тестового профиля.
        container.bind(WindowReloadHandlerDIToken, () => {
            throw new Error("шов перезагрузки не перебит продовым модулем");
        });

        container.use(lifecycleModule, { reloadWindow });
        container.get(WindowReloadHandlerDIToken).reloadWindow();

        expect(reloadWindow).toHaveBeenCalledOnce();
    });
});
