import type { TuiApplication } from "../dom/tuiApplication.ts";
import type { TUIElement } from "../dom/tuiElement.ts";
import type { BodyElement } from "../ui/body/bodyElement.ts";

export interface StoryContext {
    readonly app: TuiApplication;
    readonly body: BodyElement;
    readonly args: string[];
    afterRun(cb: () => void | Promise<void>): void;
}

export type StoryFunction = (ctx: StoryContext) => TUIElement | undefined | Promise<TUIElement | undefined>;

export interface StoryMeta {
    title?: string;
}

export interface StoryModule {
    meta?: StoryMeta;
    [key: string]: StoryFunction | StoryMeta | undefined;
}
