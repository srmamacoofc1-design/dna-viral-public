const REPLACEMENT_CHARACTER = "\uFFFD";

/**
 * PostgreSQL text/jsonb cannot represent U+0000 and rejects lone UTF-16
 * surrogates emitted as JSON escapes. JavaScript accepts both, so normalize
 * provider strings before they cross the PostgREST boundary.
 */
export function sanitizePostgresText(value: string): string {
  let result = "";

  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);

    if (codeUnit === 0) {
      result += REPLACEMENT_CHARACTER;
      continue;
    }

    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xDC00 && nextCodeUnit <= 0xDFFF) {
        result += value[index] + value[index + 1];
        index++;
      } else {
        result += REPLACEMENT_CHARACTER;
      }
      continue;
    }

    if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      result += REPLACEMENT_CHARACTER;
      continue;
    }

    result += value[index];
  }

  return result;
}

/** Recursively sanitizes every string value and object key in parsed JSON. */
export function sanitizePostgresJsonUnicode<T>(value: T): T {
  if (typeof value === "string") return sanitizePostgresText(value) as T;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizePostgresJsonUnicode(item)) as T;
  }

  if (value !== null && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      sanitized[sanitizePostgresText(key)] = sanitizePostgresJsonUnicode(nestedValue);
    }
    return sanitized as T;
  }

  return value;
}
