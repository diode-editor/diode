import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { viewMenuVisible } from "../../../browser/actions/menuContexts.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { SCM_CHANGES_VIEW_ID } from "../common/scmViews.ts";

import { GitRemotesMenu, GitTagsMenu } from "./gitMenus.ts";
import { runGitOp, showGitNotice } from "./gitOpClient.ts";
import { pickRemote, queryRefs } from "./syncActions.ts";

const inChangesMenu = viewMenuVisible(SCM_CHANGES_VIEW_ID);

/** Channel where the git extension's subprocess writes its logs (`[git] …`). */
const GIT_OUTPUT_SHOW_COMMAND = "workbench.action.output.show.extensions.host.stdout";

async function pickTag(accessor: ServiceAccessor, title: string): Promise<string | null> {
    const tags = (await queryRefs(accessor)).filter((r) => r.kind === "tag");
    if (tags.length === 0) {
        showGitNotice(accessor, "there are no tags");
        return null;
    }
    const picked = await accessor.get(QuickInputServiceDIToken).quickPick({
        title,
        placeholder: "Pick a tag",
        items: tags.map((r) => ({ label: r.name, description: `${r.sha} ${r.subject}` })),
    });
    return picked?.label ?? null;
}

/** URL first, then name — VS Code order. */
export const gitAddRemoteAction: CommandAction = {
    id: "git.addRemote",
    title: "Git: Add Remote...",
    shortTitle: "Add Remote...",
    when: "gitHasRepo",
    menus: [{ menuId: GitRemotesMenu, group: "1_remote", order: 10, when: "gitHasRepo" }],
    async run(accessor) {
        const quickInput = accessor.get(QuickInputServiceDIToken);
        const url = await quickInput.input({
            title: "Add Remote",
            placeholder: "Remote URL",
            validateInput: (v) => (v.trim() === "" ? "Remote URL is empty" : null),
        });
        if (url === undefined || url.trim() === "") return;
        const name = await quickInput.input({
            title: "Add Remote",
            placeholder: "Remote name",
            value: "origin",
            validateInput: (v) => (v.trim() === "" ? "Remote name is empty" : null),
        });
        if (name === undefined || name.trim() === "") return;
        await runGitOp(accessor, "remoteAdd", { name: name.trim(), url: url.trim() });
    },
};

export const gitRemoveRemoteAction: CommandAction = {
    id: "git.removeRemote",
    title: "Git: Remove Remote",
    shortTitle: "Remove Remote",
    when: "gitHasRemotes",
    menus: [{ menuId: GitRemotesMenu, group: "1_remote", order: 20, when: "gitHasRemotes" }],
    async run(accessor) {
        const remote = await pickRemote(accessor, "Remove Remote");
        if (remote !== null) await runGitOp(accessor, "remoteRemove", { name: remote });
    },
};

/** An empty message makes a lightweight tag, otherwise an annotated one. */
export const gitCreateTagAction: CommandAction = {
    id: "git.createTag",
    title: "Git: Create Tag",
    shortTitle: "Create Tag",
    when: "gitHasRepo",
    menus: [{ menuId: GitTagsMenu, group: "1_tags", order: 10, when: "gitHasRepo" }],
    async run(accessor) {
        const quickInput = accessor.get(QuickInputServiceDIToken);
        const name = await quickInput.input({
            title: "Create Tag",
            placeholder: "Tag name",
            validateInput: (v) => (v.trim() === "" ? "Tag name is empty" : null),
        });
        if (name === undefined || name.trim() === "") return;
        const message = await quickInput.input({
            title: "Create Tag",
            placeholder: "Tag message (optional — empty for a lightweight tag)",
        });
        if (message === undefined) return; // Escape cancels
        await runGitOp(accessor, "tagCreate", { name: name.trim(), message });
    },
};

export const gitDeleteTagAction: CommandAction = {
    id: "git.deleteTag",
    title: "Git: Delete Tag",
    shortTitle: "Delete Tag",
    when: "gitHasRepo",
    menus: [{ menuId: GitTagsMenu, group: "1_tags", order: 20, when: "gitHasRepo" }],
    async run(accessor) {
        const tag = await pickTag(accessor, "Delete Tag");
        if (tag !== null) await runGitOp(accessor, "tagDelete", { name: tag });
    },
};

/** Deviates from VS Code (which lists remote tags via `ls-remote`): we take local tags. */
export const gitDeleteRemoteTagAction: CommandAction = {
    id: "git.deleteRemoteTag",
    title: "Git: Delete Remote Tag",
    shortTitle: "Delete Remote Tag",
    when: "gitHasRemotes",
    menus: [{ menuId: GitTagsMenu, group: "1_tags", order: 30, when: "gitHasRemotes" }],
    async run(accessor) {
        const remote = await pickRemote(accessor, "Delete Remote Tag");
        if (remote === null) return;
        const tag = await pickTag(accessor, "Delete Remote Tag");
        if (tag !== null) await runGitOp(accessor, "pushDelete", { remote, ref: tag });
    },
};

export const gitShowOutputAction: CommandAction = {
    id: "git.showOutput",
    title: "Git: Show Git Output",
    shortTitle: "Show Git Output",
    menus: [{ menuId: MenuId.ViewTitle, group: "9_footer", order: 10, visible: inChangesMenu }],
    run(accessor) {
        const commands = accessor.get(CommandRegistryDIToken);
        if (commands.has(GIT_OUTPUT_SHOW_COMMAND)) commands.execute(GIT_OUTPUT_SHOW_COMMAND);
    },
};

/**
 * The mutating part. `git.showOutput` is excluded: disabling it during an operation
 * would hide that operation's own log.
 */
export const REMOTE_TAG_ACTIONS: readonly CommandAction[] = [
    gitAddRemoteAction,
    gitRemoveRemoteAction,
    gitCreateTagAction,
    gitDeleteTagAction,
    gitDeleteRemoteTagAction,
];
