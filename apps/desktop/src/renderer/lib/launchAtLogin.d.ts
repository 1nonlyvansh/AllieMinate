export {};

declare global {
  interface Window {
    launchAtLogin: {
      isEnabled: () => Promise<boolean>;
      setEnabled: (enabled: boolean) => Promise<void>;
    };
  }
}
