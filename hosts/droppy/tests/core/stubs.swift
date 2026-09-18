// Harness-only stand-in, copied field for field from `Timeline.swift`. `Text.swift` hangs
// its diff-stats type off `FileEdit`, and the real one sits behind the whole timeline model.
// Nothing under test touches it, so the harness declares the shape rather than dragging the
// app in.
struct FileEdit: Codable, Hashable, Sendable {
    var path: String
    var diff: String?
    var additions = 0
    var deletions = 0
}
