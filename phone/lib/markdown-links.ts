const WEB_AUTOLINK = /https?:\/\/[^\s<>"'`]+/iy;
const WEB_PREFIX = /https?:\/\//iy;

export function startsWebAutolink(text: string, index: number): boolean {
  const first = text[index];
  if ((first !== 'h' && first !== 'H') || (index > 0 && /\w/.test(text[index - 1]))) return false;
  WEB_PREFIX.lastIndex = index;
  return WEB_PREFIX.test(text);
}

/** Recognize Markdown angle-bracket links and bare HTTP(S) URLs in prose. */
export function readWebAutolink(text: string, index: number): { url: string; end: number } | null {
  const angled = text[index] === '<';
  WEB_AUTOLINK.lastIndex = index + Number(angled);
  const match = WEB_AUTOLINK.exec(text);
  if (!match) return null;
  let end = WEB_AUTOLINK.lastIndex;
  if (angled) {
    return text[end] === '>' ? { url: match[0], end: end + 1 } : null;
  }

  // Keep balanced URL parentheses or brackets but leave sentence punctuation in the text.
  const balance = { ')': 0, ']': 0 };
  for (const char of match[0]) {
    if (char === '(') balance[')']--;
    if (char === '[') balance[']']--;
    if (char === ')' || char === ']') balance[char]++;
  }
  while (end > index) {
    const char = text[end - 1];
    if ((char === ')' || char === ']') && balance[char] > 0) {
      balance[char]--;
    } else if (!'.,;:!?'.includes(char)) {
      break;
    }
    end--;
  }
  return { url: text.slice(index, end), end };
}

export function markdownLinkTarget(raw: string): { kind: 'note' | 'external'; url: string } | null {
  const dest = raw.trim().replace(/\s+(?:"[^"]*"|'[^']*'|\([^)]*\))$/, '');
  const url = (dest.startsWith('<') && dest.endsWith('>') ? dest.slice(1, -1) : dest)
    .replace(/\\([()])/g, '$1');
  if (!url || /[\u0000-\u001f\u007f]/.test(url)) return null;
  if (url.startsWith('//') || /^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url.startsWith('//') ? `https:${url}` : url);
      return parsed.hostname ? { kind: 'external', url: parsed.href } : null;
    } catch {
      return null;
    }
  }
  if (/^(mailto|tel):\S/i.test(url)) return { kind: 'external', url };
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null;
  return { kind: 'note', url };
}
