/**
 * A readable environment bag. Looser than NodeJS.ProcessEnv (which Next marks
 * NODE_ENV as required on) so tests can pass a handful of keys.
 */
export type EnvLike = Record<string, string | undefined>;
