import React from "react";
import { useNavigate } from "react-router-dom";
import { useCreateAiConversation } from "../../hooks/useAiConversation.js";
import { useAiSettings } from "../../hooks/useAiSettings.js";

interface Props {
  targetKind: string;
  targetId: string | null;
  className?: string;
  variant?: "primary" | "secondary" | "ghost";
}

export function AnalyzeButton({ targetKind, targetId, className = "", variant = "primary" }: Props) {
  const navigate = useNavigate();
  const { data: settings } = useAiSettings();
  const createConvo = useCreateAiConversation();

  if (!settings?.enabled) return null;

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    try {
      const { id } = await createConvo.mutateAsync({ targetKind, targetId });
      navigate(`/incidents/${id}`);
    } catch (err) {
      console.error("Failed to start AI analysis:", err);
      alert("Failed to start AI analysis. Check provider settings.");
    }
  };

  const baseClass = "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-bold transition-all disabled:opacity-50";
  const variants = {
    primary: "bg-brand-purple text-white hover:shadow-[0_0_15px_rgba(168,85,247,0.4)]",
    secondary: "bg-gray-800 text-gray-200 border border-gray-700 hover:bg-gray-700",
    ghost: "bg-transparent text-gray-400 hover:text-white hover:bg-gray-800",
  };

  return (
    <button
      onClick={handleClick}
      disabled={createConvo.isPending || settings.globalKillSwitchEngaged}
      className={`${baseClass} ${variants[variant]} ${className}`}
    >
      <span className="text-base">✨</span>
      {createConvo.isPending ? "Starting Analysis..." : "Analyze with AI"}
    </button>
  );
}
