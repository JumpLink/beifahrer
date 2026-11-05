// A tiny helper for what neither `gi://` nor `@gjsify/node-gi` can reach: SafariServices is
// Objective-C/Swift-only, with no GObject-Introspection surface (ADR 0026 § 4). Built with plain
// `swiftc` (see build.sh), no Xcode project. The window execs this as `Contents/Helpers/
// safari-ext-helper` via `Gio.Subprocess`, one argv, and reads one line of stdout.
//
// Exit codes:
//   0  ran to completion. `state` printed exactly one line (`enabled` / `disabled` / `unknown`);
//      `open-settings` printed nothing — the preferences window was asked to open.
//   1  usage error: missing or extra arguments, or an unrecognised subcommand. Nothing printed to
//      stdout; a message went to stderr.
//
// `state` never exits non-zero for an unknown or erroring extension id — Safari's own error
// (SFErrorDomain, e.g. the id does not exist) is read as `unknown`, fail-closed like every other
// read in this repo (AGENTS.md § Leitplanken): the window shows "Unknown", not a crash or a
// silent hang.
//
// `open-settings` DOES open Safari UI and must only ever run from the person's own click, never
// probed or called automatically (ADR 0026 § 4) — this binary does not decide that; its caller
// does.
import Foundation
import SafariServices

func usageAndExit() -> Never {
    FileHandle.standardError.write(
        "usage: safari-ext-helper state <extension-id> | open-settings <extension-id>\n"
            .data(using: .utf8)!
    )
    exit(1)
}

let arguments = CommandLine.arguments
guard arguments.count == 3 else { usageAndExit() }
let command = arguments[1]
let extensionId = arguments[2]

switch command {
case "state":
    let group = DispatchGroup()
    group.enter()
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
    exit(0)
case "open-settings":
    let group = DispatchGroup()
    group.enter()
    SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionId) { _ in
        group.leave()
    }
    group.wait()
    exit(0)
default:
    usageAndExit()
}
