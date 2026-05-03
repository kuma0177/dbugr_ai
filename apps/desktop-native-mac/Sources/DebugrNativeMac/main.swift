import AppKit
import Foundation

if CommandLine.arguments.contains("--capture-smoke") {
    let service = CaptureService()
    let store = CaptureDebugStore()
    final class SmokeState {
        var done = false
    }
    let state = SmokeState()

    Task {
        do {
            let displays = try await service.listDisplaySources()
            let windows = try await service.listWindowSources()
            let sources = displays + windows
            print("debugr_native_smoke_sources=\(sources.count)")
            guard let source = displays.first ?? windows.first else {
                print("debugr_native_smoke_err=no_sources")
                state.done = true
                return
            }
            let result = try await service.capture(source)
            let saved = try store.save(result: result, source: source)
            print("debugr_native_smoke_source=\(source.label)")
            print("debugr_native_smoke_validation=\(result.validation.summary)")
            print("debugr_native_smoke_png=\(saved.pngURL.path)")
            print("debugr_native_smoke_json=\(saved.diagnosticsURL.path)")
        } catch {
            print("debugr_native_smoke_err=\(error.localizedDescription)")
        }
        state.done = true
    }

    while !state.done {
        RunLoop.current.run(mode: .default, before: Date(timeIntervalSinceNow: 0.05))
    }
    exit(0)
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var mainWindowController: MainWindowController?
    private var hotKeyController: HotKeyController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)

        let controller = MainWindowController()
        controller.showWindow(nil)
        mainWindowController = controller

        hotKeyController = HotKeyController {
            DispatchQueue.main.async { [weak self] in
                self?.mainWindowController?.showAndFocus()
            }
        }
        hotKeyController?.register()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
