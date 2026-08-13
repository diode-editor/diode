import type { StoryContext, StoryMeta } from "../../testing/storyTypes.ts";
import { FocusableBox } from "../../demos/FocusableBox.ts";
import { VStackElement } from "../layout/vStackElement.ts";

export const meta: StoryMeta = {
    title: "FocusDemo",
};

export function tabCycling(ctx: StoryContext): void {
    ctx.body.title = "Focus Demo — Tab / Shift+Tab to cycle";
    const stack = new VStackElement();

    const labels = ["Inbox", "Drafts", "Sent", "Trash", "Settings"];
    for (const label of labels) {
        stack.addChild(new FocusableBox(label), { width: "fill", height: 3 });
    }

    ctx.body.setContent(stack);
}
