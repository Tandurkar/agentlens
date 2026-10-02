/**
 * One-line human summaries for well-known tool inputs (Claude Code's tool
 * set, primarily), so transcript cards read as actions — `$ pnpm test`,
 * `src/App.tsx` — instead of raw JSON. Returns null when the input can't
 * be summarized (unknown tool, or JSON still streaming in).
 */

export function prettyToolName(name: string): string {
  const mcp = name.match(/^mcp__(.+?)__(.+)$/);
  return mcp ? `${mcp[1]} · ${mcp[2]}` : name;
}

const shortPath = (p: string): string => (p.length > 64 ? `…${p.slice(-63)}` : p);

export function toolSummary(name: string, inputJson: string): string | null {
  let input: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(inputJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    input = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const s = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

  switch (name) {
    case 'Bash': {
      const command = s(input.command);
      return command ? `$ ${command}` : null;
    }
    case 'Read': {
      const path = s(input.file_path);
      if (!path) return null;
      const pages = s(input.pages);
      return pages ? `${shortPath(path)} · pages ${pages}` : shortPath(path);
    }
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const path = s(input.file_path) ?? s(input.notebook_path);
      return path ? shortPath(path) : null;
    }
    case 'Grep': {
      const pattern = s(input.pattern);
      if (!pattern) return null;
      const where = s(input.path) ?? s(input.glob);
      return where ? `/${pattern}/ in ${shortPath(where)}` : `/${pattern}/`;
    }
    case 'Glob':
      return s(input.pattern) ?? null;
    case 'LS':
      return s(input.path) ? shortPath(s(input.path)!) : null;
    case 'WebFetch':
      return s(input.url) ?? null;
    case 'WebSearch': {
      const query = s(input.query);
      return query ? `“${query}”` : null;
    }
    case 'Task':
    case 'Agent':
      return s(input.description) ?? s(input.prompt)?.slice(0, 120) ?? null;
    case 'TodoWrite':
      return Array.isArray(input.todos) ? `${input.todos.length} todo items` : null;
    case 'SendUserFile':
      return Array.isArray(input.files) ? input.files.map(String).map(shortPath).join(', ') : null;
    default:
      return null;
  }
}
