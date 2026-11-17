/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugActionViewItems.ts
// `FocusSessionActionViewItem`: the select of the sessions — the debug toolbar's (`Focus Session`, the roots while
// `debug.showSubSessionsInToolBar` is off) and the Debug Console's (the sessions with a console of their own). It
// follows the focused session, the new and ended ones and their names; a child is indented under its parent.
// Picking a session runs the item's command with it. The start configuration's select of the docked toolbar
// (`StartDebugActionViewItem`) is not here.

import { SelectBoxElement } from "@tuidom/elements/selectbox/selectBoxElement";

import { Emitter, type Event } from "../../../../base/common/event.ts";
import { Disposable, DisposableStore } from "../../../../base/common/lifecycle.ts";
import type { IDebugService, IDebugSession } from "../common/debug.ts";

/** Which sessions a select lists, and which of them stands for the focused one. */
export interface ISessionSelectStrategy {
    getSessions(): readonly IDebugSession[];
    mapFocusedSessionToSelected(focusedSession: IDebugSession): IDebugSession;
}

export type ISessionSelectDebugService = Pick<
    IDebugService,
    "getModel" | "getViewModel" | "onDidNewSession" | "onDidEndSession"
>;

export class FocusSessionActionViewItem extends Disposable {
    public readonly element = new SelectBoxElement();
    private readonly onDidChangeEmitter = this.register(new Emitter<void>());
    /** The options or the selection changed: the host lays the select out again. */
    public readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    public constructor(
        private readonly debugService: ISessionSelectDebugService,
        private readonly strategy: ISessionSelectStrategy,
        run: (session: IDebugSession) => void,
        session?: IDebugSession,
    ) {
        super();
        this.element.onDidSelect = ({ index }) => {
            const picked = this.strategy.getSessions().at(index);
            if (picked) run(picked);
        };

        this.register(
            this.debugService.getViewModel().onDidFocusSession(() => {
                const selected = this.getSelectedSession();
                if (selected) {
                    const index = this.strategy.getSessions().indexOf(selected);
                    this.element.select(index);
                    this.onDidChangeEmitter.fire();
                }
            }),
        );

        const sessionListenersStore = this.register(new DisposableStore());
        const registerSessionListeners = (s: IDebugSession): void => {
            const sessionListeners = sessionListenersStore.add(new DisposableStore());
            sessionListeners.add(
                s.onDidChangeName(() => {
                    this.update();
                }),
            );
            sessionListeners.add(
                s.onDidEndAdapter(() => {
                    sessionListenersStore.delete(sessionListeners);
                }),
            );
        };
        this.register(
            this.debugService.onDidNewSession((s) => {
                registerSessionListeners(s);
                this.update();
            }),
        );
        // Apply the same pattern to existing sessions - track listeners for cleanup
        this.strategy.getSessions().forEach(registerSessionListeners);
        this.register(
            this.debugService.onDidEndSession(() => {
                this.update();
            }),
        );

        const selectedSession = session ? this.strategy.mapFocusedSessionToSelected(session) : undefined;
        this.update(selectedSession);
    }

    public update(session?: IDebugSession): void {
        session ??= this.getSelectedSession();
        const sessions = this.strategy.getSessions();
        const names = sessions.map((s) => {
            const label = s.getLabel();
            if (s.parentSession) {
                // Indent child sessions so they look like children
                return `\u00A0\u00A0${label}`;
            }

            return label;
        });
        this.element.setOptions(
            names.map((text) => ({ text })),
            session ? sessions.indexOf(session) : undefined,
        );
        this.onDidChangeEmitter.fire();
    }

    private getSelectedSession(): IDebugSession | undefined {
        const session = this.debugService.getViewModel().focusedSession;
        return session ? this.strategy.mapFocusedSessionToSelected(session) : undefined;
    }
}

/** The toolbar's sessions: all of them with `debug.showSubSessionsInToolBar`, the roots otherwise. */
export function toolbarSessionStrategy(
    debugService: Pick<IDebugService, "getModel">,
    showSubSessions: () => boolean,
): ISessionSelectStrategy {
    return {
        getSessions: () => {
            const sessions = debugService.getModel().getSessions();
            return showSubSessions() ? sessions : sessions.filter((s) => !s.parentSession);
        },
        mapFocusedSessionToSelected: (focusedSession) => {
            let selected = focusedSession;
            while (selected.parentSession && !showSubSessions()) {
                selected = selected.parentSession;
            }
            return selected;
        },
    };
}
