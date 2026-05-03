import CoreGraphics
import Foundation

struct CaptureResult: @unchecked Sendable {
    let image: CGImage
    let pngData: Data
    let validation: CaptureValidationResult
    let capturedAt: Date
}

struct CaptureValidationResult: Codable, Sendable {
    let isValid: Bool
    let width: Int
    let height: Int
    let transparentSampleRatio: Double
    let dominantColorRatio: Double
    let sampledPixels: Int
    let issues: [String]

    var summary: String {
        if isValid {
            return "valid \(width)x\(height), dominant=\(String(format: "%.2f", dominantColorRatio)), transparent=\(String(format: "%.2f", transparentSampleRatio))"
        }
        return "invalid \(width)x\(height): \(issues.joined(separator: "; "))"
    }
}
