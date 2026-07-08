#!/usr/bin/env node

/**
 * Script to find and remove duplicate leads based on email and phone number.
 * Keeps the oldest entry (by created_at) and removes duplicates.
 *
 * Run with:
 *   node --env-file=.env.local scripts/remove-duplicates.mjs
 *
 * To actually delete duplicates (not just preview):
 *   node --env-file=.env.local scripts/remove-duplicates.mjs --execute
 */

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("❌ Missing required environment variables:");
  console.error("   - NEXT_PUBLIC_SUPABASE_URL");
  console.error("   - SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function findDuplicates() {
  console.log("🔍 Searching for duplicate leads...\n");

  // Get all non-hidden leads
  const { data: leads, error } = await supabase
    .from("leads")
    .select("*")
    .or("hidden.is.null,hidden.eq.false")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("❌ Error fetching leads:", error);
    process.exit(1);
  }

  console.log(`📊 Total leads found: ${leads.length}\n`);

  // Group by email
  const emailGroups = {};
  const phoneGroups = {};

  for (const lead of leads) {
    const email = lead.parent_email?.toLowerCase().trim();
    const phone = lead.parent_phone?.trim();

    if (email) {
      if (!emailGroups[email]) {
        emailGroups[email] = [];
      }
      emailGroups[email].push(lead);
    }

    if (phone) {
      if (!phoneGroups[phone]) {
        phoneGroups[phone] = [];
      }
      phoneGroups[phone].push(lead);
    }
  }

  // Find duplicates
  const duplicatesByEmail = Object.entries(emailGroups).filter(
    ([_, leads]) => leads.length > 1
  );
  const duplicatesByPhone = Object.entries(phoneGroups).filter(
    ([_, leads]) => leads.length > 1
  );

  // Combine and deduplicate (some might have both email and phone duplicates)
  const allDuplicateLeadIds = new Set();
  const duplicateGroups = [];

  for (const [email, leads] of duplicatesByEmail) {
    duplicateGroups.push({
      type: "email",
      value: email,
      leads: leads,
    });
    leads.forEach((lead) => allDuplicateLeadIds.add(lead.id));
  }

  for (const [phone, leads] of duplicatesByPhone) {
    // Check if this is a new group or already covered by email
    const existingGroup = duplicateGroups.find((g) =>
      g.leads.some((l) => leads.some((pl) => pl.id === l.id))
    );

    if (!existingGroup) {
      duplicateGroups.push({
        type: "phone",
        value: phone,
        leads: leads,
      });
      leads.forEach((lead) => allDuplicateLeadIds.add(lead.id));
    }
  }

  return duplicateGroups;
}

async function displayDuplicates(duplicateGroups) {
  if (duplicateGroups.length === 0) {
    console.log("✅ No duplicates found!");
    return [];
  }

  console.log(`\n⚠️  Found ${duplicateGroups.length} duplicate groups:\n`);

  const toDelete = [];

  for (let i = 0; i < duplicateGroups.length; i++) {
    const group = duplicateGroups[i];
    console.log(`\n${"=".repeat(80)}`);
    console.log(
      `Group ${i + 1}: Duplicates by ${group.type.toUpperCase()} - ${group.value}`
    );
    console.log(`${"=".repeat(80)}`);

    // Sort by created_at to keep the oldest
    const sorted = [...group.leads].sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    );

    sorted.forEach((lead, idx) => {
      const isOldest = idx === 0;
      console.log(
        `\n  ${isOldest ? "✓ KEEP" : "✗ DELETE"} [${idx + 1}/${sorted.length}]`
      );
      console.log(`    ID: ${lead.id}`);
      console.log(`    Created: ${lead.created_at}`);
      console.log(`    Name: ${lead.parent_name}`);
      console.log(`    Player: ${lead.player_name}`);
      console.log(`    Email: ${lead.parent_email}`);
      console.log(`    Phone: ${lead.parent_phone}`);
      console.log(`    Status: ${lead.status}`);
      console.log(`    WhatsApp Confirmed: ${lead.whatsapp_confirmed}`);
      console.log(`    Source: ${lead.source || "N/A"}`);

      if (!isOldest) {
        toDelete.push(lead);
      }
    });
  }

  console.log(`\n${"=".repeat(80)}\n`);
  console.log(`📝 Summary:`);
  console.log(
    `   - Total duplicate groups: ${duplicateGroups.length}`
  );
  console.log(`   - Leads to keep: ${duplicateGroups.length}`);
  console.log(`   - Leads to delete: ${toDelete.length}\n`);

  return toDelete;
}

async function deleteDuplicates(toDelete, dryRun = true) {
  if (toDelete.length === 0) {
    return;
  }

  if (dryRun) {
    console.log("🔍 DRY RUN MODE - No actual deletions will occur\n");
    console.log("To actually delete duplicates, run with: --execute\n");
    return;
  }

  console.log("⚠️  EXECUTING DELETION...\n");

  let successCount = 0;
  let errorCount = 0;

  for (const lead of toDelete) {
    console.log(`Deleting lead ${lead.id} (${lead.parent_email})...`);

    // Soft delete by setting hidden flag
    const { error } = await supabase
      .from("leads")
      .update({
        hidden: true,
        hidden_reason: "duplicate",
      })
      .eq("id", lead.id);

    if (error) {
      console.error(`  ❌ Error: ${error.message}`);
      errorCount++;
    } else {
      console.log(`  ✅ Soft-deleted successfully`);
      successCount++;
    }
  }

  console.log(`\n${"=".repeat(80)}`);
  console.log(`✅ Deletion complete!`);
  console.log(`   - Successfully deleted: ${successCount}`);
  console.log(`   - Errors: ${errorCount}`);
  console.log(`${"=".repeat(80)}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes("--execute");

  console.log("🚀 PSS Tryouts - Duplicate Lead Removal Script\n");

  const duplicateGroups = await findDuplicates();
  const toDelete = await displayDuplicates(duplicateGroups);

  if (toDelete.length > 0) {
    await deleteDuplicates(toDelete, !execute);
  }

  console.log("✅ Done!\n");
}

main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
