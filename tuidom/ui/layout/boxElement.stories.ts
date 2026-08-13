import type { StoryContext, StoryMeta } from "../../testing/storyTypes.ts";

import { BoxElement } from "./boxElement.ts";

export const meta: StoryMeta = {
    title: "BoxElement",
};

export function simpleBox(ctx: StoryContext): void {
    const box = new BoxElement();
    ctx.body.setContent(box);
}
