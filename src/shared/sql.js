export function escapeLikePattern(value) {
  return String(value).replace(/[\\%_]/g, '\\$&');
}

export function createContainsLikePattern(value) {
  return `%${escapeLikePattern(value)}%`;
}
