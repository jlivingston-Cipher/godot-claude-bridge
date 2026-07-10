/**
 * `--from-github` escape hatch for `breakpoint-mcp init`: fetch the editor addon
 * (addons/breakpoint_mcp/**) straight from the GitHub repo at a chosen ref, as an
 * alternative to the copy bundled in the npm tarball. Used when the bundled addon
 * is missing/corrupt, or to install a different ref (e.g. `main`, or an older tag)
 * than the one that shipped with the installed package.
 *
 * Dependency-free: one GitHub git/trees API call lists the addon's blobs at the ref,
 * then each file is downloaded from raw.githubusercontent.com (a CDN that does not
 * count against the REST rate limit). The fetch-shaped dependency is injectable, so
 * the whole path is unit-testable offline.
 */
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_REPO = "jlivingston-Cipher/godot-breakpoint-mcp";
const ADDON_PREFIX = "addons/breakpoint_mcp/";
const USER_AGENT = "breakpoint-mcp-cli";

/** The narrow slice of the fetch API this module needs — so tests pass a fake. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<HttpResponse>;

function defaultFetch(): FetchLike {
  const f = (globalThis as { fetch?: unknown }).fetch;
  if (typeof f !== "function") {
    throw new Error("global fetch is unavailable — Node 18+ is required for --from-github.");
  }
  return f as FetchLike;
}

/** Validate and split an `owner/repo` slug; throws on anything else. */
export function parseRepo(repo: string): { owner: string; name: string } {
  const m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repo.trim());
  if (!m) throw new Error(`invalid --repo '${repo}' (expected owner/repo).`);
  return { owner: m[1], name: m[2] };
}

interface TreeEntry {
  path: string;
  type: string;
}
interface TreeResponse {
  tree?: TreeEntry[];
  truncated?: boolean;
}

function authHeaders(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const h: Record<string, string> = { "User-Agent": USER_AGENT };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/**
 * Fetch addons/breakpoint_mcp/** from `repo` at `ref` into `dest` (created if
 * needed). Returns the written relative paths. Throws a clear Error on a bad
 * repo/ref, a missing addon, rate-limiting, or a network failure.
 */
export async function fetchAddonFromGitHub(
  opts: { repo: string; ref: string; dest: string },
  fetchFn?: FetchLike,
): Promise<string[]> {
  const doFetch = fetchFn ?? defaultFetch();
  const { owner, name } = parseRepo(opts.repo);
  const ref = opts.ref;
  const treeUrl = `https://api.github.com/repos/${owner}/${name}/git/trees/${ref}?recursive=1`;

  let treeRes: HttpResponse;
  try {
    treeRes = await doFetch(treeUrl, {
      headers: { ...authHeaders(), Accept: "application/vnd.github+json" },
    });
  } catch (err) {
    throw new Error(`could not reach GitHub: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (treeRes.status === 404) {
    throw new Error(`GitHub returned 404 for ${owner}/${name}@${ref} — check the repo and ref.`);
  }
  if (treeRes.status === 403) {
    throw new Error(
      "GitHub returned 403 (rate-limited or forbidden). Set GITHUB_TOKEN to raise the limit, or retry later.",
    );
  }
  if (!treeRes.ok) {
    throw new Error(`GitHub git/trees request failed (HTTP ${treeRes.status}).`);
  }

  const body = (await treeRes.json()) as TreeResponse;
  if (body.truncated) {
    throw new Error(
      `the repository tree at ${ref} was too large to list in one request; --from-github can't be used for this ref.`,
    );
  }
  const entries = Array.isArray(body.tree) ? body.tree : [];
  const files = entries.filter((e) => e.type === "blob" && e.path.startsWith(ADDON_PREFIX));
  if (files.length === 0) {
    throw new Error(`no ${ADDON_PREFIX} found in ${owner}/${name}@${ref}.`);
  }

  const written: string[] = [];
  for (const f of files) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${name}/${ref}/${f.path}`;
    let res: HttpResponse;
    try {
      res = await doFetch(rawUrl, { headers: { "User-Agent": USER_AGENT } });
    } catch (err) {
      throw new Error(`could not download ${f.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) {
      throw new Error(`could not download ${f.path} (HTTP ${res.status}).`);
    }
    const rel = f.path.slice(ADDON_PREFIX.length);
    const outPath = path.join(opts.dest, rel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
    written.push(rel);
  }
  return written;
}
