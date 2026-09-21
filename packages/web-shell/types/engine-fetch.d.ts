export declare function adoptEngineContext(): void;
export declare function beginLogin(): void;
export declare function engineContext(): string;
/** End local access even when remote revocation has not changed the cookies. */
export declare function discardEngineResponses(): void;
/** Fence an entire user operation, including new requests after an awaited stage. */
export declare function captureEngineSession(): () => void;
export declare function assertEngineResponse(response: Response): void;
export declare function engineFetch(url: string, init?: RequestInit): Promise<Response>;
