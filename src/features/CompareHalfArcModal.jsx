import React, { useEffect, useMemo } from "react";

function splitName(fullName = "") {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return { firstname: "", lastname: "" };
  if (parts.length === 1) return { firstname: parts[0], lastname: "" };
  return {
    firstname: parts[0],
    lastname: parts.slice(1).join(" "),
  };
}

export default function CompareHalfArcModal({ open, onClose, person }) {
  const { firstname, lastname } = useMemo(
    () => splitName(person?.name || ""),
    [person]
  );

  const iframeSrc = useMemo(() => {
    if (!firstname && !lastname) return "/compare-a-vs-everyone.html";
    const params = new URLSearchParams({
      firstname,
      lastname,
    }).toString();
    return `/compare-a-vs-everyone.html?${params}`;
  }, [firstname, lastname]);

  useEffect(() => {
    if (!open) return;
    const prev = document.documentElement.style.overflow || "";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = prev;
    };
  }, [open]);

  if (!open || !person) return null;

  return (
    <div className="compare-modal-backdrop" onClick={onClose}>
      <div className="compare-modal-shell" onClick={(e) => e.stopPropagation()}>
        <div className="compare-modal-header">
          <div>
            <div className="compare-modal-title">Compare A vs Everyone</div>
            <div className="compare-modal-sub">
              {person.name || "ไม่ทราบชื่อ"} • {person.party || "ไม่ทราบพรรค"}
            </div>
          </div>
          <button
            type="button"
            className="compare-modal-close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="compare-modal-body">
          <iframe
            title="Compare A vs Everyone"
            src={iframeSrc}
            style={{
              width: "100%",
              height: "100%",
              border: "none",
              borderRadius: "16px",
              background: "#fff",
            }}
          />
        </div>
      </div>
    </div>
  );
}
