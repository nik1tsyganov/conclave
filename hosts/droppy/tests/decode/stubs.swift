// Harness-only stand-ins for types Library.swift touches that live behind the app's own
// modules. None of them takes part in what is being tested.
enum PanelDockCorner: String, Codable { case bottomTrailing }
