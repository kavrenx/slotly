import { planning } from "../../i18n/messages/ru/planning";

export async function planningRequest<T>(url: string, method: string, input: unknown): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); }
  catch { throw new Error(planning.errors.SERVICE_UNAVAILABLE); }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(planning.errors[body?.code as string] ?? planning.errors.SERVICE_UNAVAILABLE);
  return body as T;
}
