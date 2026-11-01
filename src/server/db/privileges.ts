import type { Pool, PoolClient } from "pg";

function identifier(value: string) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/u.test(value)) throw new Error("Unsafe database identifier");
  return `"${value}"`;
}

// Operational provisioning, deliberately outside application migrations.
// The caller is an administrator; neither login can create roles or databases.
export async function createDatabaseLogin(client: Pool | PoolClient, name: string, password: string) {
  identifier(name);
  const statement = await client.query<{ sql: string }>(
    "select format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', $1::text, $2::text) as sql", [name, password]);
  await client.query(statement.rows[0]!.sql);
}

export async function configureDatabaseAccess(client: Pool | PoolClient, migrationRole: string, applicationRole: string) {
  const migration = identifier(migrationRole), application = identifier(applicationRole);
  if (migrationRole === applicationRole) throw new Error("Database roles must differ");
  const database = identifier((await client.query<{ name: string }>("select current_database() as name")).rows[0]!.name);
  const roles = await client.query<{ rolname: string; unsafe: boolean }>(`select rolname,
    rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls as unsafe from pg_roles where rolname=any($1::text[])`, [[migrationRole, applicationRole]]);
  const memberships = await client.query("select 1 from pg_auth_members where member in (select oid from pg_roles where rolname=any($1::text[]))", [[migrationRole, applicationRole]]);
  if (roles.rowCount !== 2 || roles.rows.some(r => r.unsafe) || memberships.rowCount) throw new Error("Unsafe role attributes or membership");

  await client.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
  await client.query(`REVOKE ALL ON DATABASE ${database} FROM ${application}, ${migration}`);
  await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${application}`);
  await client.query(`GRANT CONNECT, CREATE ON DATABASE ${database} TO ${migration}`);
  await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  for (const schema of ["slotly", "drizzle"]) {
    await client.query(`ALTER SCHEMA ${identifier(schema)} OWNER TO ${migration}`);
    await client.query(`REVOKE ALL ON SCHEMA ${identifier(schema)} FROM PUBLIC, ${application}`);
    await client.query(`GRANT USAGE ON SCHEMA ${identifier(schema)} TO ${application}`);
  }
  const tables = await client.query<{ schema: string; name: string; kind: string }>(`select n.nspname as schema,c.relname as name,c.relkind as kind
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('slotly','drizzle') and c.relkind in ('r','p','S') order by (c.relkind='S'),c.relname`);
  for (const table of tables.rows) {
    await client.query(`ALTER ${table.kind === "S" ? "SEQUENCE" : "TABLE"} ${identifier(table.schema)}.${identifier(table.name)} OWNER TO ${migration}`);
  }
  const functions = await client.query<{ name: string; arguments: string }>(`select p.proname as name,pg_get_function_identity_arguments(p.oid) as arguments
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='slotly' and p.prokind='f'`);
  for (const fn of functions.rows) {
    // Argument declarations come from PostgreSQL's catalog, never user input.
    const signature = `slotly.${identifier(fn.name)}(${fn.arguments})`;
    await client.query(`ALTER FUNCTION ${signature} OWNER TO ${migration}`);
    await client.query(`ALTER FUNCTION ${signature} SET search_path = pg_catalog`);
  }
  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA slotly, drizzle FROM PUBLIC, ${application}`);
  await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA slotly, drizzle FROM PUBLIC, ${application}`);
  await client.query(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA slotly FROM PUBLIC, ${application}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA slotly TO ${application}`);
  await client.query(`REVOKE UPDATE, DELETE ON slotly.bookings, slotly.booking_events FROM ${application}`);
  await client.query(`REVOKE DELETE ON slotly.occupancies FROM ${application}`);
  await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA drizzle TO ${application}`);
  await client.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA slotly TO ${application}`);
  await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA slotly TO ${application}`);
  // New objects are denied until an explicit post-migration grant review.
  await client.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${migration} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`);
}
