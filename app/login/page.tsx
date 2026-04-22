"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";

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
    <div className="min-h-screen flex">
      {/* Lado esquerdo — foto */}
      <div className="hidden lg:block lg:w-1/2 relative overflow-hidden">
        <Image
          src="/Carol.png"
          alt="Carolina Gaubert"
          fill
          className="object-cover object-top"
          priority
        />
      </div>

      {/* Lado direito — formulário */}
      <div className="w-full lg:w-1/2 flex items-center justify-center bg-[#111111] p-8">
        <div className="w-full max-w-sm">
          {/* Logo CG */}
          <div className="flex justify-center mb-6">
            <div className="w-28 h-28 rounded-full overflow-hidden">
              <Image
                src="/Logo.png"
                alt="Carolina Gaubert - Concursos Públicos"
                width={224}
                height={126}
                className="object-cover object-center scale-[1.6]"
                priority
              />
            </div>
          </div>

          {/* Título */}
          <h1 className="text-xl font-bold text-white text-center mb-8 tracking-wide">
            Acompanhamento Alunos
          </h1>

          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-[#1e1e1e] border border-[#333] text-white placeholder-gray-500 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#8B0000] focus:ring-1 focus:ring-[#8B0000]"
            />
            <input
              type="password"
              placeholder="Senha"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full bg-[#1e1e1e] border border-[#333] text-white placeholder-gray-500 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#8B0000] focus:ring-1 focus:ring-[#8B0000]"
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#8B0000] hover:bg-[#a00000] text-white font-semibold py-3 rounded-lg text-sm transition disabled:opacity-50"
            >
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
