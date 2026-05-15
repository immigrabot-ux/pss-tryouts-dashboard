import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-xl w-full text-center space-y-6">
        <div className="inline-flex items-center gap-2 text-pss-red font-semibold tracking-widest text-xs uppercase">
          <span className="w-1.5 h-1.5 rounded-full bg-pss-red" />
          Peace Soccer School
        </div>
        <h1 className="text-4xl font-bold">PSS Tryouts System</h1>
        <p className="text-neutral-400">
          Backend, automation, and admin dashboard for the Fall 2026 tryouts
          campaign. The public landing page lives at{" "}
          <a
            href="https://peacesoccerschool.com/tryouts"
            className="text-pss-red hover:underline"
          >
            peacesoccerschool.com/tryouts
          </a>
          .
        </p>
        <div className="flex justify-center gap-3 pt-2">
          <Link
            href="/admin"
            className="px-5 py-2.5 rounded-md bg-pss-red hover:bg-pss-redhover text-white font-medium transition"
          >
            Open Admin Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
