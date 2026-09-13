export declare function adoptEngineContext(): void;
export declare function beginLogin(): void;
export declare function engineContext(): string;
export declare function assertEngineResponse(response: Response): void;
export declare function engineFetch(url: string, init?: RequestInit): Promise<Response>;
