import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Resolve a project path that may be given as `res://...`, an absolute path, or
 * a path relative to the project root, into an absolute filesystem path.
 */
export function toFsPath(p: string, projectPath: string): string {
  if (p.startsWith("res://")) return path.join(projectPath, p.slice("res://".length));
  if (path.isAbsolute(p)) return p;
  return path.join(projectPath, p);
}

/** Same resolution as toFsPath, returned as a `file://` URI (for LSP). */
export function toFileUri(p: string, projectPath: string): string {
  return pathToFileURL(toFsPath(p, projectPath)).href;
}

/** Read a project file's text, or return "" if it cannot be read. */
export function readFileText(absPath: string): string {
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch {
    return "";
  }
}
