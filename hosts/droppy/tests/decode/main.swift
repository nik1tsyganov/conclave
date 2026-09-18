import Foundation

// Does a thread saved before Three Brains existed come back unchanged, with the feature off?
// This is the one risk the Core harness cannot reach, because it needs the real ChatThread.

var failures = 0, checks = 0
func check(_ c: Bool, _ label: String, line: UInt = #line) {
    checks += 1
    if !c { failures += 1; FileHandle.standardError.write(Data("FAIL \(label) (line \(line))\n".utf8)) }
}
func equal<T: Equatable>(_ l: T, _ r: T, _ label: String, line: UInt = #line) {
    checks += 1
    if l != r { failures += 1; FileHandle.standardError.write(Data("FAIL \(label)\n  got: \(l)\n  expected: \(r)\n  (line \(line))\n".utf8)) }
}

let decoder = JSONDecoder.storage
let encoder = JSONEncoder.storage

// A save written by a build that never heard of Three Brains.
let oldThread = """
{"id":"11111111-1111-1111-1111-111111111111","projectID":"22222222-2222-2222-2222-222222222222",
 "title":"An older chat","provider":"claude","model":"opus","effort":"high","fastMode":false,
 "runtimeMode":"fullAccess","interactionMode":"build","isPinned":false,"isArchived":false,
 "hasUnread":false,"hasCustomTitle":true,"hydraEnabled":true,"hydraEnabledIsExplicit":true,
 "hydraSpawnCount":4,"createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z"}
"""
let thread = try decoder.decode(ChatThread.self, from: Data(oldThread.utf8))
equal(thread.title, "An older chat", "an older thread still decodes")
equal(thread.provider, .claude, "its provider survives")
equal(thread.hydraEnabled, true, "its Hydra switch survives")
equal(thread.hydraSpawnCount, 4, "its head count survives")
equal(thread.brainsEnabled, false, "Three Brains is off for it")
check(thread.brains == nil, "and it is not a seat")
check(!thread.isBrainsSeat, "so it does not read as one")

// A project saved before the feature.
let oldProject = """
{"id":"33333333-3333-3333-3333-333333333333","name":"A project","path":"/tmp/p",
 "addedAt":"2026-01-01T00:00:00Z","isExpanded":true,"scripts":[]}
"""
let project = try decoder.decode(Project.self, from: Data(oldProject.utf8))
equal(project.name, "A project", "an older project still decodes")
check(project.brainsTestCommand == nil, "with no default check command")

// A whole library of older saves.
let oldLibrary = "{\"projects\":[\(oldProject)],\"threads\":[\(oldThread)]}"
let library = try decoder.decode(Library.self, from: Data(oldLibrary.utf8))
equal(library.threads.count, 1, "an older library decodes its threads")
equal(library.projects.count, 1, "and its projects")

// A seat thread round-trips, and a corrupt one never comes back as a passed check.
var seat = ChatThread(projectID: UUID(), provider: .codex, model: "gpt-5.6-sol", effort: "high", runtimeMode: .fullAccess)
seat.brains = BrainsSeatInfo(runID: UUID(), unitID: "U1", role: .verify, brain: Brain(slot: .ponens))
seat.brains?.receipt.status = .completed
seat.brains?.receipt.position = .approve
seat.brains?.receipt.sessionID = "s"
seat.brains?.receipt.tokens = 10
seat.brains?.receipt.modelObserved = "gpt-5.6-sol"
seat.brains?.receipt.treeBefore = "abc123"
seat.brains?.receipt.treeAfter = "abc123"
let seatBack = try decoder.decode(ChatThread.self, from: encoder.encode(seat))
check(seatBack.isBrainsSeat, "a seat thread round-trips as a seat")
equal(seatBack.brains?.unitID, "U1", "keeping its unit")
equal(seatBack.brains?.receipt.position, .approve, "and its vote")
check(seatBack.brains?.receipt.counted == true, "which still counts")

// The same seat with its audit lost on the way back does not count.
var auditless = seat
auditless.brains?.receipt.treeBefore = nil
auditless.brains?.receipt.treeAfter = nil
let auditlessBack = try decoder.decode(ChatThread.self, from: encoder.encode(auditless))
check(auditlessBack.brains?.receipt.counted == false, "a seat whose tree audit did not survive does not count")

// A receipt whose status cannot be read must not come back countable.
var broken = try JSONSerialization.jsonObject(with: encoder.encode(seat)) as! [String: Any]
var brains = broken["brains"] as! [String: Any]
var receipt = brains["receipt"] as! [String: Any]
receipt["status"] = "a-status-from-a-newer-build"
brains["receipt"] = receipt
broken["brains"] = brains
let brokenBack = try decoder.decode(ChatThread.self, from: JSONSerialization.data(withJSONObject: broken))
equal(brokenBack.brains?.receipt.status, .failed, "an unreadable status reads as failed, never as completed")
check(brokenBack.brains?.receipt.counted == false, "so its vote does not count")

// A verdict card in the lead's timeline. It is stored so that a thread reopened later shows
// the same count it showed when the panel reached it, and it must survive a save.
let unit = BrainsUnit(id: "U1", task: "add a median", brief: "add a median to stats.py")
let verdict = BrainsVerdict(
    outcome: .passage, approve: 2, reject: 0, abstain: 1, independence: .checkersShareVendor,
    adjustments: [BrainsAdjustment(slot: .advocatus, brainName: "Advocatus", role: .review,
                                   declared: .approve, counted: .abstain, reason: "gave no reason of its own")],
    uncounted: [], flags: ["approve-without-evidence-counted-as-abstain"])
func receipt(_ slot: Brain.Slot, _ provider: ProviderKind, _ role: BrainsRole,
             _ position: BrainsPosition? = nil, evidence: String? = nil) -> BrainsReceipt {
    var brain = Brain(slot: slot)
    brain.provider = provider
    var made = BrainsReceipt(unitID: "U1", role: role, brain: brain)
    made.position = position
    made.evidence = evidence
    return made
}
let receipts = [
    receipt(.ponens, .codex, .implement),
    receipt(.scrutator, .claude, .verify, .approve, evidence: "6 tests pass in stats_test.py"),
    receipt(.advocatus, .claude, .review, .approve),
]
let card = BrainsPanelVerdict(unit: unit, verdict: verdict, seats: verdict.lines(from: receipts))
equal(card.seats.count, 3, "a card carries a line per seat, the builder included")
equal(card.seats[0].counted, BrainsPosition?.none, "the builder never counts")
equal(card.seats[1].counted, BrainsPosition.approve, "a checker with a reason counts as it said")
equal(card.seats[2].counted, BrainsPosition.abstain, "one without a reason counts as an abstention")
check(card.seats[2].note?.contains("no reason of its own") == true, "and says why beside the seat")

var withCard = ThreadDocument(threadID: UUID())
withCard.items = [
    TimelineItem(turnID: UUID(), content: .user(UserMessage(text: "add a median", hydraHeads: nil))),
    TimelineItem(turnID: nil, content: .brains(card)),
]
let cardBack = try decoder.decode(ThreadDocument.self, from: encoder.encode(withCard))
equal(cardBack.items.count, 2, "a timeline holding a verdict card round-trips")
if case .brains(let stored) = cardBack.items[1].content {
    equal(stored.unit.id, "U1", "the card keeps its unit")
    equal(stored.verdict.outcome, .passage, "its outcome")
    equal(stored.verdict.approve, 2, "its count")
    equal(stored.seats.count, 3, "and every seat line")
    equal(stored.seats[2].counted, BrainsPosition.abstain, "including what a changed vote was counted as")
    equal(stored.verdict.independence, .checkersShareVendor, "and how independent the checks were")
} else {
    check(false, "the stored item is still a verdict card")
}

// The case is new, so a build without it cannot read one. That must cost the reader the card
// and nothing else: the rest of the thread has to come back.
var raw = try JSONSerialization.jsonObject(with: encoder.encode(withCard)) as! [String: Any]
var items = raw["items"] as! [[String: Any]]
items[1] = ["id": "x", "date": 0, "content": ["a_case_from_a_newer_build": ["text": "?"]]]
raw["items"] = items
let older = try decoder.decode(ThreadDocument.self, from: JSONSerialization.data(withJSONObject: raw))
equal(older.items.count, 1, "an item a build cannot read is dropped, not the transcript")
if case .user(let message) = older.items[0].content {
    equal(message.text, "add a median", "and the words around it are still there")
} else {
    check(false, "the message before it survives")
}

// A seat is a panel child exactly as a head is. Every reader that lists a lead's children
// used to ask for a Hydra head by name, so a seat was in none of them: not the sidebar under
// its lead, not the panel, not even the panel's own list of seats. It did match the reader
// for a single docked helper, so the first seat of a run would have been drawn as one.
var panelSeat = ChatThread(projectID: UUID(), provider: .claude, model: "opus", effort: "high", runtimeMode: .supervised)
panelSeat.parentThreadID = UUID()
panelSeat.isInPanel = true
var seatBrain = Brain(slot: .scrutator)
seatBrain.provider = .claude
panelSeat.brains = BrainsSeatInfo(runID: UUID(), unitID: "U7", role: .verify, brain: seatBrain)
check(panelSeat.isBrainsSeat, "a seat reads as a seat")
check(!panelSeat.isHydraHead, "and never as a Hydra head")
check(panelSeat.isPanelMember, "but it is a panel child, which is what the readers ask")
check(panelSeat.isDroppyRun, "and Droppy Code runs its session, so it has a chat to show")
check(panelSeat.isHelper, "and it is its lead's helper")

var nativeHead = ChatThread(projectID: UUID(), provider: .codex, model: "m", effort: "high", runtimeMode: .fullAccess)
nativeHead.isInPanel = true
nativeHead.hydra = HydraHeadInfo(index: 2, task: "read the callers", kind: .native, origin: .delegated)
check(nativeHead.isPanelMember, "a head is a panel child too")
check(!nativeHead.isDroppyRun, "but a native one has no session of Droppy's own")
check(ChatThread(projectID: UUID(), provider: .codex, model: nil, effort: nil, runtimeMode: .auto).isPanelMember == false,
      "and an ordinary chat is neither")

// The panel draws one row for both kinds, so a seat has to describe itself in the panel's
// own vocabulary rather than there being a second panel that looks the same.
let seatInfo = panelSeat.panelInfo
equal(seatInfo?.displayName, "Scrutator", "a seat is called what the user named it")
equal(seatInfo?.task, "verifies U7", "and the row says what it is doing")
equal(seatInfo?.kind, HydraHeadInfo.Kind.droppy, "it is a Droppy-run child")
equal(seatInfo?.status, HydraHeadInfo.Status.running, "and it starts running")
equal(nativeHead.panelInfo?.displayName, nativeHead.hydra?.persona.name, "a head keeps the roster's name")
check(nativeHead.panelInfo?.name == nil, "having none of its own")

// A finished seat shows its vote where a head shows its summary.
panelSeat.brains?.receipt.status = .completed
panelSeat.brains?.receipt.position = .reject
panelSeat.brains?.receipt.evidence = "The empty case at stats.py:14 is not covered."
let finishedInfo = panelSeat.panelInfo
equal(finishedInfo?.status, HydraHeadInfo.Status.completed, "a finished seat reads as finished")
check(finishedInfo?.summary?.contains("REJECT") == true, "and its row carries the vote")
check(finishedInfo?.summary?.contains("stats.py:14") == true, "with the reason it gave")
check(finishedInfo?.canStop == false, "and there is nothing left to stop")

// The colour is the slot's, so a seat looks the same from one run to the next.
var advocatus = panelSeat
var casperBrain = Brain(slot: .advocatus)
casperBrain.provider = .antigravity
advocatus.brains = BrainsSeatInfo(runID: UUID(), unitID: "U7", role: .review, brain: casperBrain)
check(advocatus.panelInfo?.index != panelSeat.panelInfo?.index, "two seats do not share a colour")
equal(advocatus.panelInfo?.task, "reviews U7", "and each says its own job")

// A stored head from a build before seats existed still decodes, and gains no name.
let oldHead = "{\"index\":1,\"task\":\"t\",\"kind\":\"droppy\",\"origin\":\"delegated\",\"status\":\"completed\"}"
let decodedHead = try decoder.decode(HydraHeadInfo.self, from: Data(oldHead.utf8))
check(decodedHead.name == nil, "a head stored before seats existed has no name of its own")
equal(decodedHead.displayName, decodedHead.persona.name, "and still shows the roster's")

print("\(checks - failures)/\(checks) checks passed")
if failures > 0 { exit(1) }
