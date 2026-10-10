import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { parseBrokerOperationsXlsx } from "../src/lib/import-operations.ts";
import { auditXtbPortfolio } from "../src/lib/xtb-import-audit.ts";
import type { InvestmentPortfolio } from "../src/types/portfolio.ts";

// Always read-only. --output prepares a source-backed correction/review plan,
// not an UPDATE script. Rebuilding linked lots/sales without a complete source
// history would make a partially corrected ledger unsafe.
const args = process.argv.slice(2);
const option = (name: string) => args[args.indexOf(name) + 1];
const source = args.includes("--source") ? option("--source") : undefined;
const output = args.includes("--output") ? option("--output") : undefined;
const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 12);
const main = async () => {
  if (args.includes("--apply")) throw new Error("Audyt nie zapisuje produkcyjnych danych. Najpierw przejrzyj plan korekty.");
  if (!process.env.DATABASE_URL) throw new Error("Brakuje DATABASE_URL.");
  const uri = new URL(process.env.DATABASE_URL);
  const ca = process.env.POSTGRES_CA_CERT_BASE64
    ? Buffer.from(process.env.POSTGRES_CA_CERT_BASE64, "base64").toString("utf8")
    : process.env.POSTGRES_CA_CERT_PATH ? readFileSync(process.env.POSTGRES_CA_CERT_PATH, "utf8") : undefined;
  if (ca) uri.searchParams.delete("sslmode");
  const pool = new Pool({ connectionString: uri.toString(), ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}), max: 1, connectionTimeoutMillis: 10000 });
  const client = await pool.connect().catch(async () => { await pool.end(); throw new Error("Nie mozna polaczyc sie z baza; sprawdz konfiguracje SSL."); });
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout = '20s'");
    const parsedSource = source ? await parseBrokerOperationsXlsx(new Uint8Array(readFileSync(source))) : undefined;
    const findings: Array<Record<string, unknown>> = [];
    let userCount = 0, portfolioCount = 0, xtbOperationCount = 0;
    let cursor = "";
    while (true) {
      const { rows } = await client.query("SELECT id, portfolio_json FROM users WHERE id > $1 AND portfolio_json IS NOT NULL ORDER BY id LIMIT 25", [cursor]);
      if (!rows.length) break;
      for (const row of rows) {
        userCount++;
        const document = typeof row.portfolio_json === "string" ? JSON.parse(row.portfolio_json) : row.portfolio_json;
        for (const portfolio of (document?.portfolios ?? []) as InvestmentPortfolio[]) {
          portfolioCount++;
          xtbOperationCount += (portfolio.operations ?? []).filter((op) => op.metadata?.importSource === "XTB").length;
          for (const finding of auditXtbPortfolio(portfolio, parsedSource?.operations)) findings.push({ user: fingerprint(row.id), ...finding });
        }
        cursor = row.id;
      }
    }
    await client.query("ROLLBACK");
    const counts: Record<string, number> = {};
    for (const finding of findings) counts[String(finding.code)] = (counts[String(finding.code)] ?? 0) + 1;
    console.log(JSON.stringify({ mode: "DRY_RUN_READ_ONLY", userCount, portfolioCount, xtbOperationCount, findings: findings.length, counts, sourceOperations: parsedSource?.operations.length ?? 0, sourceSkipped: parsedSource?.skippedRows.length ?? 0 }, null, 2));
    if (output) {
      const destination = resolve(output);
      // Evidence can contain account references. It must never enter this repo.
      const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
      const repoRelative = relative(repoRoot, destination);
      if (!repoRelative.startsWith("..") && !isAbsolute(repoRelative)) throw new Error("Plan korekty zapisz poza repozytorium.");
      await writeFile(destination, JSON.stringify({
        mode: "DRY_RUN", generatedAt: new Date().toISOString(),
        automaticApplySafe: false,
        correctionPolicy: "Przed korekta wykonaj backup, zweryfikuj kompletna historie z XLSX i odtworz powiazane loty/sprzedaze w izolowanej kopii. Nie aktualizuj samej operacji bez kosztu nabycia, historii sprzedazy i portfolio_json.",
        findings,
      }, null, 2), { flag: "wx", mode: 0o600 });
      console.log("Plan korekty zapisano poza repozytorium. Baza pozostala bez zmian.");
    }
  } finally {
    client.release();
    await pool.end();
  }
};
main().catch((error: unknown) => {
  // Do not print pg errors or connection configuration (may contain secrets).
  console.error(error instanceof Error && !/password|postgres:|host|connect|certificate/i.test(error.message) ? error.message : "Audyt nie powiodl sie; sprawdz konfiguracje polaczenia i certyfikatu.");
  process.exitCode = 1;
});
