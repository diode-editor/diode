/** An entry is written when `lvl >= configured`. */
export const LogLevel = {
    Off: 0,
    Trace: 10,
    Debug: 20,
    Info: 30,
    Warn: 40,
    Error: 50,
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

/** Upstream's default: the window level (`env.logLevel`) without `--log`; our own channels default to Trace instead. */
export const DEFAULT_WINDOW_LOG_LEVEL: LogLevel = LogLevel.Info;

const NAMES: Record<LogLevel, string> = {
    [LogLevel.Off]: "off",
    [LogLevel.Trace]: "trace",
    [LogLevel.Debug]: "debug",
    [LogLevel.Info]: "info",
    [LogLevel.Warn]: "warn",
    [LogLevel.Error]: "error",
};

export function logLevelName(level: LogLevel): string {
    return NAMES[level];
}

export function parseLogLevel(s: string): LogLevel | undefined {
    switch (s.toLowerCase()) {
        case "off":
            return LogLevel.Off;
        case "trace":
            return LogLevel.Trace;
        case "debug":
            return LogLevel.Debug;
        case "info":
            return LogLevel.Info;
        case "warn":
        case "warning":
            return LogLevel.Warn;
        case "error":
            return LogLevel.Error;
        default:
            return undefined;
    }
}
