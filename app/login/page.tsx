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
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Lado esquerdo — foto */}
      <div
        className="hidden lg:block lg:w-1/2"
        style={{ position: "relative", overflow: "hidden" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/Carol.png"
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
      <div
        className="w-full lg:w-1/2 flex items-center justify-center p-8"
        style={{ backgroundColor: "#111111" }}
      >
        <div style={{ width: "100%", maxWidth: "360px" }}>
          {/* Logo CG — recorte circular */}
          <div
            style={{
              width: "120px",
              height: "120px",
              borderRadius: "50%",
              overflow: "hidden",
              margin: "0 auto 24px",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/Logo.png"
              alt="CG Concursos Públicos"
              style={{
                width: "180%",
                height: "180%",
                marginLeft: "-40%",
                marginTop: "-40%",
                objectFit: "cover",
              }}
            />
          </div>

          {/* Título */}
          <h1
            style={{
              color: "#ffffff",
              fontSize: "1.25rem",
              fontWeight: 700,
              textAlign: "center",
              marginBottom: "2rem",
              letterSpacing: "0.05em",
            }}
          >
            Acompanhamento Alunos
          </h1>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: "100%",
                backgroundColor: "#1e1e1e",
                border: "1px solid #333",
                color: "#fff",
                borderRadius: "8px",
                padding: "12px 16px",
                fontSize: "0.875rem",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <input
              type="password"
              placeholder="Senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: "100%",
                backgroundColor: "#1e1e1e",
                border: "1px solid #333",
                color: "#fff",
                borderRadius: "8px",
                padding: "12px 16px",
                fontSize: "0.875rem",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            {error && (
              <p style={{ color: "#f87171", fontSize: "0.875rem", margin: 0 }}>
                {error}
              </p>
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
                fontSize: "0.875rem",
                border: "none",
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
                transition: "background-color 0.2s",
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
  );
}
