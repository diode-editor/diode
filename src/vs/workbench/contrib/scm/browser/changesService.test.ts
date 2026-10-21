import { describe, expect, it, vi } from "vitest";

import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";

import { PUBLISH_CHANGES_COMMAND, ScmChangesService } from "./changesService.ts";

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
    it("publishes the set via a command and exposes it as a snapshot + event", () => {
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

    it("drops garbage entries (a garbage group included), a non-array is an empty set", () => {
        const { service, commands } = setup();

        commands.execute(PUBLISH_CHANGES_COMMAND, [
            A,
            null,
            42,
            { uri: "" },
            { uri: "file:///x", status: 1 },
            { uri: "file:///x", status: "M" }, // no group
            { uri: "file:///x", status: "M", group: "outer-space" }, // group not in the enum
        ]);
        expect(service.changes.map((c) => c.uri.toString())).toEqual(["file:///repo/a.ts"]);

        commands.execute(PUBLISH_CHANGES_COMMAND, "not-an-array");
        expect(service.changes).toEqual([]);
    });

    it("colorId and path are optional: empty strings without them", () => {
        const { service, commands } = setup();

        commands.execute(PUBLISH_CHANGES_COMMAND, [{ uri: "file:///x", status: "M", group: "index" }]);

        expect(service.changes[0].colorId).toBe("");
        expect(service.changes[0].path).toBe("");
        expect(service.changes[0].group).toBe("index");
    });

    it("an identical repeated publish is suppressed: the event does not fire", () => {
        const { service, commands } = setup();
        const changed = vi.fn();
        service.onDidChangeChanges(changed);

        commands.execute(PUBLISH_CHANGES_COMMAND, [A]);
        commands.execute(PUBLISH_CHANGES_COMMAND, [A]);

        expect(changed).toHaveBeenCalledTimes(1);
    });

    it("an empty set clears the list and fires the event", () => {
        const { service, commands } = setup();
        const changed = vi.fn();
        commands.execute(PUBLISH_CHANGES_COMMAND, [A]);
        service.onDidChangeChanges(changed);

        commands.execute(PUBLISH_CHANGES_COMMAND, []);

        expect(changed).toHaveBeenCalledTimes(1);
        expect(service.changes).toEqual([]);
    });

    it("the subscription can be removed", () => {
        const { service, commands } = setup();
        const changed = vi.fn();
        const sub = service.onDidChangeChanges(changed);

        sub.dispose();
        commands.execute(PUBLISH_CHANGES_COMMAND, [A]);

        expect(changed).not.toHaveBeenCalled();
    });

    it("dispose removes the command registration", () => {
        const { service, commands } = setup();

        service.dispose();

        expect(commands.has(PUBLISH_CHANGES_COMMAND)).toBe(false);
    });
});
