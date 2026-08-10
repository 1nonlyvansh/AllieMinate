import fs from 'node:fs';
import { envPath } from './paths';

const ENV_PATH = envPath();

export function updateEnv(values: Record<string, string>): void {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';

  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(content)) {
      content = content.replace(re, line);
    } else {
      content += (content === '' || content.endsWith('\n') ? '' : '\n') + line + '\n';
    }
    process.env[key] = value;
  }

  fs.writeFileSync(ENV_PATH, content);
}
