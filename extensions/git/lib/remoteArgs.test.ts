import { describe, expect, it } from "vitest";

import { remoteAddArgs, remoteRemoveArgs, tagCreateArgs, tagDeleteArgs } from "./remoteArgs.ts";

describe("remoteArgs", () => {
    it("remote add/remove with flag protection", () => {
        expect(remoteAddArgs({ name: "origin", url: "https://x/y.git" })).toEqual([
            "remote",
            "add",
            "origin",
            "https://x/y.git",
        ]);
        expect(remoteAddArgs({ name: "origin" })).toBeNull();
        expect(remoteAddArgs({ name: "--evil", url: "u" })).toBeNull();
        expect(remoteRemoveArgs({ name: "origin" })).toEqual(["remote", "remove", "origin"]);
        expect(remoteRemoveArgs({})).toBeNull();
    });

    it("tag: lightweight without a message, annotated with one; delete", () => {
        expect(tagCreateArgs({ name: "v1.0" })).toEqual(["tag", "v1.0"]);
        expect(tagCreateArgs({ name: "v1.0", message: "  " })).toEqual(["tag", "v1.0"]);
        expect(tagCreateArgs({ name: "v1.0", message: "release" })).toEqual(["tag", "-a", "v1.0", "-m", "release"]);
        expect(tagCreateArgs({})).toBeNull();
        expect(tagDeleteArgs({ name: "v1.0" })).toEqual(["tag", "-d", "v1.0"]);
        expect(tagDeleteArgs({ name: "-d" })).toBeNull();
    });

    it("a tag on a specific commit puts the ref last", () => {
        const sha = "a".repeat(40);
        expect(tagCreateArgs({ name: "v1.0", ref: sha })).toEqual(["tag", "v1.0", sha]);
        expect(tagCreateArgs({ name: "v1.0", message: "release", ref: sha })).toEqual([
            "tag",
            "-a",
            "v1.0",
            "-m",
            "release",
            sha,
        ]);
        expect(tagCreateArgs({ name: "v1.0", ref: "--force" })).toEqual(["tag", "v1.0"]);
    });
});
