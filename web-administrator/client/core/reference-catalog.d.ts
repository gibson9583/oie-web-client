/* Hand-written declaration for the GENERATED reference-catalog.js (regenerate
   with tools/refdump) — the generated module stays plain JS because it is one
   catalog literal; a .ts twin would only double it on disk. */

/** One engine code-reference entry (Swing ReferenceListFactory item). */
export interface ReferenceCatalogEntry {
    name: string;
    /** null = Available Variables / Miscellaneous. */
    category: string | null;
    description: string;
    code: string;
    type: string;
}

export const REFERENCE_CATALOG: ReferenceCatalogEntry[];
