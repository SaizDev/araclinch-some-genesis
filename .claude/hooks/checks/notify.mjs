// Notification: tell the human that Claude needs input (terminal OSC 9 plus macOS banner).
import { spawn } from 'node:child_process';

export async function run(ctx) {
  const policy = ctx.policies.notify ?? {};
  const message = String(ctx.input.message ?? 'Claude Code needs your attention').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 180);
  const title = String(ctx.input.title ?? 'Claude Code').replace(/[\u0000-\u001f\u007f"\\]/g, ' ').slice(0, 60);
  if (policy.macos !== false && process.platform === 'darwin') {
    try {
      const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`;
      const child = spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' });
      child.unref();
    } catch {
      // ignore
    }
  }
  if (policy.terminal !== false) return { terminalSequence: `\u001b]9;${title}: ${message}\u0007` };
  return null;
}
