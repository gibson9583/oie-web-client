/** Shared fallback for restricted routes and settings with no visible sections. */
export function AccessDeniedView({ message = "You don't have permission to view this page. Contact your administrator if you need access." }: { message?: string }) {
    return (
        <div className="view">
            <div className="view-body">
                <div className="dt-empty" role="status">
                    <h2 className="text-text font-semibold mb-2">Access denied</h2>
                    <p className="text-text-dim">{message}</p>
                </div>
            </div>
        </div>
    );
}
