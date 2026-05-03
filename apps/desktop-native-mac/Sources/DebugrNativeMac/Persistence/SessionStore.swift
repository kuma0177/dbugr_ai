import Foundation

final class SessionStore: @unchecked Sendable {
    let workspaceDirectory: URL
    let capturesDirectory: URL
    private let sessionsURL: URL

    init(fileManager: FileManager = .default) {
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        workspaceDirectory = base
            .appendingPathComponent("debugr", isDirectory: true)
            .appendingPathComponent("native-workspace", isDirectory: true)
        capturesDirectory = workspaceDirectory.appendingPathComponent("captures", isDirectory: true)
        sessionsURL = workspaceDirectory.appendingPathComponent("sessions.json")
    }

    func loadSessions() throws -> [NativeSessionRecord] {
        guard FileManager.default.fileExists(atPath: sessionsURL.path) else {
            return []
        }
        let data = try Data(contentsOf: sessionsURL)
        let sessions = try JSONDecoder.debugr.decode([NativeSessionRecord].self, from: data)
        return sessions.sorted { $0.updatedAt > $1.updatedAt }
    }

    func saveSessions(_ sessions: [NativeSessionRecord]) throws {
        try FileManager.default.createDirectory(at: workspaceDirectory, withIntermediateDirectories: true)
        let data = try JSONEncoder.debugr.encode(sessions.sorted { $0.updatedAt > $1.updatedAt })
        try data.write(to: sessionsURL, options: .atomic)
    }

    func saveCaptureAsset(pngData: Data, captureID: String, capturedAt: Date) throws -> String {
        try FileManager.default.createDirectory(at: capturesDirectory, withIntermediateDirectories: true)
        let filename = "\(Self.fileStamp(from: capturedAt))-\(captureID).png"
        let url = capturesDirectory.appendingPathComponent(filename)
        try pngData.write(to: url, options: .atomic)
        return "captures/\(filename)"
    }

    func absoluteCaptureURL(for relativePath: String) -> URL {
        workspaceDirectory.appendingPathComponent(relativePath)
    }

    private static func fileStamp(from date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmmss-SSS"
        return formatter.string(from: date)
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

private extension JSONDecoder {
    static var debugr: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}
