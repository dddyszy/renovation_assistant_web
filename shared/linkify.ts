export type TextPart =
  { type: "text"; value: string } | { type: "link"; value: string; href: string };

// Trailing sentence punctuation stays as text so links keep working.
const URL_PATTERN = /https?:\/\/[A-Za-z0-9\-._~:/?#[@!$&'()*+,;=%\]]+/gi;
const TRAILING = /[.,;:!?，。；：！？、）)】\]]+$/;

export function linkify(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ type: "text", value: text.slice(last, index) });
    const trailing = match[0].match(TRAILING)?.[0] ?? "";
    const url = trailing ? match[0].slice(0, -trailing.length) : match[0];
    parts.push({ type: "link", value: url, href: url });
    if (trailing) parts.push({ type: "text", value: trailing });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}
