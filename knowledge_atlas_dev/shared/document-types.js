// Only inert media is served inline. HTML and SVG remain text, never executable pages.
const media = {
  pdf: ["pdf", "application/pdf"],
  png: ["image", "image/png"],
  jpg: ["image", "image/jpeg"],
  jpeg: ["image", "image/jpeg"],
  gif: ["image", "image/gif"],
  webp: ["image", "image/webp"],
  avif: ["image", "image/avif"],
  mp3: ["audio", "audio/mpeg"],
  wav: ["audio", "audio/wav"],
  ogg: ["audio", "audio/ogg"],
  m4a: ["audio", "audio/mp4"],
  flac: ["audio", "audio/flac"],
  mp4: ["video", "video/mp4"],
  webm: ["video", "video/webm"],
};
const text =
  /^(txt|md|markdown|json|csv|ya?ml|log|js|jsx|ts|tsx|py|css|html|xml|svg|ini|conf|toml|sh|sql|c|cpp|h|rs|java)$/i;
export function documentType(value, remote = false) {
  let pathname = value;
  if (remote) {
    try {
      pathname = new URL(value).pathname;
    } catch {
      pathname = "";
    }
  }
  const extension = pathname
    .split(/[\\/]/)
    .at(-1)
    .split(".")
    .slice(1)
    .at(-1)
    ?.toLowerCase();
  if (media[extension])
    return { kind: media[extension][0], mime: media[extension][1] };
  if (text.test(extension || ""))
    return {
      kind: "text",
      format: /^(md|markdown)$/.test(extension) ? "markdown" : "plain",
    };
  return { kind: remote ? "web" : "download" };
}
