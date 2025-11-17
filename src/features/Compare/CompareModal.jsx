// src/features/Compare/CompareModal.jsx
import React, { useEffect, useState } from "react";
import * as d3 from "d3";
import {
  fetchCompareEvents,
  fetchProfiles,
  fetchOrganizations,
} from "./queryUtils";
import "./CompareModal.css";


function fmtDate(iso) {
  const d = new Date(iso);
  return isNaN(d)
    ? iso || "—"
    : d.toLocaleDateString("th-TH", {
        year: "numeric",
        month: "short",
        day: "2-digit",
      });
}
function parseDateMaybe(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d) ? null : d;
}
function asThaiYear(date) {
  return date.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "short",
  });
}
function keyify(s) {
  return (s || "").replace(/\s+/g, " ").trim().toLowerCase();
}
function pctNumber(p) {
  const n = parseFloat(
    String(p || "")
      .toString()
      .replace("%", "")
  );
  return Number.isFinite(n) ? n : 0;
}
function diffYearMonth(start, end) {
  if (!start || !end) return { y: 0, m: 0 };
  let y = end.getFullYear() - start.getFullYear();
  let m = end.getMonth() - start.getMonth();
  const d = end.getDate() - start.getDate();
  if (d < 0) m -= 1;
  if (m < 0) {
    y -= 1;
    m += 12;
  }
  return { y, m };
}
function fmtDuration(y, m) {
  const parts = [];
  if (y > 0) parts.push(`${y} ปี`);
  if (m > 0 || !parts.length) parts.push(`${m} เดือน`);
  return parts.join(" ");
}

/* ========= globals (shared state) ========= */

let aggGlobal = null;
const compareCache = new Map(); // fullName -> { events, rows, agg }
let profilesCache = null;
let orgsCache = null;
let profilesGlobal = null;
let organizationsGlobal = [];
let totalEventsGlobal = 0;
let profilesIndexByName = new Map();
let imageIndexGlobal = new Map();
let joinedGlobal = [];
let selectedNameGlobal = null;
let selectedIsAGlobal = false;
let centralNameGlobal = "";

let nodeCardEl = null;
let cardTitleEl = null;
let cardBodyEl = null;
let cardAvatarEl = null;
let statusGraphEl = null;
let statusPeersEl = null;
let graphWrapEl = null;
let graphSvgEl = null;
let peersSvgEl = null;

let resizeHandlerAttached = false;

/* ========= Data transforms ========= */

function flattenCompareRows(events) {
  const rows = [];
  totalEventsGlobal = events.length;

  for (const ev of events) {
    const aVote = ev.A?.[0] || null;
    const aVoter = aVote?.voters?.[0] || null;
    const aName = aVoter ? `${aVoter.firstname} ${aVoter.lastname}` : "";
    const aOpt = aVote?.option || "";
    const aParty = aVote?.voter_party || "";
    const aImg = aVoter?.image || "";

    for (const b of ev.B || []) {
      const bV = b.voters?.[0] || null;
      const bName = bV ? `${bV.firstname} ${bV.lastname}` : "";
      const bImg = bV?.image || "";

      rows.push({
        id: ev.id,
        title: ev.title,
        start_date: ev.start_date,
        A_name: aName,
        A_party: aParty,
        A_option: aOpt,
        A_image: aImg,
        B_name: bName,
        B_party: b.voter_party || "",
        B_option: b.option || "",
        B_image: bImg,
        flag: aOpt && b.option && aOpt === b.option ? 1 : 0,
      });
    }
  }
  return rows;
}

function aggregatePairs(rows) {
  const r = d3.rollups(
    rows,
    (v) => d3.sum(v, (d) => +d.flag || 0),
    (d) => d.A_name,
    (d) => d.B_name
  );
  const out = [];
  for (const [a, bmap] of r) {
    for (const [b, sumFlag] of bmap) {
      out.push({ A_name: a, B_name: b, sum_flag: sumFlag });
    }
  }
  return out.sort(
    (x, y) =>
      d3.descending(x.sum_flag, y.sum_flag) ||
      d3.ascending(x.A_name, y.A_name) ||
      d3.ascending(x.B_name, y.B_name)
  );
}

function buildImageIndex(rows) {
  const idx = new Map();
  for (const r of rows) {
    const an = (r.A_name || "").trim();
    const ai = (r.A_image || "").trim();
    const bn = (r.B_name || "").trim();
    const bi = (r.B_image || "").trim();
    if (an && ai && !idx.has(an)) idx.set(an, ai);
    if (bn && bi && !idx.has(bn)) idx.set(bn, bi);
  }
  return idx;
}

function addIndex(idx, key, profile) {
  const k = keyify(key);
  if (k && !idx.has(k)) idx.set(k, profile);
}

function extractAllParties(p) {
  const set = new Set();
  for (const m of p.memberships || []) {
    for (const post of m.posts || []) {
      for (const o of post.organizations || []) {
        if ((o.classification || "").toUpperCase() === "POLITICAL_PARTY") {
          set.add((o.name || o.name_en || "").trim());
        }
      }
    }
  }
  return [...set].join(", ");
}

function computeTimelineParties(p) {
  const out = [];
  for (const m of p.memberships || []) {
    const start = parseDateMaybe(m.start_date);
    const end = m.end_date ? parseDateMaybe(m.end_date) : null;
    for (const post of m.posts || []) {
      for (const o of post.organizations || []) {
        if ((o.classification || "").toUpperCase() === "POLITICAL_PARTY") {
          out.push({
            party_th: o.name || "",
            party_en: o.name_en || "",
            start,
            end,
            start_iso: m.start_date || "",
            end_iso: m.end_date || "",
          });
        }
      }
    }
  }
  out.sort((a, b) => (a.start?.getTime() || 0) - (b.start?.getTime() || 0));
  return out;
}

function latestMembership(ms) {
  if (!Array.isArray(ms) || !ms.length) return null;
  const rank = (m) => {
    const end = m.end_date
      ? parseDateMaybe(m.end_date)
      : new Date(8640000000000000);
    const start = parseDateMaybe(m.start_date) || new Date(0);
    return [end.getTime(), start.getTime()];
  };
  return ms.slice().sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (rb[0] !== ra[0]) return rb[0] - ra[0];
    return rb[1] - ra[1];
  })[0];
}

function currentParty(p) {
  const tl = computeTimelineParties(p);
  for (let i = tl.length - 1; i >= 0; i--) {
    if (!tl[i].end) return tl[i].party_th || tl[i].party_en || "";
  }
  const last = tl[tl.length - 1];
  return last?.party_th || last?.party_en || "" || "";
}

function latestRoleFromMembership(m) {
  if (!m) return "";
  const p = (m.posts || [])[0];
  return p?.role || p?.label || "";
}
function nameFromMembership(m) {
  if (!m) return "";
  for (const p of m.posts || []) {
    for (const o of p.organizations || []) {
      if (o.name) return o.name;
    }
  }
  return "";
}
function idFromMembership(m) {
  return !m ? "" : m.id || "";
}

function currentMembership(p) {
  const ms = p.memberships || [];
  const cur = ms.find((m) => !m.end_date) || null;
  return cur || latestMembership(ms);
}

function flattenProfiles(people) {
  const arr = people.map((p) => {
    const ms = p.memberships || [];
    const lm = latestMembership(ms);
    const cm = currentMembership(p);
    const timeline = computeTimelineParties(p);
    const name =
      p.name ||
      `${p.firstname ?? ""} ${p.lastname ?? ""}`.replace(/\s+/g, " ").trim();
    return {
      name,
      firstname: p.firstname || "",
      lastname: p.lastname || "",
      image: p.image || "",
      parties: extractAllParties(p),
      province: lm?.province || "",
      latest_role: latestRoleFromMembership(lm) || "",
      latest_party: currentParty(p) || "",
      current_membership_id: idFromMembership(cm) || "",
      current_membership_name: nameFromMembership(cm) || "",
      timelineParties: timeline,
      memberships: ms,
    };
  });

  const idx = new Map();
  for (const p of arr) {
    addIndex(idx, p.name, p);
    addIndex(idx, `${p.firstname} ${p.lastname}`, p);
  }
  profilesIndexByName = idx;
  return arr;
}

function joinAggWithProfiles(agg) {
  const idx = profilesIndexByName;
  return (agg || []).map((r) => {
    const pa = idx.get(keyify(r.A_name || "")) || {};
    const pb = idx.get(keyify(r.B_name || "")) || {};
    const percent =
      totalEventsGlobal > 0
        ? ((r.sum_flag / totalEventsGlobal) * 100).toFixed(1) + "%"
        : "—";
    const aImg =
      imageIndexGlobal?.get((r.A_name || "").trim()) || pa.image || "";
    const bImg =
      imageIndexGlobal?.get((r.B_name || "").trim()) || pb.image || "";
    return {
      ...r,
      percent,
      A_image: aImg,
      B_image: bImg,
      A_latest_party: pa.latest_party || "",
      B_latest_party: pb.latest_party || "",
      A_current_membership_name: pa.current_membership_name || "",
      B_current_membership_name: pb.current_membership_name || "",
    };
  });
}

function partyDurationYearsForParty(profile, partyName) {
  if (!profile || !partyName) return 0;
  const target = partyName.trim();
  if (!target) return 0;
  const today = new Date();
  let totalMonths = 0;

  for (const m of profile.memberships || []) {
    const start = parseDateMaybe(m.start_date);
    const end = parseDateMaybe(m.end_date) || today;
    if (!start) continue;
    for (const post of m.posts || []) {
      for (const o of post.organizations || []) {
        if ((o.classification || "").toUpperCase() === "POLITICAL_PARTY") {
          const nTh = (o.name || "").trim();
          const nEn = (o.name_en || "").trim();
          if (nTh === target || nEn === target) {
            const d = diffYearMonth(start, end);
            totalMonths += d.y * 12 + d.m;
            break;
          }
        }
      }
    }
  }
  return totalMonths / 12;
}

/* ========= Timeline mini (card) ========= */

function renderTimelineMini(containerEl, timeline) {
  containerEl.innerHTML = "";

  const entries = timeline
    .map((t) => {
      const start =
        t.start || (t.start_iso ? parseDateMaybe(t.start_iso) : null);
      const hasEnd = !!(t.end || t.end_iso);
      const endRaw = t.end || (t.end_iso ? parseDateMaybe(t.end_iso) : null);
      return {
        label:
          (t.party_th || t.party_en || "") +
          (t.party_en && t.party_th && t.party_en !== t.party_th
            ? ` (${t.party_en})`
            : ""),
        party_th: t.party_th || "",
        party_en: t.party_en || "",
        start,
        end: endRaw,
        start_iso:
          t.start_iso || (start ? start.toISOString().slice(0, 10) : ""),
        end_iso: t.end_iso || (endRaw ? endRaw.toISOString().slice(0, 10) : ""),
        isCurrent: !hasEnd,
      };
    })
    .filter((e) => e.start);

  if (!entries.length) {
    containerEl.innerHTML =
      '<div class="timeline-wrap">ไม่พบช่วงเวลาที่ระบุวันเริ่มต้น</div>';
    return;
  }

  const today = new Date();
  entries.forEach((e) => {
    if (e.isCurrent) e.end = today;
  });

  const minDate = d3.min(entries, (e) => e.start);
  const maxDate = d3.max(entries, (e) => e.end);
  const W = 400;
  const barH = 14;
  const gap = 8;
  const H = entries.length * (barH + gap) + 24 + 10;
  const margin = { top: 6, right: 16, bottom: 20, left: 150 };

  const wrap = d3
    .select(containerEl)
    .append("div")
    .attr("class", "timeline-wrap");
  const svg = wrap
    .append("svg")
    .attr("width", W)
    .attr("height", H + margin.top + margin.bottom);
  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3
    .scaleTime()
    .domain([minDate, maxDate])
    .range([0, W - margin.left - margin.right]);
  const y = d3
    .scaleBand()
    .domain(d3.range(entries.length))
    .range([0, H])
    .paddingInner(0.35);

  g.append("g")
    .attr("transform", `translate(0,${H})`)
    .call(
      d3
        .axisBottom(x)
        .ticks(4)
        .tickFormat((d) => asThaiYear(d))
    )
    .selectAll("text")
    .style("font-size", "10px");

  g.append("g")
    .selectAll("line")
    .data(x.ticks(4))
    .enter()
    .append("line")
    .attr("x1", (d) => x(d))
    .attr("x2", (d) => x(d))
    .attr("y1", 0)
    .attr("y2", H)
    .attr("stroke", "#f2f5fb");

  g.append("g")
    .selectAll("text")
    .data(entries)
    .enter()
    .append("text")
    .attr("x", -10)
    .attr("y", (_, i) => y(i) + barH / 2 + 4)
    .attr("text-anchor", "end")
    .style("font-size", "11px")
    .text((d) => d.label || "—");

  const color = d3
    .scaleOrdinal()
    .domain(entries.map((e) => e.label))
    .range([
      "#b8d1ff",
      "#ffc2e2",
      "#d6f7b0",
      "#b8f0e3",
      "#d9ccff",
      "#ffe8a3",
      "#ffd8cc",
    ]);

  g.append("g")
    .selectAll("rect")
    .data(entries)
    .enter()
    .append("rect")
    .attr("x", (d) => x(d.start))
    .attr("y", (_, i) => y(i))
    .attr("rx", 5)
    .attr("ry", 5)
    .attr("width", (d) => Math.max(2, x(d.end) - x(d.start)))
    .attr("height", barH)
    .attr("fill", (d) => color(d.label))
    .append("title")
    .text((d) => {
      const endLabel = d.isCurrent
        ? "ปัจจุบัน"
        : d.end_iso
        ? fmtDate(d.end_iso)
        : fmtDate(d.end);
      return `${d.label}\n${fmtDate(d.start_iso || d.start)} – ${endLabel}`;
    });

  wrap
    .append("div")
    .attr("class", "timeline-legend")
    .text("สมาชิกภาพตามเวลา (ปลายว่าง = ปัจจุบัน)");

  const table = document.createElement("table");
  table.className = "timeline-table";
  table.innerHTML = `
    <thead>
      <tr>
        <th style="width:42%">พรรค</th>
        <th style="width:23%">เริ่ม</th>
        <th style="width:23%">สิ้นสุด</th>
        <th style="width:12%">ระยะเวลา</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector("tbody");

  entries.forEach((e) => {
    const endDate = e.end || null;
    const { y, m } = diffYearMonth(e.start, endDate || today);
    const tr = document.createElement("tr");

    const partyCell = document.createElement("td");
    partyCell.innerHTML =
      e.party_en && e.party_th && e.party_en !== e.party_th
        ? `<b>${e.party_th}</b><div class="card-sub">${e.party_en}</div>`
        : `<b>${e.party_th || e.party_en || "—"}</b>`;

    const startCell = document.createElement("td");
    startCell.textContent = e.start_iso
      ? fmtDate(e.start_iso)
      : e.start
      ? fmtDate(e.start)
      : "—";

    const endCell = document.createElement("td");
    endCell.textContent = e.isCurrent
      ? "ปัจจุบัน"
      : e.end_iso
      ? fmtDate(e.end_iso)
      : endDate
      ? fmtDate(endDate)
      : "—";

    const durCell = document.createElement("td");
    durCell.textContent = fmtDuration(y, m);

    tr.appendChild(partyCell);
    tr.appendChild(startCell);
    tr.appendChild(endCell);
    tr.appendChild(durCell);
    tbody.appendChild(tr);
  });

  containerEl.appendChild(table);
}

/* ========= Node card ========= */

function ensureDomRefs() {
  nodeCardEl = document.getElementById("nodeCard");
  cardTitleEl = document.getElementById("cardTitle");
  cardBodyEl = document.getElementById("cardBody");
  cardAvatarEl = document.getElementById("cardAvatar");
  statusGraphEl = document.getElementById("statusGraph");
  statusPeersEl = document.getElementById("statusPeers");
  graphWrapEl = document.getElementById("graphWrap");
  graphSvgEl = document.getElementById("graph");
  peersSvgEl = document.getElementById("peers");

  // Force nodeCard to be hidden initially
  if (nodeCardEl) {
    nodeCardEl.style.display = "none";
  }

  const closeBtn = document.getElementById("cardClose");
  if (closeBtn && !closeBtn._compareAttached) {
    closeBtn.addEventListener("click", hideNodeCard);
    closeBtn._compareAttached = true;
  }

  if (!resizeHandlerAttached) {
    window.addEventListener("resize", handleResizeCompare);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hideNodeCard();
    });
    document.addEventListener("click", (e) => {
      if (
        nodeCardEl &&
        nodeCardEl.style.display !== "none" &&
        !nodeCardEl.contains(e.target) &&
        graphWrapEl?.contains(e.target) === false
      ) {
        hideNodeCard();
      }
    });
    resizeHandlerAttached = true;
  }
}

function hideNodeCard() {
  if (!nodeCardEl || !cardBodyEl) return;
  nodeCardEl.style.display = "none";
  cardBodyEl.innerHTML = "";
}

function showNodeCardAt(name, avatarUrl, px, py) {
  if (!nodeCardEl || !cardTitleEl || !cardBodyEl || !cardAvatarEl) return;
  const profile = profilesIndexByName.get(keyify(name));
  cardTitleEl.textContent = name || "—";
  const imgSrc = avatarUrl || profile?.image || "";
  if (imgSrc) {
    cardAvatarEl.src = imgSrc;
    cardAvatarEl.style.display = "block";
  } else {
    cardAvatarEl.removeAttribute("src");
    cardAvatarEl.style.display = "none";
  }

  cardBodyEl.innerHTML = "";
  if (
    profile &&
    Array.isArray(profile.timelineParties) &&
    profile.timelineParties.length
  ) {
    renderTimelineMini(cardBodyEl, profile.timelineParties);
  } else {
    const cur = profile?.latest_party || "—";
    const all = profile?.parties || "—";
    cardBodyEl.innerHTML = `<div class="timeline-wrap">
      <div style="font-size:13px"><b>ข้อมูลสรุป</b></div>
      <div style="font-size:12px;margin-top:4px">พรรคปัจจุบัน: ${cur}</div>
      <div style="font-size:12px;margin-top:2px">ทั้งหมดที่อยู่: ${all}</div>
      <div class="timeline-legend">ยังไม่มีข้อมูลช่วงเวลาแบบละเอียด</div>
    </div>`;
  }
  nodeCardEl.style.display = "block";

  const pad = 10;
  const gwRect = graphWrapEl.getBoundingClientRect();
  const r = nodeCardEl.getBoundingClientRect();
  let left = px + pad;
  let top = py - r.height / 2;
  if (left + r.width > gwRect.width - 6) left = Math.max(6, px - r.width - pad);
  if (top < 6) top = 6;
  if (top + r.height > gwRect.height - 6) top = gwRect.height - r.height - 6;
  nodeCardEl.style.left = `${left}px`;
  nodeCardEl.style.top = `${top}px`;
}

function positionNodeCard(openIfHidden = true) {
  if (!selectedNameGlobal || !renderHalfArc._context) return;
  const { svg, nodesData, cx, cy } = renderHalfArc._context;
  let d =
    nodesData.find((x) => x.B_name === selectedNameGlobal) ||
    (selectedIsAGlobal ? { x: cx, y: cy, B_image: "" } : null);
  if (!d) return;

  const t = d3.zoomTransform(svg.node());
  const vx = t.applyX(d.x);
  const vy = t.applyY(d.y);
  const svgRect = svg.node().getBoundingClientRect();
  const wrapRect = graphWrapEl.getBoundingClientRect();
  const px = svgRect.left - wrapRect.left + vx;
  const py = svgRect.top - wrapRect.top + vy;
  const avatar =
    d.B_image ||
    (selectedIsAGlobal
      ? profilesIndexByName.get(keyify(selectedNameGlobal))?.image || ""
      : "");
  if (nodeCardEl.style.display === "none" && openIfHidden) {
    showNodeCardAt(selectedNameGlobal, avatar, px, py);
  } else if (nodeCardEl.style.display !== "none") {
    showNodeCardAt(selectedNameGlobal, avatar, px, py);
  }
}

/* ========= Selection linking ========= */

function setSelection(name, isA = false, showCard = true) {
  console.log("🎯 setSelection:", name, "isA:", isA, "showCard:", showCard);
  selectedNameGlobal = name;
  selectedIsAGlobal = !!isA;
  highlightSelectionOnHalfArc(name);
  renderPeersChart(name);
  if (showCard) {
    positionNodeCard(true);
  }
}

/* ========= Half-Arc rendering (main graph) ========= */

function renderHalfArc(joinedRows, centralName, centralProfile) {
  console.log("🎨 renderHalfArc, centralName:", centralName);
  ensureDomRefs();
  hideNodeCard();
  joinedGlobal = joinedRows || [];
  centralNameGlobal = centralName || "";

  const svg = d3.select(graphSvgEl);
  const wrap = graphWrapEl;

  const wrapRect = wrap.getBoundingClientRect();
  const width = wrapRect.width;
  const height = wrapRect.height;

  svg.selectAll("*").remove();

  if (!joinedGlobal.length) {
    if (statusGraphEl)
      statusGraphEl.textContent = "ไม่มีข้อมูลสำหรับแสดงกราฟ Half-Arc";
    return;
  }

  const cleaned = joinedGlobal
    .filter((d) => (d.B_name || "").trim() !== "")
    .map((d) => ({ ...d, _pct: pctNumber(d.percent) }))
    .sort((a, b) => d3.descending(a._pct, b._pct))
    .slice(0, 10);

  if (!cleaned.length) {
    if (statusGraphEl)
      statusGraphEl.textContent = "ไม่มีพันธมิตรจากการลงมติร่วมกัน";
    return;
  }

  const W = Math.max(480, width - 32);
  const H = Math.max(480, height - 40);
  svg.attr("width", W).attr("height", H);

  const centerR = 50;
  const leftPad = 40;
  const cx = Math.max(centerR + leftPad, W * 0.14);
  const cy = H / 2;

  const zoomRoot = svg.append("g");
  const layerSpokes = zoomRoot.append("g").attr("data-layer", "spokes");
  const layerCenter = zoomRoot.append("g").attr("data-layer", "center");
  const layerNodes = zoomRoot.append("g").attr("data-layer", "nodes");
  const layerLabels = zoomRoot.append("g").attr("data-layer", "labels");

  const zoom = d3
    .zoom()
    .scaleExtent([0.6, 4])
    .on("zoom", (ev) => {
      zoomRoot.attr("transform", ev.transform);
      positionNodeCard(false);
    });

  svg.call(zoom).on("dblclick.zoom", null);

  const inBtn = document.getElementById("zoomInBtn");
  const outBtn = document.getElementById("zoomOutBtn");
  const resetBtn = document.getElementById("zoomResetBtn");
  if (inBtn) {
    inBtn.onclick = () =>
      svg.transition().duration(200).call(zoom.scaleBy, 1.2);
  }
  if (outBtn) {
    outBtn.onclick = () =>
      svg
        .transition()
        .duration(200)
        .call(zoom.scaleBy, 1 / 1.2);
  }
  if (resetBtn) {
    resetBtn.onclick = () =>
      svg.transition().duration(200).call(zoom.transform, d3.zoomIdentity);
  }

  const defsRoot = svg.append("defs");
  const f = defsRoot
    .append("filter")
    .attr("id", "selShadow")
    .attr("x", "-50%")
    .attr("y", "-50%")
    .attr("width", "200%")
    .attr("height", "200%");
  f.append("feDropShadow")
    .attr("dx", 0)
    .attr("dy", 2)
    .attr("stdDeviation", 3)
    .attr("flood-color", "#000")
    .attr("flood-opacity", 0.2);

  const linkWidth = d3
    .scaleLinear()
    .domain([0, d3.max(cleaned, (d) => d.sum_flag) || 1])
    .range([1.5, 8]);
  const nodeR = d3
    .scaleSqrt()
    .domain([0, d3.max(cleaned, (d) => d.sum_flag) || 1])
    .range([12, 24]);
  const color = d3
    .scaleOrdinal()
    .domain(cleaned.map((d) => d.B_latest_party || "อื่นๆ"))
    .range([
      "#a7c5ff",
      "#ffc2e2",
      "#d6f7b0",
      "#b8f0e3",
      "#d9ccff",
      "#ffe8a3",
      "#ffd8cc",
      "#c9f7f0",
      "#f5d9ff",
      "#f8e5b3",
    ]);

  const R = Math.min(W - cx - 30, H * 0.46);
  const n = cleaned.length;
  const angles =
    n === 1
      ? [-Math.PI / 2]
      : d3.range(n).map((i) => ((-90 + (180 * i) / (n - 1)) * Math.PI) / 180);

  const nodesData = cleaned.map((d, i) => {
    const th = angles[i];
    const tx = cx + R * Math.cos(th);
    const ty = cy + R * Math.sin(th);
    const jitter = () => (Math.random() - 0.5) * 10;
    return {
      rank: i + 1,
      ...d,
      tx,
      ty,
      th,
      x: tx + jitter(),
      y: ty + jitter(),
    };
  });

  const spokes = layerSpokes
    .selectAll("line")
    .data(nodesData)
    .enter()
    .append("line")
    .attr("class", "spoke")
    .attr("x1", cx)
    .attr("y1", cy)
    .attr("stroke-width", (d) => linkWidth(d.sum_flag))
    .attr("data-w", (d) => linkWidth(d.sum_flag))
    .on("click", (ev, d) => {
      console.log("👆 Spoke clicked:", d.B_name);
      ev.stopPropagation();
      setSelection(d.B_name, false, true);
    });

  const centralProfileReal =
    profilesIndexByName.get(keyify(centralName || "")) || centralProfile || {};
  const aImg = centralProfileReal?.image || "";

  const idC = "clip-center";
  const clipCenter = defsRoot.append("clipPath").attr("id", idC);
  clipCenter.append("circle").attr("r", 50).attr("cx", cx).attr("cy", cy);

  const centerG = layerCenter
    .append("g")
    .attr("class", "node")
    .style("pointer-events", "all")
    .on("click", (ev) => {
      console.log("👆 Center clicked:", centralName);
      ev.stopPropagation();
      setSelection(centralName, true, true);
    });

  if (aImg) {
    centerG
      .append("image")
      .attr("href", aImg)
      .attr("x", cx - 50)
      .attr("y", cy - 50)
      .attr("width", 100)
      .attr("height", 100)
      .attr("clip-path", `url(#${idC})`);
    centerG
      .append("circle")
      .attr("cx", cx)
      .attr("cy", cy)
      .attr("r", 50)
      .attr("class", "photo-ring center");
  } else {
    centerG
      .append("circle")
      .attr("cx", cx)
      .attr("cy", cy)
      .attr("r", 50)
      .attr("fill", "#7aa5ff22")
      .attr("stroke", "#8bb8ff")
      .attr("stroke-width", 1.5);
  }

  centerG
    .append("text")
    .attr("x", cx)
    .attr("y", cy - 50 - 12)
    .attr("text-anchor", "middle")
    .style("font-weight", 900)
    .text(centralName || "—");

  const nodes = layerNodes
    .selectAll("g.node")
    .data(nodesData)
    .enter()
    .append("g")
    .attr("class", "node node-b")
    .style("pointer-events", "all")
    .on("click", (ev, d) => {
      console.log("👆 Node clicked:", d.B_name);
      ev.stopPropagation();
      setSelection(d.B_name, false, true);
    });

  nodes.each(function (d, i) {
    const r = nodeR(d.sum_flag);
    const id = `clip-b-${i}`;
    const cp = defsRoot.append("clipPath").attr("id", id);
    cp.append("circle").attr("r", r).attr("cx", 0).attr("cy", 0);

    if (d.B_image) {
      d3.select(this)
        .append("image")
        .attr("href", d.B_image)
        .attr("x", -r)
        .attr("y", -r)
        .attr("width", r * 2)
        .attr("height", r * 2)
        .attr("clip-path", `url(#${id})`);
      d3.select(this).append("circle").attr("r", r).attr("class", "photo-ring");
    } else {
      d3.select(this)
        .append("circle")
        .attr("r", r)
        .attr("fill", color(d.B_latest_party || "อื่นๆ"));
    }
    d3.select(this)
      .append("circle")
      .attr("r", r + 3)
      .attr("class", "selected-ring")
      .style("opacity", 0);
  });

  const labels = layerLabels
    .selectAll("text")
    .data(nodesData)
    .enter()
    .append("text")
    .attr("class", "label-b")
    .text((d) => `#${d.rank} ${d.B_name} (${d._pct.toFixed(0)}%)`)
    .on("click", (ev, d) => {
      console.log("👆 Label clicked:", d.B_name);
      ev.stopPropagation();
      setSelection(d.B_name, false, true);
    });

  const placeLabel = (sel) => {
    sel
      .attr("x", (d) => {
        const r = nodeR(d.sum_flag);
        const th = Math.atan2(d.y - cy, d.x - cx);
        const pad = 8;
        return d.x + (r + pad) * Math.cos(th);
      })
      .attr("y", (d) => {
        const r = nodeR(d.sum_flag);
        const th = Math.atan2(d.y - cy, d.x - cx);
        const dy = 4;
        return d.y + (r + 2) * Math.sin(th) + dy;
      })
      .attr("text-anchor", (d) => {
        const th = Math.atan2(d.y - cy, d.x - cx);
        return Math.cos(th) >= 0 ? "start" : "end";
      })
      .style("font-weight", 600)
      .style("opacity", 0.98);
  };

  placeLabel(labels);

  const sim = d3
    .forceSimulation(nodesData)
    .alpha(0.9)
    .alphaDecay(0.05)
    .velocityDecay(0.25)
    .force("x", d3.forceX((d) => d.tx).strength(0.06))
    .force("y", d3.forceY((d) => d.ty).strength(0.06))
    .force(
      "collide",
      d3.forceCollide((d) => nodeR(d.sum_flag) + 6)
    )
    .force("charge", d3.forceManyBody().strength(-18))
    .on("tick", ticked);

  const drag = d3
    .drag()
    .on("start", (ev, d) => {
      if (!ev.active) sim.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    })
    .on("drag", (ev, d) => {
      d.fx = ev.x;
      d.fy = ev.y;
      positionNodeCard(false);
      placeLabel(labels.filter((x) => x === d));
    })
    .on("end", (ev, d) => {
      if (!ev.active) sim.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    });

  nodes.call(drag).on("mousedown", (ev) => ev.stopPropagation());

  function ticked() {
    nodesData.forEach((d) => {
      const vx = d.x - cx;
      const vy = d.y - cy;
      const dist = Math.hypot(vx, vy);
      const target = Math.hypot(d.tx - cx, d.ty - cy);
      const maxDelta = 40;
      if (Math.abs(dist - target) > maxDelta) {
        const angle = Math.atan2(vy, vx);
        const newR = target + Math.sign(dist - target) * maxDelta;
        d.x = cx + newR * Math.cos(angle);
        d.y = cy + newR * Math.sin(angle);
      }
    });
    nodes.attr("transform", (d) => `translate(${d.x},${d.y})`);
    placeLabel(labels);
    spokes.attr("x2", (d) => d.x).attr("y2", (d) => d.y);
    positionNodeCard(false);
  }

  svg.on("click", () => hideNodeCard());

  if (statusGraphEl) {
    const partyA = centralProfileReal?.latest_party || "";
    statusGraphEl.textContent = `${centralName || "—"} — ${
      partyA || "ไม่ทราบพรรค"
    }`;
  }

  // Auto-select first node on render (ไม่เปิดการ์ด)
  if (nodesData.length > 0) {
    const firstNode = nodesData[0].B_name;
    selectedNameGlobal = firstNode;
    selectedIsAGlobal = false;
    highlightSelectionOnHalfArc(firstNode);
    renderPeersChart(firstNode);
  }

  renderHalfArc._context = { svg, nodesData, cx, cy, nodeR };
}

/* ========= Highlight on Half-Arc ========= */

function highlightSelectionOnHalfArc(name) {
  console.log("✨ highlightSelectionOnHalfArc:", name);
  const ctx = renderHalfArc._context;
  if (!ctx || !graphSvgEl) return;
  const svg = d3.select(graphSvgEl);
  const { cx, cy, nodeR } = ctx;

  const OFFSET = 26;
  const SCALE = 1.12;
  const DFLT_OPA = 0.95;

  svg
    .selectAll("g.node-b")
    .transition()
    .duration(250)
    .style("opacity", DFLT_OPA)
    .style("filter", null)
    .attr("transform", (d) => `translate(${d.x},${d.y}) scale(1)`);
  svg.selectAll(".selected-ring").style("opacity", 0);

  svg
    .selectAll("text.label-b")
    .transition()
    .duration(250)
    .style("font-weight", 600)
    .style("font-size", "12px")
    .style("opacity", 0.98)
    .attr("x", (d) => {
      const r = nodeR(d.sum_flag);
      const th = Math.atan2(d.y - cy, d.x - cx);
      return d.x + (r + 8) * Math.cos(th);
    })
    .attr("y", (d) => {
      const r = nodeR(d.sum_flag);
      const th = Math.atan2(d.y - cy, d.x - cx);
      return d.y + (r + 2) * Math.sin(th) + 4;
    })
    .attr("text-anchor", (d) => {
      const th = Math.atan2(d.y - cy, d.x - cx);
      return Math.cos(th) >= 0 ? "start" : "end";
    });

  svg.selectAll("line.spoke").each(function (d) {
    const baseW =
      +this.getAttribute("data-w") ||
      +d3.select(this).attr("stroke-width") ||
      2;
    d3.select(this)
      .transition()
      .duration(250)
      .attr("x2", d.x)
      .attr("y2", d.y)
      .attr("stroke-width", baseW)
      .attr("stroke-opacity", 0.35);
  });

  if (!name) return;

  const getAngle = (d) => Math.atan2(d.y - cy, d.x - cx);

  svg
    .selectAll("g.node-b")
    .filter((d) => d && d.B_name === name)
    .raise()
    .transition()
    .duration(320)
    .attr("transform", (d) => {
      const th = getAngle(d);
      const nx = d.x + OFFSET * Math.cos(th);
      const ny = d.y + OFFSET * Math.sin(th);
      return `translate(${nx},${ny}) scale(${SCALE})`;
    })
    .style("opacity", 1)
    .style("filter", "url(#selShadow)");

  svg
    .selectAll("g.node-b")
    .filter((d) => d && d.B_name === name)
    .select(".selected-ring")
    .style("opacity", 1);

  svg
    .selectAll("text.label-b")
    .filter((d) => d && d.B_name === name)
    .raise()
    .transition()
    .duration(320)
    .attr("x", (d) => {
      const th = getAngle(d);
      const nx = d.x + OFFSET * Math.cos(th);
      const r = nodeR(d.sum_flag) * SCALE;
      return nx + (r + 10) * Math.cos(th);
    })
    .attr("y", (d) => {
      const th = getAngle(d);
      const ny = d.y + OFFSET * Math.sin(th);
      const r = nodeR(d.sum_flag) * SCALE;
      return ny + (r + 4) * Math.sin(th) + 4;
    })
    .attr("text-anchor", (d) => {
      const th = getAngle(d);
      return Math.cos(th) >= 0 ? "start" : "end";
    })
    .style("font-weight", 900)
    .style("opacity", 1);

  svg
    .selectAll("line.spoke")
    .filter((d) => d && d.B_name === name)
    .each(function (d) {
      const baseW =
        +this.getAttribute("data-w") ||
        +d3.select(this).attr("stroke-width") ||
        2;
      const th = getAngle(d);
      const nx = d.x + OFFSET * Math.cos(th);
      const ny = d.y + OFFSET * Math.sin(th);
      d3.select(this)
        .transition()
        .duration(320)
        .attr("x2", nx)
        .attr("y2", ny)
        .attr("stroke-width", baseW * 1.8)
        .attr("stroke-opacity", 1);
    });
}

/* ========= Peers scatter ========= */

function renderPeersChart(selName) {
  ensureDomRefs();
  const svg = d3.select(peersSvgEl);
  svg.selectAll("*").remove();

  if (!selName || !joinedGlobal.length) {
    if (statusPeersEl)
      statusPeersEl.textContent = "คลิกโหนดในกราฟฝั่งซ้ายเพื่อดูเพื่อนร่วมพรรค";
    return;
  }

  const prof = profilesIndexByName.get(keyify(selName));
  const party = (prof?.latest_party || "").trim();

  if (!party) {
    if (statusPeersEl) statusPeersEl.textContent = `ไม่พบพรรคของ "${selName}"`;
    return;
  }

  const peers = joinedGlobal
    .filter((r) => (r.B_name || "").trim() !== "")
    .filter((r) => (r.B_latest_party || "").trim() === party)
    .map((r) => {
      const p = profilesIndexByName.get(keyify(r.B_name));
      const years = partyDurationYearsForParty(p, party);
      return {
        name: r.B_name,
        pct: pctNumber(r.percent),
        img: r.B_image || "",
        years,
      };
    });

  const seen = new Set();
  const uniq = [];
  for (const p of peers) {
    if (!seen.has(p.name)) {
      seen.add(p.name);
      uniq.push(p);
    }
  }

  console.log("📊 Peers found:", uniq.length);

  if (!uniq.length) {
    if (statusPeersEl)
      statusPeersEl.textContent = `ไม่พบเพื่อนร่วมพรรค (${party}) ของ "${selName}"`;
    return;
  }

  uniq.sort((a, b) => d3.descending(a.pct, b.pct));

  const mean = d3.mean(uniq, (d) => d.pct) || 0;
  const variance = d3.mean(uniq, (d) => Math.pow(d.pct - mean, 2)) || 0;
  const sd = Math.sqrt(variance);
  const mMinus = Math.max(0, mean - sd);
  const mPlus = Math.min(100, mean + sd);

  const wrap = peersSvgEl.parentNode.getBoundingClientRect();
  const wrapHeight = graphWrapEl?.getBoundingClientRect().height || 520; // Match the left side
  const W = Math.max(480, wrap.width - 32);
  const H = Math.max(480, wrapHeight - 40); // Use dynamic height
  svg.attr("width", W).attr("height", H);

  const margin = { top: 48, right: 36, bottom: 50, left: 100 };
  const width = W - margin.left - margin.right;
  const height = H - margin.top - margin.bottom;

  const yMax = d3.max(uniq, (d) => d.years) || 1;
  const x = d3.scaleLinear().domain([0, 100]).range([0, width]).nice();
  const y = d3.scaleLinear().domain([0, yMax]).range([height, 0]).nice();

  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const xM = x(mean);
  const xL = x(mMinus);
  const xR = x(mPlus);

  g.append("rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", Math.max(0, xL))
    .attr("height", height)
    .attr("fill", "rgba(167,197,255,0.25)");
  g.append("rect")
    .attr("x", xL)
    .attr("y", 0)
    .attr("width", Math.max(0, xR - xL))
    .attr("height", height)
    .attr("fill", "rgba(214,247,176,0.30)");
  g.append("rect")
    .attr("x", xR)
    .attr("y", 0)
    .attr("width", Math.max(0, width - xR))
    .attr("height", height)
    .attr("fill", "rgba(255,200,180,0.28)");

  g.append("g")
    .call(
      d3
        .axisTop(x)
        .ticks(6)
        .tickFormat((d) => d + "%")
    )
    .selectAll("text")
    .style("font-size", "11px");
  g.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(
      d3
        .axisBottom(x)
        .ticks(6)
        .tickFormat((d) => d + "%")
    )
    .selectAll("text")
    .style("font-size", "11px");
  g.append("g")
    .call(
      d3
        .axisLeft(y)
        .ticks(6)
        .tickFormat((d) => d.toFixed(1) + " ปี")
    )
    .selectAll("text")
    .style("font-size", "11px");

  g.append("g")
    .selectAll("line.ygrid")
    .data(y.ticks(6))
    .enter()
    .append("line")
    .attr("x1", 0)
    .attr("x2", width)
    .attr("y1", (d) => y(d))
    .attr("y2", (d) => y(d))
    .attr("stroke", "#eef2f9");

  const addVLine = (xpos, stroke, dash, label) => {
    g.append("line")
      .attr("x1", xpos)
      .attr("x2", xpos)
      .attr("y1", 0)
      .attr("y2", height)
      .attr("stroke", stroke)
      .attr("stroke-width", 1.5)
      .attr("stroke-dasharray", dash);
    g.append("text")
      .attr("x", xpos)
      .attr("y", -16)
      .attr("text-anchor", "middle")
      .style("font-size", "10px")
      .attr("fill", "#334155")
      .text(label);
  };

  addVLine(xL, "#7aa5ff", "6 4", "Mean - SD");
  addVLine(xM, "#334155", "6 4", "Mean");
  addVLine(xR, "#ffb9a3", "6 4", "Mean + SD");

  const defs = svg.append("defs");
  const glow = defs.append("filter").attr("id", "selGlow");
  glow
    .append("feDropShadow")
    .attr("dx", 0)
    .attr("dy", 1)
    .attr("stdDeviation", 2.2)
    .attr("flood-color", "#ef4444")
    .attr("flood-opacity", 0.65);

  const baseR = 8;
  const selR = 12;
  const color = d3
    .scaleLinear()
    .domain([0, 50, 100])
    .range(["#b8d1ff", "#ffe8a3", "#ffc2e2"]);

  g.selectAll("circle.peer")
    .data(uniq, (d) => d.name)
    .enter()
    .append("circle")
    .attr("class", "peer")
    .attr("cx", (d) => x(d.pct))
    .attr("cy", (d) => y(d.years))
    .attr("r", (d) => (d.name === selName ? selR : baseR))
    .attr("fill", (d) => (d.name === selName ? "#ef4444" : color(d.pct)))
    .attr("stroke", (d) => (d.name === selName ? "#991b1b" : "#ffffff"))
    .attr("stroke-width", (d) => (d.name === selName ? 2.5 : 1))
    .style("filter", (d) => (d.name === selName ? "url(#selGlow)" : null))
    .append("title")
    .text(
      (d) =>
        `${d.name} · ${d.pct.toFixed(1)}% · อยู่ในพรรค ${d.years.toFixed(1)} ปี`
    );

  g.selectAll("circle.peer")
    .filter((d) => d.name === selName)
    .raise();

  g.append("line")
    .attr("x1", xM)
    .attr("x2", xM)
    .attr("y1", 0)
    .attr("y2", height)
    .attr("stroke", "#e9eef6")
    .attr("stroke-dasharray", "4 4");

  g.append("text")
    .attr("x", width / 2)
    .attr("y", height + 32)
    .attr("text-anchor", "middle")
    .style("font-size", "11px")
    .text("Percent match (%)");
  g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", -58)
    .attr("text-anchor", "middle")
    .style("font-size", "11px")
    .text("ระยะเวลาที่อยู่ในพรรค (ปี)");

  if (statusPeersEl) {
    const maxYears = yMax;
    statusPeersEl.textContent = `Selected: "${selName}" · พรรค: ${party} · สมาชิกที่พบ: ${
      uniq.length
    } · Mean ≈ ${mean.toFixed(1)}% · SD ≈ ${sd.toFixed(
      1
    )} · ระยะสูงสุด ≈ ${maxYears.toFixed(1)} ปี`;
  }
}

/* ========= Render all from globals ========= */

function renderAllFromGlobals(fullNameProp) {
  console.log("🔄 renderAllFromGlobals:", fullNameProp);
  ensureDomRefs();

  if (!graphWrapEl || !graphSvgEl || !peersSvgEl) {
    console.warn("❌ DOM not ready");
    return;
  }
  if (!aggGlobal || !profilesGlobal) {
    console.warn("❌ Data not loaded");
    return;
  }

  const joinedAll = joinAggWithProfiles(aggGlobal);
  if (!joinedAll.length) {
    d3.select(graphSvgEl).selectAll("*").remove();
    d3.select(peersSvgEl).selectAll("*").remove();
    hideNodeCard();
    if (statusGraphEl) {
      statusGraphEl.textContent = "ไม่มีข้อมูลกราฟ";
    }
    if (statusPeersEl) {
      statusPeersEl.textContent = "ไม่มีข้อมูลเพื่อนร่วมพรรค";
    }
    return;
  }

  let centralName = (fullNameProp || "").trim();
  let centralProfile = null;

  if (!centralName) {
    // ถ้าไม่ได้ส่งชื่อมาเลย ให้ใช้ A คนแรกใน dataset เป็นค่าเริ่มต้น
    centralName = joinedAll[0]?.A_name || "";
  }

  centralProfile = profilesIndexByName.get(keyify(centralName)) || null;

  console.log("🎯 Central candidate:", centralName);

  // Filter connections: A_name = central
  let joined = joinedAll.filter((r) => (r.A_name || "").trim() === centralName);
  console.log("📊 Filtered connections (as A):", joined.length);

  // ถ้าไม่มีเลย ลองหาว่าเขาเคยโผล่ในฝั่ง B บ้างไหม แล้ว swap
  if (!joined.length) {
    console.log("⚠️ No data as A_name, checking as B_name…");
    const asB = joinedAll.filter(
      (r) => (r.B_name || "").trim() === centralName
    );
    if (asB.length) {
      joined = asB.map((r) => ({
        ...r,
        A_name: r.B_name,
        A_party: r.B_party,
        A_image: r.B_image,
        A_latest_party: r.B_latest_party,
        A_current_membership_name: r.B_current_membership_name,
        B_name: r.A_name,
        B_party: r.A_party,
        B_image: r.A_image,
        B_latest_party: r.A_latest_party,
        B_current_membership_name: r.A_current_membership_name,
      }));
      console.log("📊 After swapping, connections:", joined.length);
    }
  }

  if (!joined.length) {
    console.warn("❌ No voting comparison data available for:", centralName);
    d3.select(graphSvgEl).selectAll("*").remove();
    d3.select(peersSvgEl).selectAll("*").remove();
    hideNodeCard();

    if (statusGraphEl) {
      statusGraphEl.textContent = `ไม่พบข้อมูลการลงมติสำหรับ "${centralName}"`;
    }
    if (statusPeersEl) {
      statusPeersEl.textContent = "ไม่มีข้อมูลเพื่อเปรียบเทียบ";
    }

    const svg = d3.select(graphSvgEl);
    const { width } = graphWrapEl.getBoundingClientRect();
    const height = 520;
    svg.attr("width", width).attr("height", height);

    svg
      .append("text")
      .attr("x", width / 2)
      .attr("y", height / 2)
      .attr("text-anchor", "middle")
      .style("font-size", "16px")
      .style("fill", "#6b7280")
      .text(`ไม่พบข้อมูลการลงมติของ ${centralName}`);

    centralNameGlobal = centralName;
    return;
  }

  // Reset selection when center changes
  selectedNameGlobal = null;
  selectedIsAGlobal = false;
  centralNameGlobal = centralName;

  renderHalfArc(joined, centralName, centralProfile);
}

/* ========= Resize handler ========= */

function handleResizeCompare() {
  console.log("📏 Resize");
  hideNodeCard();
  const currentCenter = centralNameGlobal || "";
  renderAllFromGlobals(currentCenter);

  if (selectedNameGlobal) {
    setTimeout(() => {
      setSelection(selectedNameGlobal, selectedIsAGlobal, false);
    }, 200);
  }
}

async function safeFetchProfiles() {
  if (profilesCache) return profilesCache;
  try {
    const res = await fetchProfiles();
    if (res && Array.isArray(res.people)) {
      profilesCache = res;
      return res;
    }
    profilesCache = mockProfilesData();
    return profilesCache;
  } catch {
    profilesCache = mockProfilesData();
    return profilesCache;
  }
}

async function safeFetchOrganizations() {
  if (orgsCache) return orgsCache;
  try {
    const res = await fetchOrganizations();
    if (res && Array.isArray(res.organizations)) {
      orgsCache = res;
      return res;
    }
    orgsCache = mockOrgsData();
    return orgsCache;
  } catch {
    orgsCache = mockOrgsData();
    return orgsCache;
  }
}

async function safeFetchCompareEvents(fullName) {
  const key = fullName.trim();
  if (compareCache.has(key)) {
    return compareCache.get(key);
  }

  const [firstname = "", lastname = ""] = key.split(/\s+/, 2);
  try {
    const res = await fetchCompareEvents(firstname, lastname);
    if (res && Array.isArray(res.events)) {
      compareCache.set(key, res);
      return res;
    }
    const fallback = mockCompareData();
    compareCache.set(key, fallback);
    return fallback;
  } catch {
    const fallback = mockCompareData();
    compareCache.set(key, fallback);
    return fallback;
  }
}

/* ========= React component ========= */

export default function CompareModal({ open, onClose, fullName }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;

    let alive = true;

    async function loadAll() {
      try {
        setLoading(true);
        setErr("");

        const cacheKey = (fullName || "").trim();

        const [cmp, prof, orgs] = await Promise.all([
          safeFetchCompareEvents(fullName),
          safeFetchProfiles(),
          safeFetchOrganizations(),
        ]);

        if (!alive) return;

        const events = cmp?.events ?? [];
        const people = prof?.people ?? [];
        const organizations = orgs?.organizations ?? [];

        if (!profilesCache) profilesCache = prof;
        if (!orgsCache) orgsCache = orgs;

        if (
          compareCache.has(cacheKey) &&
          compareCache.get(cacheKey)._precomputed
        ) {
          const { rows, agg, images } = compareCache.get(cacheKey);
          aggGlobal = agg;
          imageIndexGlobal = images;
        } else {
          const rows = flattenCompareRows(events);
          const agg = aggregatePairs(rows);
          const images = buildImageIndex(rows);

          compareCache.set(cacheKey, {
            events,
            rows,
            agg,
            images,
            _precomputed: true,
          });

          aggGlobal = agg;
          imageIndexGlobal = images;
        }

        // ---- Profiles global ----
        if (!profilesGlobal) {
          profilesGlobal = flattenProfiles(people);
        }

        organizationsGlobal = organizations;

        const rows = flattenCompareRows(events);
        aggGlobal = aggregatePairs(rows);
        imageIndexGlobal = buildImageIndex(rows);

        // profilesGlobal = flattenProfiles(people);
        if (!profilesGlobal) {
          profilesGlobal = flattenProfiles(people);
        }
        organizationsGlobal = organizations;

        console.log(
          "[CompareModal] loaded",
          events.length,
          "events;",
          rows.length,
          "rows; agg",
          aggGlobal.length,
          "pairs; people",
          people.length
        );
      } catch (e) {
        console.error("[CompareModal] unexpected error", e);
        if (!alive) return;
        setErr(e.message || "เกิดข้อผิดพลาดระหว่างโหลดข้อมูล");
      } finally {
        if (alive) setLoading(false);
      }
    }

    setTimeout(() => {
      if (!alive) return;
      ensureDomRefs();

      const nodeCard = document.getElementById("nodeCard");
      if (nodeCard) {
        nodeCard.style.display = "none";
      }

      loadAll();
    }, 0);

    return () => {
      alive = false;
      if (graphSvgEl) d3.select(graphSvgEl).selectAll("*").remove();
      if (peersSvgEl) d3.select(peersSvgEl).selectAll("*").remove();
      hideNodeCard();

      aggGlobal = null;
      profilesGlobal = null;
      organizationsGlobal = [];
      totalEventsGlobal = 0;
      profilesIndexByName = new Map();
      imageIndexGlobal = new Map();
      joinedGlobal = [];
      selectedNameGlobal = null;
      selectedIsAGlobal = false;
      centralNameGlobal = "";
    };
  }, [open, fullName]);

  useEffect(() => {
    if (open) {
      setTimeout(() => {
        handleResizeCompare();
      }, 50);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (loading) return;
    if (err) return;

    console.log("🎬 Rendering with fullName:", fullName);

    setTimeout(() => {
      renderAllFromGlobals(fullName);
    }, 150);
  }, [open, loading, err, fullName]);

  if (!open) return null;

  return (
    <div className="cmp-overlay">
      <div className="cmp-modal">
        <div className="cmp-modal-header">
          <div className="cmp-brand">
            <div className="brand-badge" />
            <div>
              <div className="brand-title">เปรียบเทียบกับสมาชิกคนอื่น</div>
            </div>
          </div>
          <div className="cmp-header-right">
            <div className="cmp-mp-name">{fullName || "ไม่ทราบชื่อ"}</div>
            <button className="cmp-close-btn" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        <div className="cmp-modal-body">
          {loading && <div className="cmp-loading">กำลังโหลดข้อมูล…</div>}
          {err && !loading && (
            <div className="cmp-error">เกิดข้อผิดพลาด: {err}</div>
          )}

          {!loading && !err && (
            <div className="page page-inside-modal">
              <div className="grid">
                <div className="card">
                  <div className="card-header">
                    <div className="card-title">
                      <span className="dot" />
                      Possible alliance from different parties
                    </div>
                    <div className="card-subtle" id="statusGraph"></div>
                  </div>
                  <div className="card-body" style={{ padding: "12px" }}>
                    <div id="graphWrap" className="graph-wrap">
                      <div className="zoom-ui" id="zoomUI" aria-hidden="true">
                        <button id="zoomInBtn">+</button>
                        <button id="zoomOutBtn">−</button>
                        <button id="zoomResetBtn">Reset</button>
                      </div>
                      <svg
                        id="graph"
                        width="100%"
                        height="100%"
                        style={{ touchAction: "none" }}
                      ></svg>

                      <div id="nodeCard" aria-live="polite">
                        <div className="card-head">
                          <img id="cardAvatar" alt="" />
                          <div>
                            <div
                              id="cardTitle"
                              className="card-title-pop"
                            ></div>
                            <div className="card-sub">เส้นเวลาพรรคการเมือง</div>
                          </div>
                          <button
                            id="cardClose"
                            className="card-close"
                            type="button"
                          >
                            ปิด
                          </button>
                        </div>
                        <div id="cardBody"></div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <div className="card-header">
                    <div className="card-title">
                      <span className="dot" />A Comparison of Attitudes within
                      the Party
                    </div>
                    <div className="card-subtle" id="statusPeers"></div>
                  </div>
                  <div className="card-body" style={{ padding: "12px" }}>
                    <svg id="peers" width="100%" height="97%"></svg>
                    <div className="legend">
                      <span>Percent match (%)</span>
                      <div className="grad-bar" />
                      <span>0</span>
                      <span style={{ color: "var(--muted)" }}>→</span>
                      <span>100</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ========= Mock data ========= */

function mockCompareData() {
  const A = { firstname: "อนุสรี", lastname: "ทับสุวรรณ", image: "" };
  return {
    events: [
      {
        id: "e1",
        title: "ร่าง พ.ร.บ. งบประมาณ",
        start_date: "2024-01-15",
        A: [
          {
            id: "a1",
            option: "เห็นด้วย",
            voter_party: "พรรค ก",
            voters: [A],
          },
        ],
        B: [
          {
            id: "b1",
            option: "เห็นด้วย",
            voter_party: "พรรค ข",
            voters: [{ firstname: "สมชาย", lastname: "ใจดี", image: "" }],
          },
          {
            id: "b2",
            option: "ไม่เห็นด้วย",
            voter_party: "พรรค ก",
            voters: [{ firstname: "ศิริพร", lastname: "วงศ์ดี", image: "" }],
          },
          {
            id: "b3",
            option: "เห็นด้วย",
            voter_party: "พรรค ค",
            voters: [{ firstname: "ธเนศ", lastname: "อินทร์ศิลา", image: "" }],
          },
        ],
      },
      {
        id: "e2",
        title: "ญัตติอภิปรายทั่วไป",
        start_date: "2024-03-02",
        A: [
          {
            id: "a2",
            option: "งดออกเสียง",
            voter_party: "พรรค ก",
            voters: [A],
          },
        ],
        B: [
          {
            id: "b4",
            option: "เห็นด้วย",
            voter_party: "พรรค ข",
            voters: [{ firstname: "สมชาย", lastname: "ใจดี", image: "" }],
          },
          {
            id: "b5",
            option: "งดออกเสียง",
            voter_party: "พรรค ค",
            voters: [{ firstname: "ธเนศ", lastname: "อินทร์ศิลา", image: "" }],
          },
        ],
      },
    ],
  };
}

function mockProfilesData() {
  return {
    people: [
      {
        id: "pA",
        firstname: "อนุสรี",
        lastname: "ทับสุวรรณ",
        name: "อนุสรี ทับสุวรรณ",
        image: "",
        memberships: [
          {
            id: "m1",
            province: "กทม.",
            start_date: "2021-06-01",
            end_date: "2022-12-31",
            posts: [
              {
                role: "สมาชิก",
                label: "สมาชิก",
                organizations: [
                  {
                    id: "orgX",
                    name: "พรรค X",
                    name_en: "Party X",
                    classification: "POLITICAL_PARTY",
                    image: "",
                  },
                ],
              },
            ],
          },
          {
            id: "m2",
            province: "กทม.",
            start_date: "2023-01-01",
            end_date: null,
            posts: [
              {
                role: "ส.ส.",
                label: "ส.ส.",
                organizations: [
                  {
                    id: "orgA",
                    name: "พรรค ก",
                    name_en: "Party A",
                    classification: "POLITICAL_PARTY",
                    image: "",
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "pB1",
        name: "สมชาย ใจดี",
        image: "",
        memberships: [
          {
            id: "mb1",
            province: "เชียงใหม่",
            start_date: "2022-06-01",
            end_date: null,
            posts: [
              {
                role: "ส.ส.",
                label: "ส.ส.",
                organizations: [
                  {
                    id: "orgB",
                    name: "พรรค ข",
                    name_en: "Party B",
                    classification: "POLITICAL_PARTY",
                    image: "",
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "pB2",
        name: "ศิริพร วงศ์ดี",
        image: "",
        memberships: [
          {
            id: "mb2",
            province: "ขอนแก่น",
            start_date: "2024-02-01",
            end_date: null,
            posts: [
              {
                role: "ส.ส.",
                label: "ส.ส.",
                organizations: [
                  {
                    id: "orgA",
                    name: "พรรค ก",
                    name_en: "Party A",
                    classification: "POLITICAL_PARTY",
                    image: "",
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "pB3",
        name: "ธเนศ อินทร์ศิลา",
        image: "",
        memberships: [
          {
            id: "mb3",
            province: "ชลบุรี",
            start_date: "2020-01-01",
            end_date: null,
            posts: [
              {
                role: "ส.ส.",
                label: "ส.ส.",
                organizations: [
                  {
                    id: "orgC",
                    name: "พรรค ค",
                    name_en: "Party C",
                    classification: "POLITICAL_PARTY",
                    image: "",
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function mockOrgsData() {
  return {
    organizations: [
      { name: "พรรค ก", image: "" },
      { name: "พรรค ข", image: "" },
      { name: "พรรค ค", image: "" },
    ],
  };
}
