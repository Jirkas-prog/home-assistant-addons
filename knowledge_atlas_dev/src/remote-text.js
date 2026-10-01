const limit = 2_000_000;
export async function readRemoteText(url, signal) {
  // Fetch in the browser with CORS; never proxy arbitrary URLs through the add-on.
  const response = await fetch(url, {
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal,
  });
  if (!response.ok) throw new Error("The remote document could not be loaded.");
  if (Number(response.headers.get("content-length")) > limit)
    throw new Error("The text editor supports files up to 2 MB.");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit)
        throw new Error("The text editor supports files up to 2 MB.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  if (bytes.includes(0))
    throw new Error("The text editor requires UTF-8 encoding.");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("The text editor requires UTF-8 encoding.");
  }
}
