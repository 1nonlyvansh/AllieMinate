import React from 'react';
import { IconGithub, IconInstagram, IconLinkedin, IconWhatsapp, IconMail, IconExternalLink } from '../icons';
import { BRAND_LOGO_DATA_URI } from '../lib/brandLogo';

const GITHUB_REPO_URL = 'https://github.com/1nonlyvansh/AllieMinate';
const DEV_GITHUB_URL = 'https://github.com/1nonlyvansh';
const DEV_INSTAGRAM_URL = 'https://instagram.com/1nonlyvansh';
const DEV_LINKEDIN_URL = 'https://www.linkedin.com/in/vanshkishore/';
const DEV_EMAIL = 'vansh080605@gmail.com';
const DEV_WHATSAPP = '919136158580'; // wa.me needs country code, no leading + or dashes

function openExternal(url: string): void {
  window.alliminate.openExternal(url);
}

const FEATURES: { title: string; desc: string }[] = [
  { title: 'One place for every cloud', desc: 'Google Drive (multi-account), OneDrive, MEGA, pCloud, Backblaze B2, and any S3-compatible bucket — browse, upload, and organize all of them from a single window.' },
  { title: 'Cross-device Sync Pairs', desc: 'Two-way, backup-only, or download-only sync between any local folder and a cloud account or a paired device — with bandwidth limits, ignore rules, conflict resolution, and a real Sync Trash.' },
  { title: 'Universal Sync', desc: 'One shared folder, broadcast to every device you grant it to — a Mac, a Windows PC, and an Android phone can all stay in sync with a single host folder, no per-pair setup on each device.' },
  { title: 'Device pairing over LAN', desc: 'Pair your Mac, Windows PC, and Android phone directly — browse each other\'s files, send files instantly, and see live battery/online status, no cloud relay in between.' },
  { title: 'Universal Clipboard', desc: 'Copy on one device, paste on another — desktop-to-desktop and desktop-to-phone, automatically.' },
  { title: 'Nearby Share', desc: 'Send a file to any AllieMinate device on the same WiFi instantly, even before it\'s paired — accept or decline right on the receiving device.' },
  { title: 'Real file management', desc: 'Rename, move, copy, trash, and preview (images, video, with zoom/rotate) across every connected cloud and device — not just upload/download.' },
  { title: 'Built-in security', desc: 'Optional App Lock with Touch ID/Windows Hello/fingerprint, remote Approve-on-Phone unlock, and destructive actions gated behind device authentication.' },
];

const USE_CASES: string[] = [
  'Keep your Desktop/Documents/Screenshots folder mirrored across your Mac, Windows PC, and phone without paying for three different sync services.',
  'Consolidate storage spread across five different Google accounts and other providers into one searchable, browsable space.',
  'Send a file from your phone straight to your Mac\'s Downloads folder, or the other way around, without AirDrop, cables, or a shared cloud folder.',
  'Copy a password or link on your computer and paste it straight into your phone, mid-conversation.',
  'Set up a folder once (Universal Sync) and have it show up, live, on every device you own — school notes, project files, camera backups.',
];

const DIFFERENTIATORS: string[] = [
  'Most cloud managers stop at "browse your cloud." AllieMinate also does device-to-device sync, LAN file transfer, clipboard sharing, and remote unlock — one app instead of four.',
  'Sync direction and conflict handling are explicit and per-pair, not a black box — you choose two-way, backup-only, or download-only for every single folder.',
  'No mandatory account, no subscription, no cloud relay for device-to-device features — pairing and Nearby Share go directly over your own network.',
  'Open source — the whole thing, not a trial. Read the code, build it yourself, or contribute.',
];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="section-title" style={{ marginTop: 28 }}>{children}</div>;
}

function SocialLink({ icon, label, url }: { icon: React.ReactNode; label: string; url: string }) {
  return (
    <div
      className="provider-row glass-card"
      style={{ cursor: 'pointer' }}
      onClick={() => openExternal(url)}
    >
      <div className="provider-icon" style={{ background: 'transparent' }}>{icon}</div>
      <div className="provider-info">
        <div className="name">{label}</div>
      </div>
      <IconExternalLink size={15} />
    </div>
  );
}

export function AboutView() {
  return (
    <section className="view active">
      <div className="view-header">
        <div>
          <h1>About AllieMinate</h1>
          <p>What this app is, what it does, and who built it</p>
        </div>
      </div>

      <div className="settings-group">
        <div className="glass-card" style={{ padding: '24px', display: 'flex', gap: 18, alignItems: 'center' }}>
          <img src={BRAND_LOGO_DATA_URI} alt="AllieMinate" style={{ width: 56, height: 56, borderRadius: 14 }} />
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>AllieMinate</div>
            <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4 }}>A Space With You</div>
          </div>
        </div>
        <div className="glass-card" style={{ padding: '20px 24px', marginTop: 12, fontSize: 13.5, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          AllieMinate is a cross-platform cloud storage aggregator and device-sync suite for macOS, Windows, and
          Android. It brings every cloud account you use into one window, syncs folders across your own devices
          without a subscription, and lets your Mac, PC, and phone talk to each other directly — file transfer,
          clipboard, and remote unlock included.
        </div>
      </div>

      <SectionTitle>Features</SectionTitle>
      <div className="settings-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {FEATURES.map((f) => (
          <div key={f.title} className="glass-card" style={{ padding: '16px 18px' }}>
            <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 6 }}>{f.title}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{f.desc}</div>
          </div>
        ))}
      </div>

      <SectionTitle>Use Cases</SectionTitle>
      <div className="glass-card" style={{ padding: '18px 22px' }}>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8, color: 'var(--text-secondary)' }}>
          {USE_CASES.map((u) => <li key={u}>{u}</li>)}
        </ul>
      </div>

      <SectionTitle>How AllieMinate is different</SectionTitle>
      <div className="glass-card" style={{ padding: '18px 22px' }}>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8, color: 'var(--text-secondary)' }}>
          {DIFFERENTIATORS.map((d) => <li key={d}>{d}</li>)}
        </ul>
      </div>

      <SectionTitle>Open Source</SectionTitle>
      <SocialLink icon={<IconGithub size={20} />} label="github.com/1nonlyvansh/AllieMinate" url={GITHUB_REPO_URL} />

      <SectionTitle>About Developer</SectionTitle>
      <div className="glass-card" style={{ padding: '18px 22px', marginBottom: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>Vansh Kishore Sharma</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <SocialLink icon={<IconGithub size={20} />} label="github.com/1nonlyvansh" url={DEV_GITHUB_URL} />
        <SocialLink icon={<IconInstagram size={20} />} label="instagram.com/1nonlyvansh" url={DEV_INSTAGRAM_URL} />
        <SocialLink icon={<IconLinkedin size={20} />} label="linkedin.com/in/vanshkishore" url={DEV_LINKEDIN_URL} />
      </div>

      <SectionTitle>Need Help or Give a Suggestion?</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        <SocialLink icon={<IconMail size={20} />} label={DEV_EMAIL} url={`mailto:${DEV_EMAIL}`} />
        <SocialLink icon={<IconWhatsapp size={20} />} label="+91 91361 58580" url={`https://wa.me/${DEV_WHATSAPP}`} />
      </div>
    </section>
  );
}
