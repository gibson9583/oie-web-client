type PartialScriptPurpose = 'mapDiscovery' | 'partialValidation';
export declare function generateElementScript(element: any, getChildren?: (el: any) => any[], mode?: PartialScriptPurpose): string | null;
/** Names an enabled step uses in the enclosing Iterator's JavaScript scope. */
export declare function usesGeneratedIteratorIdentifier(el: any, name: string): boolean;
export {};
