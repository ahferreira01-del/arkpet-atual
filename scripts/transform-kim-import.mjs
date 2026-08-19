// One-off: transform the Kim Pet Sitter export into a production-compatible import script.
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "attached_assets/export_creche_kim_pet_sitter_1787002245339.sql";
const OUT = "artifacts/api-server/import/kim-import.sql";

const raw = readFileSync(SRC, "utf8");

// --- split into top-level statements (quote-aware) ---
const stmts = [];
let cur = "";
let inStr = false;
// strip comment lines first (they otherwise glue onto the following statement)
const cleaned = raw
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

for (let i = 0; i < cleaned.length; i++) {
  const ch = cleaned[i];
  cur += ch;
  if (inStr) {
    if (ch === "'") {
      if (cleaned[i + 1] === "'") { cur += "'"; i++; } // escaped ''
      else inStr = false;
    }
  } else {
    if (ch === "'") inStr = true;
    else if (ch === ";") { stmts.push(cur.trim()); cur = ""; }
  }
}
if (cur.trim()) stmts.push(cur.trim());

// 10 statements in the export are wrapped in stray double quotes ("INSERT ...;");
// the closing quote lands at the start of the following statement. Strip them.
for (let i = 0; i < stmts.length; i++) stmts[i] = stmts[i].replace(/^["\s]+/, "");

// --- helpers ---
function parseInsert(stmt) {
  const m = stmt.match(/^INSERT INTO (\w+) \(([^)]*)\) VALUES \(([\s\S]*)\);$/);
  if (!m) return null;
  const [, table, colStr, valStr] = m;
  const cols = colStr.split(",").map((s) => s.trim());
  // split values at top-level commas (quote-aware, paren-agnostic since values contain no bare parens outside strings)
  const vals = [];
  let v = "", str = false;
  for (let i = 0; i < valStr.length; i++) {
    const ch = valStr[i];
    if (str) {
      v += ch;
      if (ch === "'") {
        if (valStr[i + 1] === "'") { v += "'"; i++; }
        else str = false;
      }
    } else if (ch === "'") { str = true; v += ch; }
    else if (ch === ",") { vals.push(v.trim()); v = ""; }
    else v += ch;
  }
  if (v.trim()) vals.push(v.trim());
  if (vals.length !== cols.length) throw new Error(`col/val mismatch in ${table}: ${cols.length} cols vs ${vals.length} vals :: ${stmt.slice(0, 120)}`);
  return { table, cols, vals };
}
const rebuild = ({ table, cols, vals }) =>
  `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${vals.join(", ")});`;

const EXCLUDE_TABLES = new Set(["push_subscriptions", "stay_services", "timeline_edit_history"]);
const BOOKING_OFFSET = 100; // prod bookings max=96; export range 72-162 -> 172-262
const VACCINE_REMAP = { 3: 5 }; // prod vaccines max=4
const PLACEHOLDER_TUTOR = "69"; // replaces references to old user id 1 (not in export)

const out = [];
const counts = {};
let placeholderNeeded = false;

for (const stmt of stmts) {
  if (/^BEGIN;$/.test(stmt) || /^COMMIT;$/.test(stmt)) continue;
  if (/^SELECT setval/.test(stmt)) continue; // rebuilt below
  if (/^UPDATE creches SET admin_id = 40 WHERE id = 16;$/.test(stmt)) {
    out.push({ order: 1.5, sql: stmt });
    continue;
  }
  const ins = parseInsert(stmt);
  if (!ins) {
    if (/^INSERT/.test(stmt)) throw new Error("unparsed INSERT: " + stmt.slice(0, 120));
    continue; // comments already stripped by split (comments live between stmts; keep none)
  }
  const { table, cols, vals } = ins;
  if (EXCLUDE_TABLES.has(table)) continue;

  const col = (name) => {
    const idx = cols.indexOf(name);
    return idx;
  };

  if (table === "timeline_events") {
    for (const dead of ["edited_at", "edited_by"]) {
      const i = col(dead);
      if (i >= 0) { cols.splice(i, 1); vals.splice(i, 1); }
    }
  }
  if (table === "bookings") {
    const i = col("id");
    vals[i] = `'${parseInt(vals[i].replace(/'/g, "")) + BOOKING_OFFSET}'`;
    const t = col("tutor_id");
    if (vals[t] === "'1'") { vals[t] = `'${PLACEHOLDER_TUTOR}'`; placeholderNeeded = true; }
  }
  if (table === "vaccines") {
    const i = col("id");
    const oldId = parseInt(vals[i].replace(/'/g, ""));
    if (VACCINE_REMAP[oldId]) vals[i] = `'${VACCINE_REMAP[oldId]}'`;
  }
  if (table === "pets") {
    const t = col("tutor_id");
    if (vals[t] === "'1'") { vals[t] = `'${PLACEHOLDER_TUTOR}'`; placeholderNeeded = true; }
  }

  counts[table] = (counts[table] || 0) + 1;
  const ORDER = { creches: 0, users: 1, pets: 2, bookings: 3, walks: 4, vaccines: 5, medications: 6, tasks: 7, timeline_events: 8, timeline_likes: 9, chat_messages: 10 };
  out.push({ order: ORDER[table] ?? 99, table, sql: rebuild(ins) });
}

if (placeholderNeeded) {
  // inert account: cannot log in (invalid hash), inactive
  out.push({
    order: 1.1,
    table: "users",
    sql: `INSERT INTO users (id, name, email, password_hash, role, creche_id, must_change_password, is_active, created_at) VALUES ('${PLACEHOLDER_TUTOR}', 'Tutor (antigo)', 'tutor-antigo-import@invalido.local', '!imported-no-login', 'tutor', '16', 'f', 'f', NOW());`,
  });
  counts.users = (counts.users || 0) + 1;
}

out.sort((a, b) => a.order - b.order);

// Max imported id per table, computed from the actual transformed data.
const maxIds = {};
for (const o of out) {
  if (!o.table) continue;
  const m = o.sql.match(/VALUES \('(\d+)'/);
  if (m) maxIds[o.table] = Math.max(maxIds[o.table] || 0, +m[1]);
}

// setvals run BEFORE the inserts (setval is non-transactional): any concurrent
// insert from a still-running old server instance during the deploy window is
// pushed above the imported id ranges, so it cannot collide with our fixed ids.
const SETVAL_TABLES = ["creches", "users", "pets", "bookings", "walks", "vaccines", "medications", "tasks", "timeline_events", "timeline_likes", "chat_messages"];
const setvals = SETVAL_TABLES.map((t) => {
  const mx = maxIds[t];
  if (!mx) throw new Error(`no max id for ${t}`);
  return `SELECT setval(pg_get_serial_sequence('${t}', 'id'), GREATEST(${mx}, (SELECT last_value FROM ${t}_id_seq)));`;
});

const body = [
  "-- Import creche 'Pet sitter (Kim)' (id 16) — gerado automaticamente a partir do export.",
  "-- Ajustes: colunas edited_* removidas da timeline; bookings +100 (colisão de IDs);",
  "-- vacina 3->5; tutor antigo id 1 -> placeholder 69; push/stay_services/edit_history excluídos.",
  "BEGIN;",
  "-- trava de execução única: uma segunda instância bloqueia aqui até a primeira terminar",
  "SELECT pg_advisory_xact_lock(41641616);",
  ...setvals,
  ...out.map((o) => o.sql),
  "COMMIT;",
].join("\n");

writeFileSync(OUT, body);

// Also emit an embeddable TS module so the SQL ships inside the esbuild bundle
// (production runs dist/index.cjs; loose files would not be deployed).
const TS_OUT = "artifacts/api-server/src/import/kimImportSql.ts";
writeFileSync(
  TS_OUT,
  `// GENERATED by scripts/transform-kim-import.mjs — do not edit by hand.\n// One-off data import for creche 'Pet sitter (Kim)' (id 16).\nexport const KIM_IMPORT_SQL = ${JSON.stringify(body)};\n`
);

console.log("counts:", JSON.stringify(counts));
console.log("statements:", out.length, "-> wrote", OUT, "and", TS_OUT, body.length, "bytes");
