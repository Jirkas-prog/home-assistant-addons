// A short moving window reacts to slowdowns and excludes paused time.
export class TransferMeter {
  constructor(now = () => performance.now()) {
    this.now = now;
    this.reset(0);
  }
  reset(bytes) {
    this.samples = [{ time: this.now(), bytes }];
  }
  update(bytes, total) {
    const time = this.now();
    this.samples.push({ time, bytes });
    while (this.samples.length > 2 && this.samples[1].time < time - 5000)
      this.samples.shift();
    const first = this.samples[0];
    const elapsed = (time - first.time) / 1000;
    const rate =
      elapsed >= 0.25 ? Math.max(0, (bytes - first.bytes) / elapsed) : 0;
    return {
      rate,
      eta:
        rate > 0 && total != null ? Math.max(0, (total - bytes) / rate) : null,
    };
  }
}
export function transferPercent(loaded, total) {
  if (!Number.isFinite(total) || total <= 0) return null;
  // Do not round an incomplete transfer up to 100.00%.
  return loaded >= total
    ? 100
    : Math.min(99.99, Math.max(0, (loaded / total) * 100));
}
export function formatPercent(loaded, total, language) {
  const value = transferPercent(loaded, total);
  return value == null
    ? "\u2014"
    : `${value.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}
export function formatBytes(bytes, language) {
  const units = ["B", "KiB", "MiB", "GiB"];
  const index =
    bytes > 0 ? Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024))) : 0;
  return `${(bytes / 1024 ** index).toLocaleString(language, { maximumFractionDigits: 2, minimumFractionDigits: 2 })} ${units[index]}`;
}
export function formatDuration(seconds) {
  const value = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(value / 3600),
    minutes = Math.floor((value % 3600) / 60),
    rest = value % 60;
  return [hours, minutes, rest]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}
