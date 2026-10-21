import { describe, expect, it } from "vitest";

import { fromGitUri, GIT_SCHEME, toGitUri } from "./gitUri.ts";

describe("toGitUri", () => {
    it("sets the git scheme, keeps the path and writes params into the query", () => {
        const built = toGitUri({ path: "/repo/src/a.ts", fsPath: "/repo/src/a.ts" }, "HEAD");

        expect(built.scheme).toBe(GIT_SCHEME);
        expect(built.path).toBe("/repo/src/a.ts");
        expect(JSON.parse(built.query)).toEqual({ path: "/repo/src/a.ts", ref: "HEAD" });
    });

    it("puts fsPath, not path, into the query: they differ on Windows", () => {
        const built = toGitUri({ path: "/C:/repo/a.ts", fsPath: "C:\\repo\\a.ts" }, "HEAD");

        expect(JSON.parse(built.query)).toEqual({ path: "C:\\repo\\a.ts", ref: "HEAD" });
    });

    it("an empty ref (index) is a valid revision", () => {
        expect(JSON.parse(toGitUri({ path: "/a.ts", fsPath: "/a.ts" }, "").query)).toEqual({ path: "/a.ts", ref: "" });
    });
});

describe("fromGitUri", () => {
    it("round-trip returns the original params", () => {
        const built = toGitUri({ path: "/repo/a.ts", fsPath: "/repo/a.ts" }, "HEAD");

        expect(fromGitUri({ scheme: built.scheme, query: built.query })).toEqual({ path: "/repo/a.ts", ref: "HEAD" });
    });

    it("a foreign scheme gives null", () => {
        expect(fromGitUri({ scheme: "file", query: '{"path":"/a.ts","ref":"HEAD"}' })).toBeNull();
    });

    it("an unparsable query gives null, not an exception", () => {
        expect(fromGitUri({ scheme: "git", query: "not json" })).toBeNull();
    });

    it("a structurally foreign query gives null", () => {
        for (const query of ["null", '"string"', "42", "{}", '{"ref":"HEAD"}', '{"path":"/a.ts"}']) {
            expect(fromGitUri({ scheme: "git", query })).toBeNull();
        }
    });

    it("rejects an empty path: there would be nothing to read", () => {
        expect(fromGitUri({ scheme: "git", query: '{"path":"","ref":"HEAD"}' })).toBeNull();
    });

    it("rejects non-string fields", () => {
        expect(fromGitUri({ scheme: "git", query: '{"path":1,"ref":"HEAD"}' })).toBeNull();
        expect(fromGitUri({ scheme: "git", query: '{"path":"/a.ts","ref":2}' })).toBeNull();
    });
});
