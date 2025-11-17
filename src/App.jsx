import "./global.css";
import React from "react";
import VisMain from "./features/VisMain.jsx";

export default function App() {
  return (
    <div>
      <div class="header">
        <h1 style={{ margin: "14px 0 8px", textAlign: "center"}}>
          Political Voting Network
        </h1>
      </div>
      <VisMain />
    </div>
  );
}
