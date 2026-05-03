import CoreGraphics
import ScreenCaptureKit

enum CaptureSourceKind: String, Codable {
    case display
    case window
}

struct CaptureSource: Identifiable, @unchecked Sendable {
    let id: UInt32
    let kind: CaptureSourceKind
    let label: String
    let frame: CGRect
    let appName: String?
    let title: String?
    let isBrowserSource: Bool
    let display: SCDisplay?
    let window: SCWindow?
}
