import CoreGraphics
import Foundation

struct PermissionDiagnostics: Codable {
    let preflight: Bool
    let bundleIdentifier: String
    let executablePath: String

    static func current() -> PermissionDiagnostics {
        PermissionDiagnostics(
            preflight: CGPreflightScreenCaptureAccess(),
            bundleIdentifier: Bundle.main.bundleIdentifier ?? "unknown",
            executablePath: Bundle.main.executablePath ?? "unknown"
        )
    }
}
