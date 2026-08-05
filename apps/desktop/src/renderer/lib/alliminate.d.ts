export {};

declare global {
  interface Window {
    alliminate: {
      platform: string;
      openApp: (target?: string) => Promise<void>;
      onNavigate: (cb: (view: string) => void) => () => void;
      completeDrop: (kind: 'folder' | 'device' | 'nearby', id: string) => Promise<void>;
      cancelDrop: () => Promise<void>;
      keepPanelOpen: () => Promise<void>;
      notifyPanelDragLeave: () => Promise<void>;
      dropFilesInPanel: (filePaths: string[], kind?: 'cloud' | 'device' | 'nearby') => Promise<void>;
      switchDropKind: (kind: 'cloud' | 'device') => Promise<void>;
      copyFile: (url: string, filename: string) => Promise<{ ok: boolean; error?: string }>;
      prepareFileForDrag: (url: string, filename: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      startFileDrag: (filePath: string) => void;
      showInFinder: (filePath: string) => Promise<void>;
      openFolder: (folderPath: string) => Promise<string>;
      copyLocalFile: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
      pickFolder: () => Promise<{ canceled: boolean; path?: string }>;
      openExternal: (url: string) => Promise<void>;
      composeMailWithAttachments: (params: { to: string; subject: string; body: string; attachmentPaths: string[] }) => Promise<{ ok: boolean; error?: string }>;
      getPathForFile: (file: File) => string;
      onTrayState: (cb: (state: unknown) => void) => () => void;
    };
  }
}
