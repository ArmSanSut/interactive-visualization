import React from "react";

export default function CompareProfile({ votes, fullName }) {
  if (!votes || votes.length === 0) return null;

  const person = votes.find(v => v.name === fullName) || votes[0];

  return (
    <div className="card" style={{ paddingBottom: 24 }}>
      <h3 style={{ marginBottom: 12 }}>👤 ข้อมูลสมาชิกสภาผู้แทนราษฎร</h3>

      <svg width={1000} height={200}>
        <text
          x={20}
          y={40}
          fontSize={26}
          fontWeight={700}
        >
          {person.name}
        </text>

        <text
          x={20}
          y={80}
          fontSize={18}
        >
          พรรค: {person.party}
        </text>

        <rect
          x={20}
          y={115}
          width={340}
          height={20}
          rx={10}
          fill={person.color}
        />
      </svg>
    </div>
  );
}
