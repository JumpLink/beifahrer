import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

// S3: does Gio.FileMonitor on a directory see a registry file appear, change and vanish?
const dir = GLib.dir_make_tmp('bf-reg-XXXXXX');
const events: string[] = [];
const t0 = Date.now();
const mon = Gio.File.new_for_path(dir).monitor_directory(Gio.FileMonitorFlags.NONE, null);
mon.connect('changed', (_m: unknown, file: Gio.File, _o: unknown, type: Gio.FileMonitorEvent) => {
  events.push(`${Date.now() - t0}ms ${Gio.FileMonitorEvent[type]} ${file.get_basename()}`);
});
const f = `${dir}/session-1.json`;
const loop = new GLib.MainLoop(null, false);
const step = (ms: number, fn: () => void) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => { fn(); return GLib.SOURCE_REMOVE; });
step(200, () => GLib.file_set_contents(f, '{"a":1}'));
step(700, () => GLib.file_set_contents(f, '{"a":2}'));
step(1200, () => Gio.File.new_for_path(f).delete(null));
step(2200, () => {
  console.log(`[monitor] type=${mon.constructor?.name} events:\n  ${events.join('\n  ') || '(none)'}`);
  loop.quit();
});
loop.run();
