import TryoutForm from "./_components/TryoutForm";
import { TRYOUT_DAYS, TRYOUT_LOCATION } from "@/lib/tryout-config";

export default function Home() {
  return (
    <main className="min-h-screen relative overflow-hidden">
      {/* glow background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -left-40 w-[600px] h-[600px] rounded-full bg-pss-red/20 blur-3xl" />
        <div className="absolute top-1/3 -right-40 w-[500px] h-[500px] rounded-full bg-pss-red/10 blur-3xl" />
      </div>

      <div className="max-w-5xl mx-auto px-6 py-12 md:py-20 grid md:grid-cols-2 gap-12 items-start">
        {/* LEFT — hero copy */}
        <div className="space-y-6 md:pt-10">
          <div className="inline-flex items-center gap-2 text-pss-red font-semibold tracking-widest text-xs uppercase">
            <span className="w-1.5 h-1.5 rounded-full bg-pss-red" />
            Peace Soccer School · Fall 2026
          </div>
          <h1 className="text-4xl md:text-5xl font-bold leading-tight">
            Your Fall 2026{" "}
            <span className="text-pss-red">Tryout</span> starts here
          </h1>
          <p className="text-neutral-400 text-lg leading-relaxed">
            Two days of tryouts — sign your player up below. We'll send a
            calendar invite covering both sessions and follow up on WhatsApp.
          </p>
          <div className="space-y-3 pt-2">
            {TRYOUT_DAYS.map((day) => (
              <DayCard
                key={day.label}
                label={day.label}
                date={day.displayDate}
                time={day.displayTime}
              />
            ))}
            <div className="flex items-center gap-3 pt-1">
              <div className="w-10 h-10 rounded-lg bg-pss-panel border border-pss-border flex items-center justify-center text-lg">
                📍
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-neutral-500">
                  Location (both days)
                </div>
                <div className="font-medium">{TRYOUT_LOCATION}</div>
              </div>
            </div>
          </div>
          <div className="text-sm text-neutral-500 pt-4 border-t border-pss-border">
            Questions? Coach Mina will reach out personally after you sign up.
          </div>
        </div>

        {/* RIGHT — form */}
        <div className="bg-pss-panel border border-pss-border rounded-2xl p-6 md:p-8 shadow-2xl">
          <TryoutForm />
        </div>
      </div>
    </main>
  );
}

function DayCard({
  label,
  date,
  time,
}: {
  label: string;
  date: string;
  time: string;
}) {
  return (
    <div className="flex items-start gap-3 bg-pss-panel/40 border border-pss-border rounded-lg p-3">
      <div className="w-10 h-10 rounded-lg bg-pss-red/15 border border-pss-red/30 flex items-center justify-center text-pss-red font-bold text-sm">
        {label.replace(/Day /, "")}
      </div>
      <div>
        <div className="text-xs uppercase tracking-wider text-pss-red font-semibold">
          {label}
        </div>
        <div className="font-medium">{date}</div>
        <div className="text-sm text-neutral-400">{time}</div>
      </div>
    </div>
  );
}
