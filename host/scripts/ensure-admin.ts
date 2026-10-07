import { createClient } from "@libsql/client";

const adminAccounts = (process.env.ADMIN_NEAR_ACCOUNTS ?? "ballzz.near")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const url = process.env.HOST_DATABASE_URL || "file:./database.db";
const authToken = process.env.HOST_DATABASE_AUTH_TOKEN;

async function main() {
  if (adminAccounts.length === 0) {
    console.log("No ADMIN_NEAR_ACCOUNTS configured");
    return;
  }

  const client = createClient({ url, authToken });
  const placeholders = adminAccounts.map(() => "?").join(", ");
  const existing = await client.execute({
    sql: `SELECT n.account_id, u.id, u.role
          FROM near_account n
          JOIN user u ON u.id = n.user_id
          WHERE n.account_id IN (${placeholders})`,
    args: adminAccounts,
  });

  let updated = 0;
  for (const row of existing.rows) {
    if (row.role === "admin") continue;
    await client.execute({
      sql: "UPDATE user SET role = 'admin' WHERE id = ?",
      args: [String(row.id)],
    });
    updated += 1;
  }

  console.log(
    `Admin accounts configured: ${adminAccounts.length}. Existing users updated: ${updated}. Remaining accounts will become admin on first login.`,
  );
}

void main().catch((error) => {
  console.error("Failed to ensure admin role:", error instanceof Error ? error.message : error);
  process.exit(1);
});
