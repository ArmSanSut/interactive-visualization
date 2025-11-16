import React, { useEffect, useState, useRef } from "react";
import * as d3 from "d3";
import { fetchCompareEvents } from "./queryUtils";

export default function CompareHalfArc({ open, onClose, fullName }) {
  if (!open) return null;

  const svgRef = useRef();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  const [firstname, lastname] = fullName.split(" ");

  useEffect(() => {
    if (!firstname || !lastname) return;
    let alive = true;

    async function load() {
      setLoading(true);
      const data = await fetchCompareEvents(firstname, lastname);

      if (!alive) return;

      setEvents(data.events || []);
      setLoading(false);
    }

    load();
    return () => (alive = false);
  }, [firstname, lastname]);

  useEffect(() => {
    if (!svgRef.current || !events.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const W = 600,
      H = 350;
    svg.attr("width", W).attr("height", H);

    const cx = W / 2,
      cy = H * 0.9,
      r = 250;

    const root = svg.append("g");

    const angle = d3
      .scaleLinear()
      .domain([0, events.length])
      .range([-Math.PI, 0]);

    events.forEach((ev, i) => {
      const a = angle(i);
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);

      root
        .append("circle")
        .attr("cx", x)
        .attr("cy", y)
        .attr("r", 6)
        .attr("fill", ev.A?.length ? "var(--yes)" : "var(--no)");

      root
        .append("text")
        .attr("x", x + 8)
        .attr("y", y)
        .style("font-size", "11px")
        .text(ev.title);
    });
  }, [events]);

  return (
    <div className="compare-backdrop">
      <div className="compare-modal">
        <button className="close" onClick={onClose}>✕</button>
        <h2>Half Arc Comparison — {fullName}</h2>
        {loading && <div>กำลังโหลดข้อมูล…</div>}
        <svg ref={svgRef}></svg>
      </div>
    </div>
  );
}
