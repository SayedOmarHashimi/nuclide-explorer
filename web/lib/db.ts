import { Pool, type QueryResultRow } from "pg";

/**
 * A single pooled connection, reused across hot lambda invocations.
 *
 * Serverless functions can be re-created frequently, so the pool is cached on
 * globalThis to avoid opening a new connection on every request during
 * development hot-reload and across warm invocations in production.
 */
declare global {
  var __nuclidePool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  return new Pool({
    connectionString,
    // Hosted Postgres (Neon) requires TLS. `rejectUnauthorized` stays on so a
    // man-in-the-middle cannot present its own certificate.
    ssl: connectionString.includes("localhost")
      ? undefined
      : { rejectUnauthorized: true },
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function pool(): Pool {
  if (!global.__nuclidePool) {
    global.__nuclidePool = createPool();
  }
  return global.__nuclidePool;
}

/**
 * Run a parameterised query.
 *
 * `values` are always sent out-of-band as bind parameters - never interpolated
 * into the SQL string. Every call site in this app passes user input through
 * Zod validation first and then through this function, so there is no path
 * from a query parameter to concatenated SQL.
 */
export async function query<T extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool().query<T>(text, values as unknown[]);
  return result.rows;
}
