// Hand-written type definitions for safe-write-mode.
// The library itself is plain CommonJS without a build step; this file only
// describes the public surface exported by src/index.js.
// test/types.test.js checks that the names here match the real exports.

export type Mode = 'read-only' | 'read-write';

export type SafetyErrorCode =
  | 'READ_ONLY_MODE'
  | 'CONFIRMATION_REQUIRED'
  | 'CONFIRMATION_REJECTED'
  | 'DESTRUCTIVE_NOT_ACKED'
  | 'REASON_REQUIRED'
  | 'INVALID_MODE'
  | 'INVALID_METHOD'
  | 'INVALID_PATH'
  | 'AUDIT_UNAVAILABLE'
  | 'MODE_LOCKED'
  | 'VERIFIER_LOCKED'
  | 'BODY_CYCLE'
  | 'BODY_TOO_DEEP'
  | 'TEST_HOOKS_DISABLED';

export class SafetyError extends Error {
  constructor(message: string, code: SafetyErrorCode);
  name: 'SafetyError';
  code: SafetyErrorCode;
  /** Only on AUDIT_UNAVAILABLE raised during a refusal: the refusal that would have been reported. */
  reasonCode?: SafetyErrorCode;
}

/** Per-call options of a write. */
export interface WriteOptions {
  /** Must be exactly `true`. Strings and numbers are refused. */
  confirmed?: boolean;
  /** Must be exactly `true` for DELETE and for destructive-looking paths. */
  destructive?: boolean;
  /** Rehearse: passes the same gate, is logged, but `execute` is not called. */
  dryRun?: boolean;
  /** Free text, written to the audit log as given. Keep secrets out of it. */
  reason?: string | null;
  /** Make a non-empty `reason` mandatory for this call. */
  requireReason?: boolean;
  /** Passed to the confirmation verifier, if one is installed. */
  confirmationToken?: unknown;
  /** Further keys are handed through to the adapter's `write`. */
  [key: string]: unknown;
}

export interface DryRunResult {
  dryRun: true;
  integration: string;
  method: string;
  path: string;
}

export interface SafeWriteArgs<T> {
  integration: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' | (string & {});
  path: string;
  body?: unknown;
  opts?: WriteOptions;
  /** Sends the request. Only called after every check has passed. */
  execute: () => T | Promise<T>;
}

/** The core gate. Resolves with the result of `execute`, or a DryRunResult. */
export function safeWrite<T = unknown>(args: SafeWriteArgs<T>): Promise<T | DryRunResult>;

/** Current mode: the locked mode if `lockMode()` was called, else from the environment. */
export function getMode(): Mode;
/** Freeze the mode for the lifetime of the process. Locking a different mode later throws MODE_LOCKED. */
export function lockMode(mode?: Mode): Mode;
export function isModeLocked(): boolean;

export interface ConfirmationRequest {
  integration: string;
  method: string;
  /** Full target including the query string. */
  path: string;
  requestHash: string | null;
  destructive: boolean;
  reason: string | null;
  confirmationToken: unknown;
}

/** Must resolve to exactly `true` to allow the write. Can be installed once and not removed. */
export type ConfirmationVerifier = (request: ConfirmationRequest) => boolean | Promise<boolean>;
export function setConfirmationVerifier(verifier: ConfirmationVerifier | null): void;

export interface AdapterSpec<R = unknown> {
  /** Short identifier for logs. */
  label: string;
  get: (path: string, opts?: Record<string, unknown>) => R | Promise<R>;
  /** Omit for a read-only adapter. Never called directly, only through the gate. */
  write?: (
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body: unknown,
    opts?: WriteOptions,
  ) => R | Promise<R>;
}

/** Opaque, frozen client. Only clients built by `defineAdapter` are accepted by `createIntegration`. */
export interface AdapterClient<R = unknown> {
  readonly label: string;
  readonly get: (path: string, opts?: Record<string, unknown>) => R | Promise<R>;
}

export function defineAdapter<R = unknown>(spec: AdapterSpec<R>): AdapterClient<R>;
/** After this call `defineAdapter` throws. */
export function lockAdapterRegistration(): void;

export interface ReadSurface<R = unknown> {
  get(path: string, opts?: Record<string, unknown>): R | Promise<R>;
}

export interface WriteSurface<R = unknown> {
  post(path: string, body: unknown, opts?: WriteOptions): Promise<R | DryRunResult>;
  patch(path: string, body: unknown, opts?: WriteOptions): Promise<R | DryRunResult>;
  put(path: string, body: unknown, opts?: WriteOptions): Promise<R | DryRunResult>;
  delete(path: string, opts?: WriteOptions): Promise<R | DryRunResult>;
}

export interface ReadOnlyIntegration<R = unknown> {
  readonly name: string;
  readonly readOnly: true;
  readonly read: ReadSurface<R>;
  /** A read-only integration has no write surface at all. */
  readonly write?: undefined;
}

export interface Integration<R = unknown> {
  readonly name: string;
  readonly readOnly: false;
  readonly read: ReadSurface<R>;
  readonly write: WriteSurface<R>;
}

export function createIntegration<R = unknown>(config: {
  name: string;
  client: AdapterClient<R>;
  readOnly: true;
}): ReadOnlyIntegration<R>;
export function createIntegration<R = unknown>(config: {
  name: string;
  client: AdapterClient<R>;
  readOnly?: false;
}): Integration<R>;
export function createIntegration<R = unknown>(config: {
  name: string;
  client: AdapterClient<R>;
  readOnly: boolean;
}): Integration<R> | ReadOnlyIntegration<R>;

// ── HTTP helper (optional; you can bring your own client instead) ──────────

export interface HeadersLike {
  get(name: string): string | null;
}

export interface RetryPolicy {
  /** Capped at 10. */
  retries: number;
  backoffMs: number;
  maxBackoffMs: number;
}

export interface RequestOptions {
  method?: string;
  /** Must be https: (http: only with SAFE_WRITE_ALLOW_INSECURE=1) and must not resolve to a private address. */
  url: string;
  headers?: Record<string, string>;
  /** Strings are sent as given, everything else as JSON. */
  body?: unknown;
  /** Default 30000. */
  timeoutMs?: number;
  retry?: RetryPolicy;
}

export interface HttpResponse<B = unknown> {
  status: number;
  body: B;
  headers: HeadersLike;
}

export class HttpError extends Error {
  constructor(message: string, details?: { status?: number; body?: unknown; headers?: HeadersLike });
  name: 'HttpError';
  status: number | undefined;
  readonly body: unknown;
  readonly headers: HeadersLike | undefined;
}

/** fetch with timeout, retry and SSRF guard. Refuses redirects. */
export function request<B = unknown>(opts: RequestOptions): Promise<HttpResponse<B>>;
/** Joins base URL and path; throws if the result would leave the origin of `baseUrl`. */
export function safeJoin(baseUrl: string, path: string): string;
/** Strips query string, fragment and userinfo. */
export function sanitizeUrlForLog(url: string): string;

export const http: {
  request: typeof request;
  HttpError: typeof HttpError;
  safeJoin: typeof safeJoin;
  sanitizeUrlForLog: typeof sanitizeUrlForLog;
  /** Rejects if the URL is not allowed by the SSRF guard. */
  assertPublicURL(url: string): Promise<void>;
  isPrivateIPv4(ip: string): boolean;
  isPrivateIPv6(ip: string): boolean;
};

export const logger: {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
  /** Appends one entry to the NDJSON audit log. Throws if the log is not writable. */
  logWrite(entry: Record<string, unknown>): void;
  /** Returns a copy with secret-looking keys and values masked. The shape can change (for example Headers become a string). */
  redact(meta: unknown): unknown;
};

export const env: {
  /** Throws if the variable is missing or empty. */
  required(name: string): string;
  optional(name: string): string | null;
  optional<F>(name: string, fallback: F): string | F;
  /** Reads a base64-encoded JSON value; refuses `__proto__`, `constructor`, `prototype` keys. */
  requiredJsonBase64<T = unknown>(name: string): T;
};
