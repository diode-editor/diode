import { describe, expect, it } from "vitest";

import {
    branchCreateArgs,
    branchDeleteArgs,
    branchRenameArgs,
    checkoutArgs,
    cherryPickArgs,
    mergeArgs,
    pushDeleteArgs,
    rebaseArgs,
} from "./branchArgs.ts";

describe("branchArgs", () => {
    it("checkout: обычный и detached; невалидный ref — null", () => {
        expect(checkoutArgs({ ref: "main" })).toEqual(["checkout", "main"]);
        expect(checkoutArgs({ ref: "v1.0", detach: true })).toEqual(["checkout", "--detach", "v1.0"]);
        expect(checkoutArgs({ ref: "--evil" })).toBeNull();
        expect(checkoutArgs({})).toBeNull();
    });

    it("branchCreate: с базой и без; branchDelete: -d/-D; branchRename", () => {
        expect(branchCreateArgs({ name: "feat" })).toEqual(["checkout", "-b", "feat"]);
        expect(branchCreateArgs({ name: "feat", base: "origin/main" })).toEqual([
            "checkout",
            "-b",
            "feat",
            "origin/main",
        ]);
        expect(branchCreateArgs({ base: "main" })).toBeNull();

        expect(branchDeleteArgs({ name: "feat" })).toEqual(["branch", "-d", "feat"]);
        expect(branchDeleteArgs({ name: "feat", force: true })).toEqual(["branch", "-D", "feat"]);
        expect(branchDeleteArgs({})).toBeNull();

        expect(branchRenameArgs({ name: "renamed" })).toEqual(["branch", "-m", "renamed"]);
        expect(branchRenameArgs({ name: "-m" })).toBeNull();
    });

    it("merge/rebase/cherryPick/pushDelete", () => {
        expect(mergeArgs({ ref: "feature" })).toEqual(["merge", "feature"]);
        expect(mergeArgs({})).toBeNull();
        expect(rebaseArgs({ ref: "main" })).toEqual(["rebase", "main"]);
        expect(rebaseArgs({})).toBeNull();
        expect(cherryPickArgs({ sha: "abc123" })).toEqual(["cherry-pick", "abc123"]);
        expect(cherryPickArgs({ sha: "--all" })).toBeNull();
        expect(pushDeleteArgs({ remote: "origin", ref: "feat" })).toEqual(["push", "origin", "--delete", "feat"]);
        expect(pushDeleteArgs({ remote: "origin" })).toBeNull();
        expect(pushDeleteArgs({ ref: "feat" })).toBeNull();
    });
});
