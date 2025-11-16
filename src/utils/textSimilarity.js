export function normalizeThaiLawTitle(s) {
  if (!s) return "";
  let x = String(s);
  x = x.replace(/ร่าง/g, "");
  x = x.replace(/พระราชบัญญัติ/g, "");
  x = x.replace(/พระราชกำหนด/g, "");
  x = x.replace(/พ\.ร\.บ\./g, "");
  x = x.replace(/พ\.ร\.ก\./g, "");
  x = x.replace(/\(ฉบับที่\s*.*?\)/g, " ");
  x = x.replace(/วาระที่\s*[๑-๙0-9]+/g, " ");
  x = x.replace(/การลงมติในวาระที่หนึ่ง.*$/g, " ");
  x = x.replace(/ซึ่งคณะกรรมาธิการวิสามัญพิจารณาเสร็จแล้ว/g, " ");
  x = x.replace(/พ\.ศ\.\s*[0-9\.]+/g, " ");
  x = x.replace(/[“”"'\(\)\[\]\{\}<>:;,\.!?]/g, " ");
  x = x.replace(/\s+/g, " ").trim().toLowerCase();
  return x;
}
function jaroSimilarity(s, t) {
  if (s === t) return 1;
  const len1 = s.length,
    len2 = t.length;
  if (len1 === 0 || len2 === 0) return 0;
  const matchDist = Math.floor(Math.max(len1, len2) / 2) - 1;
  const sMatches = new Array(len1).fill(false);
  const tMatches = new Array(len2).fill(false);
  let matches = 0;
  for (let i = 0; i < len1; i++) {
    const start = Math.max(0, i - matchDist);
    const end = Math.min(i + matchDist + 1, len2);
    for (let j = start; j < end; j++) {
      if (tMatches[j]) continue;
      if (s[i] !== t[j]) continue;
      sMatches[i] = true;
      tMatches[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let k = 0,
    transpositions = 0;
  for (let i = 0; i < len1; i++) {
    if (!sMatches[i]) continue;
    while (!tMatches[k]) k++;
    if (s[i] !== t[k]) transpositions++;
    k++;
  }
  transpositions /= 2;
  return (
    (matches / len1 + matches / len2 + (matches - transpositions) / matches) / 3
  );
}
export function jaroWinkler(s, t, prefixScale = 0.1) {
  const js = jaroSimilarity(s, t);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s.length, t.length); i++) {
    if (s[i] === t[i]) prefix++;
    else break;
  }
  return js + prefix * prefixScale * (1 - js);
}
export function titleSimilarity(a, b) {
  const A = normalizeThaiLawTitle(a);
  const B = normalizeThaiLawTitle(b);
  if (!A || !B) return 0;
  return jaroWinkler(A, B);
}
export function sameOrCloseDate(a, b, slackDays = 7) {
  if (!a && !b) return true;
  const da = a ? new Date(a) : null;
  const db = b ? new Date(b) : null;
  if (!da || !db) return false;
  const diff = Math.abs(da - db) / (1000 * 60 * 60 * 24);
  return diff <= slackDays;
}
