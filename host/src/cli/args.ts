/**
 * Minimal argv parser for the `breakpoint-mcp` CLI subcommands (init / doctor).
 * Deliberately dependency-free — a ~40-line parser keeps the package's
 * SDK-and-zod-only footprint, and the CLI's flag surface is tiny.
 *
 * Supported forms:
 *   --flag value        (value-taking, unless `flag` is in booleanFlags)
 *   --flag=value        (always value-taking)
 *   --flag              (boolean, or value-taking with no following value)
 *   -h                  (single-dash short flag → boolean)
 *   --                  (everything after is a positional)
 *   plain               (positional)
 *
 * `booleanFlags` names the flags that never consume the next token, so
 * `--json /path` parses as `{json:true}` + positional `/path`, not `{json:"/path"}`.
 */
export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[], booleanFlags: string[] = []): ParsedArgs {
  const bool = new Set(booleanFlags);
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      if (bool.has(key)) {
        flags[key] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
      continue;
    }
    if (a.startsWith("-") && a.length > 1) {
      flags[a.slice(1)] = true;
      continue;
    }
    positionals.push(a);
  }

  return { positionals, flags };
}
