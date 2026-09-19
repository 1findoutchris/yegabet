"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

export default function AdminLoginPage() {
  const { secret } = useParams<{ secret: string }>();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin() {
    if (!username || !password) {
      setError("Please enter your username and password.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Invalid credentials. Try again.");
        setLoading(false);
        return;
      }
      router.replace(`/admin/${secret}`);
    } catch {
      setError("Network error. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh", background: "#081820",
      display: "flex", alignItems: "center", justifyContent: "center", padding: "16px",
    }}>
      <div style={{
        width: "100%", maxWidth: "380px",
        background: "linear-gradient(150deg,#1A4252,#12303C 60%)",
        border: "1px solid #1E4A58", borderRadius: "24px", padding: "32px",
      }}>
        {/* Logo */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", marginBottom: "32px" }}>
          <div style={{
            width: "52px", height: "52px", borderRadius: "14px",
            background: "linear-gradient(135deg,#7DE8D8,#2DD4BF 45%,#0D9488)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <span style={{ fontWeight: 900, color: "#09090B", fontSize: "22px" }}>V</span>
          </div>
          <p style={{ fontWeight: 800, fontSize: "22px", color: "#F5F5F5", margin: 0 }}>
            Vinna<span style={{ color: "#2DD4BF" }}>Bet</span>
          </p>
          <p style={{ fontSize: "12px", color: "#AECDD6", margin: 0 }}>Admin dashboard</p>
        </div>

        {/* Username */}
        <div style={{ marginBottom: "12px" }}>
          <label style={{ display: "block", fontSize: "11px", textTransform: "uppercase" as const, letterSpacing: "0.07em", color: "#AECDD6", marginBottom: "6px" }}>
            Username
          </label>
          <input
            autoFocus
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="admin"
            style={{
              display: "block", width: "100%", height: "44px", padding: "0 14px",
              borderRadius: "10px", background: "#0C2027",
              border: "1px solid #1E4A58", color: "#FFFFFF",
              fontSize: "14px", outline: "none", boxSizing: "border-box" as const,
            }}
          />
        </div>

        {/* Password */}
        <div style={{ marginBottom: "16px" }}>
          <label style={{ display: "block", fontSize: "11px", textTransform: "uppercase" as const, letterSpacing: "0.07em", color: "#AECDD6", marginBottom: "6px" }}>
            Password
          </label>
          <div style={{ position: "relative" as const }}>
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              placeholder="••••••••"
              style={{
                display: "block", width: "100%", height: "44px", padding: "0 40px 0 14px",
                borderRadius: "10px", background: "#0C2027",
                border: "1px solid #1E4A58", color: "#FFFFFF",
                fontSize: "14px", outline: "none", boxSizing: "border-box" as const,
              }}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              style={{
                position: "absolute" as const, right: "12px", top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", cursor: "pointer", color: "#AECDD6",
                display: "flex", padding: 0,
              }}
            >
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            background: "#FF3B5C18", border: "1px solid #FF3B5C44",
            borderRadius: "10px", padding: "10px 14px", marginBottom: "14px",
          }}>
            <p style={{ color: "#FF3B5C", fontSize: "13px", margin: 0 }}>⚠ {error}</p>
          </div>
        )}

        {/* Button */}
        <button
          type="button"
          onClick={handleLogin}
          disabled={loading}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
            width: "100%", height: "46px", borderRadius: "12px",
            background: "linear-gradient(135deg,#7DE8D8,#2DD4BF 45%,#0D9488)",
            color: "#09090B", fontWeight: 700, fontSize: "15px",
            border: "none", cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? (
            <>
              <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
              Signing in…
            </>
          ) : "Sign in"}
        </button>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
