import { describe, expect, it } from "vitest";

import { classifyGitStderr } from "./classifyGitError.ts";

describe("classifyGitStderr", () => {
    it("auth: отключённые промпты, пароли, ssh", () => {
        expect(classifyGitStderr("fatal: could not read Username for 'https://x': terminal prompts disabled")).toBe(
            "auth",
        );
        expect(classifyGitStderr("remote: Authentication failed")).toBe("auth");
        expect(classifyGitStderr("git@github.com: Permission denied (publickey).")).toBe("auth");
        expect(classifyGitStderr("Host key verification failed.")).toBe("auth");
    });

    it("conflict: merge/rebase/cherry-pick", () => {
        expect(classifyGitStderr("CONFLICT (content): Merge conflict in a.ts\nAutomatic merge failed")).toBe(
            "conflict",
        );
        expect(classifyGitStderr("error: could not apply abc123... feat")).toBe("conflict");
    });

    it("dirty-worktree, push-rejected, no-upstream, not-merged", () => {
        expect(classifyGitStderr("error: Your local changes to the following files would be overwritten by merge")).toBe(
            "dirty-worktree",
        );
        expect(classifyGitStderr(" ! [rejected] main -> main (non-fast-forward)")).toBe("push-rejected");
        expect(classifyGitStderr("error: failed to push some refs to 'origin'")).toBe("push-rejected");
        expect(classifyGitStderr("fatal: The current branch feature has no upstream branch.")).toBe("no-upstream");
        expect(classifyGitStderr("error: the branch 'x' is not fully merged")).toBe("not-merged");
    });

    it("прочее — git-error", () => {
        expect(classifyGitStderr("fatal: unable to access 'https://nowhere/': Could not resolve host")).toBe(
            "git-error",
        );
        expect(classifyGitStderr("")).toBe("git-error");
    });
});
