"use client";

import { useState } from "react";

type FormState = {
  parent_name: string;
  player_name: string;
  player_age: string;
  parent_phone: string;
  parent_email: string;
  whatsapp_opt_in: boolean;
};

const initial: FormState = {
  parent_name: "",
  player_name: "",
  player_age: "",
  parent_phone: "",
  parent_email: "",
  whatsapp_opt_in: true,
};

export default function TryoutForm() {
  const [form, setForm] = useState<FormState>(initial);
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // basic client-side validation
    if (
      !form.parent_name.trim() ||
      !form.player_name.trim() ||
      !form.player_age ||
      !form.parent_phone.trim() ||
      !form.parent_email.trim()
    ) {
      setError("Please fill in every field.");
      return;
    }
    const age = parseInt(form.player_age, 10);
    if (Number.isNaN(age) || age < 3 || age > 25) {
      setError("Player age must be between 3 and 25.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.parent_email)) {
      setError("Please enter a valid email.");
      return;
    }

    setStatus("submitting");
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent_name: form.parent_name.trim(),
          player_name: form.player_name.trim(),
          player_age: age,
          parent_phone: form.parent_phone.trim(),
          parent_email: form.parent_email.trim(),
          whatsapp_opt_in: form.whatsapp_opt_in,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(
          data.error || data.message || `Submission failed (${res.status})`
        );
      }

      setStatus("success");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (status === "success") {
    return (
      <div className="text-center space-y-5 py-6">
        <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-3xl">
          ✓
        </div>
        <div>
          <h2 className="text-2xl font-bold">You're in! 🎉</h2>
          <p className="text-neutral-400 mt-2">
            We just sent a confirmation email to{" "}
            <strong className="text-white">{form.parent_email}</strong> with a
            calendar invite.
          </p>
        </div>
        {form.whatsapp_opt_in && (
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-4 text-sm text-emerald-300 text-left">
            📱 You'll get a WhatsApp message from Coach Mina in the next day or
            two. Reply YES to lock in your spot and we'll send reminders as the
            tryout gets closer.
          </div>
        )}
        <button
          onClick={() => {
            setForm(initial);
            setStatus("idle");
          }}
          className="text-sm text-neutral-500 hover:text-white"
        >
          Sign up another player →
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-xl font-bold">Sign up for tryouts</h2>
        <p className="text-sm text-neutral-500">
          Takes 30 seconds. We'll never spam you.
        </p>
      </div>

      <Field
        label="Your name (parent / guardian)"
        value={form.parent_name}
        onChange={(v) => update("parent_name", v)}
        placeholder="Sarah Johnson"
        autoComplete="name"
      />

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="Player's name"
          value={form.player_name}
          onChange={(v) => update("player_name", v)}
          placeholder="Lucas"
        />
        <Field
          label="Age"
          value={form.player_age}
          onChange={(v) => update("player_age", v.replace(/\D/g, "").slice(0, 2))}
          placeholder="9"
          inputMode="numeric"
        />
      </div>

      <Field
        label="Your phone (for WhatsApp)"
        value={form.parent_phone}
        onChange={(v) => update("parent_phone", v)}
        placeholder="+1 508 555 1234"
        inputMode="tel"
        autoComplete="tel"
      />

      <Field
        label="Your email"
        value={form.parent_email}
        onChange={(v) => update("parent_email", v)}
        placeholder="sarah@example.com"
        type="email"
        autoComplete="email"
      />

      <label className="flex items-start gap-3 bg-black/40 border border-pss-border rounded-lg p-3 cursor-pointer hover:border-pss-red transition">
        <input
          type="checkbox"
          checked={form.whatsapp_opt_in}
          onChange={(e) => update("whatsapp_opt_in", e.target.checked)}
          className="mt-1 accent-pss-red w-4 h-4"
        />
        <div className="text-sm">
          <div className="font-medium">Send me WhatsApp updates</div>
          <div className="text-neutral-500 text-xs mt-0.5">
            Coach Mina will follow up to confirm and send reminders before the
            tryout. You can opt out any time.
          </div>
        </div>
      </label>

      {error && (
        <div className="bg-red-950/40 border border-red-900 rounded-md px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="w-full bg-pss-red hover:bg-pss-redhover disabled:opacity-60 disabled:cursor-not-allowed transition rounded-lg py-3 font-semibold text-white"
      >
        {status === "submitting" ? "Submitting…" : "Sign up for tryouts ⚽"}
      </button>

      <p className="text-[11px] text-neutral-600 text-center">
        By signing up, you agree to receive emails and WhatsApp messages about
        the tryout. Peace Soccer School · Rehoboth, MA
      </p>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: "text" | "numeric" | "tel" | "email" | "url" | "search" | "none" | "decimal";
  autoComplete?: string;
}) {
  return (
    <label className="block space-y-1">
      <div className="text-xs uppercase tracking-wider text-neutral-500">
        {label}
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete={autoComplete}
        className="w-full bg-black border border-pss-border rounded-md px-3 py-2.5 text-white placeholder:text-neutral-700 focus:border-pss-red outline-none transition"
      />
    </label>
  );
}
