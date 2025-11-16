import React, { useEffect } from "react";
import "./InteractionModal.css";

export default function InteractionModal({ open, onClose, person }) {
  // Lock background scroll when modal is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }
    return () => {
      document.body.style.overflow = "auto";
    };
  }, [open]);

  if (!open) return null;

  // Person name to pass to D3 page
  const personName = person?.voter_name || person?.firstname || "";

  return (
    <div className="imodal-overlay" onClick={onClose}>
      <div
        className="imodal-content"
        onClick={(e) => e.stopPropagation()} // prevent closing when clicking inside
      >
        {/* Close button */}
        <button className="imodal-close" onClick={onClose}>
          ✕
        </button>

        {/* D3 Page */}
        <iframe
          className="imodal-iframe"
          src={`/compare-a-vs-everyone.html?name=${encodeURIComponent(
            personName
          )}`}
          title="Compare A vs Everyone"
        />
      </div>
    </div>
  );
}
