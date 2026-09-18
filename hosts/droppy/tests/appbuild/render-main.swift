import AppKit
import SwiftUI

// Renders a settings page straight to a PNG with ImageRenderer.
//
// Why not a screenshot: capturing a window, and the app's own capture harness, both need
// Screen Recording permission, which is the user's to grant and not worth asking for to look
// at a page. ImageRenderer draws the view itself, needs no permission, and shows the same
// layout the app would.
//
// It runs as a capture run (`--website-captures`), so it reads its own defaults suite and its
// own storage folder and never touches the real settings, library or keychain.

@MainActor
func render() {
    let model = AppModel()
    // A panel to look at: three seats, one per vendor, with a job written on one of them and
    // a set of skills chosen, so the page is drawn with something in it rather than empty.
    model.settings.brainsEnabled = true
    model.settings.brainsSkillMode = .perSeat
    model.settings.updateBrain(.ponens) { $0.charter = "Be the one who gets it done." }
    model.settings.updateBrain(.advocatus) { $0.maxHeads = 2 }

    // A verdict worth looking at: one vote counted as declared, one approval downgraded for
    // having no reason of its own, and one seat that could not prove itself. Those are the
    // three cases the card has to make legible.
    var unit = BrainsUnit(id: "U1", task: "Add a median helper", brief: "1. Add median(values) to stats.py.",
                          files: ["stats.py"], test: "./check.sh")
    unit.builder = .ponens
    unit.checkers = [BrainsSeatPlan(role: .verify, slot: .scrutator), BrainsSeatPlan(role: .review, slot: .advocatus)]

    func receipt(_ slot: Brain.Slot, _ provider: ProviderKind, _ role: BrainsRole, _ position: BrainsPosition?,
                 _ evidence: String?, proved: Bool = true) -> BrainsReceipt {
        var brain = Brain(slot: slot)
        brain.provider = provider
        var receipt = BrainsReceipt(unitID: "U1", role: role, brain: brain)
        receipt.status = .completed
        receipt.position = position
        receipt.evidence = evidence
        receipt.treeBefore = "a"
        receipt.treeAfter = "a"
        if proved {
            receipt.sessionID = "session-\(slot.rawValue)"
            receipt.tokens = 24_000
            receipt.modelObserved = "model"
        }
        return receipt
    }
    let receipts = [
        receipt(.ponens, .codex, .implement, nil, nil),
        receipt(.scrutator, .claude, .verify, .approve,
                "I traced median([4,1,3,2]) by hand through stats.py:13-17 to 2.5, and the mutation test at test_stats.py:22 would fail under an in-place sort."),
        receipt(.advocatus, .antigravity, .review, .approve, "Looks good to me, nice work."),
    ]
    let verdict = BrainsTally.verdict(receipts)

    // The panel a lead shows while its seats work, which until this change drew nothing at
    // all for a seat: three seat threads under one lead, at three points of a run.
    let project = model.addProject(at: URL(fileURLWithPath: NSTemporaryDirectory()))
    let lead = model.newThread(in: project)
    if let lead {
        model.enterThreeBrains(for: lead.id)
        let seats: [(Brain.Slot, ProviderKind, BrainsRole, BrainsSeatStatus, BrainsPosition?, String?)] = [
            (.ponens, .codex, .implement, .completed, nil, nil),
            (.scrutator, .claude, .verify, .completed, .approve, "The six tests in test_stats.py pass, the even-length case included."),
            (.advocatus, .antigravity, .review, .running, nil, nil),
        ]
        for (slot, provider, role, status, position, evidence) in seats {
            var brain = Brain(slot: slot)
            brain.provider = provider
            var seatThread = ChatThread(projectID: project.id, provider: provider, model: nil,
                                        effort: "high",
                                        runtimeMode: role == .implement ? .fullAccess : .supervised)
            seatThread.parentThreadID = lead.id
            seatThread.isInPanel = true
            seatThread.hydraEnabled = false
            seatThread.title = "\(brain.displayName) · \(role.panelWord) U1"
            seatThread.hasCustomTitle = true
            var info = BrainsSeatInfo(runID: UUID(), unitID: "U1", role: role, brain: brain)
            info.receipt.status = status
            info.receipt.position = position
            info.receipt.evidence = evidence
            info.receipt.tokens = 34_000
            info.receipt.startedAt = Date.now.addingTimeInterval(-95)
            info.receipt.finishedAt = status == .running ? nil : Date.now.addingTimeInterval(-20)
            seatThread.brains = info
            model.insertThread(seatThread)
        }
    }

    let pages: [(String, AnyView)] = [
        ("three-brains-settings", AnyView(ThreeBrainsSettingsPage())),
        ("three-brains-verdict", AnyView(BrainsVerdictCard(unit: unit, verdict: verdict,
                                                           seats: verdict.lines(from: receipts)))),
        ("three-brains-panel", lead.map { lead in
            AnyView(HydraPanel(
                runtime: model.runtime(for: lead.id),
                heads: model.brainsSeats(of: lead.id),
                size: CGSize(width: 380, height: 430),
                workingDirectory: nil,
                projectName: "stats",
                onDrag: { _ in }, onDragEnd: {}, dismiss: {}
            )
            .environment(WindowLiveResize(window: NSWindow()))
            .frame(width: 380, height: 430))
        } ?? AnyView(EmptyView())),
    ]
    for (name, page) in pages {
        // No ScrollView: an image pass renders one laid-out tree, and a scroll container
        // comes out empty. The page is drawn at its natural height instead.
        let view = VStack(alignment: .leading, spacing: 18) { page }
            .padding(20)
            .frame(width: 720, alignment: .leading)
            .environment(model)
            .environment(\.colorScheme, .dark)
            .background(Color(red: 0.11, green: 0.11, blue: 0.12))

        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        guard let image = renderer.nsImage,
              let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else {
            FileHandle.standardError.write(Data("could not render \(name)\n".utf8))
            continue
        }
        let url = URL(fileURLWithPath: "\(name).png")
        try? png.write(to: url)
        print("wrote \(url.lastPathComponent) (\(Int(image.size.width))x\(Int(image.size.height)) points)")
    }
}

@main
enum RenderPages {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        MainActor.assumeIsolated { render() }
        exit(0)
    }
}
