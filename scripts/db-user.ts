// A4: the post-deploy database user for the app's managed identity. Run by the deploy workflow with the token of its
// federated identity, a member of "FocusTime DB Admins" (the server's Entra admin); never by hand.
//
//   node scripts/db-user.ts --server <fqdn> --database focustime --principal ft-dev-app --client-id <its client id>
//
// Idempotent: the user when missing (the Container App's system identity), made with CREATE USER ... WITH SID = <client
// id>, TYPE = E: the same Entra user as FROM EXTERNAL PROVIDER, without the server looking the name up in the directory
// (that needs the server's own identity with Directory Readers, a tenant role FocusTime doesn't take). The client id is
// the repository variable AZURE_<ENV>_APP_IDENTITY_CLIENT_ID (az ad sp show --id <principal id> --query appId);
// then db_datareader, db_datawriter and EXECUTE on the dbo schema. No DDL: the schema is changed only by the migration
// runner (focustime migrate), which the workflow runs as the admin group.
import { parseArgs } from "node:util";
import { sqlServerConn } from "../store/sql/sqlserver.ts";

const { values: a } = parseArgs({ options: { server: { type: "string" }, database: { type: "string" }, principal: { type: "string" }, "client-id": { type: "string" } }, strict: true });
if (!a.server || !a.database || !a.principal || !a["client-id"]) {
  console.error("usage: node scripts/db-user.ts --server FQDN --database NAME --principal NAME --client-id GUID");
  process.exit(2);
}
// The name goes into the statement as an identifier (CREATE USER takes no parameter), so it is checked first.
if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/.test(a.principal)) {
  console.error("The principal must be a managed identity's name (letters, digits and hyphens)");
  process.exit(2);
}
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(a["client-id"])) {
  console.error("The client id must be a GUID");
  process.exit(2);
}
const user = `[${a.principal}]`;
const clientId = a["client-id"];
const conn = await sqlServerConn({
  settings: { server: a.server, port: 1433, database: a.database, auth: "entra", user: null, managedIdentityClientId: null, encrypt: true, trustServerCertificate: false },
});
try {
  const had = await conn.get("SELECT name FROM sys.database_principals WHERE name = ?", [a.principal]);
  await conn.batch(`IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'${a.principal}')
BEGIN
  DECLARE @sid nvarchar(40) = CONVERT(nvarchar(40), CONVERT(varbinary(16), CAST(N'${clientId}' AS uniqueidentifier)), 1);
  EXEC (N'CREATE USER ${user} WITH SID = ' + @sid + N', TYPE = E;');
END
IF IS_ROLEMEMBER('db_datareader', N'${a.principal}') = 0 ALTER ROLE db_datareader ADD MEMBER ${user};
IF IS_ROLEMEMBER('db_datawriter', N'${a.principal}') = 0 ALTER ROLE db_datawriter ADD MEMBER ${user};
GRANT EXECUTE ON SCHEMA::dbo TO ${user};`);
  const roles = await conn.all(
    "SELECT r.name AS role FROM sys.database_role_members m JOIN sys.database_principals r ON r.principal_id = m.role_principal_id JOIN sys.database_principals u ON u.principal_id = m.member_principal_id WHERE u.name = ? ORDER BY r.name",
    [a.principal],
  );
  console.log(`${a.principal}: ${had ? "user existed" : "user created"}; roles ${roles.map((r) => r.role).join(", ")}; EXECUTE on dbo`);
} finally {
  await conn.close();
}
