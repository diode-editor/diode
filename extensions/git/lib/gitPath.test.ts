import { describe, expect, it } from "vitest";

import { configuredGitPath } from "./gitPath.ts";

describe("configuredGitPath — upstream git.path", () => {
    const exists = (path: string) => path.startsWith("/ok");

    it("the default null, an empty string and garbage are git from PATH", () => {
        expect(configuredGitPath(null, exists)).toBeUndefined();
        expect(configuredGitPath(undefined, exists)).toBeUndefined();
        expect(configuredGitPath("", exists)).toBeUndefined();
        expect(configuredGitPath(7, exists)).toBeUndefined();
    });

    it("a path that exists is taken, one that does not is git from PATH", () => {
        expect(configuredGitPath("/ok/git", exists)).toBe("/ok/git");
        expect(configuredGitPath("/missing/git", exists)).toBeUndefined();
    });

    it("an array is looked up in order, the first existing path wins", () => {
        expect(configuredGitPath(["/missing/git", 3, "", "/ok/a", "/ok/b"], exists)).toBe("/ok/a");
    });

    it("without a lookup it checks the disk", () => {
        expect(configuredGitPath([process.execPath, "/nonexistent/git"])).toBe(process.execPath);
    });
});
