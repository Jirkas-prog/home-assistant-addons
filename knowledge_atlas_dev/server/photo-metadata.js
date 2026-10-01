import exifr from "exifr";
import { validDate } from "../shared/tools.js";

export async function photoMetadata(bytes) {
  try {
    const meta = await exifr.parse(bytes, {
      pick: [
        "DateTimeOriginal",
        "OffsetTimeOriginal",
        "GPSLatitude",
        "GPSLongitude",
        "GPSLatitudeRef",
        "GPSLongitudeRef",
        "Make",
        "Model",
      ],
      reviveValues: false,
    });
    if (!meta) return null;
    const photo = {};
    const date = String(meta.DateTimeOriginal || "").replace(
      /^(\d{4}):(\d\d):(\d\d) /,
      "$1-$2-$3T",
    );
    if (
      /^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(date) &&
      validDate(date.slice(0, 10))
    )
      photo.takenAt = date;
    if (/^[+-]\d\d:\d\d$/.test(meta.OffsetTimeOriginal || ""))
      photo.offset = meta.OffsetTimeOriginal;
    if (
      Number.isFinite(meta.latitude) &&
      Math.abs(meta.latitude) <= 90 &&
      Number.isFinite(meta.longitude) &&
      Math.abs(meta.longitude) <= 180
    )
      Object.assign(photo, {
        latitude: meta.latitude,
        longitude: meta.longitude,
      });
    const camera = [meta.Make, meta.Model]
      .filter(Boolean)
      .join(" ")
      .slice(0, 180);
    if (camera) photo.camera = camera;
    return Object.keys(photo).length ? { ...photo, source: "exif" } : null;
  } catch {
    // Unsupported or damaged metadata must not prevent preserving the original file.
    return null;
  }
}
