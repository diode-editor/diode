import { describe, expect, it } from "vitest";

import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";

import { PUBLISH_REPO_STATE_COMMAND, ScmRepoStateService } from "./repoStateService.ts";
import { BRANCH_GLYPH, ScmStatusBarContribution } from "./scmStatusBarContribution.ts";

const STATE = {
    branch: "main",
    detached: false,
    upstream: "origin/main",
    ahead: 1,
    behind: 2,
    remotes: ["origin"],
    state: "idle",
};

function setup(): {
    contribution: ScmStatusBarContribution;
    commands: CommandRegistry;
    statusBar: StatusBarService;
    executed: string[];
    publish: (state: unknown) => void;
    texts: () => string[];
    click: (id: string) => void;
} {
    const commands = new CommandRegistry();
    const statusBar = new StatusBarService(NULL_STATE_SERVICE);
    const repoState = new ScmRepoStateService(commands, new ContextKeyService());
    const contribution = new ScmStatusBarContribution(statusBar, repoState, commands);
    const executed: string[] = [];
    for (const id of ["git.checkout", "git.sync", "git.publish"]) {
        commands.register(id, () => executed.push(id));
    }
    return {
        contribution,
        commands,
        statusBar,
        executed,
        publish: (state) => commands.execute(PUBLISH_REPO_STATE_COMMAND, state),
        texts: () => statusBar.entries().map((e) => e.text),
        click: (id) => statusBar.entries().find((e) => e.id === id)?.onClick?.(),
    };
}

describe("ScmStatusBarContribution", () => {
    it("до публикации repo-state записей нет; публикация даёт ветку и счётчики", () => {
        const h = setup();
        expect(h.texts()).toEqual([]);

        h.publish(STATE);
        expect(h.texts()).toEqual([`${BRANCH_GLYPH} main`, "↓2 ↑1"]);
    });

    it("клики: ветка → git.checkout, счётчики → git.sync, без upstream → git.publish", () => {
        const h = setup();
        h.publish(STATE);
        h.click("status.scm.branch");
        h.click("status.scm.sync");
        expect(h.executed).toEqual(["git.checkout", "git.sync"]);

        h.executed.length = 0;
        h.publish({ ...STATE, upstream: null, ahead: 0, behind: 0 });
        expect(h.texts()[1]).toBe("☁ publish");
        h.click("status.scm.sync");
        expect(h.executed).toEqual(["git.publish"]);
    });

    it("detached и merge-состояние отражаются в тексте; без remotes sync-сегмент исчезает", () => {
        const h = setup();
        h.publish({ ...STATE, branch: null, detached: true, state: "merging", remotes: [], upstream: null });
        expect(h.texts()).toEqual([`${BRANCH_GLYPH} detached (merging)`]);

        // Возврат remotes — сегмент возвращается.
        h.publish(STATE);
        expect(h.texts()).toEqual([`${BRANCH_GLYPH} main`, "↓2 ↑1"]);
    });

    it("unborn HEAD (не detached, ветки нет) — метка unborn", () => {
        const h = setup();
        h.publish({ ...STATE, branch: null, upstream: null, remotes: [] });
        expect(h.texts()).toEqual([`${BRANCH_GLYPH} unborn`]);
    });

    it("dispose снимает записи", () => {
        const h = setup();
        h.publish(STATE);
        h.contribution.dispose();
        expect(h.texts()).toEqual([]);
    });
});
