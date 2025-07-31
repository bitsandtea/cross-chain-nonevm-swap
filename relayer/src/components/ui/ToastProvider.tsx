import { Toaster } from "react-hot-toast";

export function ToastProvider() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          background: "rgba(0, 0, 0, 0.95)",
          color: "#00ffff",
          border: "1px solid rgba(0, 255, 255, 0.5)",
          borderRadius: "8px",
          fontFamily: "monospace",
          boxShadow: "0 0 20px rgba(0, 255, 255, 0.3)",
        },
      }}
    />
  );
}
