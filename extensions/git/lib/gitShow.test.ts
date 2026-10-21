import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { GitRevisionNotFoundError, showFileAtRevision, toRepoRelativePath } from "./gitShow.ts";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));

const { spawn } = await import("node:child_process");
const spawnMock = vi.mocked(spawn);

class FakeChild extends EventEmitter {
    public readonly stdout = new EventEmitter();
    public readonly stderr = new EventEmitter();
    public kill(): boolean {
        return true;
    }
}

function nextGit(code: number, stdout = ""): FakeChild {
    const child = new FakeChild();
    spawnMock.mockReturnValue(child as never);
    queueMicrotask(() => {
        if (stdout !== "") child.stdout.emit("data", Buffer.from(stdout, "utf8"));
        child.emit("close", code);
    });
    return child;
}

afterEach(() => {
    spawnMock.mockReset();
});

describe("toRepoRelativePath", () => {
    it("makes the path relative to the repository root", () => {
        expect(toRepoRelativePath("/repo", "/repo/src/a.ts")).toBe("src/a.ts");
    });

    it("a file outside the repository gives null", () => {
        expect(toRepoRelativePath("/repo", "/other/a.ts")).toBeNull();
    });

    it("the root itself gives null (not a file)", () => {
        expect(toRepoRelativePath("/repo", "/repo")).toBeNull();
    });

    it("a path to the parent level gives null", () => {
        expect(toRepoRelativePath("/repo/src", "/repo/a.ts")).toBeNull();
    });
});

describe("showFileAtRevision", () => {
    it("returns the revision content and calls git show with a relative path", async () => {
        nextGit(0, "original text\n");

        const bytes = await showFileAtRevision("/repo", "/repo/src/a.ts", "HEAD");

        expect(new TextDecoder().decode(bytes)).toBe("original text\n");
        expect(spawnMock.mock.calls[0][1]).toEqual(["show", "HEAD:src/a.ts"]);
        expect(spawnMock.mock.calls[0][2]).toMatchObject({ cwd: "/repo" });
    });

    it("an empty ref addresses the index", async () => {
        nextGit(0, "from index");

        await showFileAtRevision("/repo", "/repo/a.ts", "");

        expect(spawnMock.mock.calls[0][1]).toEqual(["show", ":a.ts"]);
    });

    it("file absent at the revision (non-zero code) → GitRevisionNotFoundError", async () => {
        nextGit(128);

        await expect(showFileAtRevision("/repo", "/repo/new.ts", "HEAD")).rejects.toBeInstanceOf(
            GitRevisionNotFoundError,
        );
    });

    it("rejects a file outside the repository WITHOUT running git", async () => {
        await expect(showFileAtRevision("/repo", "/other/a.ts", "HEAD")).rejects.toBeInstanceOf(
            GitRevisionNotFoundError,
        );

        expect(spawnMock).not.toHaveBeenCalled();
    });

    it("unavailable git gives the same rejection: the gutter has nothing to show either way", async () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);
        queueMicrotask(() => child.emit("error", new Error("ENOENT")));

        await expect(showFileAtRevision("/repo", "/repo/a.ts", "HEAD")).rejects.toBeInstanceOf(
            GitRevisionNotFoundError,
        );
    });

    it("passes env to the child process (git.path setting)", async () => {
        nextGit(0, "x");

        await showFileAtRevision("/repo", "/repo/a.ts", "HEAD", { PATH: "/custom/bin" });

        expect(spawnMock.mock.calls[0][2]).toMatchObject({ env: { PATH: "/custom/bin" } });
    });

    it("empty revision content is a valid result, not an error", async () => {
        nextGit(0, "");

        expect(new TextDecoder().decode(await showFileAtRevision("/repo", "/repo/empty.ts", "HEAD"))).toBe("");
    });
});
