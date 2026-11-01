export function localReviewReadiness(input: { appUrl: string; databaseUrl: string; mailTransport: "local" | "smtp"; issues: string[] }) {
  const loopback = (url: string) => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
  const issues = [...input.issues];
  if (!loopback(input.appUrl)) issues.push("LOCAL_APP_REQUIRED");
  if (!loopback(input.databaseUrl)) issues.push("LOCAL_DATABASE_REQUIRED");
  if (input.mailTransport !== "local") issues.push("LOCAL_MAIL_REQUIRED");
  return {
    target: "local-design-review", ready: issues.length === 0, issues: [...new Set(issues)].sort(),
    adapters: { mail: input.mailTransport === "local" ? "local-mailbox" : "smtp-configured", backups: "local-encrypted", alerts: "local-files" },
    publicLaunch: { ready: false, pending: ["HOSTING_AND_HTTPS", "PROXY_ISOLATION", "REAL_MAIL_DELIVERY", "REMOTE_BACKUPS", "EXTERNAL_ALERTS", "PERSONAL_DATA_POLICY_AND_ERASURE", "LEGAL_TEXTS"] },
  };
}
