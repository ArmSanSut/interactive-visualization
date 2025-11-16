export function classifyVote(opt) {
  if (!opt) return "other";
  const o = String(opt).toLowerCase();
  if (/(ไม่เห็น|คัดค้าน|against|reject|disapprove)/i.test(o)) return "no";
  if (/(เห็นชอบ|เห็นด้วย|approve|for|support|pass)/i.test(o)) return "yes";
  if (/(งดออกเสียง|ไม่ลงคะแนน|ไม่แสดงตน|abstain|absent|no vote)/i.test(o))
    return "other";
  return "other";
}
export function isValidName(n) {
  if (!n) return false;
  const s = String(n).trim();
  if (!/[A-Za-zก-๙]/.test(s)) return false;
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      s
    )
  )
    return false;
  return s.length >= 3;
}
