import { describe, expect, it, vi } from "vitest";

import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";

import { PUBLISH_LOG_COMMAND, ScmGraphService } from "./graphService.ts";

function setup(): { service: ScmGraphService; commands: CommandRegistry } {
    const commands = new CommandRegistry();
    const service = new ScmGraphService(commands);
    return { service, commands };
}

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const A = { sha: SHA_A, shortSha: "aaaaaaaa", subject: "feat: панель" };
const B = { sha: SHA_B, shortSha: "bbbbbbbb", subject: "fix: сэш" };

describe("ScmGraphService", () => {
    it("публикует набор командой и отдаёт его снимком + событием", () => {
        const { service, commands } = setup();
        const changed = vi.fn();
        service.onDidChangeCommits(changed);

        commands.execute(PUBLISH_LOG_COMMAND, [A, B]);

        expect(changed).toHaveBeenCalledTimes(1);
        expect(service.commits).toEqual([A, B]);
    });

    it("повторная идентичная публикация гасится без события", () => {
        const { service, commands } = setup();
        const changed = vi.fn();
        service.onDidChangeCommits(changed);

        commands.execute(PUBLISH_LOG_COMMAND, [A]);
        commands.execute(PUBLISH_LOG_COMMAND, [A]);
        expect(changed).toHaveBeenCalledTimes(1);

        commands.execute(PUBLISH_LOG_COMMAND, []);
        expect(changed).toHaveBeenCalledTimes(2);
        expect(service.commits).toEqual([]);
    });

    it("отбрасывает мусорные записи, не-массив трактует как пустой набор", () => {
        const { service, commands } = setup();

        commands.execute(PUBLISH_LOG_COMMAND, [A, null, 42, { sha: "" }, { sha: SHA_B, subject: 1 }]);
        expect(service.commits).toEqual([A]);

        commands.execute(PUBLISH_LOG_COMMAND, "not-an-array");
        expect(service.commits).toEqual([]);
    });

    it("shortSha необязателен: без него ядро урезает sha", () => {
        const { service, commands } = setup();

        commands.execute(PUBLISH_LOG_COMMAND, [{ sha: SHA_A, subject: "s" }]);
        expect(service.commits).toEqual([{ sha: SHA_A, shortSha: "aaaaaaaa", subject: "s" }]);
    });

    it("отписка события работает", () => {
        const { service, commands } = setup();
        const changed = vi.fn();
        const subscription = service.onDidChangeCommits(changed);
        subscription.dispose();

        commands.execute(PUBLISH_LOG_COMMAND, [A]);
        expect(changed).not.toHaveBeenCalled();
    });
});
