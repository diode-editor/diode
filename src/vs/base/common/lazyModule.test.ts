import { afterEach, describe, expect, it, vi } from "vitest";

import { importLazyModule, setLazyModuleLoader } from "./lazyModule.ts";
import { loadSemver } from "./semver.ts";

afterEach(() => {
    setLazyModuleLoader(undefined);
});

describe("importLazyModule", () => {
    it("загрузчик не подставлен (тесты, dev) — модуль приходит через importer", async () => {
        const mod = { answer: 42 };
        const importer = vi.fn(() => Promise.resolve(mod));

        await expect(importLazyModule("pkg", importer)).resolves.toBe(mod);
        expect(importer).toHaveBeenCalledTimes(1);
    });

    it("подставленный загрузчик получает id и importer — importer сам не зовётся", async () => {
        const fromChunk = { answer: "chunk" };
        const loader = vi.fn(() => Promise.resolve(fromChunk));
        setLazyModuleLoader(loader as never);
        const importer = vi.fn(() => Promise.resolve({ answer: "node_modules" }));

        await expect(importLazyModule("pkg", importer)).resolves.toBe(fromChunk);
        expect(loader).toHaveBeenCalledWith("pkg", importer);
        expect(importer).not.toHaveBeenCalled();
    });

    it("undefined возвращает прямой import()", async () => {
        const loader = vi.fn(() => Promise.reject(new Error("загрузчик не должен вызываться")));
        setLazyModuleLoader(loader as never);
        setLazyModuleLoader(undefined);

        await expect(importLazyModule("pkg", () => Promise.resolve("direct"))).resolves.toBe("direct");
        expect(loader).not.toHaveBeenCalled();
    });
});

describe("loadSemver", () => {
    it("берёт кусок semver через загрузчик процесса", async () => {
        const loader = vi.fn((_id: string, importer: () => Promise<unknown>) => importer());
        setLazyModuleLoader(loader as never);

        const semver = await loadSemver();

        expect(loader).toHaveBeenCalledWith("semver", expect.any(Function));
        expect(semver.satisfies("1.2.3", "^1.0.0")).toBe(true);
        expect(semver.valid("not-a-version")).toBeNull();
    });
});
