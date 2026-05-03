import AppKit

private enum CaptureMode: Int {
    case visibleArea = 0
    case fullScreen = 1
    case window = 2
}

final class MainViewController: NSViewController {
    private let captureService = CaptureService()
    private let debugStore = CaptureDebugStore()
    private var sources: [CaptureSource] = []
    private var captureMode: CaptureMode = .visibleArea

    private let statusLabel = NSTextField(labelWithString: "Ready")
    private let sourceHintLabel = NSTextField(labelWithString: "Default: capture the screen you are currently looking at.")
    private let modeControl = NSSegmentedControl(labels: ["Visible area", "Full screen", "App window"], trackingMode: .selectOne, target: nil, action: nil)
    private let sourcePopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private let previewView = NSImageView()
    private let logView = NSTextView()
    private let refreshButton = NSButton(title: "Refresh Sources", target: nil, action: nil)
    private let captureButton = NSButton(title: "Capture Selected", target: nil, action: nil)
    private let permissionButton = NSButton(title: "Check Permission", target: nil, action: nil)

    override func loadView() {
        view = NSView()
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        buildLayout()
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        refreshButton.target = self
        refreshButton.action = #selector(refreshSources)
        captureButton.target = self
        captureButton.action = #selector(captureSelected)
        permissionButton.target = self
        permissionButton.action = #selector(checkPermission)
        modeControl.target = self
        modeControl.action = #selector(captureModeChanged)
        modeControl.selectedSegment = captureMode.rawValue
        appendLog("Native prototype started. Debug folder: \(debugStore.debugDirectory.path)")
        refreshSources()
    }

    private func buildLayout() {
        let title = NSTextField(labelWithString: "Debugr Native Capture Prototype")
        title.font = .systemFont(ofSize: 24, weight: .bold)

        let subtitle = NSTextField(labelWithString: "First milestone: prove native source listing, capture, validation, and debug saves.")
        subtitle.textColor = .secondaryLabelColor
        sourceHintLabel.textColor = .secondaryLabelColor
        sourceHintLabel.lineBreakMode = .byWordWrapping
        sourceHintLabel.maximumNumberOfLines = 2

        let controls = NSStackView(views: [refreshButton, captureButton, permissionButton])
        controls.orientation = .horizontal
        controls.spacing = 10

        previewView.imageScaling = .scaleProportionallyUpOrDown
        previewView.wantsLayer = true
        previewView.layer?.backgroundColor = NSColor.black.withAlphaComponent(0.05).cgColor
        previewView.layer?.cornerRadius = 12

        logView.isEditable = false
        logView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.documentView = logView

        let stack = NSStackView(views: [title, subtitle, statusLabel, modeControl, sourceHintLabel, sourcePopup, controls, previewView, scroll])
        stack.orientation = .vertical
        stack.spacing = 14
        stack.alignment = .leading
        stack.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(stack)
        for child in [title, subtitle, statusLabel, modeControl, sourceHintLabel, sourcePopup, controls, previewView, scroll] {
            child.translatesAutoresizingMaskIntoConstraints = false
        }

        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -24),
            sourcePopup.widthAnchor.constraint(equalTo: stack.widthAnchor),
            previewView.widthAnchor.constraint(equalTo: stack.widthAnchor),
            previewView.heightAnchor.constraint(equalToConstant: 360),
            scroll.widthAnchor.constraint(equalTo: stack.widthAnchor),
            scroll.heightAnchor.constraint(equalToConstant: 180)
        ])
    }

    @objc private func refreshSources() {
        setBusy(true, statusText(for: captureMode, busy: true))
        Task {
            do {
                let loaded = try await loadSources(for: captureMode)
                await MainActor.run {
                    sources = loaded
                    sourcePopup.removeAllItems()
                    sourcePopup.addItems(withTitles: loaded.map(\.label))
                    sourcePopup.isEnabled = captureMode != .visibleArea
                    sourceHintLabel.stringValue = hintText(for: captureMode, count: loaded.count)
                    setBusy(false, statusText(for: captureMode, busy: false, count: loaded.count))
                    appendLog("Loaded \(loaded.count) source(s) for \(modeName(captureMode))")
                }
            } catch {
                await MainActor.run {
                    setBusy(false, "Failed to load sources")
                    appendLog("Source listing failed: \(error.localizedDescription)")
                }
            }
        }
    }

    @objc private func captureSelected() {
        guard let source = selectedSource() else {
            appendLog("No source selected.")
            return
        }

        setBusy(true, "Capturing \(source.label)...")

        Task {
            do {
                let result = try await captureService.capture(source)
                let saved = try debugStore.save(result: result, source: source)
                await MainActor.run {
                    previewView.image = NSImage(cgImage: result.image, size: .zero)
                    setBusy(false, result.validation.isValid ? "Capture valid" : "Capture rejected")
                    appendLog("Capture saved: \(saved.pngURL.path)")
                    appendLog("Diagnostics saved: \(saved.diagnosticsURL.path)")
                    appendLog("Validation: \(result.validation.summary)")
                }
            } catch {
                await MainActor.run {
                    setBusy(false, "Capture failed")
                    appendLog("Capture failed: \(error.localizedDescription)")
                }
            }
        }
    }

    @objc private func captureModeChanged() {
        let nextMode = CaptureMode(rawValue: modeControl.selectedSegment) ?? .visibleArea
        captureMode = nextMode
        refreshSources()
    }

    @objc private func checkPermission() {
        let diagnostics = PermissionDiagnostics.current()
        appendLog("Bundle id: \(diagnostics.bundleIdentifier)")
        appendLog("Executable: \(diagnostics.executablePath)")
        appendLog("CGPreflightScreenCaptureAccess: \(diagnostics.preflight)")
    }

    private func setBusy(_ busy: Bool, _ text: String) {
        statusLabel.stringValue = text
        refreshButton.isEnabled = !busy
        captureButton.isEnabled = !busy
        permissionButton.isEnabled = !busy
    }

    private func appendLog(_ message: String) {
        let stamp = ISO8601DateFormatter().string(from: Date())
        logView.string += "[\(stamp)] \(message)\n"
        logView.scrollToEndOfDocument(nil)
    }

    private func loadSources(for mode: CaptureMode) async throws -> [CaptureSource] {
        switch mode {
        case .visibleArea:
            return [try await captureService.visibleDisplaySource()]
        case .fullScreen:
            return try await captureService.listDisplaySources()
        case .window:
            return try await captureService.listWindowSources()
        }
    }

    private func selectedSource() -> CaptureSource? {
        if captureMode == .visibleArea {
            return sources.first
        }
        let index = sourcePopup.indexOfSelectedItem
        guard index >= 0, index < sources.count else { return nil }
        return sources[index]
    }

    private func hintText(for mode: CaptureMode, count: Int) -> String {
        switch mode {
        case .visibleArea:
            return "Default path: capture the screen under the mouse pointer, then annotate on top of the frozen image."
        case .fullScreen:
            return "Choose a whole display when you want the complete screen context."
        case .window:
            return "Advanced path: choose a filtered app window. Browser windows are sorted first and helper windows are hidden."
        }
    }

    private func statusText(for mode: CaptureMode, busy: Bool, count: Int? = nil) -> String {
        if busy {
            switch mode {
            case .visibleArea:
                return "Preparing visible-area capture..."
            case .fullScreen:
                return "Loading available screens..."
            case .window:
                return "Loading filtered app windows..."
            }
        }
        if let count {
            return "Ready: \(modeName(mode)) (\(count) source(s))"
        }
        return "Ready"
    }

    private func modeName(_ mode: CaptureMode) -> String {
        switch mode {
        case .visibleArea:
            return "visible area"
        case .fullScreen:
            return "full screen"
        case .window:
            return "app window"
        }
    }
}
