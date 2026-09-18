import Foundation

// What a panel writes for the record. The shape is not ours: the owner's vault tools read
// CONCLAVE runs, so a Droppy panel writes CONCLAVE's two files with `hostMode: "droppy"`. A field
// that drifts here is a row that silently stops being readable by those tools, which is the
// kind of break nothing else would notice.

var failures = 0
var checks = 0

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
func receipt(_ slot: Brain.Slot, _ provider: ProviderKind, _ role: BrainsRole, _ position: BrainsPosition?,
             evidence: String?, tokens: Int?, seconds: Double) -> BrainsReceipt {
    var brain = Brain(slot: slot)
    brain.provider = provider
    var made = BrainsReceipt(unitID: "U1", role: role, brain: brain)
    made.status = .completed
    made.position = position
    made.evidence = evidence
    made.modelRequested = "asked-for"
    made.modelObserved = "answered-by"
    made.effortRequested = "high"
    made.sessionID = "session-\(slot.rawValue)"
    made.tokens = tokens
    made.treeBefore = "a"
    made.treeAfter = "a"
    made.startedAt = Date(timeIntervalSince1970: 1_700_000_000)
    made.finishedAt = made.startedAt.addingTimeInterval(seconds)
    return made
}

let when = Date(timeIntervalSince1970: 1_700_000_100)
var unit = BrainsUnit(id: "U1", task: "Add a median", brief: "1. Add it.", files: ["stats.py"], test: "./check.sh")
unit.class = .standardFeature
let receipts = [
    receipt(.ponens, .codex, .implement, nil, evidence: nil, tokens: nil, seconds: 50),
    receipt(.scrutator, .claude, .verify, .approve, evidence: "Six tests in stats_test.py pass, the even case included.", tokens: 30_000, seconds: 60),
    receipt(.advocatus, .antigravity, .review, .approve, evidence: "I read the callers in app.py and none passes a tuple.", tokens: 40_000, seconds: 70),
]
// The verdict is CONCLAVE's answer; the record's job is to write down whatever it was.
let verdict = BrainsVerdict(outcome: .passage, approve: 2, reject: 0, abstain: 0,
                            independence: .crossVendor, adjustments: [], uncounted: [], flags: [])
var landing = BrainsRunner.BrainsLanding()
landing.files = ["stats.py"]
let outcome = BrainsRunner.Outcome(unit: unit, phase: .landed, verdict: verdict, receipts: receipts,
                                   builderReport: "I changed one file.", checkerReports: [], landing: landing)

let row = BrainsTelemetry.unitRow(outcome, runID: "run-1", at: when)

// The fields CONCLAVE reads by name.
equal(row["schemaVersion"]?.int, 1, "the row names its schema")
equal(row["kind"]?.string, "unit", "and what kind of row it is")
equal(row["hostMode"]?.string, "droppy", "and which host wrote it")
equal(row["key"]?.string, "run-1:U1", "the key is the run and the unit")
equal(row["unitId"]?.string, "U1", "the unit is named")
equal(row["class"]?.string, "standard-feature", "with its class")
equal(row["approval"]?.string, "PASS", "a landed unit passed")
check(row["reason"]?.isNull == true, "and needs no reason")
equal(row["date"]?.string, "2023-11-14", "the date is the run's, in UTC")

// Vendors, not command-line tools: CONCLAVE rows are read across hosts.
equal(row["authorVendor"]?.string, "openai", "the builder is named by vendor")
equal(BrainsTelemetry.vendor(.claude), "anthropic", "claude is anthropic")
equal(BrainsTelemetry.vendor(.antigravity), "google", "antigravity is google")
equal(BrainsTelemetry.vendor(.codex), "openai", "codex is openai")

// The panel block.
let panel = row["panel"]?.object
equal(panel?["verdict"]?.string, "PASSAGE", "the verdict is CONCLAVE's word for it")
equal(panel?["passed"]?.bool, true, "and says whether it landed")
equal(panel?["approve"]?.int, 2, "with the counts")
equal(panel?["reject"]?.int, 0, "as they were counted")
equal(panel?["independence"]?.string, "crossVendor", "and how independent the checks were")

// Every seat, with what it actually ran on. `model` is what was asked for and
// `modelObserved` is what answered: a row that kept only one of them could not answer the
// question the whole protocol exists to answer.
let dispatches = row["dispatches"]?.array ?? []
equal(dispatches.count, 3, "one dispatch per seat")
let verify = dispatches.compactMap { $0.object }.first { $0["role"]?.string == "verify" }
equal(verify?["vendor"]?.string, "anthropic", "the seat's vendor")
equal(verify?["model"]?.string, "asked-for", "what it was asked to run")
equal(verify?["modelObserved"]?.string, "answered-by", "and what answered")
equal(verify?["position"]?.string, "APPROVE", "its vote")
equal(verify?["counted"]?.bool, true, "and whether that vote counted")
equal(verify?["tokens"]?.int, 30_000, "its tokens")
equal(verify?["durationMs"]?.int, 60_000, "and how long it took")
equal(verify?["sessionId"]?.string, "session-scrutator", "with the session that proves it ran")

// A seat whose vendor reported no tokens is null, never zero: zero would read as a seat that
// ran for free, and this is the vendor declining to say.
let built = dispatches.compactMap { $0.object }.first { $0["role"]?.string == "implement" }
check(built?["tokens"]?.isNull == true, "a vendor that reported no tokens writes null")
equal(row["tokensTotal"]?.int, 70_000, "and the total is of what was actually reported")
equal(row["tokensByVendor"]?.object?["google"]?.int, 40_000, "with a line per vendor")
check(row["tokensByVendor"]?.object?["openai"] == nil, "and no line for one that said nothing")
equal(row["durationMs"]?.int, 70_000, "the unit's own span is its longest seat")
equal(row["landed"]?.array?.count, 1, "and what landed is on the record")

// The two outcomes CONCLAVE has no word for are written as themselves rather than folded into
// one it does. A reader that sees DEADLOCK where the check simply failed would draw the
// wrong conclusion about the panel.
equal(BrainsTelemetry.word(.checkFailed), "CHECK_FAILED", "a failing check is said plainly")
equal(BrainsTelemetry.word(.notPanel), "NOT_PANEL", "so is too few votes")
equal(BrainsTelemetry.word(.reject), "REJECT", "a rejection is CONCLAVE's word")
equal(BrainsTelemetry.word(.deadlock), "DEADLOCK", "and so is a split")

var refusedUnit = unit
refusedUnit.id = "U2"
let refusedVerdict = BrainsVerdict(outcome: .checkFailed, approve: 2, reject: 0, abstain: 0,
                                   independence: .crossVendor, adjustments: [], uncounted: [],
                                   flags: ["the-unit-s-own-check-did-not-pass"])
let refused = BrainsRunner.Outcome(unit: refusedUnit, phase: .checkFailed, verdict: refusedVerdict,
                                   receipts: receipts, builderReport: "", checkerReports: [], landing: nil)
let refusedRow = BrainsTelemetry.unitRow(refused, runID: "run-1", at: when)
equal(refusedRow["approval"]?.string, "FAIL", "a unit that did not land did not pass")
equal(refusedRow["reason"]?.string, "Its check did not pass", "and the reason is the phase it stopped in")
equal(refusedRow["panel"]?.object?["verdict"]?.string, "CHECK_FAILED", "which the panel block agrees with")
equal(refusedRow["landed"]?.array?.count, 0, "and nothing is listed as landed")

// The run row is built from the unit rows, so the two can never disagree.
let runRow = BrainsTelemetry.runRow([row, refusedRow], runID: "run-1", at: when)
equal(runRow["kind"]?.string, "run", "the run row says what it is")
equal(runRow["hostMode"]?.string, "droppy", "and which host wrote it")
equal(runRow["dispatches"]?.int, 6, "it counts every seat of every unit")
equal(runRow["pass"]?.int, 6, "all of which ran")
equal(runRow["executionStatus"]?.string, "PASS", "so execution passed")
equal(runRow["approvalStatus"]?.string, "FAIL", "while approval did not, because one unit did not land")
equal(runRow["ok"]?.bool, false, "and ok is both together")
equal(runRow["units"]?.array?.count, 2, "with a line per unit")
equal(runRow["tokensTotal"]?.int, 140_000, "and the tokens of the whole run")
equal(runRow["wallMs"]?.int, 70_000, "and its longest unit")

// Nothing here claims a model decided anything: the count is code, run offline.
let arbiter = runRow["arbiter"]?.object
equal(arbiter?["vendor"]?.string, "droppy", "the arbiter is the app")
equal(arbiter?["model"]?.string, "code-counted", "and it is code, not a model")
check(row["jev"] == nil, "a Droppy row carries no arbiter block it did not earn")

// Both files are written, and both are readable as JSON by anything that reads CONCLAVE's.
let directory = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("brains-telemetry-\(UUID().uuidString)")
BrainsTelemetry.write([outcome, refused], runID: "run-1", to: directory, at: when)
let lines = (try? String(contentsOf: directory.appendingPathComponent("units.jsonl"), encoding: .utf8))?
    .split(separator: "\n").map(String.init) ?? []
equal(lines.count, 2, "one line per unit, and one line only")
for line in lines {
    check(!line.contains("\n"), "a line holds no newline of its own")
    check(JSONValue.parse(line)?.object?["unitId"]?.string != nil, "and every line parses back with its unit")
}
let written = (try? Data(contentsOf: directory.appendingPathComponent("run-row.json"))).flatMap { JSONValue.parse($0) }
equal(written?.object?["key"]?.string, "run-1", "the run row is written and parses back")
try? FileManager.default.removeItem(at: directory)

print("\(checks - failures)/\(checks) checks passed")
if failures > 0 { exit(1) }
