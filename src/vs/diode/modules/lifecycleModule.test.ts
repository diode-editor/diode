import { describe, expect, it } from "vitest";

import type { IHostProcess } from "../../workbench/services/lifecycle/common/hostProcess.ts";
import { HostProcessDIToken } from "../../workbench/services/lifecycle/common/hostProcess.ts";

import { lifecycleModule } from "./lifecycleModule.ts";
import { createTestContainer } from "./testProfile.ts";

/** A swapped argument yields a working container and a window that never exits or reloads. */
describe("lifecycleModule", () => {
    it("шов процесса-владельца отдаёт хуки владельца приложения", () => {
        const { container } = createTestContainer();
        const hostProcess: IHostProcess = { exit: () => undefined, restart: () => undefined };
        // The token is poisoned: if the module stopped overriding it, the test would pass on the test profile default.
        container.bind(HostProcessDIToken, () => {
            throw new Error("шов процесса-владельца не перебит продовым модулем");
        });

        container.use(lifecycleModule, { hostProcess });

        expect(container.get(HostProcessDIToken)).toBe(hostProcess);
    });
});
