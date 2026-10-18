/** The part of D1 the sources use (D1Database satisfies it), so tests can run the same SQL on SQLite. */
export interface D1Like {
  prepare(sql: string): {
    bind(...values: (string | number | null)[]): {
      first(): Promise<unknown>;
      all(): Promise<{ results: unknown[] }>;
    };
  };
}
