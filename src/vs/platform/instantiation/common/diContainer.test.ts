import { describe, expect, it } from "vitest";

import type { ContainerModule } from "./diContainer.ts";
import { Container, token } from "./diContainer.ts";

class Logger {
    public static dependencies = [] as const;
    public readonly tag = "logger";
}

class Database {
    public static dependencies = [] as const;
    public readonly tag = "db";
}

const LoggerDIToken = token<Logger>("Logger");
const DatabaseDIToken = token<Database>("Database");

class UserService {
    public static dependencies = [LoggerDIToken, DatabaseDIToken] as const;

    public readonly logger: Logger;
    public readonly db: Database;

    public constructor(logger: Logger, db: Database) {
        this.logger = logger;
        this.db = db;
    }
}

const UserServiceDIToken = token<UserService>("UserService");

describe("DiContainer", () => {
    describe("factory binding", () => {
        it("resolves a value from factory function", () => {
            const ValueDIToken = token<number>("Value");
            const container = new Container().bind(ValueDIToken, () => 42);

            expect(container.get(ValueDIToken)).toBe(42);
        });
    });

    describe("class binding with static dependencies", () => {
        it("resolves class with no dependencies", () => {
            const container = new Container().bind(LoggerDIToken, Logger);

            const logger = container.get(LoggerDIToken);

            expect(logger).toBeInstanceOf(Logger);
            expect(logger.tag).toBe("logger");
        });

        it("resolves class with dependencies", () => {
            const container = new Container()
                .bind(LoggerDIToken, Logger)
                .bind(DatabaseDIToken, Database)
                .bind(UserServiceDIToken, UserService);

            const svc = container.get(UserServiceDIToken);

            expect(svc).toBeInstanceOf(UserService);
            expect(svc.logger).toBeInstanceOf(Logger);
            expect(svc.db).toBeInstanceOf(Database);
        });

        it("resolves dependency chain A → B → C", () => {
            const CDIToken = token<C>("C");
            const BDIToken = token<B>("B");
            const ADIToken = token<A>("A");

            class C {
                public static dependencies = [] as const;
                public readonly tag = "c";
            }
            class B {
                public static dependencies = [CDIToken] as const;
                public readonly c: C;
                public constructor(c: C) {
                    this.c = c;
                }
            }
            class A {
                public static dependencies = [BDIToken] as const;
                public readonly b: B;
                public constructor(b: B) {
                    this.b = b;
                }
            }

            const container = new Container().bind(CDIToken, C).bind(BDIToken, B).bind(ADIToken, A);

            const a = container.get(ADIToken);

            expect(a.b.c.tag).toBe("c");
        });

        it("bind order does not matter (lazy resolution)", () => {
            const container = new Container()
                .bind(UserServiceDIToken, UserService)
                .bind(DatabaseDIToken, Database)
                .bind(LoggerDIToken, Logger);

            const svc = container.get(UserServiceDIToken);

            expect(svc.logger).toBeInstanceOf(Logger);
            expect(svc.db).toBeInstanceOf(Database);
        });
    });

    describe("singleton behavior", () => {
        it("returns the same instance on repeated get()", () => {
            const container = new Container().bind(LoggerDIToken, Logger);

            const a = container.get(LoggerDIToken);
            const b = container.get(LoggerDIToken);

            expect(a).toBe(b);
        });

        it("dependencies are shared singletons", () => {
            const container = new Container()
                .bind(LoggerDIToken, Logger)
                .bind(DatabaseDIToken, Database)
                .bind(UserServiceDIToken, UserService);

            const svc = container.get(UserServiceDIToken);
            const logger = container.get(LoggerDIToken);

            expect(svc.logger).toBe(logger);
        });
    });

    describe("error handling", () => {
        it("throws on missing binding", () => {
            const container = new Container();
            const MissingDIToken = token<string>("Missing");

            expect(() => container.get(MissingDIToken)).toThrowError('No binding for "Missing"');
        });

        it("throws on circular dependency", () => {
            const XDIToken = token<unknown>("X");
            const YDIToken = token<unknown>("Y");

            const container: Container = new Container()
                .bind(XDIToken, (): unknown => container.get(YDIToken))
                .bind(YDIToken, (): unknown => container.get(XDIToken));

            expect(() => container.get(XDIToken)).toThrowError(/Circular dependency detected.*X.*Y/);
        });
    });

    describe("plain constructor (no DI)", () => {
        it("class with static dependencies can be constructed directly", () => {
            const logger = new Logger();
            const db = new Database();
            const svc = new UserService(logger, db);

            expect(svc.logger).toBe(logger);
            expect(svc.db).toBe(db);
        });
    });

    describe("modules (.use)", () => {
        it("applies a context-less module", () => {
            const loggingModule: ContainerModule = (c) => {
                c.bind(LoggerDIToken, Logger);
            };
            const container = new Container().use(loggingModule);

            expect(container.get(LoggerDIToken)).toBeInstanceOf(Logger);
        });

        it("applies a module with typed context", () => {
            const ValueDIToken = token<number>("Value");
            const valueModule: ContainerModule<{ value: number }> = (c, ctx) => {
                c.bind(ValueDIToken, () => ctx.value);
            };
            const container = new Container().use(valueModule, { value: 7 });

            expect(container.get(ValueDIToken)).toBe(7);
        });

        it("modules compose via chaining", () => {
            const loggingModule: ContainerModule = (c) => {
                c.bind(LoggerDIToken, Logger);
            };
            const dbModule: ContainerModule = (c) => {
                c.bind(DatabaseDIToken, Database);
            };
            const userModule: ContainerModule = (c) => {
                c.bind(UserServiceDIToken, UserService);
            };

            const container = new Container().use(loggingModule).use(dbModule).use(userModule);

            const svc = container.get(UserServiceDIToken);
            expect(svc.logger).toBeInstanceOf(Logger);
            expect(svc.db).toBeInstanceOf(Database);
        });

        it("returns container for chaining mixed with bind", () => {
            const loggingModule: ContainerModule = (c) => {
                c.bind(LoggerDIToken, Logger);
            };
            const container = new Container().use(loggingModule).bind(DatabaseDIToken, Database);

            expect(container.get(LoggerDIToken)).toBeInstanceOf(Logger);
            expect(container.get(DatabaseDIToken)).toBeInstanceOf(Database);
        });
    });
});
