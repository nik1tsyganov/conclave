import CoreGraphics
import Foundation
// Window ids belonging to one process, so a screenshot can be of that window alone rather
// than of whatever else is on the user's screen.
let pid = Int32(CommandLine.arguments.dropFirst().first ?? "0") ?? 0
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
for window in list {
    guard let owner = window[kCGWindowOwnerPID as String] as? Int32, owner == pid,
          let id = window[kCGWindowNumber as String] as? Int else { continue }
    let bounds = window[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let name = window[kCGWindowName as String] as? String ?? ""
    print("\(id)\t\(Int(bounds["Width"] as? Double ?? 0))x\(Int(bounds["Height"] as? Double ?? 0))\t\(name)")
}
