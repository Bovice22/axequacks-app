export default function Home() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-10">
      <h1 className="text-3xl font-extrabold text-zinc-900">Axe Quacks Booking Portal</h1>
      <p className="mt-3 text-sm text-zinc-600">
        Use the booking and events pages to reserve your spot or request a group event.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <a
          href="/book"
          className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
        >
          Book Now
        </a>
        <a
          href="/host-event"
          className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
        >
          Request an Event
        </a>
      </div>
    </div>
  );
}
