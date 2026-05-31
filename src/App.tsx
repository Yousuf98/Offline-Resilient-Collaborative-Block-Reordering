import React, { useEffect, useState } from "react";
import { useStore } from "./store";

export default function App() {
  const { blocks, isOnline, toggleOnline, moveBlock, init, clientId } =
    useStore();
  const [draggedId, setDraggedId] = useState<string | null>(null);

  useEffect(() => {
    init();
  }, [init]);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.effectAllowed = "move";
    setDraggedId(id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedId) {
      moveBlock(draggedId, targetIndex);
      setDraggedId(null);
    }
  };

  return (
    <div
      style={{
        maxWidth: "600px",
        margin: "40px auto",
        fontFamily: "sans-serif",
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px",
        }}
      >
        <h2>Block Editor (Client: {clientId.slice(0, 4)})</h2>
        <button
          onClick={toggleOnline}
          style={{
            padding: "8px 16px",
            backgroundColor: isOnline ? "#4CAF50" : "#f44336",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          {isOnline ? "🟢 Online" : "🔴 Offline"}
        </button>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {blocks.map((block, index) => (
          <div
            key={block.id}
            draggable
            onDragStart={(e) => handleDragStart(e, block.id)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, index)}
            style={{
              padding: "16px",
              backgroundColor: draggedId === block.id ? "#f0f8ff" : "#ffffff",
              border: "1px solid #ddd",
              borderRadius: "6px",
              cursor: "grab",
              display: "flex",
              justifyContent: "space-between",
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            }}
          >
            <strong style={{ color: "black" }}>{block.text}</strong>
            <span style={{ fontSize: "0.8em", color: "#666" }}>
              pos: {block.pos} | By: {block.lastModifiedBy.slice(0, 4)} | L:{" "}
              {block.lastModifiedLamport}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
