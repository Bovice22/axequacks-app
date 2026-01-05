"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function WaiverContent() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const returnPath = params.get("return") || "";
  const view = params.get("view") === "1";
  const bookingId = params.get("booking_id") || "";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [agree, setAgree] = useState(false);
  const [waiverText, setWaiverText] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "signed" | "error">("loading");
  const [error, setError] = useState("");
  const [redirecting, setRedirecting] = useState(false);
  const [signedInfo, setSignedInfo] = useState<any>(null);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setError("Missing waiver link.");
      return;
    }
    (async () => {
      try {
        const query = bookingId ? `?booking_id=${encodeURIComponent(bookingId)}` : "";
        const res = await fetch(`/api/waivers/${token}${query}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStatus("error");
          setError(json?.error || "Failed to load waiver.");
          return;
        }
        if (json?.status === "SIGNED") {
          setStatus("signed");
        } else {
          setStatus("ready");
        }
        setName(json?.customer?.full_name || "");
        setEmail(json?.customer?.email || "");
        setWaiverText(json?.waiverText || "");
        setSignedInfo(json?.signed || null);
      } catch (err: any) {
        setStatus("error");
        setError(err?.message || "Failed to load waiver.");
      }
    })();
  }, [token, bookingId]);

  async function submitWaiver() {
    setError("");
    try {
      const query = bookingId ? `?booking_id=${encodeURIComponent(bookingId)}` : "";
      const res = await fetch(`/api/waivers/${token}${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, signature: name }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error || "Failed to sign waiver.");
        return;
      }
      setStatus("signed");
    } catch (err: any) {
      setError(err?.message || "Failed to sign waiver.");
    }
  }

  useEffect(() => {
    if (status !== "signed") return;
    if (!returnPath) return;
    setRedirecting(true);
    const timer = setTimeout(() => {
      window.location.href = returnPath;
    }, 1200);
    return () => clearTimeout(timer);
  }, [status, returnPath]);

  return (
    <div className="min-h-screen bg-zinc-50">
      <div className="mx-auto max-w-xl px-4 py-12">
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="text-2xl font-extrabold text-zinc-900">Axe Quacks Waiver</div>
          <div className="mt-2 text-sm text-zinc-600">Please review and sign your waiver.</div>

          {status === "loading" ? (
            <div className="mt-6 text-sm text-zinc-600">Loading waiver…</div>
          ) : status === "error" ? (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          ) : status === "signed" ? (
            <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              Waiver already signed. Thank you!
              {redirecting ? <div className="mt-2 text-xs text-emerald-700">Returning to your booking…</div> : null}
              {returnPath ? (
                <div className="mt-2 text-xs text-emerald-700">
                  <a className="underline" href={returnPath}>
                    Back to booking
                  </a>
                </div>
              ) : null}
              {view ? (
                <div className="mt-4 border-t border-emerald-200 pt-4 text-zinc-700">
                  <div className="text-sm font-semibold text-zinc-900">Signed Waiver</div>
                  {signedInfo?.signed_at ? (
                    <div className="mt-1 text-xs text-zinc-600">
                      Signed: {new Date(signedInfo.signed_at).toLocaleString("en-US")}
                    </div>
                  ) : null}
                  {signedInfo?.signer_name ? (
                    <div className="mt-1 text-xs text-zinc-600">Name: {signedInfo.signer_name}</div>
                  ) : null}
                  {signedInfo?.signer_email ? (
                    <div className="mt-1 text-xs text-zinc-600">Email: {signedInfo.signer_email}</div>
                  ) : null}
                  <div className="mt-4 whitespace-pre-line text-sm text-zinc-700">{waiverText}</div>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div className="mt-6 whitespace-pre-line text-sm text-zinc-700">{waiverText}</div>

              <div className="mt-6 space-y-2">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full Name"
                  className="h-11 w-full rounded-2xl border border-zinc-200 px-4 text-sm font-semibold outline-none focus:border-zinc-900"
                />
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  className="h-11 w-full rounded-2xl border border-zinc-200 px-4 text-sm font-semibold outline-none focus:border-zinc-900"
                />
                <label className="flex items-center gap-2 text-sm text-zinc-700">
                  <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                  I agree to the waiver terms.
                </label>
                {error ? <div className="text-sm text-red-600">{error}</div> : null}
                <button
                  type="button"
                  disabled={!name || !agree}
                  onClick={submitWaiver}
                  className="h-11 w-full rounded-2xl bg-zinc-900 text-sm font-extrabold text-white disabled:opacity-50"
                >
                  Sign Waiver
                </button>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

export default function WaiverPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zinc-50">
          <div className="mx-auto max-w-xl px-4 py-12">
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <div className="text-sm text-zinc-600">Loading waiver…</div>
            </div>
          </div>
        </div>
      }
    >
      <WaiverContent />
    </Suspense>
  );
}
