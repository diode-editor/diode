import { describe, expect, it } from "vitest";

import { toDisposable } from "../../../base/common/lifecycle.ts";

import { ProgressService } from "./progressService.ts";

describe("ProgressService.addTaskHold", () => {
    it("each task takes a hold at its start and releases it at its end, failed tasks too", async () => {
        const service = new ProgressService();
        const log: string[] = [];
        let n = 0;
        service.addTaskHold(() => {
            const id = ++n;
            log.push(`take ${String(id)}`);
            return toDisposable(() => log.push(`release ${String(id)}`));
        });
        await service.withProgress({ location: "window", title: "a" }, () => {
            log.push("task 1");
            return Promise.resolve();
        });
        await expect(
            service.withProgress({ location: "window", title: "b" }, () => Promise.reject(new Error("boom"))),
        ).rejects.toThrow("boom");
        expect(log).toStrictEqual(["take 1", "task 1", "release 1", "take 2", "release 2"]);
        service.dispose();
    });

    it("a removed hold is no longer taken; the others still are", async () => {
        const service = new ProgressService();
        const taken: string[] = [];
        const first = service.addTaskHold(() => {
            taken.push("first");
            return toDisposable(() => undefined);
        });
        service.addTaskHold(() => {
            taken.push("second");
            return toDisposable(() => undefined);
        });
        first.dispose();
        await service.withProgress({ location: "window", title: "a" }, () => Promise.resolve());
        expect(taken).toStrictEqual(["second"]);
        service.dispose();
    });
});
