export interface Identifier {
  name: string;
  label: string;
  priority: 'high' | 'normal' | 'low';
}

export const DEFAULT_IDENTIFIERS: Identifier[] = [
  { name: 'TODO',  label: 'todo',       priority: 'normal' },
  { name: 'FIXME', label: 'bug',        priority: 'high'   },
  { name: 'HACK',  label: 'tech-debt',  priority: 'low'    },
  { name: 'BUG',   label: 'bug',        priority: 'high'   },
];

/** Label hex colors for auto-creation when labels don't exist in the repo */
export const LABEL_COLORS: Record<string, string> = {
  'todo':       '0075ca',
  'bug':        'd73a4a',
  'tech-debt':  'e4e669',
};

interface ExtraIdentifierInput {
  name: string;
  label: string;
  priority?: 'high' | 'normal' | 'low';
}

export function buildIdentifiers(extraJson: string): Identifier[] {
  let extras: ExtraIdentifierInput[] = [];
  try {
    const parsed = JSON.parse(extraJson);
    if (Array.isArray(parsed)) extras = parsed;
  } catch {
    // invalid JSON — ignore extras
  }

  const merged = [...DEFAULT_IDENTIFIERS];
  for (const extra of extras) {
    if (!extra.name || !extra.label) continue;
    if (!merged.find(i => i.name === extra.name)) {
      merged.push({
        name: extra.name,
        label: extra.label,
        priority: extra.priority ?? 'normal',
      });
    }
  }
  return merged;
}

export function identifierForName(name: string, identifiers: Identifier[]): Identifier | undefined {
  return identifiers.find(i => i.name === name);
}
