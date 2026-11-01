import { AuthForm } from "@/modules/identity/components/auth-form";
import { redirect } from "next/navigation";
import { getOptionalOrganizer } from "@/modules/organizers/server";
export default async function RegisterPage() {
  if (await getOptionalOrganizer()) redirect("/dashboard");
  return <AuthForm mode="register" />;
}
