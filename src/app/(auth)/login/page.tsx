import { AuthForm } from "@/modules/identity/components/auth-form";
import { redirect } from "next/navigation";
import { getOptionalOrganizer } from "@/modules/organizers/server";
export default async function LoginPage() {
  if (await getOptionalOrganizer()) redirect("/dashboard");
  return <AuthForm mode="login" />;
}
