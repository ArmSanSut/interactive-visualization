import React, { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import "./GeoVis.css";

import GeoPoliticalViewer from "./GeoPoliticalViewer"; 
import fallback from "./fallback/vote_events.json";

const GQL_ENDPOINT = "https://politigraph.wevis.info/graphql";
const QUERY = `
  query VoteEvents {
    voteEvents {
      id
      title
      votes {
        option
        voters {
          name
          memberships { province }
        }
      }
    }
  }
`;

export default function GeoVis() {
  const svgRef = useRef(null);
  const gRef = useRef(null);

  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState("Ready");

  const [modalOpen, setModalOpen] = useState(false);
  const [modalData, setModalData] = useState(null);

  function openModal(payload) {
    setModalData(payload);
    setModalOpen(true);
    document.documentElement.style.overflow = "hidden"; // lock scroll
  }

  function closeModal() {
    setModalOpen(false);
    setModalData(null);
    document.documentElement.style.overflow = ""; // unlock scroll
  }

  // ESC key to close modal
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") closeModal();
    }
    if (modalOpen) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setStatus("Fetching vote events…");
        const res = await fetch(GQL_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: QUERY }),
        });

        if (!res.ok) {
          if (res.status >= 500) {
            if (!alive) return;
            setEvents(fallback?.data?.voteEvents ?? []);
            setStatus("Using fallback (API 5xx)");
            return;
          }
          throw new Error(`HTTP ${res.status}`);
        }

        const json = await res.json();
        if (!alive) return;
        setEvents(json?.data?.voteEvents ?? []);
        setStatus(`Loaded ${json?.data?.voteEvents?.length} events`);
      } catch (err) {
        if (!alive) return;
        setEvents(fallback?.data?.voteEvents ?? []);
        setStatus("Using fallback (network/CORS error)");
      }
    })();

    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    const g = svg.append("g").attr("class", "geo-map-root");
    gRef.current = g;

    return () => svg.selectAll("*").remove();
  }, []);

  function attachCenterClick(cx, cy, payload) {
    const g = gRef.current;
    if (!g) return;

    g.append("circle")
      .attr("class", "geo-center-dot")
      .attr("cx", cx)
      .attr("cy", cy)
      .attr("r", 8)
      .style("cursor", "pointer")
      .on("click", () => openModal(payload));
  }

  useEffect(() => {
    if (!gRef.current) return;

    attachCenterClick(200, 200, {
      title: "ข้อมูลทางภูมิรัฐศาสตร์",
      billId: null,
    });
  }, []);

  return (
    <div className="geovis-wrap">

      <div className="geovis-head">
        <h2>Thailand Geopolitical View</h2>
        <div className="muted">{status}</div>
      </div>

      <svg
        ref={svgRef}
        className="geovis-map"
        viewBox="0 0 900 1200"
      />
    </div>
  );
}

function GeoModal({ open, onClose, children }) {
  if (!open) return null;

  return (
    <div className="geo-modal-backdrop" onClick={onClose}>
      <div
        className="geo-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button className="geo-modal-close" onClick={onClose}>×</button>
        {children}
      </div>
    </div>
  );
}
