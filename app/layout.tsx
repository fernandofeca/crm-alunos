import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CRM Alunos",
  description: "Controle de desempenho de alunos",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className="min-h-full bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
