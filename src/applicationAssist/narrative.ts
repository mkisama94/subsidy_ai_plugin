import type { AssistCase } from './schema';
import { usable } from './engine';

/** Render reviewed templates; preserve sentence-level evidence and explicit plans. */
export function groundedSentences(c: AssistCase, sentences: { template: string; fieldIds: string[]; kind: 'fact' | 'plan' }[]) {
  return sentences.map(s => {
    const references = s.fieldIds.map(id => c.fields.find(f => f.fieldId === id));
    if (!references.length || references.some(f => !usable(f) || (s.kind === 'plan' && !f!.applicantConfirmed))) throw new Error('Unreviewed narrative evidence');
    const ids = [...s.template.matchAll(/\{([^{}]+)\}/g)].map(m => m[1]);
    if (ids.some(id => !s.fieldIds.includes(id))) throw new Error('Unbound narrative evidence');
    return { text: s.template.replace(/\{([^{}]+)\}/g, (_, id: string) => String(c.fields.find(f => f.fieldId === id)!.value)),
      kind: s.kind, evidenceIds: s.fieldIds, revision: c.revision, reviewRequired: true };
  });
}
