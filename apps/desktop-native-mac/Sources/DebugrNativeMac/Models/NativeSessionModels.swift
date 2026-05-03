import Foundation

enum ProviderTarget: String, CaseIterable, Codable, Sendable {
    case claude
    case codex
    case cursor

    var displayName: String {
        switch self {
        case .claude:
            return "Claude"
        case .codex:
            return "Codex"
        case .cursor:
            return "Cursor"
        }
    }
}

struct NativeAnnotationNote: Identifiable, Codable, Hashable, Sendable {
    let id: String
    var text: String
    let createdAt: Date
    var updatedAt: Date

    init(id: String = UUID().uuidString, text: String, createdAt: Date = Date(), updatedAt: Date = Date()) {
        self.id = id
        self.text = text
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

struct NativeCaptureRecord: Identifiable, Codable, Sendable {
    let id: String
    let sourceKind: String
    let sourceLabel: String
    let screenshotRelativePath: String
    let validationSummary: String
    var annotations: [NativeAnnotationNote]
    let createdAt: Date

    init(
        id: String = UUID().uuidString,
        sourceKind: String,
        sourceLabel: String,
        screenshotRelativePath: String,
        validationSummary: String,
        annotations: [NativeAnnotationNote],
        createdAt: Date = Date()
    ) {
        self.id = id
        self.sourceKind = sourceKind
        self.sourceLabel = sourceLabel
        self.screenshotRelativePath = screenshotRelativePath
        self.validationSummary = validationSummary
        self.annotations = annotations
        self.createdAt = createdAt
    }
}

struct NativeSessionRecord: Identifiable, Codable, Sendable {
    let id: String
    var title: String
    var projectFolder: String
    var githubRepo: String
    var captures: [NativeCaptureRecord]
    let createdAt: Date
    var updatedAt: Date
    var lastTarget: ProviderTarget?

    init(
        id: String = UUID().uuidString,
        title: String,
        projectFolder: String = "",
        githubRepo: String = "",
        captures: [NativeCaptureRecord] = [],
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        lastTarget: ProviderTarget? = nil
    ) {
        self.id = id
        self.title = title
        self.projectFolder = projectFolder
        self.githubRepo = githubRepo
        self.captures = captures
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.lastTarget = lastTarget
    }

    var annotationCount: Int {
        captures.reduce(0) { $0 + $1.annotations.count }
    }
}
