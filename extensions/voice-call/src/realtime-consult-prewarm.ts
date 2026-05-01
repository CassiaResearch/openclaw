import type { OpenClawConfig } from "openclaw/plugin-sdk/config-types";
import type { CoreAgentDeps } from "./core-bridge.js";

export async function prewarmVoiceCallConsultAgent(params: {
  cfg: OpenClawConfig;
  agentRuntime: CoreAgentDeps;
  agentId?: string;
  logger?: any;
}): Promise<void> {
  params.logger?.warn("[voice-call] Starting to prewarm voice call consult agent");
  const agentId = params.agentId ?? "main";
  const workspaceDir = params.agentRuntime.resolveAgentWorkspaceDir(params.cfg, agentId);
  params.logger?.warn("[voice-call] Resolving agent workspace directory", workspaceDir);
  await params.agentRuntime.ensureAgentWorkspace({ dir: workspaceDir });
  params.logger?.warn("[voice-call] Ensuring agent workspace", workspaceDir);
  const storePath = params.agentRuntime.session.resolveStorePath(params.cfg.session?.store, {
    agentId,
  });
  params.logger?.warn("[voice-call] Resolving session store path", storePath);
  params.agentRuntime.session.loadSessionStore(storePath);
  params.logger?.warn("[voice-call] Prewarming voice call consult agent complete", agentId);
}
