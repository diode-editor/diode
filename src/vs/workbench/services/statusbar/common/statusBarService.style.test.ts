import { describe, expect, it } from "vitest";

import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";

import { StatusBarService } from "./statusBarService.ts";

describe("StatusBarService.overrideStyle", () => {
    it("no override: none; the lowest priority wins; disposing one gives the bar to the next", () => {
        const service = new StatusBarService(NULL_STATE_SERVICE);
        expect(service.styleOverride()).toBeUndefined();

        const debugging = service.overrideStyle({ priority: 10, background: "statusBar.debuggingBackground" });
        const remote = service.overrideStyle({ priority: 5, background: "remote" });
        service.overrideStyle({ priority: 20, background: "late" });

        expect(service.styleOverride()?.background).toBe("remote");
        remote.dispose();
        expect(service.styleOverride()?.background).toBe("statusBar.debuggingBackground");
        debugging.dispose();
        expect(service.styleOverride()?.background).toBe("late");
    });

    it("each change notifies; a second dispose does not", () => {
        const service = new StatusBarService(NULL_STATE_SERVICE);
        let fired = 0;
        service.onDidChangeStyle(() => fired++);

        const override = service.overrideStyle({ priority: 10, foreground: "fg" });
        expect(fired).toBe(1);
        override.dispose();
        expect(fired).toBe(2);
        override.dispose();
        expect(fired).toBe(2);
    });
});
