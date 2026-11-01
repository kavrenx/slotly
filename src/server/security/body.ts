export async function readLimitedBody(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return text + decoder.decode();
    size += chunk.value.byteLength;
    if (size > limit) { await reader.cancel(); return null; }
    text += decoder.decode(chunk.value, { stream: true });
  }
}
