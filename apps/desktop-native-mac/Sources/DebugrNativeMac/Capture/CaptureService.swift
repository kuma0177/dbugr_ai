import AppKit
import CoreGraphics
import ScreenCaptureKit

enum CaptureError: LocalizedError {
    case unsupportedMacOS
    case displayNotFound
    case windowNotFound
    case pngEncodingFailed
    case invalidSource

    var errorDescription: String? {
        switch self {
        case .unsupportedMacOS:
            return "ScreenCaptureKit capture requires macOS 14 or later."
        case .displayNotFound:
            return "Selected display was no longer available."
        case .windowNotFound:
            return "Selected window was no longer available."
        case .pngEncodingFailed:
            return "Failed to encode captured image as PNG."
        case .invalidSource:
            return "Invalid capture source."
        }
    }
}

final class CaptureService: @unchecked Sendable {
    func listDisplaySources() async throws -> [CaptureSource] {
        guard #available(macOS 14.0, *) else {
            throw CaptureError.unsupportedMacOS
        }

        let content = try await shareableContent()
        var sources: [CaptureSource] = []

        for display in content.displays {
            let width = Int(display.frame.width.rounded())
            let height = Int(display.frame.height.rounded())
            sources.append(CaptureSource(
                id: display.displayID,
                kind: .display,
                label: "Screen - \(width)x\(height) pt",
                frame: display.frame,
                appName: nil,
                title: nil,
                isBrowserSource: false,
                display: display,
                window: nil
            ))
        }

        return sources
    }

    func listWindowSources() async throws -> [CaptureSource] {
        guard #available(macOS 14.0, *) else {
            throw CaptureError.unsupportedMacOS
        }

        let content = try await shareableContent()
        var seen = Set<String>()
        var sources: [CaptureSource] = []

        for window in content.windows.prefix(120) {
            guard window.frame.width >= 48, window.frame.height >= 48 else {
                continue
            }
            let appName = window.owningApplication?.applicationName ?? "Unknown App"
            if shouldHideWindow(appName: appName, title: window.title ?? "") {
                continue
            }
            let rawTitle = window.title ?? ""
            let title = rawTitle.isEmpty ? "(untitled window)" : rawTitle
            let dedupeKey = "\(appName)|\(title)|\(Int(window.frame.origin.x.rounded()))|\(Int(window.frame.origin.y.rounded()))"
            if seen.contains(dedupeKey) {
                continue
            }
            seen.insert(dedupeKey)
            let isBrowser = Self.browserAppNames.contains(appName)
            let prefix = isBrowser ? "[Browser]" : "[App]"
            sources.append(CaptureSource(
                id: window.windowID,
                kind: .window,
                label: "\(prefix) \(appName) - \(title)",
                frame: window.frame,
                appName: appName,
                title: title,
                isBrowserSource: isBrowser,
                display: nil,
                window: window
            ))
        }

        return sources.sorted {
            if $0.isBrowserSource != $1.isBrowserSource {
                return $0.isBrowserSource && !$1.isBrowserSource
            }
            if ($0.appName ?? "") != ($1.appName ?? "") {
                return ($0.appName ?? "") < ($1.appName ?? "")
            }
            return ($0.title ?? $0.label) < ($1.title ?? $1.label)
        }
    }

    func visibleDisplaySource() async throws -> CaptureSource {
        let displays = try await listDisplaySources()
        let pointer = NSEvent.mouseLocation
        if let matched = displays.first(where: { $0.frame.contains(pointer) }) {
            return matched
        }
        guard let first = displays.first else {
            throw CaptureError.displayNotFound
        }
        return first
    }

    func capture(_ source: CaptureSource) async throws -> CaptureResult {
        guard #available(macOS 14.0, *) else {
            throw CaptureError.unsupportedMacOS
        }

        let image: CGImage
        switch source.kind {
        case .display:
            guard let display = source.display else { throw CaptureError.displayNotFound }
            image = try await capture(display: display)
        case .window:
            guard let window = source.window else { throw CaptureError.windowNotFound }
            image = try await capture(window: window)
        }

        guard let pngData = pngData(from: image) else {
            throw CaptureError.pngEncodingFailed
        }

        return CaptureResult(
            image: image,
            pngData: pngData,
            validation: CaptureValidation.validate(image),
            capturedAt: Date()
        )
    }

    @available(macOS 14.0, *)
    private func capture(display: SCDisplay) async throws -> CGImage {
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        config.showsCursor = false
        config.sourceRect = CGRect(origin: .zero, size: display.frame.size)
        config.width = max(1, Int(CGDisplayPixelsWide(display.displayID)))
        config.height = max(1, Int(CGDisplayPixelsHigh(display.displayID)))
        return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
    }

    @available(macOS 14.0, *)
    private func capture(window: SCWindow) async throws -> CGImage {
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let config = SCStreamConfiguration()
        config.showsCursor = false
        config.width = max(1, Int(window.frame.width.rounded()))
        config.height = max(1, Int(window.frame.height.rounded()))
        return try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
    }

    private func pngData(from image: CGImage) -> Data? {
        let rep = NSBitmapImageRep(cgImage: image)
        return rep.representation(using: .png, properties: [:])
    }

    @available(macOS 14.0, *)
    private func shareableContent() async throws -> SCShareableContent {
        try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    }

    private func shouldHideWindow(appName: String, title: String) -> Bool {
        let loweredApp = appName.lowercased()
        let loweredTitle = title.lowercased()
        if Self.hiddenAppFragments.contains(where: { loweredApp.contains($0) }) {
            return true
        }
        if loweredTitle.contains("debugr annotation") || loweredTitle.contains("debugr native mac") {
            return true
        }
        return false
    }

    private static let browserAppNames: Set<String> = [
        "Safari",
        "Google Chrome",
        "Arc",
        "Brave Browser",
        "Microsoft Edge",
        "Firefox",
    ]

    private static let hiddenAppFragments: [String] = [
        "cursoruiviewservice",
        "feedbackagent-desktop",
        "debugr.ai",
        "debugr native mac",
        "window server",
        "system settings",
    ]
}
