/* eslint-disable @typescript-eslint/no-deprecated -- `base` is deprecated on purpose (matches the upstream surface), and this suite tests exactly it. */
import { describe, expect, it } from "vitest";

import { Uri } from "../../../base/common/uri.ts";

import { RelativePattern } from "./vscodeTypes.ts";

describe("RelativePattern", () => {
    it("a string base becomes a file uri", () => {
        const pattern = new RelativePattern("/repo", "*.ts");
        expect(pattern.baseUri.fsPath).toBe("/repo");
        expect(pattern.base).toBe("/repo");
        expect(pattern.pattern).toBe("*.ts");
    });

    it("a workspace folder gives its uri", () => {
        const folder = { uri: Uri.file("/repo"), name: "repo", index: 0 };
        expect(new RelativePattern(folder as never, "**").baseUri.fsPath).toBe("/repo");
    });

    it("base and baseUri stay in sync both ways", () => {
        const pattern = new RelativePattern(Uri.file("/repo"), "*");
        pattern.base = "/other";
        expect(pattern.baseUri.fsPath).toBe("/other");
        pattern.baseUri = Uri.file("/third");
        expect(pattern.base).toBe("/third");
    });

    it("a foreign uri-like object is accepted by its string form", () => {
        const foreign = { uri: { toString: () => "file:///foreign" } };
        expect(new RelativePattern(foreign as never, "*").baseUri.fsPath).toBe("/foreign");
    });

    it("a non-base base gives a clear error, not silent garbage", () => {
        expect(() => new RelativePattern({ uri: 42 } as never, "*")).toThrow(TypeError);
    });
});
