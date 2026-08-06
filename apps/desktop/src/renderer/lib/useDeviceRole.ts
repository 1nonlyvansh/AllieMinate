import { useEffect, useState } from 'react';

const API_BASE = 'http://localhost:4310';

export interface MasterPeer {
  id: string;
  name: string;
  platform: string;
}

export interface DeviceRole {
  hasOwnClouds: boolean;
  masterDeviceEnabled: boolean;
  masterPeer: MasterPeer | null;
  isUnderDevice: boolean;
}

// assume standalone/normal until the first real fetch resolves — avoids flashing an Under Device banner
// (or, worse, disabling Log In) before we actually know the current pairing state.
const DEFAULT_ROLE: DeviceRole = { hasOwnClouds: true, masterDeviceEnabled: true, masterPeer: null, isUnderDevice: false };

// Master/Under is a relationship computed from real state — own clouds connected, this device's Master
// Device toggle, and whether it's CURRENTLY paired to a reachable peer that's itself acting as Master —
// never from which OS this device happens to run. Polls the same /devices endpoint the Devices page
// already uses, so this rides along on existing traffic rather than adding a new poll loop.
export function useDeviceRole(pollMs = 5000): DeviceRole {
  const [role, setRole] = useState<DeviceRole>(DEFAULT_ROLE);

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const res = await fetch(`${API_BASE}/devices`);
        const data = await res.json();
        if (cancelled) return;
        const thisDeviceRole = data.thisDeviceRole ?? { hasOwnClouds: true, masterDeviceEnabled: true };
        const paired: { id: string; name: string; platform: string; online: boolean; hasOwnClouds: boolean; masterDeviceEnabled: boolean }[] =
          data.paired ?? [];
        const master = paired.find((d) => d.online && d.hasOwnClouds && d.masterDeviceEnabled) ?? null;
        setRole({
          hasOwnClouds: thisDeviceRole.hasOwnClouds,
          masterDeviceEnabled: thisDeviceRole.masterDeviceEnabled,
          masterPeer: master ? { id: master.id, name: master.name, platform: master.platform } : null,
          isUnderDevice: !thisDeviceRole.hasOwnClouds && !!master,
        });
      } catch {
        // transient fetch failure — keep the last known role rather than flashing back to the default
      }
    }
    refresh();
    const interval = setInterval(refresh, pollMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pollMs]);

  return role;
}
