export {};

declare global {
  interface Window {
    usbPairing: {
      connect: () => Promise<{ ok: boolean; error?: string }>;
      launchPairDeepLink: (code: string, macName: string) => Promise<{ ok: boolean; error?: string }>;
    };
  }
}
