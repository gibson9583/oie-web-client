/* Hand-written declaration for the extracted reference-catalog.js — the module
   stays plain JS because it is one catalog literal; a .ts twin would only
   double it on disk. */

/** One engine code-reference entry (Swing ReferenceListFactory item). */
export interface ReferenceCatalogEntry {
    name: string;
    /** null = Available Variables / Miscellaneous. */
    category: string | null;
    description: string;
    code: string;
    type: string;
    /** ContextType names the entry applies to; absent = every context. */
    contexts?: string[];
}

export const REFERENCE_CATALOG: ReferenceCatalogEntry[];
