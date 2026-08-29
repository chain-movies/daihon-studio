/* 投稿本文のバリデーションと文字数計算 */

/** X の重み付き文字数（CJK は 2、ラテン等は 1、URL は一律 23） */
const WEIGHT_1_RANGES = [
  [0x0000, 0x10ff],
  [0x2000, 0x200d],
  [0x2010, 0x201f],
  [0x2032, 0x2037],
];
const URL_RE = /https?:\/\/[^\s　]+/g;
const X_URL_WEIGHT = 23;

function charWeight(cp) {
  for (const [lo, hi] of WEIGHT_1_RANGES) if (cp >= lo && cp <= hi) return 1;
  return 2;
}

export function xWeightedLength(text) {
  let total = 0;
  let rest = text;
  const urls = text.match(URL_RE) || [];
  for (const u of urls) {
    total += X_URL_WEIGHT;
    rest = rest.replace(u, '');
  }
  for (const ch of rest) total += charWeight(ch.codePointAt(0));
  return total;
}

/** Threads はグラフェム数ではなくコードポイント数でおおむね 500 まで */
export function threadsLength(text) {
  return [...text].length;
}

export const LIMITS = { x: 280, threads: 500 };

export function lengthFor(platform, text) {
  return platform === 'x' ? xWeightedLength(text) : threadsLength(text);
}

export function validateText(platform, text) {
  const errors = [];
  if (typeof text !== 'string' || text.trim() === '') {
    errors.push('本文が空です');
    return errors;
  }
  const len = lengthFor(platform, text);
  if (len > LIMITS[platform]) {
    errors.push(`${platform} の上限 ${LIMITS[platform]} を ${len - LIMITS[platform]} 超過（現在 ${len}）`);
  }
  return errors;
}

/** 上限に収まるよう末尾を削る（URL とハッシュタグ行は温存する） */
export function fitTo(platform, text) {
  if (lengthFor(platform, text) <= LIMITS[platform]) return text;
  const lines = text.split('\n');
  // 末尾のタグ行・URL 行を確保
  const tail = [];
  while (lines.length > 1) {
    const last = lines[lines.length - 1];
    if (/^\s*$/.test(last) || /^#/.test(last.trim()) || URL_RE.test(last)) {
      URL_RE.lastIndex = 0;
      tail.unshift(lines.pop());
    } else break;
  }
  let body = lines.join('\n');
  const tailText = tail.length ? '\n' + tail.join('\n') : '';
  const budget = LIMITS[platform] - lengthFor(platform, tailText) - lengthFor(platform, '…');
  const chars = [...body];
  while (chars.length && lengthFor(platform, chars.join('')) > budget) chars.pop();
  body = chars.join('').replace(/[\s　]+$/, '') + '…';
  return body + tailText;
}
