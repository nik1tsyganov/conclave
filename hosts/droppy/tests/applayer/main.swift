import AppKit
import Foundation
import SwiftUI

// The App layer of Three Brains, driven through the calls a live chat makes.
//
// The other suites reach the Core types and the Services runner. Everything between a lead's
// reply and a seat starting work lives in `ThreadRuntime` and `AppModel`, and until this
// existed none of it had ever run: the policy had no measured caller, the block reader had no
// measured caller, and no seat thread had ever been made. Each of those is a place where the
// feature can be complete and still do nothing.
//
// Nothing here starts a vendor session. The seats are pointed at providers that are not set
// up in this run, so the panel stops at its own readiness gate and says so, which is the last
// observable point before a CLI would be spawned. What a real panel does past that point is
// what the live matrix measures.

@MainActor var failures = 0
@MainActor var checks = 0

@MainActor
func check(_ condition: Bool, _ label: String, line: UInt = #line) {
    checks += 1
    if !condition { failures += 1; FileHandle.standardError.write(Data("FAIL \(label)  (line \(line))\n".utf8)) }
}

@MainActor
func equal<T: Equatable>(_ lhs: T, _ rhs: T, _ label: String, line: UInt = #line) {
    checks += 1
    if lhs != rhs { failures += 1; FileHandle.standardError.write(Data("FAIL \(label)\n  got:      \(lhs)\n  expected: \(rhs)\n  (line \(line))\n".utf8)) }
}

@MainActor
func section(_ name: String) { print("— \(name)") }

/// A lead in the panel, in a project of its own, with nothing else in the app.
@MainActor
func makeLead(_ model: AppModel, named name: String) -> ChatThread {
    let folder = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("brains-applayer-\(name)-\(UUID().uuidString)")
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let project = model.addProject(at: folder)
    guard let thread = model.newThread(in: project) else { fatalError("no thread") }
    model.enterThreeBrains(for: thread.id)
    return model.thread(thread.id) ?? thread
}

/// A finished reply, through the same events a provider sends. This is the path that ends in
/// the turn-end branch that reads the block.
@MainActor
func reply(_ runtime: ThreadRuntime, _ text: String, ask: String = "do the thing") async {
    runtime.rehearseTurn(ask)
    runtime.rehearse(.sessionReady(sessionID: "session-\(UUID().uuidString.prefix(8))"))
    runtime.rehearse(.messageCompleted(id: UUID().uuidString, text: text))
    runtime.rehearse(.turnCompleted(status: .completed, error: nil))
    // A turn ends asynchronously: the diff is read, the summary is appended and only then is
    // the block looked at. Waiting for the turn to go idle is waiting for that to have run.
    await settle(runtime)
}

/// Waits for a runtime to finish whatever the last event started, or gives up saying so.
@MainActor
func settle(_ runtime: ThreadRuntime, seconds: Double = 8) async {
    let deadline = Date.now.addingTimeInterval(seconds)
    while Date.now < deadline {
        try? await Task.sleep(for: .milliseconds(50))
        if runtime.phase == .idle || runtime.phase == .starting { break }
    }
    // A moment more for the work the turn's end hands off: the panel's own task, and the
    // refusal turn it may queue.
    try? await Task.sleep(for: .milliseconds(250))
}

@MainActor
func assistantText(_ runtime: ThreadRuntime) -> String {
    for entry in runtime.entries.reversed() {
        if case .assistant(let message) = entry.item.content { return message.text }
    }
    return ""
}

@MainActor
func userTexts(_ runtime: ThreadRuntime) -> [String] {
    runtime.entries.compactMap { entry in
        if case .user(let message) = entry.item.content { return message.text }
        return nil
    }
}

@MainActor
func cards(_ runtime: ThreadRuntime) -> [BrainsPanelVerdict] {
    runtime.entries.compactMap { entry in
        if case .brains(let panel) = entry.item.content { return panel }
        return nil
    }
}

let twoUnits = """
I have split this in two.

```brains
[{"unit": "U1", "task": "Add the flag", "files": ["a.swift"], "test": "swift build", "brief": "1. Add it."},
 {"unit": "U2", "task": "Read the flag", "files": ["b.swift"], "brief": "1. Read it."}]
```
"""

@MainActor
func run() async {
    // The capture run's defaults suite is a fixed name, so a value written by the last run of
    // this binary would otherwise be read as the app's own default.
    if let defaults = CaptureRun.defaults {
        for key in defaults.dictionaryRepresentation().keys { defaults.removeObject(forKey: key) }
    }
    let model = AppModel()
    // A panel's working folders sit beside the app's worktrees, which a capture run does not
    // redirect. Whatever this run makes there, it takes away again.
    let runRoot = Storage.worktreesDirectory.deletingLastPathComponent().appendingPathComponent("three-brains")
    let before = Set((try? FileManager.default.contentsOfDirectory(atPath: runRoot.path)) ?? [])
    defer {
        let after = Set((try? FileManager.default.contentsOfDirectory(atPath: runRoot.path)) ?? [])
        for made in after.subtracting(before) {
            try? FileManager.default.removeItem(at: runRoot.appendingPathComponent(made))
        }
    }

    // MARK: - A chat in the panel is told it leads one

    section("a chat in the panel is told it leads one")

    let lead = makeLead(model, named: "policy")
    check(model.brainsIsOn(model.thread(lead.id) ?? lead), "a chat put in the panel is in it")
    check(model.settings.brainsEnabled, "and the feature is on")

    // The policy is what a lead is given in front of its own words. No provider has a native
    // form of it, because the seats are separate sessions the app runs.
    let policy = BrainsPrompts.leadPolicy(brains: model.brainsPanel, runsTests: model.settings.brainsRunsTests,
                                          criticalTwoReviews: model.settings.brainsCriticalTwoReviews,
                                          projectPath: model.project(lead.projectID)?.path ?? "")
    check(policy.contains("```brains"), "the policy asks for the block the reader accepts")
    equal(BrainsBlock.units(in: policy)?.count, 1, "and its example parses")

    let plain = makeLead(model, named: "plain")
    model.leaveThreeBrains(for: plain.id)
    check(!model.brainsIsOn(model.thread(plain.id) ?? plain), "a chat taken out of the panel is out of it")

    // MARK: - A reply with a block sends units out

    section("a reply with a block sends units out")

    let sender = makeLead(model, named: "sender")
    let senderRuntime = model.runtime(for: sender.id)
    await reply(senderRuntime, twoUnits)
    let sent = assistantText(senderRuntime)
    check(!BrainsBlock.hasBlock(in: sent), "the block leaves the reply once the turn ends")
    check(sent.contains("I have split this in two."), "and the lead's own words stay")
    check(!sent.isEmpty, "a reply is never left empty")

    // Nothing ran: the seats sit on providers this run has not set up, so the panel stops at
    // its readiness gate. That the gate is what stopped it, and that the lead was told, is the
    // last thing observable here without spending a vendor turn.
    // With no rules service on the machine, nothing is routed and the lead is told why rather
    // than left waiting. This is the first thing a user without CONCLAVE installed would hit.
    let withoutService = userTexts(senderRuntime).joined(separator: "\n")
    check(withoutService.contains("rules service is not installed"), "a lead is told when the rules service is missing")
    check(withoutService.contains("conclave"), "and how to get it")

    // And with it: the checkout is named, so routing really goes over MCP to the real server.
    // The project folder is deliberately not a git repository, so the run gets as far as
    // trying to copy it and no vendor session is ever started. Reaching that point at all
    // means the client spawned the server, shook hands, and got its units back routed.
    let routedLead = makeLead(model, named: "routed")
    let liveRuntime = model.runtime(for: routedLead.id)
    // The checkout this machine keeps CONCLAVE in. Override with CONCLAVE_CHECKOUT so a
    // moved or renamed checkout turns into a setting, not a silently skipped check.
    model.settings.brainsRulesCheckout =
        ProcessInfo.processInfo.environment["CONCLAVE_CHECKOUT"] ?? "~/src/conclave"
    await reply(liveRuntime, twoUnits)
    try? await Task.sleep(for: .seconds(3))
    let told = userTexts(liveRuntime).joined(separator: "\n")
    if told.contains("rules service") {
        print("   NOT RUN: the rules service could not be reached, so routing over MCP is unproven here")
    } else {
        check(told.contains("could not make a copy"), "routing came back from the service and the run went on")
        check(told.contains("U1") && told.contains("U2"), "both units were routed")
        check(told.contains("reached no verdict"), "and the lead is given it as something to answer")
        check(told.contains("Do not report this as done"), "with what not to do about it")
    }

    // MARK: - A block that cannot be read is answered once

    section("a block that cannot be read is answered once")

    let broken = makeLead(model, named: "broken")
    let brokenRuntime = model.runtime(for: broken.id)
    await reply(brokenRuntime, "Here you go.\n\n```brains\nunit one: add the flag\n```")
    let brokenText = assistantText(brokenRuntime)
    check(!BrainsBlock.hasBlock(in: brokenText), "an unreadable block leaves the reply too")
    let refusal = userTexts(brokenRuntime).joined(separator: "\n")
    check(refusal.contains("brains"), "and the lead is told what to write instead")
    check(refusal.contains("unit") || refusal.contains("task"), "in terms of the fields it needs")

    // MARK: - A block asking for nothing is a lead saying it did the work

    section("a block asking for nothing")

    let empty = makeLead(model, named: "empty")
    let emptyRuntime = model.runtime(for: empty.id)
    await reply(emptyRuntime, "I did this myself.\n\n```brains\n[]\n```")
    equal(assistantText(emptyRuntime), "I did this myself.", "the words stay and the empty block goes")
    let note = userTexts(emptyRuntime).joined(separator: "\n")
    check(note.contains("No units went out"), "and a note says nothing was sent")
    check(!note.contains("could not be read"), "which is not the same as an unreadable block")

    // MARK: - A chat that is not in the panel is left alone

    section("a chat that is not in the panel")

    let outside = makeLead(model, named: "outside")
    model.leaveThreeBrains(for: outside.id)
    let outsideRuntime = model.runtime(for: outside.id)
    await reply(outsideRuntime, twoUnits)
    check(BrainsBlock.hasBlock(in: assistantText(outsideRuntime)),
          "a block in a chat outside the panel is left exactly as the model wrote it")

    // MARK: - A verdict card goes in the lead's timeline

    section("a verdict card in the timeline")

    let shown = makeLead(model, named: "card")
    let shownRuntime = model.runtime(for: shown.id)
    var unit = BrainsUnit(id: "U1", task: "Add a median", brief: "1. Add it.", files: ["stats.py"])
    var receipts: [BrainsReceipt] = []
    for (slot, provider, role, position, evidence) in [
        (Brain.Slot.ponens, ProviderKind.codex, BrainsRole.implement, BrainsPosition?.none, String?.none),
        (.scrutator, .claude, .verify, .approve, "Six tests in stats_test.py pass, the even case included."),
        (.advocatus, .antigravity, .review, .approve, nil),
    ] {
        var brain = Brain(slot: slot)
        brain.provider = provider
        var made = BrainsReceipt(unitID: unit.id, role: role, brain: brain)
        made.status = .completed
        made.position = position
        made.evidence = evidence
        made.sessionID = "s-\(slot.rawValue)"
        made.tokens = 1_000
        made.modelObserved = "a-model"
        made.treeBefore = "a"
        made.treeAfter = "a"
        receipts.append(made)
    }
    // The count is CONCLAVE's; what this suite checks is that the app puts it in the timeline.
    let verdict = BrainsVerdict(outcome: .deadlock, approve: 1, reject: 0, abstain: 1,
                                independence: .crossVendor,
                                adjustments: [BrainsAdjustment(slot: .advocatus, brainName: "Advocatus",
                                                               role: .review, declared: .approve,
                                                               counted: .abstain, reason: "gave no evidence line")],
                                uncounted: [], flags: [])
    shownRuntime.appendBrainsVerdict(BrainsPanelVerdict(unit: unit, verdict: verdict,
                                                        seats: verdict.lines(from: receipts)))
    let shownCards = cards(shownRuntime)
    equal(shownCards.count, 1, "the card is in the timeline")
    equal(shownCards.first?.unit.id, "U1", "for the unit it decided")
    equal(shownCards.first?.seats.count, 3, "with a line per seat")
    equal(shownCards.first?.verdict.outcome, BrainsVerdict.Outcome.deadlock,
          "one counted approval is not a passage")

    // A card belongs to the chat: it survives a save and comes back the same.
    var document = ThreadDocument(threadID: shown.id)
    document.items = shownRuntime.entries.map(\.item)
    let encoded = try? JSONEncoder.storage.encode(document)
    let decoded = encoded.flatMap { try? JSONDecoder.storage.decode(ThreadDocument.self, from: $0) }
    equal(decoded?.items.compactMap { item -> BrainsPanelVerdict? in
        if case .brains(let panel) = item.content { return panel }
        return nil
    }.count, 1, "and comes back after a save")

    // MARK: - Seats are threads under the lead

    section("seats are threads under the lead")

    let host = makeLead(model, named: "seats")
    equal(model.brainsSeats(of: host.id).count, 0, "a lead with no seats has none")

    // The real thing: `makeSession` is what the runner calls for every seat, and it is what
    // gives a seat its chat. Making the session object starts no process, so this exercises
    // the spawn without spending a vendor turn.
    model.brainsRunningLead = host.id
    model.brainsRunID = UUID()
    var brain = Brain(slot: .scrutator)
    brain.provider = .claude
    let verifySeat = BrainsRunner.Seat(unitID: "U1", role: .verify, brain: brain)
    var builderBrain = Brain(slot: .ponens)
    builderBrain.provider = .codex
    let buildSeat = BrainsRunner.Seat(unitID: "U2", role: .implement, brain: builderBrain)
    let folder = URL(fileURLWithPath: model.project(host.projectID)?.path ?? NSTemporaryDirectory())
    for (seat, brief) in [(verifySeat, "Read this and vote."), (buildSeat, "Build this.")] {
        let configuration = SessionConfiguration(
            provider: seat.brain.provider, executable: nil, workingDirectory: folder,
            environment: [:], runtimeMode: seat.role == .implement ? .fullAccess : .supervised,
            interactionMode: .build)
        _ = model.makeSession(configuration, seat: seat, brief: brief)
    }
    let seats = model.brainsSeats(of: host.id)
    equal(seats.count, 2, "every seat gets a chat under its lead")
    check(seats.allSatisfy(\.isBrainsSeat), "each reads as a seat")
    check(seats.allSatisfy { $0.isInPanel }, "each is in the lead's panel")
    check(seats.allSatisfy { $0.parentThreadID == host.id }, "and under that lead and no other")
    check(seats.allSatisfy { !$0.hydraEnabled }, "a seat is never also a Hydra lead")
    equal(model.brainsSeats(of: host.id, unit: "U1").count, 1, "a seat is findable by its unit")
    equal(model.brainsSeats(of: host.id, unit: "U3").count, 0, "and not by another's")
    let verifyThread = seats.first { $0.brains?.role == .verify }
    equal(verifyThread?.brains?.receipt.provider, ProviderKind.claude, "a seat keeps the vendor it was given")
    equal(verifyThread?.brains?.slot, Brain.Slot.scrutator, "and the slot it sits in")
    equal(verifyThread?.runtimeMode, RuntimeMode.supervised, "a checking seat runs supervised")
    equal(seats.first { $0.brains?.role == .implement }?.runtimeMode, RuntimeMode.fullAccess,
          "and a building seat does not")
    check(verifyThread?.title.contains("verifies U1") == true, "its title says what it does")

    // The brief is the first thing in its chat, the way a Hydra head's is.
    if let verifyThread {
        check(userTexts(model.runtime(for: verifyThread.id)).contains("Read this and vote."),
              "a seat's brief is at the top of its chat")

        // And what the session says fills the timeline, through the same replay a live seat uses.
        // A seat's session events reach its chat through the runner's observer. Building a
        // runner here would need a rules service; what matters is the replay, so the runtime
        // is given the event directly, which is what the observer does with it.
        model.runtime(for: verifyThread.id).rehearse(.messageCompleted(id: "m1", text: "POSITION: APPROVE"))
        check(assistantText(model.runtime(for: verifyThread.id)).contains("APPROVE"),
              "and what its session says lands in it")
    } else {
        check(false, "there is a verifying seat to look at")
    }
    model.brainsRunningLead = nil

    // MARK: - The record, written by the app's own path

    section("the record")

    check(!model.settings.brainsKeepsRecord, "no record is kept unless it is asked for")
    model.settings.brainsKeepsRecord = true
    check(model.settings.brainsKeepsRecord, "and the setting holds")

    // The numbers a user can set are clamped on the way in, both ends.
    model.settings.brainsUnitsAtOnce = 99
    equal(BrainsLimits.unitsAtOnce.clamped(model.settings.brainsUnitsAtOnce), BrainsLimits.maxConcurrentSeats,
          "a units-at-once above the ceiling comes back to it")
    model.settings.brainsSeatMinutes = 0
    equal(BrainsLimits.seatMinutes.clamped(model.settings.brainsSeatMinutes), BrainsLimits.seatMinutes.lowest,
          "and a seat ceiling below the floor comes back up")
    equal(BrainsRunner.Limits.minutes(30).wall, 30 * 60, "the ceiling the user set is the ceiling a seat gets")
    equal(BrainsRunner.Limits.minutes(30).idle, 10 * 60, "and silence is a third of it")

    if CommandLine.arguments.contains("--live") { await liveUnit(model) }

    print("\(checks - failures)/\(checks) checks passed")
    if failures > 0 {
        FileHandle.standardError.write(Data("\(failures) FAILURES\n".utf8))
        exit(1)
    }
}

/// One real unit, through the app's own path, with real vendors.
///
/// Everything above stops where a CLI would start. This is the other side of that line: it
/// runs `AppModel.runBrainsUnits` on a real git checkout and checks what the app did with the
/// result, which is the only way to see a seat's chat fill, a card reach the lead's timeline,
/// a report come back as a turn and the record be written by the app rather than a harness.
/// It spends subscription capacity, three CLI turns, so it runs only with `--live`.
@MainActor
func liveUnit(_ model: AppModel) async {
    section("one real unit, end to end")

    let folder = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("brains-live-\(UUID().uuidString)")
    try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let git = { (command: String) in
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", command]
        process.currentDirectoryURL = folder
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try? process.run()
        process.waitUntilExit()
    }
    try? "def total(values):\n    return sum(values)\n".write(to: folder.appendingPathComponent("adding.py"), atomically: true, encoding: .utf8)
    git("git init -q . && git add -A && git -c user.name=t -c user.email=t@t commit -q -m base")

    let project = model.addProject(at: folder)
    guard let leadThread = model.newThread(in: project) else { return check(false, "a lead exists") }
    model.enterThreeBrains(for: leadThread.id)
    model.settings.brainsKeepsRecord = true
    // One vendor in all three seats. What this tier proves is the app's own path, and which
    // vendor sits where is what the live matrix is for; a single vendor makes the run short
    // and keeps it out of whatever any one machine's vendor config is doing. `--live-panel`
    // names another.
    var liveVendor = ProviderKind.claude
    if let flag = CommandLine.arguments.firstIndex(of: "--live-panel"),
       CommandLine.arguments.indices.contains(flag + 1),
       let named = ProviderKind(rawValue: CommandLine.arguments[flag + 1]) {
        liveVendor = named
    }
    for slot in Brain.Slot.allCases {
        model.settings.updateBrain(slot) { $0 = $0.pointing(at: liveVendor) }
    }
    // The checks above left the ceiling at its floor on purpose; a real seat needs room.
    model.settings.brainsSeatMinutes = BrainsLimits.seatMinutes.standard
    model.settings.brainsUnitsAtOnce = BrainsLimits.unitsAtOnce.standard
    guard model.brainsReadiness.canRun else {
        return check(false, "every seat's vendor is ready: \(model.brainsReadiness.words)")
    }

    let unit = BrainsUnit(
        id: "L1", task: "Add a doubling helper",
        brief: "1. In `adding.py`, below `total`, add a function `twice(value)` that returns the value added to itself.\n2. Change no other file.",
        files: ["adding.py"]
    )
    await model.runBrainsUnits([unit], for: leadThread.id)

    // A seat per role, each with a chat of its own under the lead.
    let seats = model.brainsSeats(of: leadThread.id)
    equal(seats.count, 3, "one seat per role, each with a chat")
    check(seats.contains { $0.brains?.role == .implement }, "one built it")
    check(seats.contains { $0.brains?.role == .verify }, "one verified it")
    check(seats.contains { $0.brains?.role == .review }, "one reviewed it")
    for seat in seats {
        let seatRuntime = model.runtime(for: seat.id)
        check(!userTexts(seatRuntime).isEmpty, "\(seat.brains?.receipt.brainName ?? "a seat") has its brief")
        check(!assistantText(seatRuntime).isEmpty, "\(seat.brains?.receipt.brainName ?? "a seat") has what it said")
        check(seat.panelInfo != nil, "and a row the panel can draw")
    }

    // Vendor-native proof, per seat. Without it a vote does not count and the run is a story.
    let outcome = model.brainsOutcomes["L1"]
    check(outcome != nil, "the unit reached an outcome")
    for receipt in outcome?.receipts ?? [] {
        print("   \(receipt.brainName) \(receipt.role.rawValue) on \(receipt.provider.displayName): \(receipt.status.rawValue), \(receipt.modelObserved ?? "no model observed"), \(receipt.tokens.map(String.init) ?? "no") tokens\(receipt.position.map { ", \($0.rawValue)" } ?? "")\(receipt.voidReason.map { ", void: \($0)" } ?? "")")
    }
    for receipt in outcome?.receipts ?? [] {
        check(receipt.sessionID?.isEmpty == false, "\(receipt.brainName) proves its session")
        check((receipt.tokens ?? 0) > 0, "\(receipt.brainName) proves its tokens")
        check(receipt.modelObserved?.isEmpty == false, "\(receipt.brainName) proves which model answered")
    }

    // The card in the lead's timeline, and the report as its next turn.
    let leadRuntime = model.runtime(for: leadThread.id)
    let leadCards = cards(leadRuntime)
    equal(leadCards.count, 1, "the verdict is a card in the lead's timeline")
    equal(leadCards.first?.unit.id, "L1", "for the unit that ran")
    equal(leadCards.first?.seats.count, outcome?.receipts.count, "with a line per seat that sat")
    // The report goes to the lead as its next turn, started asynchronously. Waiting for the
    // message to land is enough; the lead's own answer would be a fourth vendor turn, and
    // what it says about the verdict is not this suite's question.
    var backToLead = ""
    let deadline = Date.now.addingTimeInterval(10)
    while Date.now < deadline {
        backToLead = userTexts(leadRuntime).joined(separator: "\n")
        if backToLead.contains("Three Brains: L1") { break }
        try? await Task.sleep(for: .milliseconds(100))
    }
    leadRuntime.interrupt()
    check(backToLead.contains("Three Brains: L1"), "and the lead is given the result as a message")
    check(backToLead.contains("Approved") || backToLead.contains("Rejected")
          || backToLead.contains("Split") || backToLead.contains("Unverified")
          || backToLead.contains("Check failed"), "with what the panel decided")
    check(backToLead.contains("do not send out a brain to check a brain"),
          "and what not to do about it")

    // The record, written by the app rather than by a harness.
    let records = Storage.worktreesDirectory.deletingLastPathComponent().appendingPathComponent("three-brains")
    // This run's own row, not one an earlier run left in the same folder.
    let lines = (FileManager.default.enumerator(at: records, includingPropertiesForKeys: nil)?
        .compactMap { $0 as? URL }.filter { $0.lastPathComponent == "units.jsonl" }
        .compactMap { try? String(contentsOf: $0, encoding: .utf8) }
        .flatMap { $0.split(separator: "\n").map(String.init) }) ?? []
    let mine = lines.compactMap(JSONValue.parse).first { $0.object?["unitId"]?.string == "L1" }
    check(mine != nil, "the app wrote a record for this run")
    if let row = mine {
        equal(row.object?["hostMode"]?.string, "droppy", "which says which host produced it")
        equal(row.object?["unitId"]?.string, "L1", "for this unit")
        check((row.object?["dispatches"]?.array?.count ?? 0) == 3, "with a line per seat")
    } else {
        check(false, "the record parses back")
    }

    // What the panel decided, and whether the checkout agrees with it.
    let landed = (try? String(contentsOf: folder.appendingPathComponent("adding.py"), encoding: .utf8)) ?? ""
    if outcome?.verdict?.landed == true {
        check(landed.contains("twice"), "work the panel passed is in the checkout")
    } else {
        check(!landed.contains("twice"), "work the panel did not pass stayed out of the checkout")
    }
    print("   verdict: \(outcome?.verdict.map { "\($0.outcome.words) (\($0.approve)/\($0.reject)/\($0.abstain))" } ?? "none"), phase \(outcome?.phase.words ?? "?")")
}

@main
enum AppLayerTests {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let done = DispatchSemaphore(value: 0)
        Task { @MainActor in
            await run()
            done.signal()
        }
        while done.wait(timeout: .now() + 0.01) == .timedOut {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.01))
        }
        exit(0)
    }
}
