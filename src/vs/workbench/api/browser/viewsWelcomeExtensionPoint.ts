import { parseLinkedText } from "../../../base/common/linkedText.ts";
import { Uri } from "../../../base/common/uri.ts";
import type { IExtension } from "../../../platform/extensions/common/iExtension.ts";
import type { ILogger } from "../../../platform/log/common/iLogger.ts";
import type {
    IViewWelcomeBlock,
    IViewWelcomeLink,
    IViewWelcomeTarget,
} from "../../browser/parts/views/viewWelcomeElement.ts";

/** Upstream `ViewWelcome` (`viewsWelcomeExtensionPoint.ts`) after validation. */
export interface IViewWelcomeContent {
    readonly contents: string;
    /** `undefined` — always shown; `"default"` — only when no other entry of the view is shown. */
    readonly when?: string;
    readonly enablement?: string;
}

/** Upstream's `when` value for the fallback entry. */
export const DEFAULT_WELCOME_WHEN = "default";

/**
 * Upstream `ViewsWelcomeContribution`: `contributes.viewsWelcome` entries by view id, in manifest order
 * (extensions in their order). The id is not checked: a view may be another extension's or come later,
 * and an id no extension view has is simply never shown. `group` is proposed API (`contribViewsWelcome`)
 * and is ignored, as upstream does without the proposal.
 */
export function readViewsWelcome(
    extensions: readonly IExtension[],
    logger?: ILogger,
): ReadonlyMap<string, readonly IViewWelcomeContent[]> {
    const byView = new Map<string, IViewWelcomeContent[]>();
    for (const extension of extensions) {
        const contributed = extension.manifest.contributes?.viewsWelcome;
        if (contributed === undefined) continue;
        if (!Array.isArray(contributed)) {
            logger?.error(`${extension.id}: viewsWelcome must be an array`);
            continue;
        }
        for (const entry of contributed as readonly unknown[]) {
            const welcome = validWelcome(entry);
            if (welcome === null) {
                logger?.error(
                    `${extension.id}: viewsWelcome: properties \`view\` and \`contents\` are mandatory and must be strings`,
                );
                continue;
            }
            const list = byView.get(welcome.view) ?? [];
            list.push(welcome.content);
            byView.set(welcome.view, list);
        }
    }
    return byView;
}

function validWelcome(entry: unknown): { readonly view: string; readonly content: IViewWelcomeContent } | null {
    // A JSON primitive has none of the properties; only `null` cannot be destructured.
    const { view, contents, when, enablement } = (entry ?? {}) as Record<string, unknown>;
    if (typeof view !== "string" || typeof contents !== "string") return null;
    return {
        view,
        content: {
            contents,
            when: typeof when === "string" ? when : undefined,
            enablement: typeof enablement === "string" ? enablement : undefined,
        },
    };
}

/**
 * Upstream `ViewWelcomeController.render`: each non-empty trimmed line of `contents` is a paragraph, or a
 * button when the line is exactly one link. A gap separates the rendered lines, as upstream's paragraph and
 * button margins do. `enablement` dims the buttons and the `command:` links, not the other links.
 */
export function welcomeBlocks(contents: readonly IViewWelcomeContent[]): IViewWelcomeBlock[] {
    const blocks: IViewWelcomeBlock[] = [];
    for (const { contents: text, enablement } of contents) {
        for (const raw of text.split("\n")) {
            const line = raw.trim();
            if (line === "") continue;
            if (blocks.length > 0) blocks.push({ kind: "text", text: "" });
            const nodes = parseLinkedText(line).nodes.map((node) =>
                typeof node === "string" ? node : linkOf(node.label, node.href, enablement),
            );
            const only = nodes.length === 1 ? nodes[0] : undefined;
            if (only !== undefined && typeof only !== "string") {
                blocks.push({ kind: "button", ...only });
            } else {
                blocks.push({ kind: "paragraph", nodes });
            }
        }
    }
    return blocks;
}

function linkOf(label: string, href: string, enablement: string | undefined): IViewWelcomeLink {
    const target = targetOf(href);
    return "command" in target ? { label, ...target, enablement } : { label, ...target };
}

/**
 * Upstream `CommandOpener`: `command:<id>?<JSON>` (URL-encoded or not); an array is the argument list,
 * anything else is the one argument. Other hrefs are URLs, the opener decides what to do with them.
 */
export function targetOf(href: string): IViewWelcomeTarget {
    const uri = Uri.parse(href);
    if (uri.scheme !== "command") return { url: href };
    let args: unknown = [];
    try {
        args = JSON.parse(decodeURIComponent(uri.query));
    } catch {
        try {
            args = JSON.parse(uri.query);
        } catch {
            // No arguments, as upstream.
        }
    }
    return { command: uri.path, args: Array.isArray(args) ? args : [args] };
}
