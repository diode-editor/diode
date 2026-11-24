import { describe, expect, it } from "vitest";

import { configuredGitPath } from "./gitPath.ts";

describe("configuredGitPath — upstream git.path", () => {
    const missing = "/nonexistent/git";

    it("the default null, an empty string and garbage are git from PATH", () => {
        expect(configuredGitPath(null)).toBeUndefined();
        expect(configuredGitPath(undefined)).toBeUndefined();
        expect(configuredGitPath("")).toBeUndefined();
        expect(configuredGitPath(7)).toBeUndefined();
    });

    it("a path that exists is taken, one that does not is git from PATH", () => {
        expect(configuredGitPath(process.execPath)).toBe(process.execPath);
        expect(configuredGitPath(missing)).toBeUndefined();
    });

    it("an array is looked up in order, the first existing path wins", () => {
        expect(configuredGitPath([missing, 3, "", process.execPath, "/"])).toBe(process.execPath);
    });
});
