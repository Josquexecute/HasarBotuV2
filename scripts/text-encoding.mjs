// UTF-8 bytes decoded as a Windows code page leave these paired characters.
// A standalone accented letter (for example in a name) remains valid.
const brokenText = /[\u00c2-\u00c5][\u0080-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac]|\u00e2[\u0080\u20ac\u201a]|[\u0000\ufffd]/u

export function assertReadableText(text, label = 'Text') {
  if (typeof text !== 'string' || brokenText.test(text)) throw new Error(`${label}: invalid or garbled text; provide the original UTF-8 text.`)
  return text
}

export function decodeUtf8Text(bytes, label = 'Text') {
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new Error(`${label}: expected a UTF-8 file.`) }
  return assertReadableText(text, label)
}
