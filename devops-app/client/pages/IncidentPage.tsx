import React from "react";
import { useParams } from "react-router-dom";
import { IncidentView } from "../components/ai/IncidentView.js";

export function IncidentPage() {
  const { id } = useParams<{ id: string }>();

  if (!id) return null;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-950">
      <IncidentView conversationId={id} />
    </div>
  );
}
