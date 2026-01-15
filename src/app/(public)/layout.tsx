import PublicOverlayCleanup from "@/components/PublicOverlayCleanup";

export default function PublicLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-white">
      <PublicOverlayCleanup />
      <header className="border-b border-zinc-200">
        <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between px-4 py-4">
          <a href="/" className="text-sm font-extrabold tracking-wide text-zinc-900">
            Axe Quacks
          </a>
          <nav className="flex items-center gap-4 text-sm font-semibold text-zinc-700">
            <a href="/book" className="hover:underline">
              Book
            </a>
            <a href="/host-event" className="hover:underline">
              Events
            </a>
          </nav>
        </div>
      </header>
      <main className="min-h-[calc(100vh-64px)]">{children}</main>
    </div>
  );
}
