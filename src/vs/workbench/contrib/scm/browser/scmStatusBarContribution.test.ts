import { describe, expect, it } from "vitest";

import { createSwitchableIcons } from "../../../../../TestUtils/switchableIcons.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { NULL_STATE_SERVICE } from "../../../../platform/state/common/nullStateService.ts";
import type { IProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";

import { PUBLISH_REPO_STATE_COMMAND, ScmRepoStateService } from "./repoStateService.ts";
import { BRANCH_ICON, ScmStatusBarContribution } from "./scmStatusBarContribution.ts";

const BRANCH_GLYPH = BRANCH_ICON.nerdFont;

const STATE = {
    branch: "main",
    detached: false,
    upstream: "origin/main",
    ahead: 1,
    behind: 2,
    remotes: ["origin"],
    state: "idle",
};

function setup(icons?: IProductIconService): {
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
    const contribution = new ScmStatusBarContribution(statusBar, repoState, commands, icons);
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
        click: (id) =>
            statusBar
                .entries()
                .find((e) => e.id === id)
                ?.onClick?.(),
    };
}

describe("ScmStatusBarContribution", () => {
    it("no entries before repo-state is published; publish gives the branch and counters", () => {
        const h = setup();
        expect(h.texts()).toEqual([]);

        h.publish(STATE);
        expect(h.texts()).toEqual([`${BRANCH_GLYPH} main`, "↓2 ↑1"]);
    });

    it("diode.icons.nerdFont: the branch glyph follows the setting live", async () => {
        const { icons, set } = createSwitchableIcons(true);
        const h = setup(icons);
        h.publish(STATE);

        await set(false);
        expect(h.texts()).toEqual(["⎇ main", "↓2 ↑1"]);
        await set(true);
        expect(h.texts()).toEqual([`${BRANCH_GLYPH} main`, "↓2 ↑1"]);
    });

    it("clicks: branch → git.checkout, counters → git.sync, without upstream → git.publish", () => {
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

    it("detached and merge state are reflected in the text; without remotes the sync segment disappears", () => {
        const h = setup();
        h.publish({ ...STATE, branch: null, detached: true, state: "merging", remotes: [], upstream: null });
        expect(h.texts()).toEqual([`${BRANCH_GLYPH} detached (merging)`]);

        h.publish(STATE);
        expect(h.texts()).toEqual([`${BRANCH_GLYPH} main`, "↓2 ↑1"]);
    });

    it("unborn HEAD (not detached, no branch): the unborn label", () => {
        const h = setup();
        h.publish({ ...STATE, branch: null, upstream: null, remotes: [] });
        expect(h.texts()).toEqual([`${BRANCH_GLYPH} unborn`]);
    });

    it("dispose removes the entries", () => {
        const h = setup();
        h.publish(STATE);
        h.contribution.dispose();
        expect(h.texts()).toEqual([]);
    });
});
