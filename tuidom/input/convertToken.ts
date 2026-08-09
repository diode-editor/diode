import { createKeyPressEvent, type KeyPressEvent } from "./keyEvent.ts";
import type { RawKeyToken } from "./rawTerminalToken.ts";

/**
 * Map Kitty event type number to TUI event type string.
 *
 * Browser-aligned semantics: a held key fires repeated `keydown` events
 * (with `repeat: true`), not `keypress`. We follow the same model so
 * keydown listeners (e.g. the workbench for arrows/Backspace) auto-repeat.
 *
 * - 0 (not specified) → "keydown" (default is press per spec)
 * - 1 (press) → "keydown"
 * - 2 (repeat) → "keydown" (held key — also marked via the caller as a repeat)
 * - 3 (release) → "keyup"
 */
function kittyEventType(eventType: number): "keypress" | "keydown" | "keyup" {
    switch (eventType) {
        case 3:
            return "keyup";
        default:
            return "keydown";
    }
}

/**
 * Физическая клавиша для control-кода: буквы дают `KeyA`…`KeyZ`, а пробел и
 * символы из 0x1c–0x1f — свои `code` из UI Events, как в браузере (`Key\` и
 * `Key6` там не существуют).
 */
function ctrlCharCode(letter: string): string {
    switch (letter) {
        case " ":
            return "Space";
        case "\\":
            return "Backslash";
        case "]":
            return "BracketRight";
        case "6":
            return "Digit6";
        case "/":
            return "Slash";
        default:
            return `Key${letter.toUpperCase()}`;
    }
}

export function convertTokenToKeyPressEvent(token: RawKeyToken): KeyPressEvent {
    switch (token.kind) {
        case "csi-u": {
            let key = token.key;
            if (token.shiftedKey !== undefined) {
                key = String.fromCodePoint(token.shiftedKey);
            } else if (token.shiftKey && key.length === 1 && key !== key.toUpperCase()) {
                key = key.toUpperCase();
            }
            return createKeyPressEvent(key, token.raw, {
                type: kittyEventType(token.eventType),
                code: token.code,
                shiftKey: token.shiftKey,
                altKey: token.altKey,
                ctrlKey: token.ctrlKey,
                metaKey: token.metaKey,
            });
        }

        case "csi-letter":
            return createKeyPressEvent(token.key, token.raw, {
                type: kittyEventType(token.eventType),
                shiftKey: token.shiftKey,
                altKey: token.altKey,
                ctrlKey: token.ctrlKey,
                metaKey: token.metaKey,
            });

        case "csi-tilde":
            return createKeyPressEvent(token.key, token.raw, {
                type: kittyEventType(token.eventType),
                shiftKey: token.shiftKey,
                altKey: token.altKey,
                ctrlKey: token.ctrlKey,
                metaKey: token.metaKey,
            });

        case "ss3":
            return createKeyPressEvent(token.key, token.raw);

        case "pua":
            return createKeyPressEvent(token.key, token.raw, {
                type: "keydown",
                code: token.code,
            });

        case "esc-char":
            return createKeyPressEvent(token.char, token.raw, { altKey: true });

        case "esc-control":
            return createKeyPressEvent(token.letter, token.raw, {
                altKey: true,
                ctrlKey: true,
                code: `Key${token.letter.toUpperCase()}`,
            });

        case "esc-special":
            return createKeyPressEvent(token.key, token.raw, { altKey: true });

        case "standalone-esc":
            return createKeyPressEvent("Escape", token.raw);

        case "char":
            return createKeyPressEvent(token.char, token.raw);

        case "special-key":
            return createKeyPressEvent(token.key, token.raw);

        case "ctrl-char":
            return createKeyPressEvent(token.letter, token.raw, {
                ctrlKey: true,
                code: ctrlCharCode(token.letter),
            });

        case "unknown-byte":
            return createKeyPressEvent(`<0x${token.byte.toString(16).padStart(2, "0")}>`, token.raw);

        /* v8 ignore next 4 -- exhaustiveness guard: RawKeyToken is a closed union, no other kind is constructible */
        default: {
            const exhaustive: never = token;
            throw new Error(`Unhandled token kind: ${(exhaustive as { kind: string }).kind}`);
        }
    }
}
