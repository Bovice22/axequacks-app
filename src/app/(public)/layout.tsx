import { League_Spartan } from "next/font/google";
import { Suspense } from "react";
import PublicOverlayCleanup from "@/components/PublicOverlayCleanup";
import PublicHeaderLinks from "@/components/PublicHeaderLinks";

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
        <Suspense fallback={null}>
          <PublicHeaderLinks />
        </Suspense>
      </header>
      <main className="relative z-10 min-h-[calc(100vh-72px)]">{children}</main>
    </div>
  );
}
