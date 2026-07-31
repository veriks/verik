import { customAlphabet } from 'nanoid';

const generateEvidenceId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

export type EvidenceKind =
  | 'diff-excerpt'
  | 'builder-command'
  | 'deterministic-rule'
  | 'file-content'
  | 'log-excerpt';

export interface Evidence {
  id: string;
  kind: EvidenceKind;
  path?: string;
  startLine?: number;
  endLine?: number;
  excerpt: string;
  command?: string;
  ruleId?: string;
}

export interface EvidenceStore {
  items: Evidence[];
}

export function createEvidenceStore(): EvidenceStore {
  return { items: [] };
}

export function addEvidence(store: EvidenceStore, item: Omit<Evidence, 'id'>): string {
  const id = `ev_${item.kind.replace(/-/g, '_')}_${generateEvidenceId()}`;
  store.items.push({ ...item, id });
  return id;
}

export function getEvidence(store: EvidenceStore, id: string): Evidence | undefined {
  return store.items.find((e) => e.id === id);
}
