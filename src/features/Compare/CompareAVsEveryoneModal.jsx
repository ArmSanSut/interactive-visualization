import React, { useEffect, useState } from "react";
import { fetchCompareEvents } from "./queryUtils";

export default function CompareAVsEveryoneModal({ open, onClose, fullName }) {
  if (!open) return null;

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

  return (
    <div className="compare-backdrop">
      <div className="compare-modal wide">
        <button className="close" onClick={onClose}>✕</button>

        <h2>A vs Everyone — {fullName}</h2>

        {loading && <div>กำลังโหลดข้อมูล…</div>}

        {!loading && (
          <div className="compare-list">
            {events.map((ev) => (
              <div className="compare-row" key={ev.id}>
                <div className="title">{ev.title}</div>
                <div className="bar">
                  <span className="a">{ev.A?.length ?? 0} โหวต</span>
                  <span className="b">{ev.B?.length ?? 0} คนอื่น</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
