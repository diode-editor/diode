import type { TUIElement } from "../dom/tuiElement.ts";

import type { InspectorDriver } from "./InspectorDriver.ts";
import {
    type CaptureFrameResult,
    type GetDocumentResult,
    InspectorMethod,
    type InspectorRequest,
    type InspectorResponse,
    type ResizeParams,
    type SendKeyParams,
    type SendMouseParams,
    type SendTextParams,
    type WaitForIdleParams,
    type WaitForIdleResult,
} from "./protocol.ts";
import { serializeTree } from "./serializeTree.ts";

/**
 * Read-only view of the inspected application. Decouples the core from
 * `TuiApplication` so the same core can be driven by a WS server, an in-process
 * inspector widget, or a test.
 */
export interface InspectorTarget {
    getRoot(): TUIElement | null;
    getFocused(): TUIElement | null;
}

type MethodHandler = (params: unknown) => unknown;

/**
 * Transport-agnostic inspector. Holds a read-only reference to the inspected
 * app via `InspectorTarget` and answers protocol methods. Methods are a
 * registry, so new ones extend the inspector without touching `dispatch`.
 *
 * When constructed with an optional {@link InspectorDriver}, it additionally
 * registers the write/capture methods (`sendKey`, `sendText`, `resize`,
 * `captureFrame`, `shutdown`) — used by `--headless` mode. Without a driver the
 * inspector stays read-only.
 */
export class InspectorCore {
    private readonly target: InspectorTarget;
    private readonly methods = new Map<string, MethodHandler>();

    public constructor(target: InspectorTarget, driver?: InspectorDriver) {
        this.target = target;
        this.register(InspectorMethod.getDocument, () => this.getDocument());
        if (driver !== undefined) this.registerDriverMethods(driver);
    }

    public register(method: string, handler: MethodHandler): void {
        this.methods.set(method, handler);
    }

    public async dispatch(request: InspectorRequest): Promise<InspectorResponse> {
        const handler = this.methods.get(request.method);
        if (handler === undefined) {
            return { id: request.id, error: { message: `Unknown method: ${request.method}` } };
        }
        try {
            return { id: request.id, result: await handler(request.params) };
        } catch (err) {
            return { id: request.id, error: { message: err instanceof Error ? err.message : String(err) } };
        }
    }

    private getDocument(): GetDocumentResult {
        return { root: serializeTree(this.target.getRoot(), this.target.getFocused()) };
    }

    private registerDriverMethods(driver: InspectorDriver): void {
        this.register(InspectorMethod.sendKey, (params) => {
            driver.sendKey(asSendKeyParams(params).name);
            return {};
        });
        this.register(InspectorMethod.sendText, (params) => {
            driver.sendText(asSendTextParams(params).text);
            return {};
        });
        this.register(InspectorMethod.sendMouse, (params) => {
            driver.sendMouse(asSendMouseParams(params));
            return {};
        });
        this.register(InspectorMethod.resize, (params) => {
            const { cols, rows } = asResizeParams(params);
            driver.resize(cols, rows);
            return {};
        });
        this.register(InspectorMethod.captureFrame, async (): Promise<CaptureFrameResult> => {
            return { frame: await driver.captureFrame() };
        });
        this.register(InspectorMethod.waitForIdle, (params): Promise<WaitForIdleResult> => {
            return driver.waitForIdle(asWaitForIdleParams(params));
        });
        this.register(InspectorMethod.shutdown, () => {
            driver.shutdown();
            return {};
        });
    }
}

function asRecord(params: unknown): Record<string, unknown> {
    if (typeof params !== "object" || params === null) {
        throw new Error("Expected object params");
    }
    return params as Record<string, unknown>;
}

function asSendKeyParams(params: unknown): SendKeyParams {
    const { name } = asRecord(params);
    if (typeof name !== "string" || name.length === 0) {
        throw new Error("sendKey requires a non-empty string 'name'");
    }
    return { name };
}

function asSendTextParams(params: unknown): SendTextParams {
    const { text } = asRecord(params);
    if (typeof text !== "string") {
        throw new Error("sendText requires a string 'text'");
    }
    return { text };
}

const MOUSE_ACTIONS: ReadonlySet<string> = new Set([
    "press",
    "release",
    "move",
    "scroll-up",
    "scroll-down",
    "scroll-left",
    "scroll-right",
]);
const MOUSE_BUTTONS: ReadonlySet<string> = new Set(["left", "middle", "right", "none"]);

function asSendMouseParams(params: unknown): SendMouseParams {
    const { action, button, x, y, shiftKey, altKey, ctrlKey } = asRecord(params);
    if (typeof action !== "string" || !MOUSE_ACTIONS.has(action)) {
        throw new Error(`sendMouse requires 'action' one of: ${[...MOUSE_ACTIONS].join(", ")}`);
    }
    if (button !== undefined && (typeof button !== "string" || !MOUSE_BUTTONS.has(button))) {
        throw new Error(`sendMouse 'button' must be one of: ${[...MOUSE_BUTTONS].join(", ")}`);
    }
    if (!Number.isInteger(x) || !Number.isInteger(y) || (x as number) < 0 || (y as number) < 0) {
        throw new Error("sendMouse requires non-negative integer 'x' and 'y'");
    }
    return {
        action: action as SendMouseParams["action"],
        ...(button === undefined ? {} : { button: button as SendMouseParams["button"] }),
        x: x as number,
        y: y as number,
        shiftKey: shiftKey === true,
        altKey: altKey === true,
        ctrlKey: ctrlKey === true,
    };
}

function asWaitForIdleParams(params: unknown): WaitForIdleParams {
    if (params === undefined || params === null) return {};
    const { quietMs, timeoutMs } = asRecord(params);
    const out: WaitForIdleParams = {};
    if (quietMs !== undefined) {
        if (!Number.isFinite(quietMs) || (quietMs as number) < 0)
            throw new Error("waitForIdle 'quietMs' must be a non-negative number");
        out.quietMs = quietMs as number;
    }
    if (timeoutMs !== undefined) {
        if (!Number.isFinite(timeoutMs) || (timeoutMs as number) < 0)
            throw new Error("waitForIdle 'timeoutMs' must be a non-negative number");
        out.timeoutMs = timeoutMs as number;
    }
    return out;
}

function asResizeParams(params: unknown): ResizeParams {
    const { cols, rows } = asRecord(params);
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || (cols as number) <= 0 || (rows as number) <= 0) {
        throw new Error("resize requires positive integer 'cols' and 'rows'");
    }
    return { cols: cols as number, rows: rows as number };
}
