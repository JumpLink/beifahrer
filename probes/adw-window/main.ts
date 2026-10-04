import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import { runAdwaitaApp, createNavShell } from '@gjsify/adwaita-app';

const log = (m: string) => console.log(`[adw-window] ${m}`);
log(`runtime=${typeof (globalThis as { imports?: unknown }).imports === 'object' ? 'gjs' : 'node'} platform=${process.platform}`);

const code = await runAdwaitaApp({
  applicationId: 'eu.jumplink.beifahrer.Probe',
  createWindow: (app) => {
    const win = new Adw.ApplicationWindow({ application: app, defaultWidth: 600, defaultHeight: 400 });
    const shell = createNavShell(win, {
      items: [
        { id: 'status', label: 'Status', icon: 'go-home-symbolic' },
        { id: 'browser', label: 'Browser', icon: 'web-browser-symbolic' },
      ],
      sidebarTitle: 'Beifahrer',
      onSelect: (item) => shell.stack.set_visible_child_name(item.id),
    });
    const page = new Adw.StatusPage({ title: 'Connected', description: 'probe', iconName: 'emblem-ok-symbolic' });
    shell.stack.add_named(page, 'status');
    shell.stack.add_named(new Adw.StatusPage({ title: 'Browser' }), 'browser');
    win.set_content(shell.widget);
    shell.selectById('status');
    log('window built');
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
      log('quitting');
      app.quit();
      return GLib.SOURCE_REMOVE;
    });
    return win;
  },
});
log(`exit code ${code}`);
