import SessionProvider from "@/app/components/SessionProvider";
import Navbar from "@/app/components/Navbar";

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </SessionProvider>
  );
}
