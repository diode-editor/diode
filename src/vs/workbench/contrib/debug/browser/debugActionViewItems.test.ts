// The select of sessions on fakes: its options (a child indented), what it selects for the focused session (its root
// in the toolbar while sub-sessions are hidden), what it follows (new and ended sessions, names, the focus) and what
// picking an option runs.

import { describe, expect, it, vi } from "vitest";

import { Emitter } from "../../../../base/common/event.ts";
import type { IDebugSession } from "../common/debug.ts";

import { FocusSessionActionViewItem, toolbarSessionStrategy } from "./debugActionViewItems.ts";

interface IFakeSession extends IDebugSession {
    rename(name: string): void;
    end(): void;
}

function setup(showSubSessions = false) {
    const sessions: IFakeSession[] = [];
    const focus = new Emitter<IDebugSession | undefined>();
    const newSession = new Emitter<IDebugSession>();
    const endSession = new Emitter<{ session: IDebugSession; restart: boolean }>();
    let focused: IDebugSession | undefined;
    const debugService = {
        getModel: () => ({ getSessions: () => sessions }),
        getViewModel: () => ({
            get focusedSession() {
                return focused;
            },
            onDidFocusSession: focus.event,
        }),
        onDidNewSession: newSession.event,
        onDidEndSession: endSession.event,
    } as never;
    const add = (label: string, parentSession?: IDebugSession): IFakeSession => {
        let name = label;
        const changeName = new Emitter<string>();
        const endAdapter = new Emitter<undefined>();
        const session = {
            parentSession,
            getLabel: () => name,
            onDidChangeName: changeName.event,
            onDidEndAdapter: endAdapter.event,
            rename: (to: string) => {
                name = to;
                changeName.fire(to);
            },
            end: () => {
                endAdapter.fire(undefined);
            },
        } as unknown as IFakeSession;
        sessions.push(session);
        return session;
    };
    const ran: IDebugSession[] = [];
    const create = (session?: IDebugSession): FocusSessionActionViewItem =>
        new FocusSessionActionViewItem(
            debugService,
            toolbarSessionStrategy(debugService, () => showSubSessions),
            (s) => ran.push(s),
            session,
        );
    return {
        sessions,
        add,
        ran,
        create,
        focusOn: (session: IDebugSession | undefined) => {
            focused = session;
            focus.fire(session);
        },
        started: (session: IDebugSession) => {
            newSession.fire(session);
        },
        ended: (session: IDebugSession) => {
            sessions.splice(sessions.indexOf(session as IFakeSession), 1);
            endSession.fire({ session, restart: false });
        },
    };
}

function options(item: FocusSessionActionViewItem): unknown {
    return item.element.inspectState().options;
}

describe("FocusSessionActionViewItem", () => {
    it("lists the roots while sub-sessions are hidden, selecting the root of the given session", () => {
        const t = setup();
        const app = t.add("app");
        const worker = t.add("worker", app);
        t.add("other");

        const item = t.create(worker);

        expect(options(item)).toEqual(["app", "other"]);
        expect(item.element.getSelected()).toBe(0);
        expect(item.selectedLabel).toBe("app");
    });

    it("with sub-sessions shown, a child is indented and stands for itself", () => {
        const t = setup(true);
        const app = t.add("app");
        const worker = t.add("worker", app);

        const item = t.create(worker);

        expect(options(item)).toEqual(["app", "  worker"]);
        expect(item.selectedLabel).toBe("worker");
    });

    it("nothing selected without a session", () => {
        const t = setup();
        t.add("app");

        const item = t.create();

        expect(item.element.getSelected()).toBe(-1);
        expect(item.selectedLabel).toBe("");
    });

    it("follows the focus, new and ended sessions and the names, telling its host each time", () => {
        const t = setup();
        const app = t.add("app");
        const item = t.create(app);
        const changed = vi.fn();
        item.onDidChange(changed);

        const other = t.add("other");
        t.started(other);
        expect(options(item)).toEqual(["app", "other"]);

        t.focusOn(other);
        expect(item.selectedLabel).toBe("other");

        other.rename("renamed");
        expect(options(item)).toEqual(["app", "renamed"]);
        expect(item.selectedLabel).toBe("renamed");

        t.ended(other);
        expect(options(item)).toEqual(["app"]);
        expect(changed).toHaveBeenCalledTimes(4);
    });

    it("a focus that leaves no session keeps the selection", () => {
        const t = setup();
        const app = t.add("app");
        const item = t.create(app);

        t.focusOn(undefined);

        expect(item.selectedLabel).toBe("app");
    });

    it("an ended adapter no longer renames its option; the sessions there at the start are followed too", () => {
        const t = setup();
        const app = t.add("app");
        const item = t.create(app);

        app.end();
        app.rename("late");

        expect(options(item)).toEqual(["app"]);
    });

    it("picking an option runs with its session", () => {
        const t = setup();
        t.add("app");
        const other = t.add("other");
        const item = t.create();

        item.element.onDidSelect?.({ selected: "other", index: 1 });
        item.element.onDidSelect?.({ selected: "gone", index: 5 });

        expect(t.ran).toEqual([other]);
    });
});
