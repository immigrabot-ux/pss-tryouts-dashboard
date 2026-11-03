import { redirect } from "next/navigation";

/**
 * The Fall 2026 tryout sign-up page is retired (tryouts were July 25–26, 2026).
 * The public interest list now lives on the main website. The old page is saved in
 * ~/Downloads/_pss_trash/tryouts-system-home-fall2026.page.tsx if it's ever needed.
 */
export default function Home() {
  redirect("https://www.peacesoccerschool.com/tryouts");
}
