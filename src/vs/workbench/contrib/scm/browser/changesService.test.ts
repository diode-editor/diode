import { describe, expect, it, vi } from "vitest";

import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";

import { PUBLISH_CHANGES_COMMAND, ScmChangesService } from "./changesService.ts";

/** Собирает сервис поверх реестра команд; возвращает и то, и другое. */
function setup(): { service: ScmChangesService; commands: CommandRegistry } {
    const commands = new CommandRegistry();
    const service = new ScmChangesService(commands);
    return { service, commands };
}

const A = {
    uri: "file:///repo/a.ts",
    status: "M",
    colorId: "gitDecoration.modifiedResourceForeground",
    path: "a.ts",
    group: "worktree",
};
const B = {
    uri: "file:///repo/src/b.ts",
    status: "U",
    colorId: "gitDecoration.untrackedResourceForeground",
    path: "src/b.ts",
    group: "untracked",
};

describe("ScmChangesService", () => {
    it("публикует набор командой и отдаёт его снимком + событием", () => {
        const { service, commands } = setup();
        const changed = vi.fn();
        service.onDidChangeChanges(changed);

        commands.execute(PUBLISH_CHANGES_COMMAND, [A, B]);

        expect(changed).toHaveBeenCalledTimes(1);
        expect(service.changes.map((c) => [c.uri.toString(), c.status, c.colorId, c.path, c.group])).toEqual([
            ["file:///repo/a.ts", "M", "gitDecoration.modifiedResourceForeground", "a.ts", "worktree"],
            ["file:///repo/src/b.ts", "U", "gitDecoration.untrackedResourceForeground", "src/b.ts", "untracked"],
        ]);
    });

    it("отбрасывает мусорные записи (включая мусорную группу), не-массив — пустой набор", () => {
        const { service, commands } = setup();

        commands.execute(PUBLISH_CHANGES_COMMAND, [
            A,
            null,
            42,
            { uri: "" },
            { uri: "file:///x", status: 1 },
            { uri: "file:///x", status: "M" }, // без группы
            { uri: "file:///x", status: "M", group: "outer-space" }, // группа не из enum
        ]);
        expect(service.changes.map((c) => c.uri.toString())).toEqual(["file:///repo/a.ts"]);

        commands.execute(PUBLISH_CHANGES_COMMAND, "not-an-array");
        expect(service.changes).toEqual([]);
    });

    it("colorId и path необязательны: без них — пустые строки", () => {
        const { service, commands } = setup();

        commands.execute(PUBLISH_CHANGES_COMMAND, [{ uri: "file:///x", status: "M", group: "index" }]);

        expect(service.changes[0].colorId).toBe("");
        expect(service.changes[0].path).toBe("");
        expect(service.changes[0].group).toBe("index");
    });

    it("идентичную повторную публикацию гасит — событие не файрится", () => {
        const { service, commands } = setup();
        const changed = vi.fn();
        service.onDidChangeChanges(changed);

        commands.execute(PUBLISH_CHANGES_COMMAND, [A]);
        commands.execute(PUBLISH_CHANGES_COMMAND, [A]);

        expect(changed).toHaveBeenCalledTimes(1);
    });

    it("пустой набор очищает список и файрит событие", () => {
        const { service, commands } = setup();
        const changed = vi.fn();
        commands.execute(PUBLISH_CHANGES_COMMAND, [A]);
        service.onDidChangeChanges(changed);

        commands.execute(PUBLISH_CHANGES_COMMAND, []);

        expect(changed).toHaveBeenCalledTimes(1);
        expect(service.changes).toEqual([]);
    });

    it("подписку можно снять", () => {
        const { service, commands } = setup();
        const changed = vi.fn();
        const sub = service.onDidChangeChanges(changed);

        sub.dispose();
        commands.execute(PUBLISH_CHANGES_COMMAND, [A]);

        expect(changed).not.toHaveBeenCalled();
    });

    it("dispose снимает регистрацию команды", () => {
        const { service, commands } = setup();

        service.dispose();

        expect(commands.has(PUBLISH_CHANGES_COMMAND)).toBe(false);
    });
});
