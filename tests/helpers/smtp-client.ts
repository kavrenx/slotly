import { parseMailConfig } from "../../src/server/mail/config";
import { createMailDelivery, MailDeliveryError } from "../../src/server/mail/delivery";

// Runs in a separate process so NODE_EXTRA_CA_CERTS trusts only the temporary
// test certificate. Production certificate verification remains enabled.
const env = JSON.parse(process.env.SLOTLY_SMTP_TEST_CONFIG!) as Record<string, string>;
const mail = createMailDelivery(parseMailConfig(env, "https://slotly.example"), "https://slotly.example");
try {
  if (process.env.SLOTLY_SMTP_TEST_ACTION === "verify") await mail.verify();
  else await mail.sendMail({ to: "guest@example.invalid", subject: "Slotly email verification", text: "Verify your address.",
    actionUrl: "https://slotly.example/verify-email#token=test-only", messageId: "11111111-1111-4111-8111-111111111111", createdAt: "2027-01-01T10:00:00Z" });
  console.log("ok");
} catch (error) { console.log(error instanceof MailDeliveryError ? error.code : "UNEXPECTED_ERROR"); }
finally { mail.close(); }
