import TryoutForm from "./_components/TryoutForm";

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
            Sign your player up below — we'll lock in their tryout date,
            send a calendar invite, and follow up on WhatsApp with everything
            you need to know.
          </p>
          <div className="space-y-3 pt-2">
            <Detail icon="📅" label="Tryout date" value="August 15, 2026" />
            <Detail icon="⏰" label="Time" value="9:00 AM" />
            <Detail icon="📍" label="Location" value="Bliss Fields, Rehoboth MA" />
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

function Detail({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-pss-panel border border-pss-border flex items-center justify-center text-lg">
        {icon}
      </div>
      <div>
        <div className="text-xs uppercase tracking-wider text-neutral-500">
          {label}
        </div>
        <div className="font-medium">{value}</div>
      </div>
    </div>
  );
}
