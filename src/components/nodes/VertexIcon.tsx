import React from "react";

/**
 * Google Cloud Vertex AI Icon
 * Represents the Google Cloud / Vertex AI brand
 */
export function VertexIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "w-4 h-4"} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.105 3.127a8.85 8.85 0 0 1 6.262 2.593l-2.506 2.506a5.243 5.243 0 0 0-3.756-1.505c-1.45 0-2.768.59-3.756 1.505L5.843 5.72a8.85 8.85 0 0 1 6.262-2.593z" />
      <path d="M3.127 12a8.85 8.85 0 0 1 2.593-6.262l2.506 2.506A5.243 5.243 0 0 0 6.72 12c0 1.45.59 2.768 1.505 3.756l-2.506 2.506A8.85 8.85 0 0 1 3.127 12z" />
      <path d="M20.873 12a8.85 8.85 0 0 1-2.593 6.262l-2.506-2.506A5.243 5.243 0 0 0 17.28 12c0-1.45-.59-2.768-1.505-3.756l2.506-2.506A8.85 8.85 0 0 1 20.873 12z" />
    </svg>
  );
}
