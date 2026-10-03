import { describe, expect, it } from "vitest";

import type { IHostProcess } from "../../workbench/services/lifecycle/common/hostProcess.ts";
import { HostProcessDIToken } from "../../workbench/services/lifecycle/common/hostProcess.ts";

import { lifecycleModule } from "./lifecycleModule.ts";
import { createTestContainer } from "./testProfile.ts";

/**
 * Проводка процесса-владельца в DI: продовый модуль поверх тестового контейнера.
 * Проверяем не «биндинг объявлен», а что через него доезжают именно те хуки,
 * которые отдал владелец приложения: перепутанный аргумент даёт рабочий
 * контейнер и окно, которое не выходит и не перезагружается.
 */
describe("lifecycleModule", () => {
    it("шов процесса-владельца отдаёт хуки владельца приложения", () => {
        const { container } = createTestContainer();
        const hostProcess: IHostProcess = { exit: () => undefined, restart: () => undefined };
        // Токен заранее «отравлен»: если модуль перестанет его перебивать, резолв
        // упадёт — иначе тест зелёный на дефолтном биндинге тестового профиля.
        container.bind(HostProcessDIToken, () => {
            throw new Error("шов процесса-владельца не перебит продовым модулем");
        });

        container.use(lifecycleModule, { hostProcess });

        expect(container.get(HostProcessDIToken)).toBe(hostProcess);
    });
});
