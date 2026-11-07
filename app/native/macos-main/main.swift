// The app's own Mach-O main executable, `Contents/MacOS/beifahrer` (CFBundleExecutable), staged by
// `gjsify.ship.mainExecutable` (ADR 0026, amendment 2026-11-07). Built with plain `swiftc` (see
// build.sh), no Xcode project.
//
// It exists because of one measurement: `SFSafariExtensionManager.getStateOfSafariExtension`
// answers only a process that IS the containing app's CFBundleExecutable. A helper beside it
// (`Contents/Helpers/…`) gets `SFErrorDomain Code=1` and the window showed "Unknown" forever.
// SafariServices is Objective-C/Swift-only, with no GObject-Introspection surface (ADR 0026 § 4),
// so the main does that one job itself and hands everything else to the generated launcher.
//
// Two modes:
//   `--safari-ext state <extension-id>`          prints exactly one line: `enabled` / `disabled` /
//                                                 `unknown`, exit 0.
//   `--safari-ext open-settings <extension-id>`  opens Safari's settings for the extension, prints
//                                                 nothing, exit 0.
//   anything else                                 execv `../Resources/beifahrer-launcher` with the
//                                                 same arguments — the GUI, the CLI and `mcp`
//                                                 behave exactly as without this binary.
// A malformed `--safari-ext` call exits 1 with a message on stderr. The flag is reserved, not a
// bare `state`, so no present or future CLI subcommand is ever shadowed.
//
// `state` never exits non-zero for an unknown or erroring extension id — Safari's own error is read
// as `unknown`, fail-closed like every other read in this repo (AGENTS.md § Leitplanken).
// `open-settings` DOES open Safari UI and must only ever run from the person's own click, never
// probed or called automatically (ADR 0026 § 4) — this binary does not decide that; its caller does.
import Darwin
import Foundation
import SafariServices

let flag = "--safari-ext"
let arguments = CommandLine.arguments

func usageAndExit() -> Never {
    FileHandle.standardError.write(
        "usage: beifahrer \(flag) state <extension-id> | \(flag) open-settings <extension-id>\n"
            .data(using: .utf8)!
    )
    exit(1)
}

/// This binary's own resolved path. Not `argv[0]`: a CLI symlink (`/usr/local/bin/beifahrer`) or
/// a bare name found on PATH would point the launcher lookup at the wrong directory.
func ownPath() -> String? {
    var size: UInt32 = 0
    _ = _NSGetExecutablePath(nil, &size)
    var raw = [CChar](repeating: 0, count: Int(size) + 1)
    guard _NSGetExecutablePath(&raw, &size) == 0, let resolved = realpath(raw, nil) else { return nil }
    defer { free(resolved) }
    return String(cString: resolved)
}

if arguments.count > 1 && arguments[1] == flag {
    guard arguments.count == 4 else { usageAndExit() }
    let extensionId = arguments[3]
    let group = DispatchGroup()
    group.enter()
    switch arguments[2] {
    case "state":
        var line = "unknown"
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionId) { state, _ in
            // `state` is nil on error (unknown id, Safari not installed, …); that falls through to
            // the "unknown" default set above, not a different branch, on purpose.
            if let state = state {
                line = state.isEnabled ? "enabled" : "disabled"
            }
            group.leave()
        }
        group.wait()
        print(line)
    case "open-settings":
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionId) { _ in
            group.leave()
        }
        group.wait()
    default:
        usageAndExit()
    }
    exit(0)
}

guard let own = ownPath() else {
    FileHandle.standardError.write("beifahrer: cannot resolve its own executable path\n".data(using: .utf8)!)
    exit(127)
}
let launcher = URL(fileURLWithPath: own)
    .deletingLastPathComponent()
    .appendingPathComponent("../Resources/beifahrer-launcher")
    .standardizedFileURL.path
var argv: [UnsafeMutablePointer<CChar>?] = [strdup(launcher)] + arguments.dropFirst().map { strdup($0) } + [nil]
execv(launcher, &argv)
perror("beifahrer: execv \(launcher)")
exit(127)
