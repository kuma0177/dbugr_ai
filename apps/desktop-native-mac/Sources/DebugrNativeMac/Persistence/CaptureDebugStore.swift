import AppKit
import Foundation

struct SavedCaptureDebugArtifacts {
    let pngURL: URL
    let diagnosticsURL: URL
}

final class CaptureDebugStore: @unchecked Sendable {
    let debugDirectory: URL

    init(fileManager: FileManager = .default) {
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        debugDirectory = base
            .appendingPathComponent("debugr", isDirectory: true)
            .appendingPathComponent("native-capture-debug", isDirectory: true)
    }

    func save(result: CaptureResult, source: CaptureSource) throws -> SavedCaptureDebugArtifacts {
        try FileManager.default.createDirectory(at: debugDirectory, withIntermediateDirectories: true)
        let stamp = Self.fileStamp(from: result.capturedAt)
        let safeKind = source.kind.rawValue
        let pngURL = debugDirectory.appendingPathComponent("\(stamp)-\(safeKind)-\(source.id).png")
        let diagnosticsURL = debugDirectory.appendingPathComponent("\(stamp)-\(safeKind)-\(source.id).json")

        try result.pngData.write(to: pngURL, options: .atomic)

        let diagnostics = CaptureDiagnostics(
            capturedAt: result.capturedAt,
            sourceID: source.id,
            sourceKind: source.kind.rawValue,
            sourceLabel: source.label,
            sourceFrame: CodableRect(source.frame),
            validation: result.validation,
            permission: PermissionDiagnostics.current(),
            pngPath: pngURL.path
        )
        let data = try JSONEncoder.debugr.encode(diagnostics)
        try data.write(to: diagnosticsURL, options: .atomic)

        return SavedCaptureDebugArtifacts(pngURL: pngURL, diagnosticsURL: diagnosticsURL)
    }

    private static func fileStamp(from date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmmss-SSS"
        return formatter.string(from: date)
    }
}

private struct CaptureDiagnostics: Codable {
    let capturedAt: Date
    let sourceID: UInt32
    let sourceKind: String
    let sourceLabel: String
    let sourceFrame: CodableRect
    let validation: CaptureValidationResult
    let permission: PermissionDiagnostics
    let pngPath: String
}

private struct CodableRect: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double

    init(_ rect: CGRect) {
        x = rect.origin.x
        y = rect.origin.y
        width = rect.width
        height = rect.height
    }
}

private extension JSONEncoder {
    static var debugr: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}
