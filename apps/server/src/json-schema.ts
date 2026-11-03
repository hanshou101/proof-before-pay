// A deliberately small JSON Schema (2020-12) validator.
//
// The server validates every proof bundle against `schemas/proof-bundle.schema.json` before it
// answers (AC-15). Rather than add a runtime dependency the SPEC §6.0 stack does not list, this
// implements exactly the keywords that schema uses — and `test/bundle-schema.test.ts` proves it
// is not vacuous by feeding it bundles that must fail.
//
// Supported: $ref within the same document ("#/$defs/name"), type (string or array),
// required, properties, additionalProperties (boolean), items, enum, const, pattern,
// minLength, minimum, maximum, anyOf, oneOf, allOf. Annotations (title/description/format/
// $comment) are ignored on purpose.

export interface SchemaError {
  path: string;
  message: string;
}

export type JsonSchema = {
  [key: string]: unknown;
};

export function validateSchema(value: unknown, schema: JsonSchema, root: JsonSchema = schema, path = '$'): SchemaError[] {
  const errors: SchemaError[] = [];
  walk(value, schema, root, path, errors);
  return errors;
}

function walk(value: unknown, schema: JsonSchema, root: JsonSchema, path: string, errors: SchemaError[]): void {
  if (schema.$ref) {
    const target = resolveRef(root, String(schema.$ref));
    if (!target) {
      errors.push({ path, message: `unresolvable $ref ${String(schema.$ref)}` });
      return;
    }
    walk(value, target, root, path, errors);
    return;
  }

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) walk(value, sub as JsonSchema, root, path, errors);
  }
  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf as JsonSchema[];
    const attempts = branches.map((branch) => validateSchema(value, branch, root, path));
    if (!attempts.some((errorsForBranch) => errorsForBranch.length === 0)) {
      // Report the closest branch's problems — "does not match any shape" alone tells nobody
      // which field is wrong. Fewer errors wins; on a tie the deeper (more specific) path wins,
      // so `{type: "null"}` never masks the missing field of the real branch.
      const score = (errs: SchemaError[]): number => {
        const depth = errs.reduce((max, error) => Math.max(max, error.path.split('.').length), 0);
        return errs.length * 100 - depth;
      };
      const closest = attempts.reduce(
        (best, current) => (score(current) < score(best) ? current : best),
        attempts[0] ?? [],
      );
      if (closest.length > 0) errors.push(...closest);
      else errors.push({ path, message: 'does not match any of the allowed shapes' });
    }
  }
  if (Array.isArray(schema.oneOf)) {
    const branches = schema.oneOf as JsonSchema[];
    const attempts = branches.map((branch) => validateSchema(value, branch, root, path));
    const matches = attempts.filter((errorsForBranch) => errorsForBranch.length === 0).length;
    if (matches !== 1) {
      errors.push({ path, message: `matches ${matches} of the allowed shapes, expected exactly 1` });
    }
  }

  if (schema.const !== undefined && value !== schema.const) {
    errors.push({ path, message: `must be ${JSON.stringify(schema.const)}` });
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => item === value)) {
    errors.push({ path, message: `must be one of ${JSON.stringify(schema.enum)}` });
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [String(schema.type)];
    if (!types.some((type) => matchesType(value, type))) {
      errors.push({ path, message: `must be ${types.join(' or ')}, got ${describeType(value)}` });
      return;
    }
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push({ path, message: `shorter than ${schema.minLength} characters` });
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      errors.push({ path, message: `does not match /${schema.pattern}/` });
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push({ path, message: `below the minimum ${schema.minimum}` });
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push({ path, message: `above the maximum ${schema.maximum}` });
    }
  }

  if (Array.isArray(value) && schema.items !== undefined) {
    const items = schema.items as JsonSchema;
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push({ path, message: `has ${value.length} items, fewer than ${schema.minItems}` });
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push({ path, message: `has ${value.length} items, more than ${schema.maxItems}` });
    }
    value.forEach((entry, index) => walk(entry, items, root, `${path}[${index}]`, errors));
  } else if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push({ path, message: `has ${value.length} items, fewer than ${schema.minItems}` });
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push({ path, message: `has ${value.length} items, more than ${schema.maxItems}` });
    }
  }

  if (isPlainObject(value)) {
    const record = value as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    for (const key of required) {
      if (!(key in record)) errors.push({ path: `${path}.${key}`, message: 'is required' });
    }

    const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
    for (const [key, sub] of Object.entries(properties)) {
      if (key in record) walk(record[key], sub, root, `${path}.${key}`, errors);
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(record)) {
        if (!(key in properties)) errors.push({ path: `${path}.${key}`, message: 'is not an allowed property' });
      }
    }
  }
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return isPlainObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveRef(root: JsonSchema, ref: string): JsonSchema | null {
  if (!ref.startsWith('#/')) return null;
  let current: unknown = root;
  for (const part of ref.slice(2).split('/')) {
    if (!isPlainObject(current)) return null;
    current = (current as Record<string, unknown>)[part];
    if (current === undefined) return null;
  }
  return isPlainObject(current) ? (current as JsonSchema) : null;
}
