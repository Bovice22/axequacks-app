import { League_Spartan } from "next/font/google";
import PublicOverlayCleanup from "@/components/PublicOverlayCleanup";
import PublicNav from "@/components/PublicNav";

const leagueSpartan = League_Spartan({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-league",
});

export default function PublicLayout({
  children,
}: Readonly<{
      children: React.ReactNode;
  }>) {
  return (
    <div className={`${leagueSpartan.variable} public-shell relative min-h-screen`}>
      <PublicOverlayCleanup />
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-40 top-[-120px] h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(0,174,239,0.35),rgba(0,0,0,0))]" />
        <div className="absolute -left-32 top-32 h-[360px] w-[360px] rounded-full bg-[radial-gradient(circle,rgba(247,148,29,0.35),rgba(0,0,0,0))]" />
        <div className="absolute bottom-[-160px] left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,215,0,0.25),rgba(0,0,0,0))]" />
      </div>
      <header className="relative z-10">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <a href="/" className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white p-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.35)] sm:h-14 sm:w-14">
              <img src="/logo.png?v=2" alt="Axe Quacks" className="h-9 w-9 object-contain sm:h-10 sm:w-10" />
            </span>
            <span className="public-display text-base tracking-[0.18em] text-white sm:text-lg sm:tracking-[0.2em]">
              Axe Quacks
            </span>
          </a>
          <PublicNav />
        </div>
      </header>
      <main className="relative z-10 min-h-[calc(100vh-72px)]">{children}</main>
    </div>
  );
}
