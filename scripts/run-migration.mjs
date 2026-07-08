#!/usr/bin/env node

/**
 * Run the migration to add last_reminder_sent_at column
 *
 * Run with:
 *   node --env-file=.env.local scripts/run-migration.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("❌ Missing Supabase credentials in .env.local");
  console.error("   Need: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function runMigration() {
  console.log("🔧 Migration: add last_reminder_sent_at column\n");

  const migrationSQL = readFileSync(
    join(__dirname, "..", "migrations", "001_add_last_reminder_sent_at.sql"),
    "utf-8"
  );

  // Extract project ID from Supabase URL
  const projectId = url.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1] || "YOUR_PROJECT";

  console.log("📋 Please run this SQL in your Supabase SQL Editor:\n");
  console.log("─".repeat(70));
  console.log(migrationSQL);
  console.log("─".repeat(70));
  console.log("\n📍 To run it:");
  console.log(`   1. Go to https://app.supabase.com/project/${projectId}/sql`);
  console.log("   2. Copy and paste the SQL above");
  console.log("   3. Click 'Run'");
  console.log("\n✅ After running the SQL, the migration will be complete!\n");
}

runMigration();
