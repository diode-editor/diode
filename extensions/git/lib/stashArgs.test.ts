import { describe, expect, it } from "vitest";

import { stashApplyArgs, stashDropArgs, stashPopArgs, stashPushArgs } from "./stashArgs.ts";

describe("stashArgs", () => {
    it("push: флаги -u/--staged и опциональное сообщение", () => {
        expect(stashPushArgs({})).toEqual(["stash", "push"]);
        expect(stashPushArgs({ includeUntracked: true })).toEqual(["stash", "push", "-u"]);
        expect(stashPushArgs({ staged: true })).toEqual(["stash", "push", "--staged"]);
        expect(stashPushArgs({ message: "  wip  " })).toEqual(["stash", "push", "-m", "wip"]);
        expect(stashPushArgs({ message: "   " })).toEqual(["stash", "push"]);
        expect(stashPushArgs({ message: 42 })).toEqual(["stash", "push"]);
    });

    it("pop/apply: без индекса — latest; валидный индекс — явный; мусорный — null", () => {
        expect(stashPopArgs({})).toEqual(["stash", "pop"]);
        expect(stashPopArgs({ index: "stash@{2}" })).toEqual(["stash", "pop", "stash@{2}"]);
        expect(stashPopArgs({ index: "--evil" })).toBeNull();
        expect(stashApplyArgs({})).toEqual(["stash", "apply"]);
        expect(stashApplyArgs({ index: "stash@{0}" })).toEqual(["stash", "apply", "stash@{0}"]);
        expect(stashApplyArgs({ index: "junk" })).toBeNull();
    });

    it("drop: индекс обязателен", () => {
        expect(stashDropArgs({ index: "stash@{1}" })).toEqual(["stash", "drop", "stash@{1}"]);
        expect(stashDropArgs({})).toBeNull();
        expect(stashDropArgs({ index: "stash@{x}" })).toBeNull();
    });
});
