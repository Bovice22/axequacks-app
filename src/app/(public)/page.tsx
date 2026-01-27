import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Script from "next/script";

export default async function Home() {
  const headerList = await headers();
  const host = (headerList.get("x-forwarded-host") || headerList.get("host") || "").toLowerCase();
  if (host.startsWith("staff.")) {
    redirect("/staff/login");
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-12">
      <Script id="tawk-to" strategy="afterInteractive">
        {`
          var Tawk_API = Tawk_API || {}, Tawk_LoadStart = new Date();
          (function() {
            var s1 = document.createElement("script"), s0 = document.getElementsByTagName("script")[0];
            s1.async = true;
            s1.src = "https://embed.tawk.to/69713b3add396719806f7f83/1jfh4unst";
            s1.charset = "UTF-8";
            s1.setAttribute("crossorigin", "*");
            s0.parentNode.insertBefore(s1, s0);
          })();
        `}
      </Script>
      <div className="rounded-[32px] border border-white/10 bg-white/5 p-8 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur">
        <div className="public-display text-xs text-[#FFD700]">Axe Quacks</div>
        <h1 className="mt-3 text-4xl font-extrabold text-white sm:text-5xl">
          Booking Portal
        </h1>
        <p className="public-muted mt-3 max-w-xl text-sm sm:text-base">
          Book axe throwing, duckpin bowling, or a combo package. Host events, reserve party areas, and get instant
          pricing as you choose your time.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href="/book"
            className="rounded-full bg-[#FFD700] px-5 py-2.5 text-sm font-extrabold text-black shadow-[0_8px_24px_rgba(255,215,0,0.35)] transition hover:bg-[#ffe24a]"
          >
            Book Now
          </a>
          <a
            href="/host-event"
            className="rounded-full border border-white/25 px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-white/10"
          >
            Request an Event
          </a>
        </div>
      </div>
    </div>
  );
}
