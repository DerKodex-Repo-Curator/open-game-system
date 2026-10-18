/**
 * A D1-shaped wrapper over node:sqlite, so the sources' real SQL runs in tests against synthetic
 * rows (never against production).
 */
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { D1Like } from "../src/sources/d1";

export function sqliteD1(schema: string): { db: D1Like; exec: (sql: string, ...values: SQLInputValue[]) => void } {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  const db: D1Like = {
    prepare(sql) {
      const statement = raw.prepare(sql);
      return {
        bind(...values) {
          const args = values.map((v): SQLInputValue => (typeof v === "boolean" ? Number(v) : v));
          return {
            async first() {
              return statement.get(...args) ?? null;
            },
            async all() {
              return { results: statement.all(...args) };
            },
          };
        },
      };
    },
  };
  return { db, exec: (sql, ...values) => void raw.prepare(sql).run(...values) };
}
