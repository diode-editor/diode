import { describe, expect, it } from "vitest";

import { Uri } from "../../../base/common/uri.ts";

import { RelativePattern } from "./vscodeTypes.ts";

describe("RelativePattern", () => {
    it("строковая база превращается в file-uri", () => {
        const pattern = new RelativePattern("/repo", "*.ts");
        expect(pattern.baseUri.fsPath).toBe("/repo");
        expect(pattern.base).toBe("/repo");
        expect(pattern.pattern).toBe("*.ts");
    });

    it("папка воркспейса отдаёт свой uri", () => {
        const folder = { uri: Uri.file("/repo"), name: "repo", index: 0 };
        expect(new RelativePattern(folder as never, "**").baseUri.fsPath).toBe("/repo");
    });

    it("base и baseUri держатся синхронно в обе стороны", () => {
        const pattern = new RelativePattern(Uri.file("/repo"), "*");
        pattern.base = "/other";
        expect(pattern.baseUri.fsPath).toBe("/other");
        pattern.baseUri = Uri.file("/third");
        expect(pattern.base).toBe("/third");
    });

    it("чужой uri-подобный объект принимается по строковому виду", () => {
        const foreign = { uri: { toString: () => "file:///foreign" } };
        expect(new RelativePattern(foreign as never, "*").baseUri.fsPath).toBe("/foreign");
    });

    it("база не-база — понятная ошибка, а не молчаливый мусор", () => {
        expect(() => new RelativePattern({ uri: 42 } as never, "*")).toThrow(TypeError);
    });
});
