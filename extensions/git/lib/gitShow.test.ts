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
    it("делает путь относительным от корня репозитория", () => {
        expect(toRepoRelativePath("/repo", "/repo/src/a.ts")).toBe("src/a.ts");
    });

    it("файл вне репозитория — null", () => {
        expect(toRepoRelativePath("/repo", "/other/a.ts")).toBeNull();
    });

    it("сам корень — null (это не файл)", () => {
        expect(toRepoRelativePath("/repo", "/repo")).toBeNull();
    });

    it("путь на верхний уровень — null", () => {
        expect(toRepoRelativePath("/repo/src", "/repo/a.ts")).toBeNull();
    });
});

describe("showFileAtRevision", () => {
    it("отдаёт содержимое ревизии и зовёт git show с относительным путём", async () => {
        nextGit(0, "исходный текст\n");

        const bytes = await showFileAtRevision("/repo", "/repo/src/a.ts", "HEAD");

        expect(new TextDecoder().decode(bytes)).toBe("исходный текст\n");
        expect(spawnMock.mock.calls[0][1]).toEqual(["show", "HEAD:src/a.ts"]);
        expect(spawnMock.mock.calls[0][2]).toMatchObject({ cwd: "/repo" });
    });

    it("пустой ref адресует индекс", async () => {
        nextGit(0, "из индекса");

        await showFileAtRevision("/repo", "/repo/a.ts", "");

        expect(spawnMock.mock.calls[0][1]).toEqual(["show", ":a.ts"]);
    });

    it("файла нет в ревизии (ненулевой код) → GitRevisionNotFoundError", async () => {
        nextGit(128);

        await expect(showFileAtRevision("/repo", "/repo/new.ts", "HEAD")).rejects.toBeInstanceOf(
            GitRevisionNotFoundError,
        );
    });

    it("файл вне репозитория отвергается БЕЗ запуска git", async () => {
        await expect(showFileAtRevision("/repo", "/other/a.ts", "HEAD")).rejects.toBeInstanceOf(
            GitRevisionNotFoundError,
        );

        expect(spawnMock).not.toHaveBeenCalled();
    });

    it("недоступный git — тот же отказ: гуттеру нечего показывать в обоих случаях", async () => {
        const child = new FakeChild();
        spawnMock.mockReturnValue(child as never);
        queueMicrotask(() => child.emit("error", new Error("ENOENT")));

        await expect(showFileAtRevision("/repo", "/repo/a.ts", "HEAD")).rejects.toBeInstanceOf(
            GitRevisionNotFoundError,
        );
    });

    it("пробрасывает env в дочерний процесс (настройка git.path)", async () => {
        nextGit(0, "x");

        await showFileAtRevision("/repo", "/repo/a.ts", "HEAD", { PATH: "/custom/bin" });

        expect(spawnMock.mock.calls[0][2]).toMatchObject({ env: { PATH: "/custom/bin" } });
    });

    it("пустое содержимое ревизии — валидный результат, а не ошибка", async () => {
        nextGit(0, "");

        expect(new TextDecoder().decode(await showFileAtRevision("/repo", "/repo/empty.ts", "HEAD"))).toBe("");
    });
});
