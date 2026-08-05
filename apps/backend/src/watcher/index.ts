import chokidar, { FSWatcher } from 'chokidar';

export type WatchEventType = 'add' | 'change' | 'unlink';

export interface WatchEvent {
  type: WatchEventType;
  path: string;
}

export function watchFolder(
  localPath: string,
  onEvent: (event: WatchEvent) => void,
): FSWatcher {
  const watcher = chokidar.watch(localPath, {
    // chokidar's initial directory scan fires 'add' for every file already there — with this false
    // (the default), every pre-existing file gets treated as a brand-new sync on every single app
    // launch: re-uploaded, re-emitted as a sync event, and (now that sync notifications are real)
    // re-notified to the user, forever, for files that never actually changed.
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  });

  // Belt-and-suspenders on top of ignoreInitial — verified live that chokidar (this version, with
  // awaitWriteFinish also enabled) still leaks 'add' events for pre-existing files past the initial scan
  // on some app restarts, which was silently re-uploading every file in every Auto-Sync folder and firing
  // a sync notification for each, every single launch. Doesn't rely on ignoreInitial's internal behavior
  // at all — just refuses to forward anything until chokidar's own 'ready' event (initial scan complete)
  // has actually fired, which is the one guarantee this doesn't depend on being buggy.
  let ready = false;
  watcher.on('ready', () => {
    ready = true;
  });

  watcher
    .on('add', (path) => { if (ready) onEvent({ type: 'add', path }); })
    .on('change', (path) => { if (ready) onEvent({ type: 'change', path }); })
    .on('unlink', (path) => { if (ready) onEvent({ type: 'unlink', path }); });

  return watcher;
}
