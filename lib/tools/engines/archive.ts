/**
 * Archive extraction for the YouTube/Takeout converter.
 *
 * A Google Takeout export arrives as one .zip containing a folder tree, e.g.
 *
 *   Takeout/YouTube and YouTube Music/playlists/Playlist 2024-01-01/videos/
 *     My Video (abc123).mp4
 *   Takeout/YouTube and YouTube Music/video metadata/videos/My Video (abc123).info.json
 *
 * The user wants the media, not the `.info.json` sidecars and not the nested
 * paths. This module pulls the media entries out and flattens them into files
 * the converter can already handle, so nothing downstream needs to know the
 * media came from inside an archive.
 *
 * Everything runs in the tab. The zip is read with JSZip and never uploaded.
 */

import { extensionOf } from "./ffmpeg-mp3";

/**
 * Takeout's metadata sidecars. Skipped because they are JSON, not media, and
 * because dropping a .info.json into the queue produces a confusing "unsupported
 * format" error for a file the user never chose.
 */
const IGNORED_SUFFIXES = [".json", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".txt", ".csv", ".html"];

const MEDIA_EXTENSIONS = new Set([
  // video
  "mp4", "m4v", "webm", "mov", "mkv", "avi", "flv", "3gp", "ogv",
  // audio
  "mp3", "wav", "m4a", "aac", "ogg", "oga", "opus", "flac", "wma", "aiff",
]);

export interface ExtractedFile {
  file: File;
  /** Path inside the archive, kept so duplicates can be told apart in the UI. */
  path: string;
}

export interface ExtractResult {
  files: ExtractedFile[];
  /** Entries skipped, with the reason — surfaced so a silent miss is never silent. */
  skipped: { path: string; reason: string }[];
  /** True when the file was not a zip at all. */
  notAnArchive: boolean;
}

export function isArchive(file: { name: string }): boolean {
  return extensionOf(file.name) === "zip";
}

function isMedia(path: string): boolean {
  const ext = extensionOf(path);
  if (!ext) return false;
  if (IGNORED_SUFFIXES.includes(`.${ext}`)) return false;
  // `.mp4.json` has extension "json", so the suffix list above already removes
  // the sidecars; anything left with a known media extension is media.
  return MEDIA_EXTENSIONS.has(ext);
}

/**
 * Flattens a Takeout-ish path to a readable filename.
 *
 * Takeout names files "Title (videoId).mp4" and nests them several folders deep.
 * We keep the stem, drop the directories, and de-duplicate collisions by
 * appending an index — two videos with the same title must not overwrite
 * each other once flattened.
 */
function flatten(paths: string[], index: number): string {
  const base = paths[index]!.split("/").pop() ?? `file-${index}`;
  const stem = base.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "-").trim();
  const taken = paths.slice(0, index).some((other) => {
    const otherBase = other.split("/").pop() ?? "";
    return otherBase.replace(/\.[^.]+$/, "") === stem;
  });
  return taken ? `${stem} (${index + 1})${extensionOf(base)}` : base;
}

/**
 * Reads a zip and returns its media files.
 *
 * Returns `notAnArchive` rather than throwing when the file is not a zip, so
 * the caller can fall through to treating it as a plain upload — the user may
 * have grabbed the wrong file, not an invalid one.
 */
export async function extractMedia(file: File): Promise<ExtractResult> {
  const result: ExtractResult = { files: [], skipped: [], notAnArchive: false };

  if (!isArchive(file)) {
    result.notAnArchive = true;
    return result;
  }

  let zip;
  try {
    const { default: JSZip } = await import("jszip");
    zip = await JSZip.loadAsync(file);
  } catch (error) {
    // A truncated or password-protected zip. Say so rather than "unsupported".
    result.skipped.push({
      path: file.name,
      reason:
        "This zip could not be opened. It may be incomplete, still downloading, or password-protected.",
    });
    result.notAnArchive = true;
    return result;
  }

  const mediaPaths = Object.keys(zip.files).filter(
    (path) => !zip.files[path]!.dir && isMedia(path),
  );

  if (mediaPaths.length === 0) {
    result.skipped.push({
      path: file.name,
      reason: "No video or audio files were found inside this archive.",
    });
    return result;
  }

  const extracted: ExtractedFile[] = [];
  for (const [index, path] of mediaPaths.entries()) {
    const entry = zip.files[path]!;
    const blob = await entry.async("blob");
    extracted.push({
      path,
      file: new File([blob], flatten(mediaPaths, index), { type: blob.type }),
    });
  }

  result.files = extracted;
  return result;
}