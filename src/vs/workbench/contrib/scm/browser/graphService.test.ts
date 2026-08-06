import { describe, expect, it, vi } from "vitest";

import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";

import type { IScmCommit } from "./graphService.ts";
import { PUBLISH_LOG_COMMAND, ScmGraphService } from "./graphService.ts";

function setup(): { service: ScmGraphService; commands: CommandRegistry } {
    const commands = new CommandRegistry();
    const service = new ScmGraphService(commands);
    return { service, commands };
}

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

/** Запись расширения с дефолтами полей, которые тест не проверяет. */
function commit(fields: Partial<IScmCommit> & { sha: string; subject: string }): IScmCommit {
    return {
        shortSha: fields.sha.slice(0, 8),
        parents: [],
        refs: [],
        author: "Eugene",
        timestamp: 1700000000,
        ...fields,
    };
}

const A = commit({ sha: SHA_A, subject: "feat: панель", parents: [SHA_B] });
const B = commit({ sha: SHA_B, subject: "fix: сэш" });

/** Payload расширения: страница плюс признак «есть что грузить дальше». */
function publish(commands: CommandRegistry, commits: unknown, hasMore = false): void {
    commands.execute(PUBLISH_LOG_COMMAND, { commits, hasMore });
}

describe("ScmGraphService", () => {
    it("публикует страницу командой и отдаёт её снимком + событием", () => {
        const { service, commands } = setup();
        const changed = vi.fn();
        service.onDidChangeCommits(changed);

        publish(commands, [A, B]);

        expect(changed).toHaveBeenCalledTimes(1);
        expect(service.commits).toEqual([A, B]);
        expect(service.hasMore).toBe(false);
    });

    it("hasMore переезжает в снимок и участвует в подписи набора", () => {
        const { service, commands } = setup();
        const changed = vi.fn();
        service.onDidChangeCommits(changed);

        publish(commands, [A], true);
        expect(service.hasMore).toBe(true);

        // Тот же набор, но история закончилась — строка «Load More…» должна уйти.
        publish(commands, [A], false);
        expect(changed).toHaveBeenCalledTimes(2);
        expect(service.hasMore).toBe(false);
    });

    it("повторная идентичная публикация гасится без события", () => {
        const { service, commands } = setup();
        const changed = vi.fn();
        service.onDidChangeCommits(changed);

        publish(commands, [A]);
        publish(commands, [A]);
        expect(changed).toHaveBeenCalledTimes(1);

        publish(commands, []);
        expect(changed).toHaveBeenCalledTimes(2);
        expect(service.commits).toEqual([]);
    });

    it("смена родителей или бейджей при том же sha перерисовывает граф", () => {
        const { service, commands } = setup();
        const changed = vi.fn();
        service.onDidChangeCommits(changed);

        publish(commands, [commit({ sha: SHA_A, subject: "s" })]);
        publish(commands, [commit({ sha: SHA_A, subject: "s", parents: [SHA_B] })]);
        expect(changed).toHaveBeenCalledTimes(2);

        publish(commands, [
            commit({ sha: SHA_A, subject: "s", parents: [SHA_B], refs: [{ name: "main", kind: "head", current: true }] }),
        ]);
        expect(changed).toHaveBeenCalledTimes(3);
    });

    it("отбрасывает мусорные записи, не-объект трактует как пустой набор", () => {
        const { service, commands } = setup();

        publish(commands, [A, null, 42, { sha: "" }, { sha: SHA_B, subject: 1 }]);
        expect(service.commits).toEqual([A]);

        publish(commands, "not-an-array");
        expect(service.commits).toEqual([]);

        commands.execute(PUBLISH_LOG_COMMAND, "not-an-object");
        expect(service.commits).toEqual([]);
        expect(service.hasMore).toBe(false);
    });

    it("мусор в родителях и бейджах отсеивается по одному элементу", () => {
        const { service, commands } = setup();

        publish(commands, [
            {
                sha: SHA_A,
                subject: "s",
                parents: [SHA_B, "", 42, null],
                refs: [
                    { name: "main", kind: "head", current: true },
                    { name: "", kind: "head" },
                    { name: "x", kind: "branch" },
                    null,
                    42,
                ],
                author: 7,
                timestamp: "вчера",
            },
        ]);

        expect(service.commits).toEqual([
            commit({
                sha: SHA_A,
                subject: "s",
                parents: [SHA_B],
                refs: [{ name: "main", kind: "head", current: true }],
                author: "",
                timestamp: 0,
            }),
        ]);
    });

    it("shortSha необязателен: без него ядро урезает sha", () => {
        const { service, commands } = setup();

        publish(commands, [{ sha: SHA_A, subject: "s" }]);
        expect(service.commits[0].shortSha).toBe("aaaaaaaa");
    });

    it("отписка события работает", () => {
        const { service, commands } = setup();
        const changed = vi.fn();
        const subscription = service.onDidChangeCommits(changed);
        subscription.dispose();

        publish(commands, [A]);
        expect(changed).not.toHaveBeenCalled();
    });
});
