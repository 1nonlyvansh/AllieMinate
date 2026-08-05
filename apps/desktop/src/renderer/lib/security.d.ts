export {};

declare global {
  interface Window {
    security: {
      isEnabled: () => Promise<boolean>;
      setEnabled: (enabled: boolean, pin?: string) => Promise<void>;
      verifyPin: (pin: string) => Promise<boolean>;
      canTouchID: () => Promise<boolean>;
      tryTouchID: () => Promise<boolean>;
    };
  }
}
