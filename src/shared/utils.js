export function parseJsonValue(value, fallback = null) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function toBoolean(value) {
  return value === true || value === 1 || value === '1';
}
