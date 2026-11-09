// The fhir_request tool layer as the locked harness and the harness suite run it: decoding the
// model's arguments (fhir_suite_harness/core.py parse_arguments, verifiers' upstream loop) and
// validating them as FastMCP does (pre_parse_json, then pydantic), with their error texts.
// Ports fhir_suite_harness/core.py at 647729c (sha256 1e615cac13dae6cf4743d2b6443f730434c0a5388516d0657abcf5944465162a)
// and FastMCP's func_metadata.pre_parse_json (mcp 1.x).

import { PyFloat } from './pyjson.ts';
import { JSONDecodeError, loadsStrict } from './protocol.ts';
import { pyRepr, pyStrRepr } from './pyrt.ts';

export const INVALID_JSON = (error: string): string => `error: invalid JSON in tool arguments (${error}); resend the call with valid JSON`;
export const NOT_OBJECT = (kind: string): string => `error: tool arguments must be a JSON object, got ${kind}; resend as an object`;
export const UNKNOWN_TOOL = (name: string): string => `error: unknown tool ${pyStrRepr(name)}`;
export const TOOL_ERROR = (name: string, error: string): string => `Error executing tool ${name}: ${error}`;

/** Python's type(value).__name__ for a decoded JSON value. */
export const pyType = (v: unknown): string => (v === null || v === undefined ? 'NoneType' : typeof v === 'boolean' ? 'bool' : typeof v === 'string' ? 'str'
  : Array.isArray(v) ? 'list' : typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'float') : v instanceof PyFloat ? 'float' : 'dict');
const isPlainObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof PyFloat);
// pydantic shows an input value's repr cut to 50 characters, middle elided.
const shortRepr = (v: unknown): string => { const r = pyRepr(v); return r.length > 50 ? r.slice(0, 25) + '...' + r.slice(-24) : r; };

/** Decode tool-call arguments as the upstream loop does: [arguments, error text]. */
export function parseArguments(raw: string | null | undefined): [Record<string, unknown> | null, string | null] {
  let value: unknown;
  try {
    value = loadsStrict(raw || '{}');
  } catch (error) {
    if (error instanceof JSONDecodeError) return [null, INVALID_JSON(error.message)];
    throw error;
  }
  if (!isPlainObject(value)) return [null, NOT_OBJECT(pyType(value))];
  return [value, null];
}

/** FastMCP's pre_parse_json for fhir_request: a string where an object is expected (body) is
 * parsed as JSON unless that fails or gives a string or a number. */
export function preParse(args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args };
  if (typeof args.body === 'string') {
    try {
      const parsed = loadsStrict(args.body);
      if (!(typeof parsed === 'string' || typeof parsed === 'number' || typeof parsed === 'boolean' || parsed instanceof PyFloat)) out.body = parsed;
    } catch (error) {
      if (!(error instanceof JSONDecodeError)) throw error;
    }
  }
  return out;
}

/**
 * The text FastMCP answers when the arguments do not fit fhir_request's schema (method and path
 * required strings, body an object, if_match and if_none_exist strings), else null.
 */
export function argumentError(name: string, args: Record<string, unknown>): string | null {
  const problems: string[] = [];
  const bad = (field: string, kind: 'missing' | 'string_type' | 'dict_type'): void => {
    const message = kind === 'missing' ? 'Field required' : kind === 'string_type' ? 'Input should be a valid string' : 'Input should be a valid dictionary';
    const given = kind === 'missing' ? args : args[field];
    problems.push(`${field}\n  ${message} [type=${kind}, input_value=${shortRepr(given)}, input_type=${pyType(given)}]\n`
      + `    For further information visit https://errors.pydantic.dev/2.13/v/${kind}`);
  };
  for (const field of ['method', 'path'] as const) {
    if (!(field in args)) bad(field, 'missing');
    else if (typeof args[field] !== 'string') bad(field, 'string_type');
  }
  if ('body' in args && !isPlainObject(args.body)) bad('body', 'dict_type');
  for (const field of ['if_match', 'if_none_exist'] as const) if (field in args && typeof args[field] !== 'string') bad(field, 'string_type');
  if (!problems.length) return null;
  return TOOL_ERROR(name, `${problems.length} validation error${problems.length === 1 ? '' : 's'} for ${name}Arguments\n${problems.join('\n')}`);
}

export interface FhirRequestArguments { method: string; path: string; body: Record<string, unknown>; if_match: string; if_none_exist: string }

/** validate_fhir_request: the arguments with their defaults, or the FastMCP error text (thrown). */
export function validateFhirRequest(args: Record<string, unknown>): FhirRequestArguments {
  const pre = preParse(args);
  const error = argumentError('fhir_request', pre);
  if (error) throw new ArgumentError(error);
  return {
    method: pre.method as string, path: pre.path as string,
    body: (pre.body ?? {}) as Record<string, unknown>,
    if_match: (pre.if_match ?? '') as string, if_none_exist: (pre.if_none_exist ?? '') as string,
  };
}

export class ArgumentError extends Error {}
