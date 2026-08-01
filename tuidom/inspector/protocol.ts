// TUIDom inspector protocol — own, CDP-shaped (not CDP-compatible).
//
// Wire form mirrors Chrome DevTools Protocol in shape only: a request carries
// `{ id, method, params? }`, a reply is `{ id, result }` or `{ id, error }`.
// Methods live under the `TUIDom.*` namespace. The protocol is transport-
// agnostic — InspectorCore speaks it directly (in-process) or over WebSocket.

import type { MouseAction, MouseButton } from "../input/rawTerminalToken.ts";
import type { GridSnapshot } from "../rendering/gridSnapshot.ts";

/** Method names (namespace `TUIDom.*`). */
export const InspectorMethod = {
    getDocument: "TUIDom.getDocument",
    /** Inject a key by DSL name. Requires a driver (headless mode). */
    sendKey: "TUIDom.sendKey",
    /** Inject literal text as a paste. Requires a driver. */
    sendText: "TUIDom.sendText",
    /** Inject a mouse event at screen coordinates. Requires a driver. */
    sendMouse: "TUIDom.sendMouse",
    /** Resize the virtual terminal. Requires a driver. */
    resize: "TUIDom.resize",
    /** Capture the current screen as a {@link GridSnapshot}. Requires a driver. */
    captureFrame: "TUIDom.captureFrame",
    /** Wait until the app stops repainting (render settles). Requires a driver. */
    waitForIdle: "TUIDom.waitForIdle",
    /** Tear down the session and exit. Requires a driver. */
    shutdown: "TUIDom.shutdown",
} as const;

/** Params for `TUIDom.sendKey`. */
export interface SendKeyParams {
    name: string;
}

/** Params for `TUIDom.sendText`. */
export interface SendTextParams {
    text: string;
}

/**
 * Params for `TUIDom.sendMouse`.
 *
 * Coordinates are **0-based screen cells**, the same frame of reference as
 * {@link NodeSnapshot.box} — so a client can read the document, take a node's
 * `box` and click into it without any coordinate arithmetic.
 *
 * A click is two calls (`press` then `release`) — the same pair a terminal sends;
 * the DOM's `click`/`dblclick` events are synthesized from it downstream.
 */
export interface SendMouseParams {
    action: MouseAction;
    /** Defaults to `"none"` — the only meaningful button for wheel actions. */
    button?: MouseButton;
    /** 0-based column */
    x: number;
    /** 0-based row */
    y: number;
    shiftKey?: boolean;
    altKey?: boolean;
    ctrlKey?: boolean;
}

/** Params for `TUIDom.resize`. */
export interface ResizeParams {
    cols: number;
    rows: number;
}

/** Result of `TUIDom.captureFrame`. */
export interface CaptureFrameResult {
    frame: GridSnapshot;
}

/** Params for `TUIDom.waitForIdle`. */
export interface WaitForIdleParams {
    /** How long a frame must stay unchanged to count as settled (ms). */
    quietMs?: number;
    /** Give up after this long and report `idle: false` (ms). */
    timeoutMs?: number;
}

/** Result of `TUIDom.waitForIdle`. */
export interface WaitForIdleResult {
    /** `true` — render settled; `false` — timed out while still repainting. */
    idle: boolean;
    /** Frame counter at return. */
    frames: number;
}

/** Serialized tree node. */
export interface NodeSnapshot {
    /** Sequential id within a single snapshot (pre-order). Not stable across snapshots yet. */
    nodeId: number;
    /** Runtime class name (e.g. "BodyElement"). */
    type: string;
    id?: string;
    role?: string;
    focusable?: true;
    box: { x: number; y: number; width: number; height: number };
    style: { fg: number; bg: number };
    /** Активные состояния стиля (hover/focus/произвольные) — если есть. */
    styleStates?: string[];
    /** Исходные имена токенов рядом с резолвленными числами style — если стиль ссылается на токены. */
    styleTokens?: { fg?: string; bg?: string };
    /** Элемент владеет заливкой фона (bg задан собственным стилем). */
    ownBackground?: true;
    focused: boolean;
    text?: string;
    /**
     * Observable widget state, self-described by the element's `inspectState()`
     * (cursor/selection/readonly for an editor, active tab for a panel, …).
     * Absent when the element exposes none. Lets e2e assert on data instead of
     * guessing from rendered cells.
     */
    state?: Record<string, unknown>;
    children: NodeSnapshot[];
}

/** Result of `TUIDom.getDocument`. */
export interface GetDocumentResult {
    root: NodeSnapshot | null;
}

/** Inbound request envelope. */
export interface InspectorRequest {
    id: number;
    method: string;
    params?: unknown;
}

export interface InspectorSuccessResponse {
    id: number;
    result: unknown;
}

export interface InspectorErrorResponse {
    id: number;
    error: { message: string };
}

export type InspectorResponse = InspectorSuccessResponse | InspectorErrorResponse;
