import React, { useEffect, useRef } from "react";
import * as d3 from "d3";

export default function CompareTimeline({ votes, fullName }) {
  const ref = useRef();

  useEffect(() => {
    if (!votes || votes.length === 0) return;

    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();

    const width = 1000;
    const height = 420;
    const margin = { top: 40, right: 40, bottom: 60, left: 60 };

    svg.attr("width", width).attr("height", height);

    const dates = votes.map(d => d.date);

    const x = d3.scaleBand()
      .domain(dates)
      .range([margin.left, width - margin.right])
      .padding(0.4);

    const y = d3.scaleLinear()
      .domain([-1, 1])
      .range([height - margin.bottom, margin.top]);

    // X Axis
    svg.append("g")
      .attr("transform", `translate(0, ${height - margin.bottom})`)
      .call(
        d3.axisBottom(x)
          .tickFormat(d => d.replace(/T.*/, ""))
      )
      .selectAll("text")
      .style("font-size", "11px")
      .attr("transform", "rotate(-30)")
      .style("text-anchor", "end");

    // Y Axis
    svg.append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5));

    // Points
    svg.append("g")
      .selectAll("circle")
      .data(votes)
      .enter()
      .append("circle")
      .attr("cx", d => x(d.date) + x.bandwidth() / 2)
      .attr("cy", d => y(d.score))
      .attr("r", 0)
      .attr("fill", d => d.color)
      .transition()
      .duration(500)
      .attr("r", d => d.name === fullName ? 10 : 7);

  }, [votes, fullName]);

  return (
    <div className="card">
      <h3 style={{ marginBottom: 6 }}>📅 ไทม์ไลน์การลงคะแนน</h3>
      <svg ref={ref}></svg>
    </div>
  );
}
