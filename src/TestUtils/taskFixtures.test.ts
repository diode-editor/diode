import { describe, expect, it } from "vitest";

import { taskRunContext } from "./taskFixtures.ts";

describe("taskRunContext — the fixture window of task tests", () => {
    it("the task folder by name; no editor, selection, settings or extensions", () => {
        const { resolve } = taskRunContext();
        expect(resolve("${workspaceFolder:ws}|${userHome}|${cwd}")).toBe("/ws|/home/u|/ws");
        expect(() => resolve("${workspaceFolder:other}")).toThrow("No such folder 'other'");
        expect(() => resolve("${selectedText}")).toThrow("have some text selected");
        expect(() => resolve("${config:a}")).toThrow("setting 'a' not found");
        expect(() => resolve("${extensionInstallFolder:a.b}")).toThrow("a.b is not installed");
    });
});
