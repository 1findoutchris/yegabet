/*
 * No-op stand-in for the `server-only` package.
 *
 * That package's whole job is to throw if it is imported outside a React Server
 * Component, which it detects by exporting a module that throws from its
 * non-server entry point. Vitest runs in plain Node and resolves that entry, so
 * every module guarded by `import "server-only"` blows up on import.
 *
 * Aliased in vitest.config.mts. The guard still does its real job in the app
 * build; it just has nothing to protect against in a test runner.
 */
export {};
