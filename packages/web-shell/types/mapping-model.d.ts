import { replacementsToWire } from './step-replacements.js';
import type { Replacement } from './step-replacements.js';
export declare const MAPPER_TYPE = "com.mirth.connect.plugins.mapper.MapperStep";
export declare const MSGBUILDER_TYPE = "com.mirth.connect.plugins.messagebuilder.MessageBuilderStep";
export declare const JAVASCRIPT_TYPE = "com.mirth.connect.plugins.javascriptstep.JavaScriptStep";
export type ReplacementPair = Replacement;
export declare function replacementPairs(value: any): ReplacementPair[];
export declare const toReplacements: typeof replacementsToWire;
export declare function literalString(expr: any): string | null;
export declare function quoteString(value: string): string;
export interface TreeNode {
    label: string;
    value: string | null;
    accessor: string;
    children: TreeNode[];
    valueType?: 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';
}
/** Parent iterators, ordered from outermost to innermost. Not a new step type. */
export interface IteratorContext {
    id?: number;
    name: string;
    target: string;
    indexVariable: string;
    prefixSubstitutions: string[];
}
/** Template-only indices. These are never written to the channel. */
export interface MappingPreviewOptions {
    iteratorIndices?: Record<string, number>;
}
export declare function iteratorExpression(expression: string, contexts: IteratorContext[], remove?: boolean, keepFixed?: IteratorContext[]): string;
/** Rebind supported step paths when membership changes. Arbitrary JS stays
 * byte-for-byte intact and is reported for review rather than guessed at. */
export declare function rebindIteratorStep(element: any, before: IteratorContext[], after: IteratorContext[]): boolean;
/** Bind known iterator indices for template lookup, without evaluating code. */
export declare function sampleExpression(expression: string, contexts: IteratorContext[], options?: MappingPreviewOptions): string;
/** Number of template repetitions, or null for a runtime-only iterator target. */
export declare function iteratorSampleCount(nodes: TreeNode[] | null | undefined, context: IteratorContext, contexts: IteratorContext[], options?: MappingPreviewOptions): number | null;
/** Picker tree for one sample repetition. Accessors retain symbolic indices. */
export declare function iteratorTree(nodes: TreeNode[] | null | undefined, contexts: IteratorContext[], options?: MappingPreviewOptions): TreeNode[] | null | undefined;
export declare function indexTree(nodes: TreeNode[] | null | undefined): Map<string, TreeNode>;
export type MappingPreview = {
    status: 'ok';
    raw: string;
    usedDefault: boolean;
    missing: boolean;
    steps: Array<{
        find: string;
        replace: string;
        value: string;
    }>;
    value: string;
} | {
    status: 'runtime';
    reason: string;
} | {
    status: 'error';
    reason: string;
};
export declare const INBOUND_PATH_RE: RegExp;
export declare function previewMapping(step: {
    mapping?: any;
    defaultValue?: any;
    replacements?: any;
}, index: Map<string, TreeNode>, contexts?: IteratorContext[], options?: MappingPreviewOptions): MappingPreview;
export declare function variablesSet(el: any): string[];
export declare function variablesRead(el: any): string[];
export interface OrderWarning {
    name: string;
    setBy: number;
}
export declare function orderWarnings(steps: any[]): OrderWarning[][];
