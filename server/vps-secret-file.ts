import { isValidSshAlias } from "./config.ts";
import { defaultRunner, type VpsCommandRunner } from "./vps-command.ts";
import { vpsDockerArgs } from "./vps-computer.ts";

const CONTAINER_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/;
const CONTAINER_ID = /^[a-f0-9]{12,64}$/i;

/** The VPS container a turn's commands run in, for a file secret the person saves while the turn is parked. */
export const vpsThreadComputers = new Map<string, { alias: string; container: string }>();

/** Where a one-time code or other file secret lands on the VPS computer, as the bot's commands see it. */
export const VPS_SECRET_ROOT = "/home/cua/workspace/.openmausbot-secrets";

/** Writes a file secret into the bot's VPS container as a mode-600 file, through the same Docker-over-SSH path the
 * computer itself uses. Security: the value travels on stdin only, never in argv (visible to `ps` and logs); the
 * script holds only validated ids, and a failure never echoes the value. Returns the path the bot's commands use. */
export async function vpsWriteSecretFile(
  alias: string,
  containerRef: string,
  threadId: string,
  messageId: string,
  value: string,
  runner: VpsCommandRunner = defaultRunner,
): Promise<string> {
  const id = /^[\w-]{1,128}$/;
  if (!id.test(threadId) || !id.test(messageId)) throw new Error("invalid conversation or card id");
  if (!isValidSshAlias(alias) || (!CONTAINER_NAME.test(containerRef) && !CONTAINER_ID.test(containerRef))) {
    throw new Error("invalid VPS secret target");
  }
  const folder = `${VPS_SECRET_ROOT}/${threadId}`;
  const file = `${folder}/${messageId}`;
  // Drop day-old files first, so a code the bot never deleted does not outlive the 24 hours it was promised.
  const script = `umask 077 && mkdir -p '${folder}' && chmod 700 '${VPS_SECRET_ROOT}' '${folder}' && find '${VPS_SECRET_ROOT}' -type f -mmin +1440 -delete 2>/dev/null; rm -f '${file}' && cat > '${file}' && chmod 600 '${file}'`;
  try {
    await runner(
      vpsDockerArgs(alias, ["exec", "-i", "-u", "cua", "-e", "HOME=/home/cua", containerRef, "sh", "-c", script]),
      { timeoutMs: 30_000, input: value },
    );
  } catch {
    throw new Error("the VPS computer could not take the secret file");
  }
  return file;
}
