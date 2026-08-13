type JsonPrimitive = boolean | null | number | string;
export type CanonicalValue = JsonPrimitive | CanonicalValue[] | { [key: string]: CanonicalValue };

function serialize(value: unknown, path: string): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`Non-finite number at ${path}`);
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item, index) => serialize(item, `${path}[${index}]`)).join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => {
        const item = record[key];
        if (item === undefined) throw new TypeError(`Undefined value at ${path}.${key}`);
        return `${JSON.stringify(key)}:${serialize(item, `${path}.${key}`)}`;
      });
    return `{${entries.join(",")}}`;
  }

  throw new TypeError(`Unsupported canonical value at ${path}: ${typeof value}`);
}

/** Stable, whitespace-free JSON with recursively sorted keys. Inputs are schema validated first. */
export function canonicalize(value: CanonicalValue): string {
  return serialize(value, "$");
}
