import AppKit

private enum CaptureMode: Int {
    case visibleArea = 0
    case fullScreen = 1
    case window = 2
}

private enum SessionSelectionMode: Int {
    case existing = 0
    case new = 1
}

private struct DraftCapture {
    let source: CaptureSource
    let result: CaptureResult
    let artifacts: SavedCaptureDebugArtifacts
}

final class MainViewController: NSViewController {
    private let captureService = CaptureService()
    private let debugStore = CaptureDebugStore()
    private let sessionStore = SessionStore()

    private var sources: [CaptureSource] = []
    private var sessions: [NativeSessionRecord] = []
    private var captureMode: CaptureMode = .visibleArea
    private var sessionSelectionMode: SessionSelectionMode = .existing
    private var selectedDraftSessionID: String?
    private var selectedWorkspaceSessionID: String?
    private var selectedDraftAnnotationID: String?
    private var selectedProvider: ProviderTarget = .claude
    private var connectedProviders = Set<ProviderTarget>()
    private var draftCapture: DraftCapture?
    private var draftAnnotations: [NativeAnnotationNote] = []

    private let titleLabel = NSTextField(labelWithString: "Debugr Native Mac")
    private let subtitleLabel = NSTextField(labelWithString: "Capture, annotate, save into native sessions, and prepare Claude/Codex/Cursor payloads from the same macOS shell.")
    private let statusLabel = NSTextField(labelWithString: "Ready")
    private let sourceHintLabel = NSTextField(labelWithString: "Default: capture the screen you are currently looking at.")
    private let modeControl = NSSegmentedControl(labels: ["Visible area", "Full screen", "App window"], trackingMode: .selectOne, target: nil, action: nil)
    private let sourcePopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private let refreshButton = NSButton(title: "Refresh Sources", target: nil, action: nil)
    private let captureButton = NSButton(title: "Capture Selected", target: nil, action: nil)
    private let permissionButton = NSButton(title: "Check Permission", target: nil, action: nil)
    private let previewView = NSImageView()

    private let sessionModeControl = NSSegmentedControl(labels: ["Existing session", "New session"], trackingMode: .selectOne, target: nil, action: nil)
    private let existingSessionPopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private let sessionTitleField = NSTextField(string: "")
    private let projectFolderField = NSTextField(string: "")
    private let githubRepoField = NSTextField(string: "")
    private let annotationPopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private let applyAnnotationButton = NSButton(title: "Add Note", target: nil, action: nil)
    private let deleteAnnotationButton = NSButton(title: "Delete Note", target: nil, action: nil)
    private let saveDraftButton = NSButton(title: "Save Capture To Session", target: nil, action: nil)
    private let draftSummaryLabel = NSTextField(labelWithString: "Capture a screen or window, then add annotation notes.")

    private let workspaceSessionPopup = NSPopUpButton(frame: .zero, pullsDown: false)
    private let workspaceSummaryLabel = NSTextField(labelWithString: "No native sessions saved yet.")
    private let providerControl = NSSegmentedControl(labels: ProviderTarget.allCases.map(\.displayName), trackingMode: .selectOne, target: nil, action: nil)
    private let providerStatusLabel = NSTextField(labelWithString: "Select a target to prepare the payload.")
    private let connectProviderButton = NSButton(title: "Mark Target Connected", target: nil, action: nil)
    private let sendButton = NSButton(title: "Prepare Payload", target: nil, action: nil)
    private let saveConfirmationLabel = NSTextField(labelWithString: "")

    private let annotationTextView = NSTextView()
    private let promptPreviewView = NSTextView()
    private let responseView = NSTextView()
    private let logView = NSTextView()

    override func loadView() {
        view = NSView()
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
        buildLayout()
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        wireActions()
        configureInitialState()
        loadStoredSessions()
        refreshSources()
    }

    private func buildLayout() {
        titleLabel.font = .systemFont(ofSize: 28, weight: .bold)
        subtitleLabel.textColor = .secondaryLabelColor
        subtitleLabel.maximumNumberOfLines = 3
        sourceHintLabel.textColor = .secondaryLabelColor
        sourceHintLabel.maximumNumberOfLines = 2
        statusLabel.font = .systemFont(ofSize: 13, weight: .medium)
        draftSummaryLabel.textColor = .secondaryLabelColor
        draftSummaryLabel.maximumNumberOfLines = 2
        workspaceSummaryLabel.textColor = .secondaryLabelColor
        workspaceSummaryLabel.maximumNumberOfLines = 3
        providerStatusLabel.textColor = .secondaryLabelColor
        providerStatusLabel.maximumNumberOfLines = 2
        saveConfirmationLabel.textColor = .systemGreen
        saveConfirmationLabel.maximumNumberOfLines = 2

        previewView.imageScaling = .scaleProportionallyUpOrDown
        previewView.wantsLayer = true
        previewView.layer?.backgroundColor = NSColor.black.withAlphaComponent(0.05).cgColor
        previewView.layer?.cornerRadius = 14

        annotationTextView.isRichText = false
        annotationTextView.font = .systemFont(ofSize: 13)
        annotationTextView.string = ""
        promptPreviewView.isEditable = false
        promptPreviewView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
        responseView.isEditable = false
        responseView.font = .systemFont(ofSize: 13)
        logView.isEditable = false
        logView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)

        let annotationScroll = scrollView(for: annotationTextView, height: 110)
        let promptScroll = scrollView(for: promptPreviewView, height: 180)
        let responseScroll = scrollView(for: responseView, height: 110)
        let logScroll = scrollView(for: logView, height: 160)

        let controls = NSStackView(views: [refreshButton, captureButton, permissionButton])
        controls.orientation = .horizontal
        controls.spacing = 10

        let capturePanel = sectionBox(
            title: "Capture",
            views: [
                modeControl,
                sourceHintLabel,
                sourcePopup,
                controls,
                previewView,
                statusLabel,
            ]
        )

        let draftNoteControls = NSStackView(views: [annotationPopup, applyAnnotationButton, deleteAnnotationButton])
        draftNoteControls.orientation = .horizontal
        draftNoteControls.spacing = 8

        let draftPanel = sectionBox(
            title: "Annotate + Save",
            views: [
                sessionModeControl,
                existingSessionPopup,
                labeledField(title: "Session title", field: sessionTitleField, placeholder: "Checkout flow issue"),
                labeledField(title: "Project folder", field: projectFolderField, placeholder: "/Users/kumar/debugr"),
                labeledField(title: "GitHub repo", field: githubRepoField, placeholder: "owner/repo"),
                draftNoteControls,
                annotationScroll,
                draftSummaryLabel,
                saveDraftButton,
                saveConfirmationLabel,
            ]
        )

        let providerActions = NSStackView(views: [connectProviderButton, sendButton])
        providerActions.orientation = .horizontal
        providerActions.spacing = 8

        let workspacePanel = sectionBox(
            title: "Workspace + Handoff",
            views: [
                workspaceSessionPopup,
                workspaceSummaryLabel,
                providerControl,
                providerStatusLabel,
                providerActions,
                promptScroll,
                responseScroll,
            ]
        )

        let topStack = NSStackView(views: [capturePanel, draftPanel, workspacePanel])
        topStack.orientation = .vertical
        topStack.spacing = 16

        let rootStack = NSStackView(views: [titleLabel, subtitleLabel, topStack, logScroll])
        rootStack.orientation = .vertical
        rootStack.spacing = 16
        rootStack.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(rootStack)
        for subview in [capturePanel, draftPanel, workspacePanel, previewView] {
            subview.translatesAutoresizingMaskIntoConstraints = false
        }

        NSLayoutConstraint.activate([
            rootStack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            rootStack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            rootStack.topAnchor.constraint(equalTo: view.topAnchor, constant: 24),
            rootStack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -24),
            previewView.heightAnchor.constraint(equalToConstant: 280),
            sourcePopup.widthAnchor.constraint(greaterThanOrEqualToConstant: 320),
            existingSessionPopup.widthAnchor.constraint(greaterThanOrEqualToConstant: 320),
            workspaceSessionPopup.widthAnchor.constraint(greaterThanOrEqualToConstant: 320),
            annotationPopup.widthAnchor.constraint(greaterThanOrEqualToConstant: 240),
        ])
    }

    private func wireActions() {
        refreshButton.target = self
        refreshButton.action = #selector(refreshSources)
        captureButton.target = self
        captureButton.action = #selector(captureSelected)
        permissionButton.target = self
        permissionButton.action = #selector(checkPermission)
        modeControl.target = self
        modeControl.action = #selector(captureModeChanged)
        sessionModeControl.target = self
        sessionModeControl.action = #selector(sessionModeChanged)
        existingSessionPopup.target = self
        existingSessionPopup.action = #selector(existingSessionChanged)
        annotationPopup.target = self
        annotationPopup.action = #selector(draftAnnotationChanged)
        applyAnnotationButton.target = self
        applyAnnotationButton.action = #selector(applyDraftAnnotation)
        deleteAnnotationButton.target = self
        deleteAnnotationButton.action = #selector(deleteDraftAnnotation)
        saveDraftButton.target = self
        saveDraftButton.action = #selector(saveDraftCapture)
        workspaceSessionPopup.target = self
        workspaceSessionPopup.action = #selector(workspaceSessionChanged)
        providerControl.target = self
        providerControl.action = #selector(providerChanged)
        connectProviderButton.target = self
        connectProviderButton.action = #selector(toggleProviderConnection)
        sendButton.target = self
        sendButton.action = #selector(preparePayload)
    }

    private func configureInitialState() {
        modeControl.selectedSegment = captureMode.rawValue
        sessionModeControl.selectedSegment = sessionSelectionMode.rawValue
        providerControl.selectedSegment = selectedProviderSegment
        appendLog("Native prototype started.")
        appendLog("Debug capture folder: \(debugStore.debugDirectory.path)")
        appendLog("Native workspace folder: \(sessionStore.workspaceDirectory.path)")
        refreshDraftAnnotationUI()
        refreshDraftSessionUI()
        refreshWorkspaceUI()
    }

    private var selectedProviderSegment: Int {
        ProviderTarget.allCases.firstIndex(of: selectedProvider) ?? 0
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
        saveConfirmationLabel.stringValue = ""

        Task {
            do {
                let result = try await captureService.capture(source)
                let saved = try debugStore.save(result: result, source: source)
                await MainActor.run {
                    draftCapture = DraftCapture(source: source, result: result, artifacts: saved)
                    previewView.image = NSImage(cgImage: result.image, size: .zero)
                    if draftAnnotations.isEmpty {
                        selectedDraftAnnotationID = nil
                        annotationTextView.string = ""
                    }
                    setBusy(false, result.validation.isValid ? "Capture valid" : "Capture rejected")
                    draftSummaryLabel.stringValue = "Captured \(source.label). Add one or more notes, then save the capture into a session."
                    appendLog("Capture saved for debug: \(saved.pngURL.path)")
                    appendLog("Diagnostics saved: \(saved.diagnosticsURL.path)")
                    appendLog("Validation: \(result.validation.summary)")
                    refreshDraftSaveState()
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
        captureMode = CaptureMode(rawValue: modeControl.selectedSegment) ?? .visibleArea
        refreshSources()
    }

    @objc private func checkPermission() {
        let diagnostics = PermissionDiagnostics.current()
        appendLog("Bundle id: \(diagnostics.bundleIdentifier)")
        appendLog("Executable: \(diagnostics.executablePath)")
        appendLog("CGPreflightScreenCaptureAccess: \(diagnostics.preflight)")
    }

    @objc private func sessionModeChanged() {
        sessionSelectionMode = SessionSelectionMode(rawValue: sessionModeControl.selectedSegment) ?? .existing
        refreshDraftSessionUI()
        refreshDraftSaveState()
    }

    @objc private func existingSessionChanged() {
        let index = existingSessionPopup.indexOfSelectedItem
        guard index >= 0, index < sessions.count else {
            selectedDraftSessionID = nil
            refreshDraftSaveState()
            return
        }
        selectedDraftSessionID = sessions[index].id
        saveConfirmationLabel.stringValue = ""
        refreshDraftSaveState()
    }

    @objc private func draftAnnotationChanged() {
        let selected = selectedDraftAnnotation()
        selectedDraftAnnotationID = selected?.id
        annotationTextView.string = selected?.text ?? ""
        refreshDraftAnnotationUI()
    }

    @objc private func applyDraftAnnotation() {
        let text = annotationTextView.string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            saveConfirmationLabel.stringValue = "Add note text before saving the annotation."
            return
        }

        if let selectedID = selectedDraftAnnotationID,
           let index = draftAnnotations.firstIndex(where: { $0.id == selectedID }) {
            draftAnnotations[index].text = text
            draftAnnotations[index].updatedAt = Date()
            saveConfirmationLabel.stringValue = "Annotation note updated."
        } else {
            let note = NativeAnnotationNote(text: text)
            draftAnnotations.append(note)
            selectedDraftAnnotationID = note.id
            saveConfirmationLabel.stringValue = "Annotation note added."
        }

        refreshDraftAnnotationUI()
        refreshDraftSaveState()
    }

    @objc private func deleteDraftAnnotation() {
        guard let selectedID = selectedDraftAnnotationID else { return }
        draftAnnotations.removeAll { $0.id == selectedID }
        selectedDraftAnnotationID = nil
        annotationTextView.string = ""
        saveConfirmationLabel.stringValue = "Annotation note deleted."
        refreshDraftAnnotationUI()
        refreshDraftSaveState()
    }

    @objc private func saveDraftCapture() {
        guard let draftCapture else {
            saveConfirmationLabel.stringValue = "Capture a screen or window first."
            return
        }
        guard !draftAnnotations.isEmpty else {
            saveConfirmationLabel.stringValue = "Add at least one annotation note before saving."
            return
        }

        do {
            var currentSessions = try sessionStore.loadSessions()
            let now = Date()
            let targetSessionIndex: Int

            switch sessionSelectionMode {
            case .existing:
                guard let selectedDraftSessionID,
                      let index = currentSessions.firstIndex(where: { $0.id == selectedDraftSessionID }) else {
                    saveConfirmationLabel.stringValue = "Choose an existing session or switch to New session."
                    return
                }
                targetSessionIndex = index
            case .new:
                let title = sessionTitleField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !title.isEmpty else {
                    saveConfirmationLabel.stringValue = "Add a session title before saving."
                    return
                }
                let session = NativeSessionRecord(
                    title: title,
                    projectFolder: projectFolderField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines),
                    githubRepo: githubRepoField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines),
                    captures: [],
                    createdAt: now,
                    updatedAt: now,
                    lastTarget: selectedProvider
                )
                currentSessions.insert(session, at: 0)
                targetSessionIndex = 0
                selectedDraftSessionID = session.id
                selectedWorkspaceSessionID = session.id
            }

            let captureID = UUID().uuidString
            let relativePath = try sessionStore.saveCaptureAsset(
                pngData: draftCapture.result.pngData,
                captureID: captureID,
                capturedAt: draftCapture.result.capturedAt
            )
            let captureRecord = NativeCaptureRecord(
                id: captureID,
                sourceKind: draftCapture.source.kind.rawValue,
                sourceLabel: draftCapture.source.label,
                screenshotRelativePath: relativePath,
                validationSummary: draftCapture.result.validation.summary,
                annotations: draftAnnotations,
                createdAt: draftCapture.result.capturedAt
            )
            currentSessions[targetSessionIndex].captures.insert(captureRecord, at: 0)
            if sessionSelectionMode == .new {
                currentSessions[targetSessionIndex].projectFolder = projectFolderField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
                currentSessions[targetSessionIndex].githubRepo = githubRepoField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            }
            currentSessions[targetSessionIndex].updatedAt = now
            currentSessions[targetSessionIndex].lastTarget = selectedProvider

            try sessionStore.saveSessions(currentSessions)
            sessions = currentSessions.sorted { $0.updatedAt > $1.updatedAt }
            selectedWorkspaceSessionID = currentSessions[targetSessionIndex].id
            loadSessionPopups()
            refreshWorkspaceUI()
            promptPreviewView.string = promptPreview(for: workspaceSelectedSession())
            responseView.string = "Saved to session \"\(currentSessions[targetSessionIndex].title)\".\n\nNext: choose Claude, Codex, or Cursor and prepare the native payload."
            saveConfirmationLabel.stringValue = "Capture and notes saved into \"\(currentSessions[targetSessionIndex].title)\"."
            appendLog("Saved capture \(captureID) into session \(currentSessions[targetSessionIndex].title)")
            clearDraftAfterSave()
        } catch {
            saveConfirmationLabel.stringValue = "Save failed: \(error.localizedDescription)"
            appendLog("Session save failed: \(error.localizedDescription)")
        }
    }

    @objc private func workspaceSessionChanged() {
        let index = workspaceSessionPopup.indexOfSelectedItem
        guard index >= 0, index < sessions.count else {
            selectedWorkspaceSessionID = nil
            refreshWorkspaceUI()
            return
        }
        selectedWorkspaceSessionID = sessions[index].id
        refreshWorkspaceUI()
    }

    @objc private func providerChanged() {
        let index = providerControl.selectedSegment
        selectedProvider = ProviderTarget.allCases[safe: index] ?? .claude
        refreshWorkspaceUI()
    }

    @objc private func toggleProviderConnection() {
        if connectedProviders.contains(selectedProvider) {
            connectedProviders.remove(selectedProvider)
            responseView.string = "\(selectedProvider.displayName) marked as disconnected in the native prototype."
        } else {
            connectedProviders.insert(selectedProvider)
            responseView.string = "\(selectedProvider.displayName) marked as connected.\n\nThis is still a local prototype flag; real CLI/MCP/API linking is still pending."
        }
        refreshWorkspaceUI()
    }

    @objc private func preparePayload() {
        guard let session = workspaceSelectedSession() else {
            responseView.string = "Choose a saved session first."
            return
        }
        let prompt = promptPreview(for: session)
        promptPreviewView.string = prompt
        let connectionState = connectedProviders.contains(selectedProvider) ? "connected" : "not yet connected"
        responseView.string = """
        Prepared a \(selectedProvider.displayName) payload for "\(session.title)".

        Status: \(connectionState)
        Captures: \(session.captures.count)
        Annotation notes: \(session.annotationCount)

        Native handoff plumbing is still pending, but this proves the target chooser, prompt summary review, and immediate response surface in the Swift app.
        """
        appendLog("Prepared \(selectedProvider.displayName) payload for session \(session.title)")
    }

    private func loadStoredSessions() {
        do {
            sessions = try sessionStore.loadSessions()
            if selectedDraftSessionID == nil {
                selectedDraftSessionID = sessions.first?.id
            }
            if selectedWorkspaceSessionID == nil {
                selectedWorkspaceSessionID = sessions.first?.id
            }
            loadSessionPopups()
            refreshWorkspaceUI()
            appendLog("Loaded \(sessions.count) native session(s)")
        } catch {
            appendLog("Failed to load native sessions: \(error.localizedDescription)")
        }
    }

    private func loadSessionPopups() {
        let labels = sessions.map { "\($0.title) · \($0.captures.count) capture(s)" }
        existingSessionPopup.removeAllItems()
        workspaceSessionPopup.removeAllItems()
        if labels.isEmpty {
            existingSessionPopup.addItem(withTitle: "No saved sessions yet")
            workspaceSessionPopup.addItem(withTitle: "No saved sessions yet")
            existingSessionPopup.isEnabled = false
            workspaceSessionPopup.isEnabled = false
        } else {
            existingSessionPopup.addItems(withTitles: labels)
            workspaceSessionPopup.addItems(withTitles: labels)
            existingSessionPopup.isEnabled = true
            workspaceSessionPopup.isEnabled = true
            if let selectedDraftSessionID,
               let index = sessions.firstIndex(where: { $0.id == selectedDraftSessionID }) {
                existingSessionPopup.selectItem(at: index)
            } else {
                existingSessionPopup.selectItem(at: 0)
                selectedDraftSessionID = sessions.first?.id
            }
            if let selectedWorkspaceSessionID,
               let index = sessions.firstIndex(where: { $0.id == selectedWorkspaceSessionID }) {
                workspaceSessionPopup.selectItem(at: index)
            } else {
                workspaceSessionPopup.selectItem(at: 0)
                selectedWorkspaceSessionID = sessions.first?.id
            }
        }
        refreshDraftSessionUI()
    }

    private func refreshDraftSessionUI() {
        let showingExisting = sessionSelectionMode == .existing
        existingSessionPopup.isHidden = !showingExisting
        sessionTitleField.superview?.isHidden = showingExisting
        projectFolderField.superview?.isHidden = showingExisting
        githubRepoField.superview?.isHidden = showingExisting
        if showingExisting && sessions.isEmpty {
            draftSummaryLabel.stringValue = "No existing sessions yet. Switch to New session, then save this capture."
        } else if draftCapture == nil {
            draftSummaryLabel.stringValue = "Capture a screen or window, then add annotation notes."
        }
    }

    private func refreshDraftAnnotationUI() {
        annotationPopup.removeAllItems()
        annotationPopup.addItem(withTitle: "New annotation note")
        if draftAnnotations.isEmpty {
            selectedDraftAnnotationID = nil
            annotationPopup.selectItem(at: 0)
            deleteAnnotationButton.isEnabled = false
            applyAnnotationButton.title = "Add Note"
        } else {
            for (index, note) in draftAnnotations.enumerated() {
                annotationPopup.addItem(withTitle: "Note \(index + 1): \(note.text.prefix(36))")
            }
            if let selectedDraftAnnotationID,
               let index = draftAnnotations.firstIndex(where: { $0.id == selectedDraftAnnotationID }) {
                annotationPopup.selectItem(at: index + 1)
                annotationTextView.string = draftAnnotations[index].text
            } else {
                annotationPopup.selectItem(at: 0)
            }
            deleteAnnotationButton.isEnabled = selectedDraftAnnotationID != nil
            applyAnnotationButton.title = selectedDraftAnnotationID == nil ? "Add Note" : "Update Note"
        }
        refreshDraftSaveState()
    }

    private func refreshDraftSaveState() {
        let hasSessionTarget = sessionSelectionMode == .new
            ? !sessionTitleField.stringValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            : selectedDraftSessionID != nil && !sessions.isEmpty
        saveDraftButton.isEnabled = draftCapture != nil && !draftAnnotations.isEmpty && hasSessionTarget
    }

    private func refreshWorkspaceUI() {
        let session = workspaceSelectedSession()
        providerControl.selectedSegment = selectedProviderSegment
        if let session {
            let latestCapture = session.captures.first
            workspaceSummaryLabel.stringValue = """
            \(session.title) · \(session.captures.count) capture(s) · \(session.annotationCount) annotation(s)
            Repo: \(session.githubRepo.isEmpty ? "not set" : session.githubRepo)
            Folder: \(session.projectFolder.isEmpty ? "not set" : session.projectFolder)
            Latest source: \(latestCapture?.sourceLabel ?? "none")
            """
            promptPreviewView.string = promptPreview(for: session)
        } else {
            workspaceSummaryLabel.stringValue = "No native sessions saved yet."
            promptPreviewView.string = ""
        }
        let connected = connectedProviders.contains(selectedProvider)
        providerStatusLabel.stringValue = connected
            ? "\(selectedProvider.displayName) is marked connected. Review the prompt, then prepare the payload."
            : "\(selectedProvider.displayName) is not connected yet. Use the button below to simulate first-time linking in this prototype."
        connectProviderButton.title = connected ? "Mark Target Disconnected" : "Mark Target Connected"
        sendButton.isEnabled = session != nil
    }

    private func clearDraftAfterSave() {
        draftAnnotations = []
        selectedDraftAnnotationID = nil
        annotationTextView.string = ""
        draftCapture = nil
        previewView.image = nil
        refreshDraftAnnotationUI()
        refreshDraftSaveState()
        if sessionSelectionMode == .new {
            sessionTitleField.stringValue = ""
            projectFolderField.stringValue = ""
            githubRepoField.stringValue = ""
        }
        draftSummaryLabel.stringValue = "Capture another screen or window to continue building the session."
    }

    private func selectedSource() -> CaptureSource? {
        if captureMode == .visibleArea {
            return sources.first
        }
        let index = sourcePopup.indexOfSelectedItem
        guard index >= 0, index < sources.count else { return nil }
        return sources[index]
    }

    private func workspaceSelectedSession() -> NativeSessionRecord? {
        sessions.first(where: { $0.id == selectedWorkspaceSessionID })
    }

    private func selectedDraftAnnotation() -> NativeAnnotationNote? {
        guard annotationPopup.indexOfSelectedItem > 0 else { return nil }
        let index = annotationPopup.indexOfSelectedItem - 1
        guard index >= 0, index < draftAnnotations.count else { return nil }
        return draftAnnotations[index]
    }

    private func promptPreview(for session: NativeSessionRecord?) -> String {
        guard let session else {
            return "Choose a saved session to generate a provider-ready prompt preview."
        }
        let lines = session.captures.prefix(3).enumerated().map { index, capture in
            let noteBlock = capture.annotations.prefix(4).enumerated().map { noteIndex, note in
                "\(noteIndex + 1). \(note.text)"
            }.joined(separator: "\n")
            let path = sessionStore.absoluteCaptureURL(for: capture.screenshotRelativePath).path
            return """
            Capture \(index + 1): \(capture.sourceLabel)
            Validation: \(capture.validationSummary)
            Screenshot: \(path)
            Notes:
            \(noteBlock)
            """
        }.joined(separator: "\n\n")

        return """
        Target: \(selectedProvider.displayName)
        Session: \(session.title)
        Project folder: \(session.projectFolder.isEmpty ? "not provided" : session.projectFolder)
        GitHub repo: \(session.githubRepo.isEmpty ? "not provided" : session.githubRepo)

        Latest captures:
        \(lines.isEmpty ? "No captures yet." : lines)
        """
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

    private func hintText(for mode: CaptureMode, count: Int) -> String {
        switch mode {
        case .visibleArea:
            return "Default path: capture the screen under the mouse pointer, then add native notes before saving into a session."
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

    private func sectionBox(title: String, views: [NSView]) -> NSBox {
        let box = NSBox()
        box.title = title
        box.boxType = .custom
        box.borderWidth = 1
        box.borderColor = NSColor.separatorColor
        box.cornerRadius = 12
        let stack = NSStackView(views: views)
        stack.orientation = .vertical
        stack.spacing = 10
        stack.alignment = .leading
        stack.translatesAutoresizingMaskIntoConstraints = false
        box.contentView?.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: box.contentView!.leadingAnchor, constant: 14),
            stack.trailingAnchor.constraint(equalTo: box.contentView!.trailingAnchor, constant: -14),
            stack.topAnchor.constraint(equalTo: box.contentView!.topAnchor, constant: 14),
            stack.bottomAnchor.constraint(equalTo: box.contentView!.bottomAnchor, constant: -14),
        ])
        return box
    }

    private func labeledField(title: String, field: NSTextField, placeholder: String) -> NSView {
        let label = NSTextField(labelWithString: title)
        label.font = .systemFont(ofSize: 12, weight: .semibold)
        field.placeholderString = placeholder
        let stack = NSStackView(views: [label, field])
        stack.orientation = .vertical
        stack.spacing = 4
        stack.alignment = .leading
        return stack
    }

    private func scrollView(for textView: NSTextView, height: CGFloat) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        scroll.documentView = textView
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.heightAnchor.constraint(equalToConstant: height).isActive = true
        return scroll
    }
}

private extension Collection {
    subscript(safe index: Index) -> Element? {
        indices.contains(index) ? self[index] : nil
    }
}
