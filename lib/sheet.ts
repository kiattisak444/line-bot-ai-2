import type { FaqItem } from "@/types";

const CACHE_TTL_MS = 60_000;

let cache: { data: FaqItem[]; fetchedAt: number } | null = null;
let inflight: Promise<FaqItem[]> | null = null;

/**
 * Minimal RFC4180 CSV parser: handles quoted fields, escaped "" quotes,
 * and commas/newlines inside quoted fields.
 */
function parseCsv(csvText: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const next = csvText[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && next === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function rowsToFaqItems(rows: string[][]): FaqItem[] {
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {
    category: header.indexOf("category"),
    question: header.indexOf("question"),
    answer: header.indexOf("answer"),
    note: header.indexOf("note"),
  };

  const items: FaqItem[] = [];
  for (const cols of rows.slice(1)) {
    const answer = (idx.answer >= 0 ? cols[idx.answer] : "")?.trim() ?? "";
    if (!answer) continue;

    items.push({
      category: (idx.category >= 0 ? cols[idx.category] : "")?.trim() ?? "",
      question: (idx.question >= 0 ? cols[idx.question] : "")?.trim() ?? "",
      answer,
      note: idx.note >= 0 ? cols[idx.note]?.trim() || undefined : undefined,
    });
  }

  return items;
}

async function fetchFaqData(): Promise<FaqItem[]> {
  const sheetUrl = process.env.SHEET_CSV_URL;
  if (!sheetUrl) {
    throw new Error("SHEET_CSV_URL is not set");
  }

  const res = await fetch(sheetUrl, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch FAQ sheet: ${res.status} ${res.statusText}`);
  }

  const csvText = await res.text();
  return rowsToFaqItems(parseCsv(csvText));
}

/**
 * Returns FAQ data, cached in-memory for 60s. On fetch failure, falls back
 * to the last known-good cache (stale-while-error) so a transient Sheet
 * outage doesn't take down replies. Throws only when there is no cache yet.
 */
export async function getFaqData(): Promise<FaqItem[]> {
  const now = Date.now();

  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }

  if (!inflight) {
    inflight = fetchFaqData()
      .then((data) => {
        cache = { data, fetchedAt: Date.now() };
        return data;
      })
      .catch((err) => {
        console.error("[sheet] fetchFaqData failed:", err);
        if (cache) {
          console.warn("[sheet] falling back to stale cache");
          return cache.data;
        }
        throw err;
      })
      .finally(() => {
        inflight = null;
      });
  }

  return inflight;
}
