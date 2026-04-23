"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (res?.ok) {
      router.push("/");
    } else {
      setError("Email ou senha incorretos.");
    }
  }

  return (
    /* Página: fundo cinza */
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#ffffff",
      padding: "24px",
    }}>
      {/* Card central */}
      <div style={{
        display: "flex",
        width: "100%",
        maxWidth: "880px",
        minHeight: "540px",
        borderRadius: "16px",
        overflow: "hidden",
        boxShadow: "0 25px 60px rgba(0,0,0,0.4)",
      }}>
        {/* Lado esquerdo — foto Carol */}
        <div style={{
          width: "42%",
          position: "relative",
          flexShrink: 0,
          display: "none",
        }}
          className="login-left"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/Carol.webp"
            alt="Carolina Gaubert"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "top center",
            }}
          />
        </div>

        {/* Lado direito — formulário */}
        <div style={{
          flex: 1,
          backgroundColor: "#1a2235",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 40px",
        }}>
          <div style={{ width: "100%", maxWidth: "320px" }}>
            {/* Logo */}
            <div style={{ textAlign: "center", marginBottom: "24px" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/Logo OK.png"
                alt="CG Concursos Públicos"
                style={{ maxWidth: "312px", width: "100%", height: "auto" }}
              />
            </div>

            {/* Título */}
            <h1 style={{
              color: "#ffffff",
              fontSize: "1.1rem",
              fontWeight: 700,
              textAlign: "center",
              marginBottom: "28px",
              letterSpacing: "0.03em",
            }}>
              Acompanhamento Alunos
            </h1>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{
                  width: "100%",
                  backgroundColor: "#253044",
                  border: "1px solid #334155",
                  color: "#fff",
                  borderRadius: "8px",
                  padding: "11px 16px",
                  fontSize: "0.875rem",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  style={{
                    width: "100%",
                    backgroundColor: "#253044",
                    border: "1px solid #334155",
                    color: "#fff",
                    borderRadius: "8px",
                    padding: "11px 44px 11px 16px",
                    fontSize: "0.875rem",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: "absolute",
                    right: "12px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#94a3b8",
                    padding: 0,
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>

              {error && (
                <p style={{ color: "#f87171", fontSize: "0.8rem", margin: 0 }}>{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: "100%",
                  backgroundColor: "#8B0000",
                  color: "#fff",
                  fontWeight: 600,
                  padding: "12px",
                  borderRadius: "8px",
                  fontSize: "0.9rem",
                  border: "none",
                  cursor: loading ? "not-allowed" : "pointer",
                  opacity: loading ? 0.6 : 1,
                  marginTop: "4px",
                }}
                onMouseEnter={(e) => { if (!loading) (e.target as HTMLButtonElement).style.backgroundColor = "#a00000"; }}
                onMouseLeave={(e) => { if (!loading) (e.target as HTMLButtonElement).style.backgroundColor = "#8B0000"; }}
              >
                {loading ? "Entrando..." : "Entrar"}
              </button>
            </form>
          </div>
        </div>
      </div>

      <style>{`
        @media (min-width: 768px) {
          .login-left { display: block !important; }
        }
      `}</style>
    </div>
  );
}
