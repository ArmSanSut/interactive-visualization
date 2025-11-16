import React from "react";
import usePolitigraphFetcher from "./usePolitigraphFetcher";
import CompareHalfArc from "./CompareHalfArc";
import CompareTimeline from "./CompareTimeline";
import CompareProfile from "./CompareProfile";

export default function ComparePage({ fullName }) {
  const { data, loading, error } = usePolitigraphFetcher(fullName);

  if (loading) return <div className="cmp-loading">กำลังโหลดข้อมูล...</div>;
  if (error) return <div className="cmp-error">{error}</div>;

  const rawVotes = data?.votes || [];

  const partyColor = {
    "พรรคก้าวไกล": "#ff6b00",
    "พรรคเพื่อไทย": "#cc0000",
    "พรรคประชาธิปัตย์": "#0085ff",
    "พรรครวมไทยสร้างชาติ": "#0a3dff",
    "อื่น ๆ": "#999"
  };

  const votes = rawVotes.map(v => ({
    name: v.voter_name,
    party: v.voter_party,
    score: v.option === "Yes" ? 1 : v.option === "No" ? -1 : 0,
    date: v.event?.end_date || v.event?.start_date || "",
    color: partyColor[v.voter_party] || "#999"
  }));

  return (
    <div className="cmp-wrap">
      <CompareHalfArc votes={votes} fullName={fullName} />
      <CompareProfile votes={votes} fullName={fullName} />
      <CompareTimeline votes={votes} fullName={fullName} />
    </div>
  );
}
